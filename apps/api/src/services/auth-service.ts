import { loadConfig } from '../config/env.ts';
import { logger } from '../config/logger.ts';
import { pool, query, queryOne, withTransaction } from '../db/pool.ts';
import { recordAudit } from '../lib/audit.ts';
import { generateToken, hashPassword, hashToken, passwordHashNeedsUpgrade, verifyPassword } from '../lib/crypto.ts';
import { AppError } from '../lib/errors.ts';
import { sendEmail } from './email.ts';

/**
 * Account lifecycle: registration, sign-in, email verification, password
 * recovery and session management.
 *
 * Security notes enforced here:
 *   * Passwords are hashed with Argon2id; hashes are never returned or logged.
 *   * Sign-in failures are counted per account and temporarily lock the account,
 *     which complements the per-IP rate limiter.
 *   * Verification and recovery tokens are random, single-use and stored only as
 *     SHA-256 hashes with an expiry.
 *   * Resetting or changing a password revokes every other session.
 *   * `role` and `account_status` are never taken from request input: only
 *     administrator provisioning or migrations can set them.
 */
const config = loadConfig();

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const VERIFICATION_TTL_HOURS = 48;
const RESET_TTL_MINUTES = 60;

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  phone?: string | undefined;
  region?: string | undefined;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface RegisterResult {
  userId: string;
  email: string;
  verificationRequired: boolean;
  /** True when the verification email could not actually be delivered. */
  verificationEmailDelivered: boolean;
  verificationMailNotice?: string;
}

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const passwordHash = await hashPassword(input.password);

  const result = await withTransaction(async (tx) => {
    const existing = await tx.queryOne<{ id: string }>('SELECT id FROM users WHERE email_normalised = lower($1)', [input.email]);
    if (existing) {
      throw AppError.conflict('An account already exists for this email address. Sign in or reset your password instead.');
    }
    const created = await tx.queryOne<{ id: string; email: string; created_at: Date }>(
      `INSERT INTO users (email, password_hash, full_name, role, account_status)
       VALUES ($1, $2, $3, 'user', 'active')
       RETURNING id, email, created_at`,
      [input.email, passwordHash, input.fullName],
    );
    if (!created) throw AppError.internal('The account could not be created');

    await tx.query(
      `INSERT INTO user_profiles (user_id, display_name, region, phone, phone_visible, public_profile)
       VALUES ($1, $2, $3, $4, false, true)`,
      [created.id, input.fullName, input.region ?? null, input.phone ?? null],
    );
    return created;
  });

  await recordAudit(
    {
      actorId: result.id,
      actorRole: 'user',
      action: 'account.registered',
      entityType: 'user',
      entityId: result.id,
      ipAddress: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
      metadata: { emailVerified: !config.email.verificationRequired },
    },
    pool.query.bind(pool) as never,
  );

  let verificationEmailDelivered = false;
  let verificationMailNotice: string | undefined;

  if (config.email.verificationRequired) {
    const delivery = await sendVerificationEmail(result.id, result.email, input.fullName, input.ip);
    verificationEmailDelivered = delivery.delivered;
    if (!delivery.delivered) {
      verificationMailNotice =
        'Your account was created, but this deployment cannot deliver email yet, so no verification message could be sent. An administrator must configure SMTP (or verify your account manually) before you can publish listings.';
    }
  }

  return {
    userId: result.id,
    email: result.email,
    verificationRequired: config.email.verificationRequired,
    verificationEmailDelivered,
    verificationMailNotice,
  };
}

export async function sendVerificationEmail(
  userId: string,
  email: string,
  fullName: string,
  ip?: string,
): Promise<{ delivered: boolean }> {
  const { token, hash } = generateToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_HOURS * 3_600_000);
  await query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, request_ip)
     VALUES ($1, 'email_verification', $2, $3, $4)`,
    [userId, hash, expiresAt, ip ?? null],
  );
  const link = `${config.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  const result = await sendEmail({
    to: email,
    subject: 'Verify your SWAPMART email address',
    template: 'verify_email',
    text: `Hello ${fullName},\n\nConfirm your email address to finish setting up your SWAPMART account:\n${link}\n\nThis link expires in ${VERIFICATION_TTL_HOURS} hours. If you did not create a SWAPMART account, you can ignore this message.\n\nSWAPMART — peer-to-peer electronics marketplace, Tanzania`,
    metadata: { userId, expiresAt: expiresAt.toISOString() },
  });
  return { delivered: result.delivered };
}

export async function confirmEmailVerification(token: string, ip?: string, userAgent?: string): Promise<{ userId: string }> {
  const hash = hashToken(token);
  const row = await queryOne<{ id: string; user_id: string; expires_at: Date; consumed_at: Date | null }>(
    `SELECT id, user_id, expires_at, consumed_at FROM auth_tokens
      WHERE token_hash = $1 AND purpose = 'email_verification'`,
    [hash],
  );
  if (!row || row.consumed_at || row.expires_at.getTime() < Date.now()) {
    throw AppError.validation('This verification link is invalid or has expired. Request a new verification email.');
  }
  await withTransaction(async (tx) => {
    await tx.query('UPDATE auth_tokens SET consumed_at = now() WHERE id = $1', [row.id]);
    await tx.query('UPDATE users SET email_verified_at = now() WHERE id = $1 AND email_verified_at IS NULL', [row.user_id]);
  });
  await recordAudit({
    actorId: row.user_id,
    actorRole: 'user',
    action: 'account.email_verified',
    entityType: 'user',
    entityId: row.user_id,
    ipAddress: ip,
    userAgent,
  });
  return { userId: row.user_id };
}

export interface LoginInput {
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface LoginResult {
  userId: string;
  sessionId: string;
  token: string;
  expiresAt: Date;
  role: 'user' | 'admin';
}

export async function loginUser(input: LoginInput): Promise<LoginResult> {
  const user = await queryOne<{
    id: string;
    email: string;
    password_hash: string;
    role: 'user' | 'admin';
    account_status: string;
    status_reason: string | null;
    failed_login_count: number;
    locked_until: Date | null;
    full_name: string;
  }>(
    `SELECT id, email, password_hash, role, account_status, status_reason, failed_login_count, locked_until, full_name
       FROM users WHERE email_normalised = lower($1)`,
    [input.email],
  );

  // Uniform failure handling: an unknown email and a wrong password produce the
  // same response and take a comparable amount of time (a dummy verification).
  if (!user) {
    await verifyPassword(
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$0000000000000000000000000000000000000000000',
      input.password,
    );
    await recordAudit({
      actorRole: 'anonymous',
      action: 'auth.login_failed',
      entityType: 'user',
      outcome: 'failure',
      ipAddress: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
      metadata: { reason: 'unknown_email' },
    });
    throw AppError.unauthenticated('The email address or password is incorrect');
  }

  if (user.locked_until && user.locked_until.getTime() > Date.now()) {
    const minutes = Math.ceil((user.locked_until.getTime() - Date.now()) / 60_000);
    throw AppError.rateLimited(
      `This account is temporarily locked after repeated failed sign-in attempts. Try again in ${minutes} minute(s), or reset your password.`,
    );
  }

  const passwordValid = await verifyPassword(user.password_hash, input.password);
  if (!passwordValid) {
    const failedCount = user.failed_login_count + 1;
    const lockUntil = failedCount >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;
    await query('UPDATE users SET failed_login_count = $2, locked_until = $3 WHERE id = $1', [user.id, failedCount, lockUntil]);
    await recordAudit({
      actorId: user.id,
      actorRole: 'user',
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user.id,
      outcome: 'failure',
      ipAddress: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
      metadata: { failedCount, locked: lockUntil !== null },
    });
    throw AppError.unauthenticated('The email address or password is incorrect');
  }

  if (user.account_status === 'suspended') {
    await recordAudit({
      actorId: user.id,
      actorRole: 'user',
      action: 'auth.login_blocked',
      entityType: 'user',
      entityId: user.id,
      outcome: 'denied',
      ipAddress: input.ip,
      userAgent: input.userAgent,
      metadata: { reason: 'suspended' },
    });
    throw AppError.suspended(user.status_reason);
  }

  if (user.account_status === 'deactivated') {
    throw AppError.forbidden('This account has been deactivated. Contact support to reopen it.');
  }

  // Opportunistic rehash when the hashing policy has been strengthened.
  if (passwordHashNeedsUpgrade(user.password_hash)) {
    const rehashed = await hashPassword(input.password);
    await query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [user.id, rehashed]);
    logger.info({ userId: user.id }, 'password hash upgraded to the current policy');
  }

  const { token, hash } = generateToken(32);
  const expiresAt = new Date(Date.now() + config.security.sessionTtlDays * 86_400_000);
  const session = await withTransaction(async (tx) => {
    const created = await tx.queryOne<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, csrf_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [user.id, hash, hashToken(token), input.ip ?? null, input.userAgent?.slice(0, 400) ?? null, expiresAt],
    );
    await tx.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
    return created;
  });
  if (!session) throw AppError.internal('The session could not be created');

  await recordAudit({
    actorId: user.id,
    actorRole: user.role,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    ipAddress: input.ip,
    userAgent: input.userAgent,
    requestId: input.requestId,
  });

  return { userId: user.id, sessionId: session.id, token, expiresAt, role: user.role };
}

export async function revokeSession(sessionId: string, reason: string, actorId?: string): Promise<void> {
  await query('UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL', [
    sessionId,
    reason,
  ]);
  if (actorId) {
    await recordAudit({
      actorId,
      actorRole: 'user',
      action: 'auth.session_revoked',
      entityType: 'session',
      entityId: sessionId,
      metadata: { reason },
    });
  }
}

export async function requestPasswordReset(email: string, ip?: string): Promise<{ delivered: boolean; requested: boolean }> {
  const user = await queryOne<{ id: string; full_name: string; email: string }>(
    'SELECT id, full_name, email FROM users WHERE email_normalised = lower($1) AND account_status <> \'deactivated\'',
    [email],
  );
  // The response is identical whether or not the account exists, so the endpoint
  // cannot be used to enumerate registered addresses.
  if (!user) return { delivered: false, requested: false };

  const { token, hash } = generateToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);
  await query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, request_ip)
     VALUES ($1, 'password_reset', $2, $3, $4)`,
    [user.id, hash, expiresAt, ip ?? null],
  );
  const link = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const result = await sendEmail({
    to: user.email,
    subject: 'Reset your SWAPMART password',
    template: 'password_reset',
    text: `Hello ${user.full_name},\n\nA password reset was requested for your SWAPMART account. Use this link within ${RESET_TTL_MINUTES} minutes:\n${link}\n\nIf you did not request this, no action is needed — your password has not changed.\n\nSWAPMART — peer-to-peer electronics marketplace, Tanzania`,
    metadata: { userId: user.id },
  });
  await recordAudit({
    actorId: user.id,
    actorRole: 'user',
    action: 'auth.password_reset_requested',
    entityType: 'user',
    entityId: user.id,
    ipAddress: ip,
  });
  return { delivered: result.delivered, requested: true };
}

export async function resetPassword(token: string, newPassword: string, ip?: string, userAgent?: string): Promise<{ userId: string }> {
  const hash = hashToken(token);
  const row = await queryOne<{ id: string; user_id: string; expires_at: Date; consumed_at: Date | null }>(
    `SELECT id, user_id, expires_at, consumed_at FROM auth_tokens
      WHERE token_hash = $1 AND purpose = 'password_reset'`,
    [hash],
  );
  if (!row || row.consumed_at || row.expires_at.getTime() < Date.now()) {
    throw AppError.validation('This password reset link is invalid or has expired. Request a new one.');
  }
  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (tx) => {
    await tx.query('UPDATE auth_tokens SET consumed_at = now() WHERE id = $1', [row.id]);
    await tx.query(
      `UPDATE users SET password_hash = $2, password_changed_at = now(), failed_login_count = 0, locked_until = NULL
        WHERE id = $1`,
      [row.user_id, passwordHash],
    );
    // Every existing session is revoked: possession of the old password may have
    // been compromised, so all devices must sign in again.
    await tx.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_reset' WHERE user_id = $1 AND revoked_at IS NULL`, [
      row.user_id,
    ]);
  });
  await recordAudit({
    actorId: row.user_id,
    actorRole: 'user',
    action: 'auth.password_reset_completed',
    entityType: 'user',
    entityId: row.user_id,
    ipAddress: ip,
    userAgent,
  });
  return { userId: row.user_id };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId?: string,
  ip?: string,
): Promise<void> {
  const user = await queryOne<{ password_hash: string; email: string; full_name: string }>(
    'SELECT password_hash, email, full_name FROM users WHERE id = $1',
    [userId],
  );
  if (!user) throw AppError.notFound('Account not found');
  const valid = await verifyPassword(user.password_hash, currentPassword);
  if (!valid) throw AppError.validation('The current password is incorrect', [{ path: 'currentPassword', message: 'Incorrect password' }]);

  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (tx) => {
    await tx.query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [userId, passwordHash]);
    await tx.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_changed'
        WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [userId, keepSessionId ?? null],
    );
  });
  await sendEmail({
    to: user.email,
    subject: 'Your SWAPMART password was changed',
    template: 'password_changed',
    text: `Hello ${user.full_name},\n\nYour SWAPMART password was changed and all other sessions were signed out. If this was not you, reset your password immediately and contact support.\n\nSWAPMART — peer-to-peer electronics marketplace, Tanzania`,
    metadata: { userId },
  });
  await recordAudit({
    actorId: userId,
    actorRole: 'user',
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: userId,
    ipAddress: ip,
  });
}

export interface ProfileUpdateInput {
  displayName?: string;
  bio?: string;
  phone?: string;
  region?: string;
  city?: string;
  phoneVisible?: boolean;
  publicProfile?: boolean;
  avatarMediaId?: string | null;
}

export async function updateProfile(userId: string, input: ProfileUpdateInput): Promise<void> {
  const assignments: string[] = [];
  const values: unknown[] = [userId];
  const push = (column: string, value: unknown) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };
  if (input.displayName !== undefined) push('display_name', input.displayName);
  if (input.bio !== undefined) push('bio', input.bio);
  if (input.phone !== undefined) push('phone', input.phone);
  if (input.region !== undefined) push('region', input.region);
  if (input.city !== undefined) push('city', input.city);
  if (input.phoneVisible !== undefined) push('phone_visible', input.phoneVisible);
  if (input.publicProfile !== undefined) push('public_profile', input.publicProfile);
  if (input.avatarMediaId !== undefined) {
    if (input.avatarMediaId) {
      const asset = await queryOne<{ id: string }>(
        `SELECT id FROM media_assets WHERE id = $1 AND owner_id = $2 AND purpose = 'avatar' AND deleted_at IS NULL`,
        [input.avatarMediaId, userId],
      );
      if (!asset) throw AppError.validation('The selected profile photo is not one of your uploads');
    }
    push('avatar_media_id', input.avatarMediaId);
  }
  if (assignments.length === 0) return;
  await query(`UPDATE user_profiles SET ${assignments.join(', ')} WHERE user_id = $1`, values);
}

export async function deactivateAccount(userId: string, password: string, reason?: string): Promise<void> {
  const user = await queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!user) throw AppError.notFound('Account not found');
  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) throw AppError.validation('The password is incorrect', [{ path: 'password', message: 'Incorrect password' }]);

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE users SET account_status = 'deactivated', deactivated_at = now(), status_reason = $2 WHERE id = $1`,
      [userId, reason ?? 'Deactivated by the account owner'],
    );
    await tx.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'account_deactivated' WHERE user_id = $1`, [userId]);
    // Listings are withdrawn so they cannot mislead buyers once the seller is gone.
    await tx.query(
      `UPDATE listings SET status = 'withdrawn', availability = 'inactive', updated_at = now()
        WHERE seller_id = $1 AND status NOT IN ('withdrawn')`,
      [userId],
    );
  });
  await recordAudit({
    actorId: userId,
    actorRole: 'user',
    action: 'account.deactivated',
    entityType: 'user',
    entityId: userId,
    metadata: { reason: reason ?? null },
  });
}

export async function listSessions(userId: string, includeRevoked: boolean) {
  const { rows } = await query(
    `SELECT id, created_at, last_seen_at, expires_at, user_agent, ip_address, revoked_at
       FROM sessions WHERE user_id = $1 AND ($2::boolean OR revoked_at IS NULL)
      ORDER BY last_seen_at DESC LIMIT 50`,
    [userId, includeRevoked],
  );
  return rows;
}

export async function revokeSessionOwnedBy(userId: string, sessionId: string): Promise<void> {
  const session = await queryOne<{ id: string }>('SELECT id FROM sessions WHERE id = $1 AND user_id = $2', [sessionId, userId]);
  if (!session) throw AppError.notFound('Session not found');
  await revokeSession(sessionId, 'revoked_by_user', userId);
}

export async function currentUserProfileRow(userId: string) {
  return queryOne(
    `SELECT p.user_id, p.display_name, p.bio, p.region, p.city, p.phone, p.phone_visible, p.public_profile,
            p.created_at, u.created_at AS user_created_at
       FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1`,
    [userId],
  );
}

/** Used for the admin "create administrator" provisioning flow only. */
export async function provisionAdmin(email: string, password: string, fullName: string): Promise<{ userId: string; created: boolean }> {
  const passwordHash = await hashPassword(password);
  return withTransaction(async (tx) => {
    const existing = await tx.queryOne<{ id: string }>('SELECT id FROM users WHERE email_normalised = lower($1)', [email]);
    if (existing) {
      await tx.query(
        `UPDATE users SET role = 'admin', account_status = 'active', password_hash = $2, email_verified_at = COALESCE(email_verified_at, now())
          WHERE id = $1`,
        [existing.id, passwordHash],
      );
      await tx.query(
        `INSERT INTO user_profiles (user_id, display_name, public_profile)
         VALUES ($1, $2, false)
         ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, public_profile = false`,
        [existing.id, fullName],
      );
      return { userId: existing.id, created: false };
    }
    const created = await tx.queryOne<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, account_status, email_verified_at)
       VALUES ($1, $2, $3, 'admin', 'active', now()) RETURNING id`,
      [email, passwordHash, fullName],
    );
    if (!created) throw AppError.internal('Administrator could not be created');
    await tx.query(`INSERT INTO user_profiles (user_id, display_name, phone_visible, public_profile) VALUES ($1, $2, false, false)`, [
      created.id,
      fullName,
    ]);
    return { userId: created.id, created: true };
  });
}

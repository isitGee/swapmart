import { Router } from 'express';
import {
  accountDeactivateSchema,
  emailVerificationConfirmSchema,
  emailVerificationRequestSchema,
  loginSchema,
  passwordChangeSchema,
  passwordForgotSchema,
  passwordResetSchema,
  profileUpdateSchema,
  registerSchema,
  sessionListQuerySchema,
  uuidSchema,
  PAGINATION,
} from '@swapmart/shared';
import { z } from 'zod';
import { loadConfig } from '../config/env.ts';
import { queryOne } from '../db/pool.ts';
import { asyncHandler, clientIp } from '../lib/http.ts';
import { AppError } from '../lib/errors.ts';
import { authLimiter, sensitiveLimiter } from '../middleware/security.ts';
import {
  clearSessionCookie,
  cookieOptions,
  currentUser,
  CSRF_COOKIE,
  requireAuth,
  setSessionCookie,
  SESSION_COOKIE,
} from '../middleware/auth.ts';
import { body, params, query, validate } from '../middleware/validate.ts';
import {
  changePassword,
  confirmEmailVerification,
  deactivateAccount,
  listSessions,
  loginUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  revokeSessionOwnedBy,
  sendVerificationEmail,
  updateProfile,
  currentUserProfileRow,
} from '../services/auth-service.ts';
import { toCurrentUser, toSession } from '../services/serializers.ts';
import { unreadCounts } from '../services/notifications.ts';
import { latestOutboxEntry } from '../services/email.ts';
import type { LoginInput, RegisterInput, ProfileUpdateInput } from '@swapmart/shared';

/**
 * Authentication and account routes.
 *
 * Registration can never set `role` or `account_status`: a public request cannot
 * obtain administrator privileges. Sessions are cookie based, and every
 * state-changing endpoint is covered by the CSRF middleware in app.ts.
 */
export const authRouter = Router();
const config = loadConfig();

authRouter.post(
  '/auth/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const input = body<RegisterInput>(req);
    const result = await registerUser({
      fullName: input.fullName,
      email: input.email,
      password: input.password,
      phone: input.phone,
      region: input.region,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });
    res.status(201).json({
      data: {
        userId: result.userId,
        email: result.email,
        verificationRequired: result.verificationRequired,
        verificationEmailDelivered: result.verificationEmailDelivered,
        notice: result.verificationMailNotice ?? null,
      },
    });
  }),
);

authRouter.post(
  '/auth/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const input = body<LoginInput>(req);
    const result = await loginUser({
      email: input.email,
      password: input.password,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });
    setSessionCookie(res, result.sessionId, result.token, result.expiresAt);
    res.json({
      data: {
        userId: result.userId,
        role: result.role,
        expiresAt: result.expiresAt.toISOString(),
        csrfToken: req.cookies?.[CSRF_COOKIE] ?? null,
      },
    });
  }),
);

authRouter.post(
  '/auth/logout',
  asyncHandler(async (req, res) => {
    if (req.auth) {
      await queryOne('UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 RETURNING id', [
        req.auth.session.id,
        'signed_out',
      ]);
    }
    clearSessionCookie(res);
    res.json({ data: { signedOut: true } });
  }),
);

authRouter.post('/auth/email/verify', authLimiter, validate({ body: emailVerificationRequestSchema }), asyncHandler(async (req, res) => {
  const { email } = body<{ email: string }>(req);
  const user = await queryOne<{ id: string; full_name: string; email_verified_at: Date | null }>(
    'SELECT id, full_name, email_verified_at FROM users WHERE email_normalised = lower($1)',
    [email],
  );
  // Always the same response: this endpoint must not reveal whether an account exists.
  if (user && !user.email_verified_at) {
    await sendVerificationEmail(user.id, email, user.full_name, clientIp(req));
  }
  res.json({
    data: {
      requested: true,
      message: 'If that address belongs to an unverified SWAPMART account, a verification email has been sent.',
    },
  });
}));

authRouter.post('/auth/email/confirm', authLimiter, validate({ body: emailVerificationConfirmSchema }), asyncHandler(async (req, res) => {
  const { token } = body<{ token: string }>(req);
  const result = await confirmEmailVerification(token, clientIp(req), req.headers['user-agent']);
  res.json({ data: { verified: true, userId: result.userId } });
}));

authRouter.post('/auth/password/forgot', authLimiter, validate({ body: passwordForgotSchema }), asyncHandler(async (req, res) => {
  const { email } = body<{ email: string }>(req);
  const result = await requestPasswordReset(email, clientIp(req));
  res.json({
    data: {
      requested: true,
      emailDelivered: result.delivered,
      message: result.delivered
        ? 'If that address belongs to a SWAPMART account, a password reset email has been sent.'
        : 'If that address belongs to a SWAPMART account, a reset link has been recorded. This deployment cannot deliver email, so an administrator must provide the link.',
    },
  });
}));

authRouter.post('/auth/password/reset', authLimiter, validate({ body: passwordResetSchema }), asyncHandler(async (req, res) => {
  const input = body<{ token: string; password: string }>(req);
  await resetPassword(input.token, input.password, clientIp(req), req.headers['user-agent']);
  clearSessionCookie(res);
  res.json({ data: { reset: true, message: 'Your password was changed. Sign in with your new password.' } });
}));

authRouter.get(
  '/auth/me',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    if (!user) {
      // 200 with an explicit null keeps the client simple: "signed out" is a
      // normal state, not an error.
      res.json({ data: null, meta: { authenticated: false, email: { transport: config.email.transport, verificationRequired: config.email.verificationRequired } } });
      return;
    }
    const profile = await currentUserProfileRow(user.id);
    const unread = await unreadCounts(user.id);
    res.json({
      data: toCurrentUser(user, (profile ?? { created_at: new Date().toISOString() }) as Record<string, unknown>, unread),
      meta: { authenticated: true, csrfToken: req.cookies?.[CSRF_COOKIE] ?? null },
    });
  }),
);

authRouter.patch('/auth/profile', requireAuth, validate({ body: profileUpdateSchema }), asyncHandler(async (req, res) => {
  const user = currentUser(req);
  if (!user) throw AppError.unauthenticated();
  await updateProfile(user.id, body<ProfileUpdateInput>(req));
  const profile = await currentUserProfileRow(user.id);
  const unread = await unreadCounts(user.id);
  // Re-read the user row so the response reflects the saved values.
  const refreshed = await queryOne<{
    bio: string | null;
    region: string | null;
    city: string | null;
    phone: string | null;
    phone_visible: boolean;
    public_profile: boolean;
    display_name: string | null;
  }>('SELECT bio, region, city, phone, phone_visible, public_profile, display_name FROM user_profiles WHERE user_id = $1', [user.id]);
  res.json({
    data: toCurrentUser(
      { ...user, displayName: refreshed?.display_name ?? user.displayName },
      (profile ?? {}) as Record<string, unknown>,
      unread,
    ),
  });
}));

authRouter.post(
  '/auth/password/change',
  requireAuth,
  sensitiveLimiter,
  validate({ body: passwordChangeSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    if (!user || !req.auth) throw AppError.unauthenticated();
    const input = body<{ currentPassword: string; newPassword: string }>(req);
    await changePassword(user.id, input.currentPassword, input.newPassword, req.auth.session.id, clientIp(req));
    res.json({ data: { changed: true, message: 'Password updated. Other devices were signed out.' } });
  }),
);

authRouter.get(
  '/auth/sessions',
  requireAuth,
  validate({ query: sessionListQuerySchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    if (!user || !req.auth) throw AppError.unauthenticated();
    const options = query<{ includeRevoked: boolean }>(req);
    const rows = await listSessions(user.id, options.includeRevoked);
    res.json({ data: rows.map((row) => toSession(row as Record<string, unknown>, req.auth!.session.id)) });
  }),
);

authRouter.delete(
  '/auth/sessions/:id',
  requireAuth,
  validate({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    if (!user) throw AppError.unauthenticated();
    const { id } = params<{ id: string }>(req);
    await revokeSessionOwnedBy(user.id, id);
    const isCurrent = req.auth?.session.id === id;
    if (isCurrent) clearSessionCookie(res);
    res.json({ data: { revoked: true, signedOutCurrent: isCurrent } });
  }),
);

authRouter.post(
  '/auth/account/deactivate',
  requireAuth,
  sensitiveLimiter,
  validate({ body: accountDeactivateSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    if (!user) throw AppError.unauthenticated();
    const input = body<{ password: string; reason?: string }>(req);
    await deactivateAccount(user.id, input.password, input.reason);
    clearSessionCookie(res);
    res.json({ data: { deactivated: true } });
  }),
);

/**
 * Development-only email outbox.
 *
 * When no SMTP server is configured, verification and reset links are recorded
 * instead of delivered. This endpoint exposes the newest entry for an address so
 * that local development (and the automated test suite) can complete the flow —
 * it is disabled outside development/test and never exposes SMTP-mode mail.
 */
if (config.env !== 'production') {
  authRouter.get(
    '/dev/email-outbox',
    validate({ query: z.object({ email: z.string().email(), template: z.string().optional() }) }),
    asyncHandler(async (req, res) => {
      if (config.email.transport !== 'log') {
        throw AppError.notConfigured(
          'Development email outbox',
          'The SMTP transport is configured, so outbox inspection is not available.',
        );
      }
      const { email, template } = query<{ email: string; template?: string }>(req);
      const entry = await latestOutboxEntry(email, template as never);
      if (!entry) throw AppError.notFound('No email has been recorded for that address');
      res.json({
        data: {
          id: entry.id,
          to: email,
          subject: entry.subject,
          bodyText: entry.body_text,
          template: entry.template,
          createdAt: entry.created_at.toISOString(),
          transport: 'log',
          notice: 'Development transport: the message was recorded, not delivered.',
        },
      });
    }),
  );
}

export { SESSION_COOKIE, cookieOptions, PAGINATION };

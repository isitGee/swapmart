import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AccountStatus, UserRole } from '@swapmart/shared';
import { loadConfig } from '../config/env.ts';
import { queryOne } from '../db/pool.ts';
import { hashToken } from '../lib/crypto.ts';
import { AppError } from '../lib/errors.ts';
import type { AuthContext, AuthenticatedUser } from '../types/express.d.ts';

const config = loadConfig();

export const SESSION_COOKIE = config.isProduction ? '__Host-swapmart_session' : 'swapmart_session';
export const CSRF_COOKIE = config.isProduction ? '__Host-swapmart_csrf' : 'swapmart_csrf';

interface SessionRow {
  session_id: string;
  session_created_at: Date;
  session_expires_at: Date;
  session_last_seen_at: Date;
  token_hash: string;
  user_id: string;
  email: string;
  email_verified_at: Date | null;
  role: UserRole;
  account_status: AccountStatus;
  status_reason: string | null;
  restricted_until: Date | null;
  full_name: string;
  password_changed_at: Date;
  identity_reviewed_at: Date | null;
  display_name: string | null;
  avatar_url: string | null;
  region: string | null;
}

/**
 * Resolves the session cookie into `req.auth`.
 *
 * Sessions are database-backed and store only a SHA-256 hash of the token, so
 * revocation is immediate and a database leak does not hand over live sessions.
 * The lookup is a single indexed query; `last_seen_at` is refreshed at most once
 * every five minutes to avoid a write on every request.
 */
export const attachAuth: RequestHandler = (req, _res, next) => {
  req.validated = req.validated ?? {};
  const cookie = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!cookie || !cookie.includes('.')) {
    next();
    return;
  }
  const [sessionId, token] = cookie.split('.') as [string, string];
  if (!sessionId || !token) {
    next();
    return;
  }

  void (async () => {
    try {
      const row = await queryOne<SessionRow>(
        `SELECT s.id AS session_id, s.created_at AS session_created_at, s.expires_at AS session_expires_at,
                s.last_seen_at AS session_last_seen_at, s.token_hash,
                u.id AS user_id, u.email, u.email_verified_at, u.role, u.account_status, u.status_reason,
                u.restricted_until, u.full_name, u.password_changed_at, u.identity_reviewed_at,
                p.display_name, p.region, ma.url AS avatar_url
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN user_profiles p ON p.user_id = u.id
           LEFT JOIN media_assets ma ON ma.id = p.avatar_media_id
          WHERE s.id = $1`,
        [sessionId],
      );
      if (!row) {
        next();
        return;
      }
      // Token must match the stored hash, and the session must be live.
      if (row.token_hash !== hashToken(token)) {
        next();
        return;
      }
      const now = Date.now();
      if (row.session_expires_at.getTime() <= now) {
        next();
        return;
      }
      if (row.account_status === 'deactivated') {
        next();
        return;
      }

      // Auto-expire a temporary restriction whose end date has passed.
      let accountStatus = row.account_status;
      let restrictionReason = row.status_reason;
      if (accountStatus === 'restricted' && row.restricted_until && row.restricted_until.getTime() <= now) {
        accountStatus = 'active';
        restrictionReason = null;
        await queryOne('UPDATE users SET account_status = $2, status_reason = NULL, restricted_until = NULL WHERE id = $1 RETURNING id', [
          row.user_id,
          'active',
        ]);
      }

      const user: AuthenticatedUser = {
        id: row.user_id,
        email: row.email,
        emailVerified: row.email_verified_at !== null,
        role: row.role,
        accountStatus,
        restrictedUntil: row.restricted_until,
        statusReason: restrictionReason,
        fullName: row.full_name,
        displayName: row.display_name ?? row.full_name,
        avatarUrl: row.avatar_url,
        region: row.region,
        passwordChangedAt: row.password_changed_at,
        identityReviewedAt: row.identity_reviewed_at,
      };

      const auth: AuthContext = {
        user,
        session: {
          id: row.session_id,
          createdAt: row.session_created_at,
          expiresAt: row.session_expires_at,
          lastSeenAt: row.session_last_seen_at,
        },
      };
      req.auth = auth;

      if (now - row.session_last_seen_at.getTime() > 5 * 60 * 1000) {
        void queryOne('UPDATE sessions SET last_seen_at = now() WHERE id = $1 RETURNING id', [sessionId]);
      }
      next();
    } catch (error) {
      next(error);
    }
  })();
};

/**
 * Marks a route as readable by guests as well as signed-in members.
 * `attachAuth` already resolves the session for every request; this middleware
 * exists so routes are explicit about who may call them.
 */
export const optionalAuth: RequestHandler = (_req, _res, next) => {
  next();
};

export function currentUser(req: Request): AuthenticatedUser | null {
  return req.auth?.user ?? null;
}

/** Throws when a suspended account tries to use an authenticated endpoint. */
function assertUsable(user: AuthenticatedUser): void {
  if (user.accountStatus === 'suspended') {
    throw AppError.suspended(user.statusReason);
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(AppError.unauthenticated());
    return;
  }
  try {
    assertUsable(req.auth.user);
    next();
  } catch (error) {
    next(error);
  }
};

export const requireEmailVerified: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(AppError.unauthenticated());
    return;
  }
  if (config.email.verificationRequired && !req.auth.user.emailVerified) {
    next(AppError.emailNotVerified());
    return;
  }
  next();
};

/** Administrator gate. Privileges are checked against the database row only. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(AppError.unauthenticated());
    return;
  }
  if (req.auth.user.role !== 'admin') {
    next(AppError.forbidden('Administrator access is required for this action'));
    return;
  }
  try {
    assertUsable(req.auth.user);
    next();
  } catch (error) {
    next(error);
  }
};

export type Capability = 'createListing' | 'message' | 'exchange' | 'report' | 'transact';

/**
 * Capability gate used by marketplace actions. A `restricted` account can still
 * browse, save listings and view history, but cannot create listings, start
 * conversations, propose exchanges or open transactions.
 */
export function requireCapability(capability: Capability): RequestHandler {
  return (req, _res, next) => {
    const user = req.auth?.user;
    if (!user) {
      next(AppError.unauthenticated());
      return;
    }
    if (user.accountStatus === 'suspended') {
      next(AppError.suspended(user.statusReason));
      return;
    }
    if (user.accountStatus === 'restricted' && capability !== 'report') {
      next(AppError.restricted(user.statusReason));
      return;
    }
    if (config.email.verificationRequired && !user.emailVerified && capability !== 'report') {
      next(AppError.emailNotVerified());
      return;
    }
    next();
  };
}

export function capabilitiesFor(user: AuthenticatedUser | null): {
  canCreateListing: boolean;
  canMessage: boolean;
  canExchange: boolean;
  canReport: boolean;
  isAdmin: boolean;
} {
  if (!user) {
    return { canCreateListing: false, canMessage: false, canExchange: false, canReport: false, isAdmin: false };
  }
  const active = user.accountStatus === 'active';
  const verified = !config.email.verificationRequired || user.emailVerified;
  return {
    canCreateListing: active && verified,
    canMessage: active && verified,
    canExchange: active && verified,
    canReport: user.accountStatus !== 'suspended',
    isAdmin: user.role === 'admin',
  };
}

export function setSessionCookie(res: Response, sessionId: string, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, `${sessionId}.${token}`, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

export function cookieOptions(): { secure: boolean; sameSite: 'lax' | 'strict' | 'none'; path: string } {
  return { secure: config.isProduction, sameSite: 'lax', path: '/' };
}

export type { NextFunction };

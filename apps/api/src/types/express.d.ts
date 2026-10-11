import type { AccountStatus, UserRole } from '@swapmart/shared';

/**
 * Request augmentation. Validated input is stored on `req.validated` rather
 * than overwriting `req.query`/`req.body`, because Express 5 exposes `req.query`
 * as a getter and silently replacing request input is a common source of
 * confused-deputy bugs.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  accountStatus: AccountStatus;
  restrictedUntil: Date | null;
  statusReason: string | null;
  fullName: string;
  displayName: string;
  avatarUrl: string | null;
  region: string | null;
  passwordChangedAt: Date;
  identityReviewedAt: Date | null;
}

export interface AuthContext {
  user: AuthenticatedUser;
  session: {
    id: string;
    createdAt: Date;
    expiresAt: Date;
    lastSeenAt: Date;
  };
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      validated: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

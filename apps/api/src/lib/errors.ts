/**
 * Application error type.
 *
 * Every error surfaced to a client has a stable machine-readable `code`, an
 * HTTP status, and a message that is safe to display. Internal details
 * (PostgreSQL messages, stack traces, absolute paths, secrets) are logged but
 * never sent to the client — the central error handler enforces this.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'validation_failed',
  UNAUTHENTICATED: 'unauthenticated',
  EMAIL_NOT_VERIFIED: 'email_not_verified',
  ACCOUNT_SUSPENDED: 'account_suspended',
  ACCOUNT_RESTRICTED: 'account_restricted',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  IDENTIFIER_CONFLICT: 'identifier_conflict',
  INVALID_STATE_TRANSITION: 'invalid_state_transition',
  RATE_LIMITED: 'rate_limited',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  UNSUPPORTED_MEDIA_TYPE: 'unsupported_media_type',
  CSRF_FAILED: 'csrf_failed',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  NOT_CONFIGURED: 'not_configured',
  INTERNAL_ERROR: 'internal_error',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;
  /** Set when the error is expected (validation, 404): avoids noisy stack logs. */
  readonly expected: boolean;

  constructor(code: ErrorCode, status: number, message: string, details?: ErrorDetail[], expected = true) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.expected = expected;
  }

  static validation(message = 'Some of the submitted information is invalid', details?: ErrorDetail[]): AppError {
    return new AppError(ERROR_CODES.VALIDATION_FAILED, 422, message, details);
  }

  static unauthenticated(message = 'Sign in to continue'): AppError {
    return new AppError(ERROR_CODES.UNAUTHENTICATED, 401, message);
  }

  static emailNotVerified(): AppError {
    return new AppError(
      ERROR_CODES.EMAIL_NOT_VERIFIED,
      403,
      'Verify your email address to continue. Check your inbox for the verification link.',
    );
  }

  static suspended(reason?: string | null): AppError {
    return new AppError(
      ERROR_CODES.ACCOUNT_SUSPENDED,
      403,
      reason ? `Your account is suspended: ${reason}` : 'Your account is suspended. Contact support for a review.',
    );
  }

  static restricted(reason?: string | null): AppError {
    return new AppError(
      ERROR_CODES.ACCOUNT_RESTRICTED,
      403,
      reason
        ? `Your account is restricted from this action: ${reason}`
        : 'Your account is restricted from this action. Contact support for a review.',
    );
  }

  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError(ERROR_CODES.FORBIDDEN, 403, message);
  }

  static notFound(message = 'The requested resource was not found'): AppError {
    return new AppError(ERROR_CODES.NOT_FOUND, 404, message);
  }

  static conflict(message: string): AppError {
    return new AppError(ERROR_CODES.CONFLICT, 409, message);
  }

  static identifierConflict(message: string, details?: ErrorDetail[]): AppError {
    return new AppError(ERROR_CODES.IDENTIFIER_CONFLICT, 409, message, details);
  }

  static invalidTransition(message: string): AppError {
    return new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, 409, message);
  }

  static rateLimited(message = 'Too many requests. Please wait and try again.'): AppError {
    return new AppError(ERROR_CODES.RATE_LIMITED, 429, message);
  }

  static notConfigured(service: string, instructions?: string): AppError {
    return new AppError(
      ERROR_CODES.NOT_CONFIGURED,
      503,
      instructions ? `${service} is not configured on this deployment. ${instructions}` : `${service} is not configured on this deployment.`,
      undefined,
      true,
    );
  }

  static serviceUnavailable(message = 'The service is temporarily unavailable. Please try again.'): AppError {
    return new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, 503, message);
  }

  static internal(message = 'Something went wrong on our side. The incident has been logged.'): AppError {
    return new AppError(ERROR_CODES.INTERNAL_ERROR, 500, message, undefined, false);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

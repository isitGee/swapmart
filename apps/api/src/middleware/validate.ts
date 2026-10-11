import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../lib/errors.ts';

/**
 * Request validation.
 *
 * Validated values are stored on `req.validated` (they never replace the raw
 * request objects). Handlers must read input exclusively from `req.validated`,
 * which guarantees that every value has passed the same schema on the server —
 * client-side validation is a convenience, never a control.
 */
export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    req.validated = req.validated ?? {};
    try {
      if (schemas.params) {
        const parsed = schemas.params.safeParse(req.params);
        if (!parsed.success) throw toAppError(parsed.error.issues, 'params');
        req.validated.params = parsed.data;
      }
      if (schemas.query) {
        const parsed = schemas.query.safeParse(req.query);
        if (!parsed.success) throw toAppError(parsed.error.issues, 'query');
        req.validated.query = parsed.data;
      }
      if (schemas.body) {
        const parsed = schemas.body.safeParse(req.body);
        if (!parsed.success) throw toAppError(parsed.error.issues, 'body');
        req.validated.body = parsed.data;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

function toAppError(
  issues: { path: (string | number)[]; message: string }[],
  source: 'body' | 'query' | 'params',
): AppError {
  return AppError.validation(
    'Some of the submitted information is invalid',
    issues.map((issue) => ({
      path: [source, ...issue.path.map(String)].join('.'),
      message: issue.message,
    })),
  );
}

/** Typed accessor helpers used inside handlers. */
export function body<T>(req: { validated: { body?: unknown } }): T {
  return req.validated.body as T;
}

export function query<T>(req: { validated: { query?: unknown } }): T {
  return req.validated.query as T;
}

export function params<T>(req: { validated: { params?: unknown } }): T {
  return req.validated.params as T;
}

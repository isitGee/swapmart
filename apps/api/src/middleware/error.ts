import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.ts';
import { AppError, ERROR_CODES } from '../lib/errors.ts';
import type { ApiErrorBody } from '@swapmart/shared';

/**
 * Central error handling.
 *
 * Clients receive a stable error envelope with a safe message and, when
 * relevant, field-level details. Database messages, stack traces, file paths and
 * secrets stay in the server log — a caller is never told how the internals are
 * built. The `requestId` is echoed so a user can quote it in a support request
 * and an operator can find the matching log line.
 */
export const notFoundHandler: RequestHandler = (req, res) => {
  const payload: ApiErrorBody = {
    error: {
      code: ERROR_CODES.NOT_FOUND,
      message: `No API route matches ${req.method} ${req.path}`,
      requestId: req.requestId,
    },
  };
  res.status(404).json(payload);
};

function pgErrorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = req.requestId;

  if (res.headersSent) {
    logger.error({ err: error, requestId }, 'error after response was sent; closing connection');
    res.end();
    return;
  }

  // 1. Known application errors.
  if (error instanceof AppError) {
    if (!error.expected) {
      logger.error({ err: error, requestId, path: req.path }, 'application error');
    } else if (error.status >= 500) {
      logger.warn({ err: error, requestId, path: req.path }, 'expected service error');
    }
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details, requestId },
    } satisfies ApiErrorBody);
    return;
  }

  // 2. Schema validation that reached the handler without being validated.
  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Some of the submitted information is invalid',
        details: error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
        requestId,
      },
    } satisfies ApiErrorBody);
    return;
  }

  // 3. Body parser failures (malformed JSON, oversized payloads).
  const type = (error as { type?: string }).type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'The request body is not valid JSON', requestId },
    } satisfies ApiErrorBody);
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({
      error: { code: ERROR_CODES.PAYLOAD_TOO_LARGE, message: 'The uploaded data exceeds the allowed size', requestId },
    } satisfies ApiErrorBody);
    return;
  }

  // 4. Upload validation failures produced by multer.
  if (error instanceof Error && error.name === 'MulterError') {
    const multerCode = (error as Error & { code?: string }).code;
    const message =
      multerCode === 'LIMIT_FILE_SIZE'
        ? 'The file is larger than the allowed upload size'
        : multerCode === 'LIMIT_FILE_COUNT' || multerCode === 'LIMIT_UNEXPECTED_FILE'
          ? 'More files were attached than this endpoint accepts'
          : 'The upload could not be processed';
    res.status(multerCode === 'LIMIT_FILE_SIZE' ? 413 : 422).json({
      error: { code: multerCode === 'LIMIT_FILE_SIZE' ? ERROR_CODES.PAYLOAD_TOO_LARGE : ERROR_CODES.VALIDATION_FAILED, message, requestId },
    } satisfies ApiErrorBody);
    return;
  }

  // 5. Database constraint violations mapped to safe, actionable messages.
  const code = pgErrorCode(error);
  if (code === '23505') {
    res.status(409).json({
      error: {
        code: ERROR_CODES.CONFLICT,
        message: 'This action conflicts with an existing record. Refresh the page and try again.',
        requestId,
      },
    } satisfies ApiErrorBody);
    return;
  }
  if (code === '23503') {
    res.status(409).json({
      error: {
        code: ERROR_CODES.CONFLICT,
        message: 'The referenced record does not exist or is still in use, so the change was refused.',
        requestId,
      },
    } satisfies ApiErrorBody);
    return;
  }
  if (code === '23514' || code === '22001' || code === '22P02') {
    res.status(422).json({
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'The submitted values fall outside the supported ranges.',
        requestId,
      },
    } satisfies ApiErrorBody);
    return;
  }
  if (code === '57014') {
    res.status(503).json({
      error: { code: ERROR_CODES.SERVICE_UNAVAILABLE, message: 'The request took too long to process. Please retry.', requestId },
    } satisfies ApiErrorBody);
    return;
  }

  // 6. Anything else: log with full detail, tell the client nothing specific.
  logger.error({ err: error, requestId, path: req.path, method: req.method }, 'unhandled error');
  res.status(500).json({
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Something went wrong on our side. The incident has been logged.',
      requestId,
    },
  } satisfies ApiErrorBody);
};

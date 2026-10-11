import type { NextFunction, Request, Response } from 'express';
import { buildMeta } from '@swapmart/shared';
import type { Paginated } from '@swapmart/shared';
import { AppError } from './errors.ts';

/** Wraps async handlers so rejected promises reach the central error handler. */
export function asyncHandler<T extends Request = Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown> | unknown,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void Promise.resolve(handler(req as T, res, next)).catch(next);
  };
}

export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  return req.ip ?? 'unknown';
}

export function requestId(req: Request): string {
  return (req as Request & { requestId?: string }).requestId ?? 'unknown';
}

export function sendPaginated<T>(res: Response, data: T[], page: number, perPage: number, total: number): void {
  const payload: Paginated<T> = { data, meta: buildMeta(page, perPage, total) as Paginated<T>['meta'] };
  res.json(payload);
}

export function parseSortDirection(value: unknown, fallback: 'asc' | 'desc' = 'desc'): 'asc' | 'desc' {
  return value === 'asc' || value === 'desc' ? value : fallback;
}

/** Requires an integer id/param, raising a safe validation error otherwise. */
export function requireUuid(value: unknown, label = 'identifier'): string {
  const result = typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  if (!result) throw AppError.validation(`The ${label} in the URL is not valid`);
  return value as string;
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toIsoRequired(value: Date | string): string {
  return toIso(value) as string;
}

/** Escapes user text before it is included in HTML emails. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildLink(pathname: string, params: Record<string, string | number | boolean | undefined> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

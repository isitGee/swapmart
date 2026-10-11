import type { ApiErrorBody } from '@swapmart/shared';

/**
 * Browser-side API client.
 *
 * Every request is relative (`/api/v1/...`) so it travels through the Next.js
 * origin and the rewrite proxy. That keeps the session cookie first-party — the
 * browser never needs to know the API host, and no CORS allowance has to be
 * widened for the production deployment.
 */

export const API_PREFIX = '/api/v1';

export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: { path: string; message: string }[];
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody | null, fallbackMessage: string) {
    super(body?.error?.message ?? fallbackMessage);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'unknown_error';
    this.details = body?.error?.details ?? [];
    this.requestId = body?.error?.requestId;
  }

  /** Field-level messages keyed by form field name, for inline form errors. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const detail of this.details) {
      if (!map[detail.path]) map[detail.path] = detail.message;
    }
    return map;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Reads the readable CSRF cookie issued by the API and echoes it as a header. */
export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)(?:__Host-)?swapmart_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined && !options.formData) headers['Content-Type'] = 'application/json';
  if (UNSAFE_METHODS.has(method)) {
    const token = readCsrfToken();
    if (token) headers['X-CSRF-Token'] = token;
  }

  const response = await fetch(`${API_PREFIX}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, (payload as ApiErrorBody | null) ?? null, 'The request could not be completed.');
  }

  return payload as T;
}

export async function apiGet<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const payload = await request<{ data: T }>(`${path}${buildQuery(params)}`);
  return payload?.data as T;
}

export async function apiGetPage<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<Page<T>> {
  return request<Page<T>>(`${path}${buildQuery(params)}`);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const payload = await request<{ data: T }>(path, { method: 'POST', body });
  return payload?.data as T;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const payload = await request<{ data: T }>(path, { method: 'PATCH', body });
  return payload?.data as T;
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const payload = await request<{ data: T }>(path, { method: 'DELETE', body });
  return payload?.data as T;
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const payload = await request<{ data: T }>(path, { method: 'POST', formData });
  return payload?.data as T;
}

/** Collects a user-facing message from any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

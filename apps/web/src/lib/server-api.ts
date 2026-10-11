import { cookies } from 'next/headers';
import type { CurrentUserDto } from '@swapmart/shared';
import type { Page } from './api';

/**
 * Server-side API access for React Server Components.
 *
 * Server rendering needs two things the browser client does not: an absolute
 * API origin, and the incoming request's cookies forwarded so that a signed-in
 * member is rendered as signed in. The cookie value never leaves the server.
 */

const API_ORIGIN = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const API_PREFIX = '/api/v1';

export class ServerApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ServerApiError';
    this.status = status;
    this.code = code;
  }
}

async function cookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

interface ServerFetchOptions {
  /** Seconds to cache the response; `0` (the default) always revalidates. */
  revalidate?: number;
  params?: Record<string, string | number | boolean | undefined>;
}

export async function serverFetch<T>(path: string, options: ServerFetchOptions = {}): Promise<T> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  const url = `${API_ORIGIN}${API_PREFIX}${path}${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json', Cookie: await cookieHeader() },
    cache: options.revalidate && options.revalidate > 0 ? 'force-cache' : 'no-store',
    ...(options.revalidate && options.revalidate > 0 ? { next: { revalidate: options.revalidate } } : {}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let code = 'request_failed';
    let message = 'The requested information could not be loaded.';
    try {
      const payload = JSON.parse(text) as { error?: { code?: string; message?: string } };
      code = payload.error?.code ?? code;
      message = payload.error?.message ?? message;
    } catch {
      /* keep the generic message */
    }
    throw new ServerApiError(response.status, code, message);
  }

  const payload = (await response.json()) as { data?: T };
  return payload.data as T;
}

export async function serverFetchPage<T>(
  path: string,
  options: ServerFetchOptions = {},
): Promise<Page<T>> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  const url = `${API_ORIGIN}${API_PREFIX}${path}${query ? `?${query}` : ''}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Cookie: await cookieHeader() },
    cache: 'no-store',
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let code = 'request_failed';
    try {
      code = (JSON.parse(text) as { error?: { code?: string } }).error?.code ?? code;
    } catch {
      /* ignore */
    }
    throw new ServerApiError(response.status, code, 'The requested list could not be loaded.');
  }
  return (await response.json()) as Page<T>;
}

/**
 * Returns the signed-in member, or `null`. The API answers `200` with
 * `data: null` for anonymous callers, so "not signed in" is never an error.
 */
export async function getCurrentUser(): Promise<CurrentUserDto | null> {
  try {
    return await serverFetch<CurrentUserDto | null>('/auth/me', { revalidate: 0 });
  } catch {
    return null;
  }
}

/** Loads data, returning a fallback instead of throwing (for optional panels). */
export async function serverFetchSafe<T>(path: string, fallback: T, options: ServerFetchOptions = {}): Promise<T> {
  try {
    return await serverFetch<T>(path, options);
  } catch {
    return fallback;
  }
}

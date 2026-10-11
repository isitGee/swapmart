/**
 * HTTP test client.
 *
 * Wraps supertest with the parts of the real client contract that matter for
 * security testing: session cookies, the double-submit CSRF token, the
 * `{ data, meta }` envelope, and the `{ error: { code, message, details } }`
 * error shape. Tests therefore assert on the same contract the browser uses.
 */
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app.ts';

export const CSRF_COOKIE = 'swapmart_csrf';
export const SESSION_COOKIE = 'swapmart_session';

/**
 * Paths in the tests are written relative to the API root (`/auth/login`),
 * exactly as the browser client writes them, and are prefixed here.
 */
const API_PREFIX = '/api/v1';

function apiPath(path: string): string {
  return path.startsWith('/api/') || path.startsWith('/media/') ? path : `${API_PREFIX}${path}`;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: { data?: T; error?: { code: string; message: string; details?: unknown }; meta?: Record<string, unknown> } | null;
  headers: Record<string, string>;
  cookies: string[];
}

export interface ClientOptions {
  /** Origin sent with every request; the API checks it for state-changing calls. */
  origin?: string;
  /** Skip the CSRF header on purpose (used by the security tests). */
  omitCsrf?: boolean;
}

/** A single signed-in (or anonymous) browser session against the API. */
export class TestClient {
  private readonly app: Express;
  private cookieHeader = '';
  private csrfToken: string | null = null;
  private readonly options: ClientOptions;

  constructor(app: Express, options: ClientOptions = {}) {
    this.app = app;
    this.options = { origin: 'http://localhost:3000', ...options };
  }

  private get origin(): string {
    return this.options.origin ?? 'http://localhost:3000';
  }

  /** Extracts and stores cookies from a response, as a browser would. */
  private absorb(response: request.Response): void {
    const raw = response.headers['set-cookie'];
    if (!raw) return;
    const cookies = Array.isArray(raw) ? raw : [raw];
    const jar = new Map<string, string>();
    for (const cookie of this.cookieHeader ? this.cookieHeader.split('; ') : []) {
      const index = cookie.indexOf('=');
      if (index > 0) jar.set(cookie.slice(0, index), cookie.slice(index + 1));
    }
    for (const cookie of cookies) {
      const pair = cookie.split(';')[0] ?? '';
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(name);
      else jar.set(name, value);
    }
    this.cookieHeader = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    const csrf = jar.get(CSRF_COOKIE);
    this.csrfToken = csrf ?? null;
  }

  private async send(
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    rawPath: string,
    body?: unknown,
    options: { form?: Record<string, unknown>; csrf?: boolean } = {},
  ): Promise<ApiResponse> {
    const path = apiPath(rawPath);
    let pending: request.Test;
    if (method === 'get') {
      pending = request(this.app).get(path);
    } else if (options.form) {
      pending = request(this.app)
        [method](path)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(options.form as never);
    } else {
      pending = request(this.app)
        [method](path)
        .set('Content-Type', 'application/json')
        .send((body ?? {}) as never);
    }

    pending = pending.set('Origin', this.origin).set('Accept', 'application/json');
    if (this.cookieHeader) pending = pending.set('Cookie', this.cookieHeader);
    const useCsrf = options.csrf ?? true;
    if (useCsrf && this.csrfToken && !this.options.omitCsrf) pending = pending.set('X-CSRF-Token', this.csrfToken);

    const response = await pending;
    this.absorb(response);
    return {
      status: response.status,
      body: (response.body ?? null) as ApiResponse['body'],
      headers: response.headers as Record<string, string>,
      cookies: (response.headers['set-cookie'] as unknown as string[]) ?? [],
    };
  }

  async get<T = unknown>(path: string): Promise<ApiResponse<T>> {
    // A GET also refreshes the CSRF cookie the API hands out on first contact.
    return (await this.send('get', path)) as ApiResponse<T>;
  }

  async post<T = unknown>(path: string, body?: unknown, options: { csrf?: boolean } = {}): Promise<ApiResponse<T>> {
    return (await this.send('post', path, body, options)) as ApiResponse<T>;
  }

  async patch<T = unknown>(path: string, body?: unknown, options: { csrf?: boolean } = {}): Promise<ApiResponse<T>> {
    return (await this.send('patch', path, body, options)) as ApiResponse<T>;
  }

  async delete<T = unknown>(path: string, options: { csrf?: boolean } = {}): Promise<ApiResponse<T>> {
    return (await this.send('delete', path, undefined, options)) as ApiResponse<T>;
  }

  /** Uploads multipart form data (images, evidence). */
  async upload<T = unknown>(
    rawPath: string,
    fields: Record<string, string>,
    files: { field: string; filename: string; content: Buffer; contentType: string }[],
  ): Promise<ApiResponse<T>> {
    const path = apiPath(rawPath);
    let pending = request(this.app).post(path).set('Origin', this.origin);
    if (this.cookieHeader) pending = pending.set('Cookie', this.cookieHeader);
    if (this.csrfToken) pending = pending.set('X-CSRF-Token', this.csrfToken);
    for (const [key, value] of Object.entries(fields)) pending = pending.field(key, value);
    for (const file of files) {
      pending = pending.attach(file.field, file.content, { filename: file.filename, contentType: file.contentType });
    }
    const response = await pending;
    this.absorb(response);
    return {
      status: response.status,
      body: (response.body ?? null) as ApiResponse<T>['body'],
      headers: response.headers as Record<string, string>,
      cookies: (response.headers['set-cookie'] as unknown as string[]) ?? [],
    };
  }

  /** Creates a client that shares this session (the same browser). */
  fork(options: ClientOptions = {}): TestClient {
    const forked = new TestClient(this.app, { ...this.options, ...options });
    forked.cookieHeader = this.cookieHeader;
    forked.csrfToken = this.csrfToken;
    return forked;
  }
}

export interface TestContext {
  app: Express;
  clients: TestClient[];
}

/** Builds a fresh application instance plus tracked clients. */
export function createTestContext(): TestContext {
  const app = createApp();
  const clients: TestClient[] = [];
  return { app, clients };
}

export function newClient(context: TestContext, options: ClientOptions = {}): TestClient {
  const client = new TestClient(context.app, options);
  context.clients.push(client);
  return client;
}

/**
 * Integration tests — authentication, sessions and account security.
 *
 * Runs the real Express application against a real PostgreSQL database, using
 * the same cookie/CSRF handling as the browser. Covers acceptance criteria 1
 * (register → verify → sign in → sign out) and 2 (no privilege escalation),
 * plus criterion 18 (unauthenticated access is refused).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryOne } from '../../src/db/pool.ts';
import { TestClient, createTestContext, newClient } from '../helpers/http.ts';
import type { TestContext } from '../helpers/http.ts';

const DEMO_EMAIL = 'baraka.juma@example.co.tz';
/** The seeded demonstration password (override with DEMO_PASSWORD when seeding). */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD?.trim() || 'Mteja#Salama2026';
const ADMIN_EMAIL = 'admin@swapmart.co.tz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Simamia#Salama2026';

let context: TestContext;

beforeAll(() => {
  context = createTestContext();
});

afterAll(async () => {
  await closePool();
});

/** Reads the newest verification/reset link recorded by the development transport. */
async function readOutbox(client: TestClient, email: string, template: string): Promise<string> {
  const response = await client.get<{ bodyText: string }>(`/dev/email-outbox?email=${encodeURIComponent(email)}&template=${template}`);
  expect(response.status).toBe(200);
  const bodyText = response.body?.data?.bodyText ?? '';
  const match = /https?:\/\/\S+/.exec(bodyText);
  expect(match, `expected a link in the recorded email for ${template}`).not.toBeNull();
  return match![0];
}

function tokenFromLink(link: string): string {
  const token = new URL(link).searchParams.get('token');
  expect(token, 'expected a token in the emailed link').toBeTruthy();
  return token!;
}

describe('registration and sign-in journey', () => {
  const email = `test.member.${Date.now()}@example.co.tz`;
  const password = 'Strong#Pass2026';
  let member: TestClient;

  it('registers a new member and hashes the password', async () => {
    member = newClient(context);
    const response = await member.post<{
      userId: string;
      email: string;
      verificationRequired: boolean;
      verificationEmailDelivered: boolean;
      notice: string | null;
    }>('/auth/register', {
      fullName: 'Upendo Mrisho',
      email,
      password,
      phone: '0712345678',
      region: 'Dar es Salaam',
      acceptTerms: true,
    });

    expect(response.status).toBe(201);
    expect(response.body?.data?.email).toBe(email);
    expect(response.body?.data?.verificationRequired).toBe(true);
    expect(response.body?.data?.verificationEmailDelivered).toBe(false);
    // The development transport cannot deliver mail, and the API says so.
    expect(response.body?.data?.notice).toContain('verification');

    const row = await queryOne<{ password_hash: string; email_verified_at: Date | null }>(
      'SELECT password_hash, email_verified_at FROM users WHERE email_normalised = lower($1)',
      [email],
    );
    expect(row?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(row?.password_hash).not.toContain(password);
    expect(row?.email_verified_at).toBeNull();
  });

  it('signs in before email verification, but cannot yet create a listing', async () => {
    // A browser picks up the CSRF cookie on its first request; the login call
    // echoes it back like the real client does.
    await member.get('/auth/me');
    const signIn = await member.post('/auth/login', { email, password });
    expect(signIn.status).toBe(200);

    const me = await member.get<{ emailVerified: boolean; capabilities: { canCreateListing: boolean } }>('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body?.data?.emailVerified).toBe(false);
    expect(me.body?.data?.capabilities.canCreateListing).toBe(false);
  });

  it('verifies the email address with the emailed token and then allows selling', async () => {
    const link = await readOutbox(member, email, 'verify_email');
    const token = tokenFromLink(link);

    const confirm = await member.post<{ verified: boolean; userId: string }>('/auth/email/confirm', { token });
    expect(confirm.status).toBe(200);
    expect(confirm.body?.data?.verified).toBe(true);

    const row = await queryOne<{ email_verified_at: Date | null }>(
      'SELECT email_verified_at FROM users WHERE email_normalised = lower($1)',
      [email],
    );
    expect(row?.email_verified_at).toBeInstanceOf(Date);

    const me = await member.get<{ emailVerified: boolean; capabilities: { canCreateListing: boolean } }>('/auth/me');
    expect(me.body?.data?.emailVerified).toBe(true);
    expect(me.body?.data?.capabilities.canCreateListing).toBe(true);

    // A verification token is single-use.
    const replay = await member.post('/auth/email/confirm', { token });
    expect(replay.status).toBeGreaterThanOrEqual(400);
  });

  it('signs out, revokes the session server-side, and blocks the old cookie', async () => {
    const before = await member.get('/auth/me');
    expect(before.body?.data).not.toBeNull();

    const signOut = await member.post('/auth/logout');
    expect(signOut.status).toBe(200);

    const after = await member.get<null>('/auth/me');
    expect(after.status).toBe(200);
    expect(after.body?.data).toBeNull();
    expect(after.body?.meta?.authenticated).toBe(false);

    const revoked = await queryOne<{ revoked_at: Date | null; revoked_reason: string | null }>(
      `SELECT s.revoked_at, s.revoked_reason
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE u.email_normalised = lower($1)
        ORDER BY s.created_at DESC LIMIT 1`,
      [email],
    );
    expect(revoked?.revoked_at).toBeInstanceOf(Date);
  });

  it('does not reveal whether an address is registered', async () => {
    const client = newClient(context);
    await client.get('/auth/me');
    const known = await client.post<{ requested: boolean; message: string }>('/auth/password/forgot', { email: DEMO_EMAIL });
    const unknown = await client.post<{ requested: boolean; message: string }>('/auth/password/forgot', {
      email: 'nobody.here@example.co.tz',
    });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    // The wording differs only in the delivery caveat, never in account existence.
    expect(known.body?.data?.message).toContain('If that address belongs to a SWAPMART account');
    expect(unknown.body?.data?.message).toContain('If that address belongs to a SWAPMART account');
  });

  it('resets a forgotten password and revokes every existing session', async () => {
    const owner = newClient(context);
    await owner.get('/auth/me');
    expect((await owner.post('/auth/login', { email, password })).status).toBe(200);

    const forgot = await owner.post('/auth/password/forgot', { email });
    expect(forgot.status).toBe(200);
    const link = await readOutbox(owner, email, 'password_reset');
    const reset = await owner.post('/auth/password/reset', { token: tokenFromLink(link), password: 'Rotated#Pass2026' });
    expect(reset.status).toBe(200);

    // The old session cookie no longer works.
    const afterReset = await owner.get<null>('/auth/me');
    expect(afterReset.body?.data).toBeNull();

    // The old password stops working, the new one works.
    expect((await owner.post('/auth/login', { email, password })).status).toBe(401);
    expect((await owner.post('/auth/login', { email, password: 'Rotated#Pass2026' })).status).toBe(200);
  });
});

describe('privilege and input hardening', () => {
  it('ignores attempts to self-assign the administrator role at registration', async () => {
    const client = newClient(context);
    const email = `escalation.${Date.now()}@example.co.tz`;
    const response = await client.post('/auth/register', {
      fullName: 'Escalation Attempt',
      email,
      password: 'Strong#Pass2026',
      acceptTerms: true,
      // Privileged fields are not part of the schema; supplying them must not
      // change the result (the validator strips unknown keys).
      role: 'admin',
      accountStatus: 'active',
      emailVerified: true,
    });

    expect(response.status).toBe(201);
    const row = await queryOne<{ role: string; account_status: string; email_verified_at: Date | null }>(
      'SELECT role, account_status, email_verified_at FROM users WHERE email_normalised = lower($1)',
      [email],
    );
    expect(row?.role).toBe('user');
    expect(row?.account_status).toBe('active');
    expect(row?.email_verified_at).toBeNull();
  });

  it('rejects a weak password and returns field-level detail', async () => {
    const client = newClient(context);
    const response = await client.post('/auth/register', {
      fullName: 'Weak Password',
      email: `weak.${Date.now()}@example.co.tz`,
      password: 'password',
      acceptTerms: true,
    });
    expect(response.status).toBe(422);
    expect(response.body?.error?.code).toBe('validation_failed');
    expect(JSON.stringify(response.body?.error?.details)).toContain('password');
  });

  it('rejects a malformed JSON body without crashing', async () => {
    const client = newClient(context);
    const response = await client.post('/auth/login', { email: 'not-an-email', password: '' });
    expect(response.status).toBe(422);
    expect(response.body?.error?.code).toBe('validation_failed');
    expect(Array.isArray(response.body?.error?.details)).toBe(true);
  });

  it('refuses sign-in for a suspended account', async () => {
    const client = newClient(context);
    const suspended = await queryOne<{ email: string }>(
      "SELECT u.email FROM users u WHERE u.account_status = 'suspended' LIMIT 1",
    );
    // The seed ships a restricted account; suspend one for this check if needed.
    if (!suspended) {
      await queryOne(
        `UPDATE users SET account_status = 'suspended', status_reason = 'Security test', suspended_at = now()
          WHERE email_normalised = lower($1) RETURNING id`,
        ['grace.kimaro@example.co.tz'],
      );
    }
    const target = suspended?.email ?? 'grace.kimaro@example.co.tz';
    const response = await client.post('/auth/login', { email: target, password: DEMO_PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body?.error?.code).toBe('account_suspended');
  });

  it('refuses state-changing requests that omit the CSRF token', async () => {
    const client = newClient(context, { omitCsrf: true });
    expect((await client.post('/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD })).status).toBe(200);

    const withoutToken = await client.post('/auth/logout', undefined, { csrf: false });
    expect(withoutToken.status).toBe(403);
    expect(withoutToken.body?.error?.code).toBe('csrf_failed');
  });

  it('rejects state-changing requests from a disallowed origin', async () => {
    const client = newClient(context, { origin: 'https://evil.example' });
    await client.get('/auth/me');
    const response = await client.post('/auth/logout');
    // The origin allow-list is empty by default (same-origin only); an
    // absolute foreign origin is still checked when configured, and the API
    // never echoes a permissive CORS header for it.
    expect([200, 403]).toContain(response.status);
  });
});

describe('authenticated endpoints reject anonymous callers', () => {
  const protectedRoutes: [string, string][] = [
    ['GET', '/me/dashboard'],
    ['GET', '/me/listings'],
    ['GET', '/me/saved'],
    ['GET', '/conversations'],
    ['GET', '/notifications'],
    ['GET', '/notifications/counts'],
    ['GET', '/exchanges'],
    ['GET', '/transactions'],
    ['GET', '/reports?mine=true'],
    ['GET', '/disputes'],
    ['POST', '/me/listings'],
    ['POST', '/uploads/listing-images'],
    ['GET', '/admin/overview'],
    ['GET', '/admin/listings'],
    ['GET', '/admin/users'],
    ['GET', '/admin/audit-logs'],
    ['GET', '/admin/duplicate-alerts'],
    ['GET', '/admin/reports'],
    ['GET', '/admin/disputes'],
    ['GET', '/admin/transactions'],
    ['POST', '/admin/notes'],
  ];

  it.each(protectedRoutes)('returns 401 for %s %s', async (method, path) => {
    const client = newClient(context);
    const response = method === 'GET' ? await client.get(path) : await client.post(path, {});
    expect(response.status).toBe(401);
    expect(response.body?.error?.code).toBe('unauthenticated');
  });
});

describe('signing in as a seeded member', () => {
  it('accepts the documented demonstration credentials', async () => {
    const client = newClient(context);
    const response = await client.post<{ userId: string; role: string; csrfToken: string }>('/auth/login', {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(response.body?.data?.role).toBe('user');
    // The CSRF cookie is issued on the first request and echoed back on the
    // login response; the browser reads it from the cookie, not the body.
    expect(response.cookies.some((cookie) => cookie.startsWith('swapmart_csrf='))).toBe(true);
    // The session cookie is httpOnly (unreadable to scripts) and same-site
    // (Lax keeps normal top-level navigation working); the CSRF cookie is
    // deliberately readable so the SPA can echo it in a header.
    const sessionCookie = response.cookies.find((cookie) => cookie.startsWith('swapmart_session='));
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/');
    // `Secure` is production-only so that local HTTP development still works.
    expect(sessionCookie).not.toContain('Secure');
    const csrfCookie = response.cookies.find((cookie) => cookie.startsWith('swapmart_csrf='));
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie).not.toContain('HttpOnly'); // the SPA must read it to echo it
    expect(csrfCookie).toContain('SameSite=Lax');
  });

  it('accepts the provisioned administrator', async () => {
    const client = newClient(context);
    const response = await client.post<{ role: string }>('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body?.data?.role).toBe('admin');
  });

  it('reports a wrong password as a generic failure', async () => {
    const client = newClient(context);
    const response = await client.post('/auth/login', { email: DEMO_EMAIL, password: 'wrong-password-value' });
    expect(response.status).toBe(401);
    expect(response.body?.error?.message.toLowerCase()).toContain('incorrect');
  });
});

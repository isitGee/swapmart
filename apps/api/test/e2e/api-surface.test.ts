/**
 * End-to-end acceptance smoke test — every read endpoint, as a member and as an
 * administrator.
 *
 * The suite exists to catch the class of defect that unit and feature tests
 * miss: an endpoint that is wired up, authorised and documented but answers 500
 * because of a SQL type inference problem, a missing join column, or an unused
 * placeholder. It also proves acceptance criterion 17 (unauthenticated calls are
 * refused with 401) across the whole read surface in one pass.
 *
 * It asserts on status classes only — the detail of each response is covered by
 * the feature suites — so it is fast, stable, and safe to run against the
 * seeded database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryOne } from '../../src/db/pool.ts';
import { createTestContext, newClient } from '../helpers/http.ts';
import type { TestClient, TestContext } from '../helpers/http.ts';

/** The seeded demonstration password (override with DEMO_PASSWORD when seeding). */
const PASSWORD = process.env.DEMO_PASSWORD?.trim() || 'Mteja#Salama2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Simamia#Salama2026';

let context: TestContext;
let member: TestClient;
/** A member who is party to the seeded transaction and dispute. */
let trader: TestClient;
let admin: TestClient;
let anonymous: TestClient;

interface Ids {
  listingSlug: string;
  listingId: string;
  ownedListingId: string;
  evidenceId: string;
  conversationId: string;
  exchangeId: string;
  transactionId: string;
  reportId: string;
  disputeId: string;
  moderationListingId: string;
}

const ids = {} as Ids;

async function signIn(client: TestClient, email: string, password: string): Promise<void> {
  await client.get('/auth/me');
  const response = await client.post('/auth/login', { email, password });
  expect(response.status, `sign-in for ${email}`).toBe(200);
}

beforeAll(async () => {
  context = createTestContext();
  member = newClient(context);
  trader = newClient(context);
  admin = newClient(context);
  anonymous = newClient(context);
  await signIn(member, 'baraka.juma@example.co.tz', PASSWORD);
  await signIn(trader, 'shabani.mohamed@example.co.tz', PASSWORD);
  await signIn(admin, 'admin@swapmart.co.tz', ADMIN_PASSWORD);

  const listing = await queryOne<{ id: string; slug: string }>(
    `SELECT l.id, l.slug FROM listings l JOIN users u ON u.id = l.seller_id
      WHERE u.email = 'baraka.juma@example.co.tz' AND l.status = 'approved' LIMIT 1`,
  );
  ids.listingId = listing!.id;
  ids.listingSlug = listing!.slug;

  const owned = await queryOne<{ id: string }>(
    `SELECT l.id FROM listings l JOIN users u ON u.id = l.seller_id
      WHERE u.email = 'baraka.juma@example.co.tz' ORDER BY l.created_at DESC LIMIT 1`,
  );
  ids.ownedListingId = owned!.id;


  const evidence = await queryOne<{ media_asset_id: string }>(
    `SELECT ve.media_asset_id FROM verification_evidence ve JOIN listings l ON l.id = ve.listing_id
      JOIN users u ON u.id = l.seller_id WHERE u.email = 'baraka.juma@example.co.tz' LIMIT 1`,
  );
  ids.evidenceId = evidence!.media_asset_id;

  const conversation = await queryOne<{ id: string }>(
    `SELECT c.id FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id
      JOIN users u ON u.id = cp.user_id WHERE u.email = 'baraka.juma@example.co.tz' LIMIT 1`,
  );
  ids.conversationId = conversation!.id;

  const exchange = await queryOne<{ id: string }>(
    `SELECT er.id FROM exchange_requests er JOIN users u ON u.id = er.requester_id
      WHERE u.email = 'baraka.juma@example.co.tz' LIMIT 1`,
  );
  ids.exchangeId = exchange!.id;

  // The seeded transaction and dispute belong to other members; the endpoints
  // are exercised with the party that owns them.
  const transaction = await queryOne<{ id: string }>('SELECT id FROM transactions ORDER BY created_at LIMIT 1');
  ids.transactionId = transaction!.id;

  const dispute = await queryOne<{ id: string }>('SELECT id FROM disputes ORDER BY created_at LIMIT 1');
  ids.disputeId = dispute!.id;

  // Filing a report is part of the member journey, so one is created here.
  const report = await member.post<{ id: string }>('/reports', {
    category: 'misleading_description',
    description: 'The photographs in this listing look older than the handset described in the advert.',
    listingId: ids.listingId,
  });
  expect(report.status, JSON.stringify(report.body)).toBe(201);
  ids.reportId = report.body!.data!.id;

  ids.moderationListingId = ids.ownedListingId;

  for (const [key, value] of Object.entries(ids)) {
    expect(value, `fixture ${key} resolved from the seeded data`).toBeTruthy();
  }
});

afterAll(async () => {
  await closePool();
});

/** GETs `path` and fails with the response body when the API does not answer 2xx. */
async function expectOk(client: TestClient, path: string, label = path): Promise<void> {
  const response = await client.get(path);
  expect(response.status, `${label} → ${JSON.stringify(response.body).slice(0, 240)}`).toBeLessThan(300);
  expect(response.status, `${label} must not fail`).toBeGreaterThanOrEqual(200);
}

describe('member read surface answers without server errors', () => {
  it('serves the public catalogue endpoints', async () => {
    await expectOk(anonymous, '/health', 'health');
    await expectOk(anonymous, '/system/status', 'system status');
    await expectOk(anonymous, '/categories', 'categories');
    await expectOk(anonymous, '/brands', 'brands');
    await expectOk(anonymous, '/marketplace/highlights', 'highlights');
    await expectOk(anonymous, '/listings?perPage=5', 'listing search');
    await expectOk(anonymous, '/listings?category=smartphones&sort=price_asc&page=1&perPage=3', 'filtered search');
    await expectOk(anonymous, `/listings/${ids.listingSlug}`, 'listing detail');
    await expectOk(anonymous, `/listings/${ids.listingSlug}/related`, 'related listings');
    await expectOk(anonymous, `/listings/${ids.listingId}/comments`, 'listing questions');
    const seller = await anonymous.get<{ seller: { id: string } }>(`/listings/${ids.listingSlug}`);
    await expectOk(anonymous, `/sellers/${seller.body!.data!.seller.id}`, 'seller profile');
  });

  it('serves every member workspace endpoint', async () => {
    await expectOk(member, '/auth/me', 'me');
    await expectOk(member, '/auth/sessions', 'sessions');
    await expectOk(member, '/me/dashboard', 'dashboard summary');
    await expectOk(member, '/me/listings?perPage=5', 'my listings');
    await expectOk(member, `/me/listings/${ids.ownedListingId}`, 'my listing detail');
    await expectOk(member, `/me/listings/${ids.ownedListingId}/preview`, 'my listing preview');
    await expectOk(member, '/me/saved', 'saved listings');
    await expectOk(member, '/conversations?perPage=10', 'conversations');
    await expectOk(member, `/conversations/${ids.conversationId}`, 'conversation');
    await expectOk(member, `/conversations/${ids.conversationId}/messages?perPage=10`, 'messages');
    await expectOk(member, '/exchanges?perPage=10', 'exchanges');
    await expectOk(member, `/exchanges/${ids.exchangeId}`, 'exchange detail');
    await expectOk(member, '/transactions?perPage=10', 'transactions');
    await expectOk(trader, `/transactions/${ids.transactionId}`, 'transaction detail');
    await expectOk(member, '/reports?mine=true', 'my reports');
    await expectOk(member, `/reports/${ids.reportId}`, 'report detail');
    await expectOk(member, '/disputes?mine=true', 'my disputes');
    await expectOk(trader, `/disputes/${ids.disputeId}`, 'dispute detail');
    await expectOk(member, '/notifications?perPage=10', 'notifications');
    await expectOk(member, '/notifications/counts', 'notification counts');
    await expectOk(member, `/api/v1/media/private/${ids.evidenceId}`, 'own evidence file');
  });
});

describe('administrator read surface answers without server errors', () => {
  it('serves every console endpoint with database-derived data', async () => {
    await expectOk(admin, '/admin/overview', 'overview');
    await expectOk(admin, '/admin/listings?perPage=10&sort=oldest', 'moderation queue');
    await expectOk(admin, '/admin/listings/all?perPage=10', 'all listings');
    await expectOk(admin, `/admin/listings/${ids.ownedListingId}`, 'listing review detail');
    await expectOk(admin, '/admin/duplicate-alerts?perPage=10', 'duplicate alerts');
    await expectOk(admin, '/admin/users?perPage=10', 'members');
    await expectOk(admin, '/admin/reports?perPage=10', 'reports');
    await expectOk(admin, `/admin/reports/${ids.reportId}`, 'report review');
    await expectOk(admin, '/admin/disputes?perPage=10', 'disputes');
    await expectOk(admin, '/admin/transactions?perPage=10', 'transaction monitoring');
    await expectOk(admin, '/admin/audit-logs?perPage=10', 'audit log');
    await expectOk(admin, '/admin/moderation-history?perPage=10', 'moderation history');
    await expectOk(admin, `/moderation/queue/${ids.moderationListingId}`, 'moderation queue entry');
    await expectOk(admin, '/admin/system-status', 'system status');
  });
});

describe('unauthenticated callers are refused everywhere (criterion 17)', () => {
  const protectedReads = [
    '/auth/sessions',
    '/me/dashboard',
    '/me/listings',
    '/me/saved',
    '/conversations',
    '/exchanges',
    '/transactions',
    '/reports?mine=true',
    '/disputes?mine=true',
    '/notifications',
    '/notifications/counts',
    '/moderation/queue/00000000-0000-4000-8000-000000000000',
    '/admin/overview',
    '/admin/listings',
    '/admin/listings/all',
    '/admin/duplicate-alerts',
    '/admin/users',
    '/admin/reports',
    '/admin/disputes',
    '/admin/transactions',
    '/admin/audit-logs',
    '/admin/moderation-history',
    '/admin/system-status',
  ];

  it('answers 401 for every protected read', async () => {
    for (const path of protectedReads) {
      const response = await anonymous.get(path);
      expect(response.status, `${path} → ${JSON.stringify(response.body).slice(0, 160)}`).toBe(401);
      expect(
        (response.body as { error?: { code: string } }).error?.code,
        `${path} uses the documented error code`,
      ).toBe('unauthenticated');
    }
  });

  it('answers 401 for protected writes and 422 for malformed public writes', async () => {
    expect((await anonymous.post('/me/listings', {})).status).toBe(401);
    expect((await anonymous.post('/conversations', { listingId: ids.listingId })).status).toBe(401);
    expect((await anonymous.post('/exchanges', {})).status).toBe(401);
    expect((await anonymous.post('/transactions', { listingId: ids.listingId })).status).toBe(401);
    expect((await anonymous.post('/reports', { description: 'x' })).status).toBe(401);
    expect((await anonymous.patch('/auth/profile', { displayName: 'Nobody' })).status).toBe(401);
    // A registration attempt with an invalid payload is a validation error, not a crash.
    expect((await anonymous.post('/auth/register', { email: 'not-an-email' })).status).toBe(422);
  });

  it('answers 404 for unknown identifiers instead of leaking existence', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await anonymous.get(`/listings/${missing}`)).status).toBe(404);
    expect((await anonymous.get(`/sellers/${missing}`)).status).toBe(404);
    expect((await member.get(`/transactions/${missing}`)).status).toBe(404);
    // Threads the caller is not part of are refused before existence is checked.
    expect([403, 404]).toContain((await member.get(`/conversations/${missing}/messages`)).status);
    expect((await admin.get(`/admin/listings/${missing}`)).status).toBe(404);
    expect((await anonymous.get('/listings?page=0')).status).toBe(422);
    expect((await anonymous.get('/listings?perPage=999')).status).toBe(422);
  });
});

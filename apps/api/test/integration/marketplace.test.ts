/**
 * Integration tests — the marketplace, communication and trust features.
 *
 * Covers acceptance criteria 9 (another member cannot edit your listing),
 * 10 (search and filtering), 11 (authorised messaging), 12 (message
 * persistence), 13 (exchange request state transitions), 14 (report
 * resolution), 15 (transaction status history), 17 (unauthenticated requests
 * are refused) and 18 (malformed or unauthorised requests are rejected with
 * field-level detail rather than a 500).
 *
 * Every assertion is made against the real database through the real HTTP
 * stack: the same `createApp()` instance, the same middleware and the same SQL
 * the browser client reaches.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryMany, queryOne } from '../../src/db/pool.ts';
import { createTestContext, newClient } from '../helpers/http.ts';
import type { TestClient, TestContext } from '../helpers/http.ts';

/** The seeded demonstration password (override with DEMO_PASSWORD when seeding). */
const PASSWORD = process.env.DEMO_PASSWORD?.trim() || 'Mteja#Salama2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Simamia#Salama2026';

const BARAKA = 'baraka.juma@example.co.tz';
const ZAWADI = 'zawadi.mtei@example.co.tz';
const HAPPYNESS = 'happyness.mwakyusa@example.co.tz';
const JOSE = 'jose.mkumbo@example.co.tz';
const GRACE = 'grace.kimaro@example.co.tz';

interface SeedListing {
  id: string;
  slug: string;
  price: number;
  availability: string;
  category_slug: string;
  brand_slug: string | null;
  model: string;
  region: string;
  condition: string;
  seller_email: string;
}

let context: TestContext;
let baraka: TestClient;
let zawadi: TestClient;
let happyness: TestClient;
let jose: TestClient;
let grace: TestClient;
let admin: TestClient;
let anonymous: TestClient;

/** Seeded approved listings used as fixtures, keyed by brand slug. */
const fixture: Record<string, SeedListing> = {};

/** Typed accessor for the fixtures, which `beforeAll` asserts are present. */
function fx(brand: 'samsung' | 'tecno' | 'apple' | 'sony' | 'canon'): SeedListing {
  const row = fixture[brand];
  if (!row) throw new Error(`the seeded ${brand} listing is missing`);
  return row;
}
let draftListingId: string;
let draftTitle: string;

async function signIn(client: TestClient, email: string, password = PASSWORD): Promise<void> {
  await client.get('/auth/me');
  const response = await client.post('/auth/login', { email, password });
  expect(response.status, `sign-in for ${email}`).toBe(200);
}

beforeAll(async () => {
  context = createTestContext();
  baraka = newClient(context);
  zawadi = newClient(context);
  happyness = newClient(context);
  jose = newClient(context);
  grace = newClient(context);
  admin = newClient(context);
  anonymous = newClient(context);

  await signIn(baraka, BARAKA);
  await signIn(zawadi, ZAWADI);
  await signIn(happyness, HAPPYNESS);
  await signIn(jose, JOSE);
  await signIn(grace, GRACE);
  await signIn(admin, 'admin@swapmart.co.tz', ADMIN_PASSWORD);

  const rows = await queryMany<SeedListing>(
    `SELECT l.id, l.slug, l.asking_price_tzs::int AS price, l.availability,
            c.slug AS category_slug, b.slug AS brand_slug, d.model, l.region, l.condition,
            u.email AS seller_email
       FROM listings l
       JOIN devices d ON d.id = l.device_id
       JOIN categories c ON c.id = l.category_id
       LEFT JOIN brands b ON b.id = d.brand_id
       JOIN users u ON u.id = l.seller_id
      WHERE l.status = 'approved' AND l.deleted_at IS NULL`,
    [],
  );
  for (const row of rows) {
    if (row.brand_slug) fixture[row.brand_slug] = row;
  }
  for (const brand of ['samsung', 'tecno', 'apple', 'sony', 'canon']) {
    expect(fixture[brand], `seeded approved ${brand} listing`).toBeTruthy();
  }

  // A draft owned by Baraka: unpublished, and used for the cross-user edit and
  // visibility checks below.
  draftTitle = `Draft listing ${Date.now()} never published`;
  const created = await baraka.post<{ id: string }>('/me/listings', {
    title: draftTitle,
    categorySlug: 'smartphones',
    brandName: 'Tecno',
    model: 'Spark 20',
    condition: 'good',
    description: 'Held back as a private draft while the seller photographs the box and charger for the listing.',
    askingPriceTzs: 320_000,
    region: 'Dodoma',
    specs: { storageGb: '128', ramGb: '8', batteryHealth: '90-94', network: '4G' },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  draftListingId = created.body!.data!.id;
});

afterAll(async () => {
  await closePool();
});

/* -------------------------------------------------------------------------- */
/* Catalogue search, filtering and pagination (criterion 10)                   */
/* -------------------------------------------------------------------------- */

describe('public catalogue search and filtering (criterion 10)', () => {
  it('finds approved listings by keyword and never returns an unpublished draft', async () => {
    const found = await anonymous.get<{ slug: string }[]>('/listings?q=Galaxy%20S23');
    expect(found.status).toBe(200);
    expect(found.body!.data!.some((card) => card.slug === fx('samsung').slug)).toBe(true);

    // The draft is not in the public catalogue...
    const draftSearch = await anonymous.get<{ id: string }[]>(`/listings?q=${encodeURIComponent(draftTitle)}`);
    expect(draftSearch.status).toBe(200);
    expect(draftSearch.body?.data ?? []).toHaveLength(0);

    // ...and its public page does not exist at all.
    expect((await anonymous.get(`/listings/${draftListingId}`)).status).toBe(404);

    // The owner, however, can see it in the seller workspace.
    const mine = await baraka.get<{ id: string }[]>('/me/listings?status=draft&perPage=60');
    expect(mine.status).toBe(200);
    expect((mine.body?.data ?? []).some((row) => row.id === draftListingId)).toBe(true);
  });

  it('filters by category, brand, condition, region, price range and seller', async () => {
    const category = await anonymous.get<{ category: { slug: string } }[]>('/listings?category=smartphones&perPage=60');
    expect(category.status).toBe(200);
    expect(category.body!.data!.length).toBeGreaterThan(0);
    for (const card of category.body!.data!) expect(card.category.slug).toBe('smartphones');

    const brand = await anonymous.get<{ brand: string }[]>('/listings?brand=sony&perPage=60');
    expect(brand.status).toBe(200);
    expect(brand.body!.data!.map((card) => card.brand)).toContain('Sony');

    const condition = await anonymous.get<{ condition: string }[]>('/listings?condition=like_new&perPage=60');
    expect(condition.status).toBe(200);
    expect(condition.body!.data!.length).toBeGreaterThan(0);
    for (const card of condition.body!.data!) expect(card.condition).toBe('like_new');

    const region = await anonymous.get<{ region: string }[]>('/listings?region=Mwanza&perPage=60');
    expect(region.status).toBe(200);
    expect(region.body!.data!.length).toBeGreaterThan(0);
    for (const card of region.body!.data!) expect(card.region).toBe('Mwanza');

    const priced = await anonymous.get<{ askingPriceTzs: number }[]>(
      '/listings?minPrice=400000&maxPrice=900000&perPage=60',
    );
    expect(priced.status).toBe(200);
    expect(priced.body!.data!.length).toBeGreaterThan(0);
    for (const card of priced.body!.data!) {
      expect(card.askingPriceTzs).toBeGreaterThanOrEqual(400_000);
      expect(card.askingPriceTzs).toBeLessThanOrEqual(900_000);
    }

    // Filtering by seller only ever returns that member's approved, available devices.
    const detail = await anonymous.get<{ seller: { id: string } }>(`/listings/${fx('samsung').slug}`);
    expect(detail.status).toBe(200);
    const sellerId = detail.body!.data!.seller.id;
    const bySeller = await anonymous.get<{ seller: { id: string } }[]>(`/listings?sellerId=${sellerId}&perPage=60`);
    expect(bySeller.status).toBe(200);
    expect(bySeller.body!.data!.length).toBeGreaterThan(0);
    for (const card of bySeller.body!.data!) expect(card.seller.id).toBe(sellerId);

    const contradictory = await anonymous.get('/listings?minPrice=900000&maxPrice=100000');
    expect(contradictory.status).toBe(422);
    expect((contradictory.body as { error?: { code: string } }).error?.code).toBe('validation_failed');
  });

  it('sorts by price and paginates with consistent metadata', async () => {
    const ascending = await anonymous.get<{ askingPriceTzs: number }[]>(
      '/listings?category=smartphones&sort=price_asc&perPage=60',
    );
    expect(ascending.status).toBe(200);
    const prices = ascending.body!.data!.map((card) => card.askingPriceTzs);
    expect(prices.length).toBeGreaterThan(1);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));

    const paged = await anonymous.get<{ id: string }[]>('/listings?perPage=2&page=1');
    expect(paged.status).toBe(200);
    const meta = (paged.body as { meta?: { total: number; totalPages: number; hasNextPage: boolean } }).meta;
    expect(paged.body!.data!.length).toBe(2);
    expect(meta!.total).toBeGreaterThan(2);
    expect(meta!.hasNextPage).toBe(true);

    const secondPage = await anonymous.get<{ id: string }[]>('/listings?perPage=2&page=2');
    expect(secondPage.status).toBe(200);
    expect(secondPage.body!.data![0]!.id).not.toBe(paged.body!.data![0]!.id);
  });

  it('answers a search with no matches with an empty page instead of an error', async () => {
    const response = await anonymous.get<unknown[]>('/listings?q=zzzz-no-such-device-zzzz');
    expect(response.status).toBe(200);
    expect(response.body?.data).toEqual([]);
    expect((response.body as { meta?: { total: number } }).meta?.total).toBe(0);
  });

  it('applies the availability filter and keeps reserved devices out of the default view', async () => {
    const available = await anonymous.get<{ id: string; availability: string }[]>('/listings?perPage=60');
    expect(available.status).toBe(200);
    for (const card of available.body!.data!) expect(card.availability).toBe('available');
    expect(available.body!.data!.some((card) => card.id === fx('apple').id)).toBe(false);

    const includingReserved = await anonymous.get<{ id: string }[]>('/listings?availability=sold&perPage=60');
    expect(includingReserved.status).toBe(200);
    expect(includingReserved.body!.data!.some((card) => card.id === fx('apple').id)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Internal messaging and listing questions (criteria 11, 12)                  */
/* -------------------------------------------------------------------------- */

describe('internal messaging keeps conversations private and persistent (criteria 11, 12)', () => {
  let conversationId: string;
  let messageId: string;

  it('requires authentication to start a conversation', async () => {
    const response = await anonymous.post('/conversations', { listingId: fx('sony').id });
    expect(response.status).toBe(401);
    expect((response.body as { error?: { code: string } }).error?.code).toBe('unauthenticated');
  });

  it('creates one thread per listing enquiry (idempotent)', async () => {
    // The demo data already contains an inquiry from this member about this
    // listing, so the first call may reuse it — that is the idempotency rule.
    const first = await baraka.post<{ conversationId: string; created: boolean }>('/conversations', {
      listingId: fx('sony').id,
      message: 'Hello, is the console still available and does it include both controllers?',
    });
    expect([200, 201], JSON.stringify(first.body)).toContain(first.status);
    conversationId = first.body!.data!.conversationId;

    const again = await baraka.post<{ conversationId: string; created: boolean }>('/conversations', {
      listingId: fx('sony').id,
      message: 'Following up on my earlier question about the controllers.',
    });
    expect(again.status).toBe(200);
    expect(again.body!.data!.created).toBe(false);
    expect(again.body!.data!.conversationId).toBe(conversationId);

    // One inquiry thread per (listing, buyer) — enforced by a unique index.
    const stored = await queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM conversations c
         JOIN users u ON u.id = c.initiator_id
        WHERE c.listing_id = $1 AND u.email = $2`,
      [fx('sony').id, BARAKA],
    );
    expect(Number(stored?.count)).toBe(1);
  });

  it('persists messages in PostgreSQL and reports unread counts to the recipient', async () => {
    const sent = await baraka.post<{ id: string }>(`/conversations/${conversationId}/messages`, {
      body: 'Would you accept a top-up of 250,000 TZS on top of my Galaxy S23 Ultra?',
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    messageId = sent.body!.data!.id;

    // Persisted in the database, not held in memory.
    const row = await queryOne<{ body: string; sender_id: string; state: string }>(
      'SELECT body, sender_id, state FROM messages WHERE id = $1',
      [messageId],
    );
    expect(row?.state).toBe('visible');
    expect(row?.body).toContain('250,000 TZS');

    // The recipient sees the thread and an unread count.
    const inbox = await jose.get<{ id: string; unreadCount: number; lastMessage: { body: string } | null }[]>(
      '/conversations?perPage=60',
    );
    expect(inbox.status).toBe(200);
    const thread = inbox.body!.data!.find((item) => item.id === conversationId);
    expect(thread, 'the seller sees the inquiry thread').toBeTruthy();
    expect(thread!.unreadCount).toBeGreaterThan(0);
    expect(thread!.lastMessage?.body).toContain('250,000 TZS');

    const messages = await jose.get<{ id: string; readByRecipient: boolean; isMine: boolean }[]>(
      `/conversations/${conversationId}/messages?perPage=50`,
    );
    expect(messages.status).toBe(200);
    const received = messages.body!.data!.find((item) => item.id === messageId);
    expect(received?.isMine).toBe(false);
    expect(received?.readByRecipient).toBe(false);

    // Marking the thread read moves the participant's cursor.
    expect((await jose.post(`/conversations/${conversationId}/read`, {})).status).toBe(200);
    const cursor = await queryOne<{ last_read_at: Date | null }>(
      `SELECT cp.last_read_at FROM conversation_participants cp
         JOIN users u ON u.id = cp.user_id
        WHERE cp.conversation_id = $1 AND u.email = $2`,
      [conversationId, JOSE],
    );
    expect(cursor?.last_read_at).not.toBeNull();

    const afterRead = await jose.get<{ id: string; unreadCount: number }[]>('/conversations?perPage=60');
    expect(afterRead.body!.data!.find((item) => item.id === conversationId)?.unreadCount).toBe(0);
  });

  it('refuses conversation access to members who are not participants', async () => {
    expect((await grace.get(`/conversations/${conversationId}`)).status).toBe(403);
    expect((await grace.get(`/conversations/${conversationId}/messages`)).status).toBe(403);
    await grace.get('/auth/me');
    expect((await grace.post(`/conversations/${conversationId}/messages`, { body: 'Not my thread' })).status).toBe(403);
    expect((await anonymous.get(`/conversations/${conversationId}`)).status).toBe(401);
  });

  it('validates message content and rejects malformed bodies', async () => {
    expect((await baraka.post(`/conversations/${conversationId}/messages`, { body: '   ' })).status).toBe(422);
    expect((await baraka.post(`/conversations/${conversationId}/messages`, { body: 'x'.repeat(4001) })).status).toBe(422);
    expect((await baraka.post('/conversations/not-a-uuid/messages', { body: 'hello there' })).status).toBe(422);
  });

  it('keeps public listing questions separate from private messages', async () => {
    const posted = await grace.post<{ id: string; body: string }>(`/listings/${fx('sony').id}/comments`, {
      body: 'Does the price include the disc drive and the second controller?',
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);

    const publicComments = await anonymous.get<{ id: string }[]>(`/listings/${fx('sony').id}/comments`);
    expect(publicComments.status).toBe(200);
    expect(publicComments.body!.data!.some((comment) => comment.id === posted.body!.data!.id)).toBe(true);

    // A public question must not leak into the private thread.
    const messages = await jose.get<{ body: string }[]>(`/conversations/${conversationId}/messages?perPage=50`);
    expect(messages.body!.data!.some((message) => message.body.includes('disc drive'))).toBe(false);

    expect((await grace.post(`/listings/${fx('sony').id}/comments`, { body: 'x' })).status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* Authorisation boundaries and malformed input (criteria 9, 17, 18)           */
/* -------------------------------------------------------------------------- */

describe('authorisation boundaries (criteria 9, 17, 18)', () => {
  it('refuses a cross-user edit, submission and withdrawal', async () => {
    const before = await queryOne<{ title: string; asking_price_tzs: string }>(
      'SELECT title, asking_price_tzs FROM listings WHERE id = $1',
      [draftListingId],
    );

    const edit = await zawadi.patch(`/me/listings/${draftListingId}`, {
      title: 'Hijacked listing title',
      askingPriceTzs: 1000,
    });
    expect([403, 404]).toContain(edit.status);

    const submit = await zawadi.post(`/me/listings/${draftListingId}/submit`, {
      confirmAccuracy: true,
      confirmLawful: true,
    });
    expect([403, 404]).toContain(submit.status);

    const withdraw = await zawadi.post(`/me/listings/${draftListingId}/withdraw`, { reason: 'not mine' });
    expect([403, 404]).toContain(withdraw.status);

    expect((await baraka.get(`/me/listings/${draftListingId}`)).status).toBe(200);

    const after = await queryOne<{ title: string; asking_price_tzs: string }>(
      'SELECT title, asking_price_tzs FROM listings WHERE id = $1',
      [draftListingId],
    );
    expect(after).toEqual(before);
  });

  it('blocks members and guests from every administrator endpoint', async () => {
    expect((await zawadi.get('/admin/overview')).status).toBe(403);
    expect((await zawadi.get('/admin/users')).status).toBe(403);
    expect(
      (await zawadi.post('/admin/notes', { entityType: 'listing', entityId: draftListingId, body: 'nope' })).status,
    ).toBe(403);
    expect((await anonymous.get('/admin/overview')).status).toBe(401);
    expect((await anonymous.get('/admin/audit-logs')).status).toBe(401);
  });

  it('rejects malformed bodies with field-level detail instead of a 500', async () => {
    const badPrice = await baraka.post('/me/listings', {
      title: 'Broken draft listing',
      categorySlug: 'smartphones',
      model: 'Spark 20',
      condition: 'good',
      description: 'This payload deliberately carries an invalid price to check the validation layer response.',
      askingPriceTzs: 'not-a-number',
      region: 'Dodoma',
    });
    expect(badPrice.status).toBe(422);
    const details = (badPrice.body as { error?: { code: string; details?: { path: string }[] } }).error;
    expect(details?.code).toBe('validation_failed');
    expect(details?.details?.some((item) => item.path.includes('askingPriceTzs'))).toBe(true);

    const missingSpecs = await baraka.post('/me/listings', {
      title: 'Smartphone without specs',
      categorySlug: 'smartphones',
      model: 'Spark 20',
      condition: 'good',
      description: 'A smartphone listing that omits the required specification fields must be refused by the API.',
      askingPriceTzs: 300_000,
      region: 'Dodoma',
      specs: { notARealField: 'value' },
    });
    expect(missingSpecs.status).toBe(422);

    const unknownListing = await anonymous.get(`/listings/${draftListingId}`);
    expect(unknownListing.status).toBe(404);
    expect((unknownListing.body as { error?: { code: string } }).error?.code).toBe('not_found');

    const shortReport = await baraka.post('/reports', {
      category: 'fraudulent_seller',
      description: 'too short',
      listingId: fx('canon').id,
    });
    expect(shortReport.status).toBe(422);
  });

  it('treats hostile search input as data, never as SQL', async () => {
    const everything = await anonymous.get<unknown[]>('/listings?perPage=60');
    const total = (everything.body as { meta?: { total: number } }).meta!.total;
    expect(total).toBeGreaterThan(0);

    for (const payload of ["' OR 1=1 --", '%', "'; DROP TABLE listings; --", '"_', '\\']) {
      const response = await anonymous.get<{ title: string; model: string; brand: string }[]>(
        `/listings?q=${encodeURIComponent(payload)}&perPage=60`,
      );
      expect(response.status, `q=${payload}`).toBe(200);
      // An injection payload must never widen the result set to the whole
      // catalogue.
      expect(response.body!.data!.length, `q=${payload} returned every listing`).toBeLessThan(total);
      if (payload === '%') {
        // A wildcard is data: only devices whose own text contains "%" match.
        for (const card of response.body!.data!) {
          expect(`${card.title} ${card.model} ${card.brand}`.toLowerCase()).toContain('%');
        }
      }
    }

    const absent = await anonymous.get<unknown[]>("/listings?q=" + encodeURIComponent("'; DROP TABLE listings; --"));
    expect(absent.body!.data).toEqual([]);
    const alive = await queryOne<{ count: string }>('SELECT count(*)::text AS count FROM listings');
    expect(Number(alive?.count)).toBeGreaterThan(0);

    // Text is stored and returned verbatim as JSON (the web client escapes it
    // on render) and the response is never served as HTML.
    const comment = await baraka.post<{ body: string }>(`/listings/${fx('sony').id}/comments`, {
      body: '<script>alert(1)</script> is this description accurate?',
    });
    expect(comment.status).toBe(201);
    expect(comment.body!.data!.body).toBe('<script>alert(1)</script> is this description accurate?');
    expect(comment.headers['content-type']).toContain('application/json');
    expect(comment.headers['x-content-type-options']).toBe('nosniff');
  });
});

/* -------------------------------------------------------------------------- */
/* Exchange requests (criterion 13)                                            */
/* -------------------------------------------------------------------------- */

describe('exchange requests follow the published state machine (criterion 13)', () => {
  let proposalId: string;
  let counterId: string;
  let exchangeTransactionId: string;

  it('blocks proposals that break the rules', async () => {
    const sameTwice = await jose.post('/exchanges', {
      listingId: fx('sony').id,
      offeredListingId: fx('sony').id,
      message: 'A proposal that uses the very same listing twice must be refused.',
      priceDifferenceTzs: 0,
    });
    expect(sameTwice.status).toBe(422);

    const notMine = await baraka.post('/exchanges', {
      listingId: fx('sony').id,
      offeredListingId: fx('tecno').id,
      message: 'Offering somebody else\'s device must be refused by the API.',
      priceDifferenceTzs: 0,
    });
    expect(notMine.status).toBe(403);
    expect((notMine.body as { error?: { code: string } }).error?.code).toBe('forbidden');

    const ownTarget = await jose.post('/exchanges', {
      listingId: fx('sony').id,
      offeredListingId: fx('apple').id,
      message: 'You cannot propose an exchange against your own listing.',
      priceDifferenceTzs: 0,
    });
    expect(ownTarget.status).toBe(409);

    // Zawadi's MacBook is reserved, so it may not be offered as a swap even
    // though it belongs to her.
    const reserved = await zawadi.post('/exchanges', {
      listingId: fx('samsung').id,
      offeredListingId: fx('apple').id,
      message: 'Offering a device that is already reserved must be refused.',
      priceDifferenceTzs: 0,
    });
    expect(reserved.status).toBe(409);
  });

  it('creates a pending proposal and only lets the recipient respond', async () => {
    const created = await baraka.post<{ id: string; status: string }>('/exchanges', {
      listingId: fx('sony').id,
      offeredListingId: fx('samsung').id,
      message: 'I would like to swap my boxed Galaxy S23 Ultra for your PlayStation 5 Slim.',
      priceDifferenceTzs: -400_000,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    proposalId = created.body!.data!.id;
    expect(created.body!.data!.status).toBe('pending');

    // The requester may not answer their own proposal.
    expect((await baraka.post(`/exchanges/${proposalId}/respond`, { action: 'accept' })).status).toBe(403);
    // Nor may an unrelated member.
    expect((await grace.post(`/exchanges/${proposalId}/respond`, { action: 'accept' })).status).toBe(403);
    expect((await grace.get(`/exchanges/${proposalId}`)).status).toBe(403);
  });

  it('supports a counter-proposal that the original requester can accept', async () => {
    const countered = await jose.post(`/exchanges/${proposalId}/respond`, {
      action: 'counter',
      message: 'I would accept if you add 250,000 TZS on top of the S23 Ultra.',
      counterPriceDifferenceTzs: 250_000,
    });
    expect(countered.status, JSON.stringify(countered.body)).toBe(200);

    const parent = await queryOne<{ status: string }>('SELECT status FROM exchange_requests WHERE id = $1', [proposalId]);
    expect(parent?.status).toBe('countered');

    const child = await queryOne<{ id: string; price_difference_tzs: string }>(
      `SELECT id, price_difference_tzs FROM exchange_requests
        WHERE parent_request_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [proposalId],
    );
    expect(child, 'the counter-proposal is recorded as a linked request').toBeTruthy();
    expect(Number(child!.price_difference_tzs)).toBe(250_000);
    counterId = child!.id;

    // A counter-proposal without an amount is a validation error, not a crash.
    const noAmount = await baraka.post(`/exchanges/${counterId}/respond`, { action: 'counter' });
    expect(noAmount.status).toBe(422);
    expect((noAmount.body as { error?: { code: string } }).error?.code).toBe('validation_failed');

    const accepted = await baraka.post<{ status: string }>(`/exchanges/${counterId}/respond`, {
      action: 'accept',
      message: 'Agreed, I will add 250,000 TZS on top.',
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body!.data!.status).toBe('accepted');

    // Accepting reserves both devices and opens a transaction record.
    const reserved = await queryMany<{ id: string; availability: string }>(
      'SELECT id, availability FROM listings WHERE id = ANY($1::uuid[])',
      [[fx('sony').id, fx('samsung').id]],
    );
    expect(reserved).toHaveLength(2);
    for (const row of reserved) expect(row.availability).toBe('reserved');

    const transaction = await queryOne<{
      id: string;
      type: string;
      status: string;
      agreed_amount_tzs: string;
      seller_id: string;
      buyer_id: string;
    }>(
      'SELECT id, type, status, agreed_amount_tzs, seller_id, buyer_id FROM transactions WHERE exchange_request_id = $1',
      [counterId],
    );
    expect(transaction?.type).toBe('exchange');
    expect(transaction?.status).toBe('initiated');
    expect(Number(transaction?.agreed_amount_tzs)).toBe(250_000);
    exchangeTransactionId = transaction!.id;

    // A second decision on an accepted proposal is refused.
    const again = await baraka.post(`/exchanges/${counterId}/respond`, { action: 'accept' });
    expect(again.status).toBe(409);
    expect((again.body as { error?: { code: string } }).error?.code).toBe('invalid_state_transition');
    expect((await baraka.post(`/exchanges/${counterId}/respond`, { action: 'reject' })).status).toBe(409);
  });

  it('marks the swap complete with an honest transaction history', async () => {
    const completed = await baraka.post<{ status: string }>(`/exchanges/${counterId}/respond`, {
      action: 'complete',
      message: 'Met in Dodoma, both devices handed over.',
    });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body!.data!.status).toBe('completed');

    const transaction = await queryOne<{ status: string; completed_at: Date | null }>(
      'SELECT status, completed_at FROM transactions WHERE id = $1',
      [exchangeTransactionId],
    );
    expect(transaction?.status).toBe('completed');
    expect(transaction?.completed_at).not.toBeNull();

    const history = await queryMany<{ from_status: string | null; to_status: string }>(
      `SELECT from_status, to_status FROM transaction_status_history
        WHERE transaction_id = $1 ORDER BY created_at ASC, id ASC`,
      [exchangeTransactionId],
    );
    expect(history.map((entry) => `${entry.from_status ?? 'new'}→${entry.to_status}`)).toEqual([
      'new→initiated',
      'initiated→agreed',
      'agreed→completed',
    ]);

    const sold = await queryMany<{ availability: string }>(
      'SELECT availability FROM listings WHERE id = ANY($1::uuid[])',
      [[fx('sony').id, fx('samsung').id]],
    );
    for (const row of sold) expect(row.availability).toBe('sold');

    // Completing an exchange that is not accepted is impossible.
    expect((await baraka.post(`/exchanges/${counterId}/respond`, { action: 'complete' })).status).toBe(409);
  });
});

/* -------------------------------------------------------------------------- */
/* Transaction records and status history (criterion 15)                       */
/* -------------------------------------------------------------------------- */

describe('transaction records keep a full status history (criterion 15)', () => {
  let transactionId: string;

  it('opens a purchase arrangement and records the initiating entry', async () => {
    const opened = await baraka.post<{ id: string; reference: string; status: string }>('/transactions', {
      listingId: fx('tecno').id,
      type: 'purchase',
    });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    transactionId = opened.body!.data!.id;
    expect(opened.body!.data!.reference).toMatch(/^TXN-\d{4}-\d{6}$/);
    expect(opened.body!.data!.status).toBe('initiated');

    const history = await queryMany<{ from_status: string | null; to_status: string }>(
      'SELECT from_status, to_status FROM transaction_status_history WHERE transaction_id = $1 ORDER BY created_at ASC',
      [transactionId],
    );
    expect(history).toHaveLength(1);
    expect(history[0]!.from_status).toBeNull();
    expect(history[0]!.to_status).toBe('initiated');
  });

  it('lets both parties move the record and keeps every step with its actor', async () => {
    const negotiating = await happyness.patch<{ status: string }>(`/transactions/${transactionId}/status`, {
      status: 'negotiating',
      note: 'The buyer will collect the handset in Mbeya this weekend.',
    });
    expect(negotiating.status, JSON.stringify(negotiating.body)).toBe(200);
    expect(negotiating.body!.data!.status).toBe('negotiating');

    const agreed = await baraka.patch<{ status: string }>(`/transactions/${transactionId}/status`, {
      status: 'agreed',
      note: 'Price of 400,000 TZS agreed.',
    });
    expect(agreed.status).toBe(200);

    const completed = await baraka.patch<{ status: string; completedAt: string | null }>(
      `/transactions/${transactionId}/status`,
      { status: 'completed', note: 'Handover done and the device was checked.' },
    );
    expect(completed.status).toBe(200);
    expect(completed.body!.data!.status).toBe('completed');
    expect(completed.body!.data!.completedAt).not.toBeNull();

    const detail = await baraka.get<{ history: { toStatus: string; note: string | null; actor: { id: string | null } }[] }>(
      `/transactions/${transactionId}`,
    );
    expect(detail.status).toBe(200);
    const trail = detail.body!.data!.history;
    expect(trail.map((entry) => entry.toStatus)).toEqual(['initiated', 'negotiating', 'agreed', 'completed']);
    expect(trail[1]!.note).toContain('Mbeya');
    expect(trail[1]!.actor.id).toBeTruthy();

    const rows = await queryMany<{ to_status: string; actor_id: string | null }>(
      `SELECT to_status, actor_id FROM transaction_status_history
        WHERE transaction_id = $1 ORDER BY created_at ASC`,
      [transactionId],
    );
    expect(rows.map((row) => row.to_status)).toEqual(['initiated', 'negotiating', 'agreed', 'completed']);
    expect(rows.every((row) => row.actor_id !== null)).toBe(true);
  });

  it('rejects invalid transitions and non-party access', async () => {
    const backwards = await baraka.patch(`/transactions/${transactionId}/status`, { status: 'negotiating' });
    expect(backwards.status).toBe(409);
    expect((backwards.body as { error?: { code: string } }).error?.code).toBe('invalid_state_transition');

    expect((await baraka.patch(`/transactions/${transactionId}/status`, { status: 'paid' })).status).toBe(422);
    expect((await grace.get(`/transactions/${transactionId}`)).status).toBe(403);
    expect((await grace.patch(`/transactions/${transactionId}/status`, { status: 'disputed' })).status).toBe(403);
    expect((await anonymous.get(`/transactions/${transactionId}`)).status).toBe(401);
  });

  it('never serves an unauthenticated dashboard', async () => {
    expect((await anonymous.get('/me/dashboard')).status).toBe(401);
    expect((await anonymous.get('/transactions')).status).toBe(401);
    expect((await anonymous.get('/exchanges')).status).toBe(401);
    expect((await anonymous.get('/reports?mine=true')).status).toBe(401);
    expect((await anonymous.get('/notifications')).status).toBe(401);
    expect((await anonymous.get('/me/saved')).status).toBe(401);
  });
});

/* -------------------------------------------------------------------------- */
/* Reports, moderation and audit trail (criterion 14)                          */
/* -------------------------------------------------------------------------- */

describe('reports are investigated, resolved and never silently deleted (criterion 14)', () => {
  let reportId: string;

  it('accepts a categorised report and keeps it private to the reporter and moderators', async () => {
    const created = await baraka.post<{ id: string; reference: string; status: string }>('/reports', {
      category: 'misleading_description',
      description: 'The listing claims a low shutter count but the photographs show heavy wear on the lens mount.',
      listingId: fx('canon').id,
      contactConsent: true,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    reportId = created.body!.data!.id;
    expect(created.body!.data!.reference).toMatch(/^RPT-\d{4}-\d{6}$/);
    expect(created.body!.data!.status).toBe('open');

    // Another member cannot read it, and guests see nothing at all.
    expect((await grace.get(`/reports/${reportId}`)).status).toBe(403);
    expect((await anonymous.get(`/reports/${reportId}`)).status).toBe(401);

    // The report text is never published with the listing.
    const publicPage = await anonymous.get(`/listings/${fx('canon').slug}`);
    expect(publicPage.status).toBe(200);
    expect(JSON.stringify(publicPage.body)).not.toContain('lens mount');
  });

  it('lets an administrator investigate with internal notes and resolve with a reason', async () => {
    const internalNote = await admin.post(`/reports/${reportId}/notes`, {
      body: 'Internal: requested the original purchase receipt from the seller before deciding.',
      visibility: 'moderator_note',
    });
    expect(internalNote.status).toBe(201);

    const reporterView = await baraka.get<{ notes: { body: string }[] }>(`/reports/${reportId}`);
    expect(reporterView.status).toBe(200);
    expect(reporterView.body!.data!.notes.some((note) => note.body.includes('original purchase receipt'))).toBe(false);

    const underReview = await admin.post<{ status: string }>(`/admin/reports/${reportId}/resolve`, {
      status: 'under_review',
      resolution: 'Investigating the condition description with the seller.',
      listingAction: 'none',
      noteVisibility: 'reporter_visible',
    });
    expect(underReview.status, JSON.stringify(underReview.body)).toBe(200);
    expect(underReview.body!.data!.status).toBe('under_review');

    const resolved = await admin.post<{ status: string; resolution: string | null; resolvedAt: string | null }>(
      `/admin/reports/${reportId}/resolve`,
      {
        status: 'resolved',
        priority: 'high',
        resolution: 'The seller could not evidence the stated shutter count, so the listing was suspended pending proof of ownership.',
        listingAction: 'suspend',
        noteVisibility: 'reporter_visible',
      },
    );
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect(resolved.body!.data!.status).toBe('resolved');
    expect(resolved.body!.data!.resolution).toContain('suspended');
    expect(resolved.body!.data!.resolvedAt).not.toBeNull();
  });

  it('applies the listing action, tells the reporter and records the audit trail', async () => {
    const listing = await queryOne<{ status: string; availability: string }>(
      'SELECT status, availability FROM listings WHERE id = $1',
      [fx('canon').id],
    );
    expect(listing?.status).toBe('suspended');
    expect(listing?.availability).toBe('inactive');

    // A suspended listing disappears from the public catalogue and its page.
    expect((await anonymous.get(`/listings/${fx('canon').slug}`)).status).toBe(404);
    const search = await anonymous.get<{ id: string }[]>('/listings?q=Canon&perPage=60');
    expect(search.body!.data!.some((card) => card.id === fx('canon').id)).toBe(false);

    // The reporter sees the outcome.
    const reporterView = await baraka.get<{ status: string; resolution: string | null }>(`/reports/${reportId}`);
    expect(reporterView.body!.data!.status).toBe('resolved');
    expect(reporterView.body!.data!.resolution).toContain('suspended');

    const notification = await queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications n JOIN users u ON u.id = n.user_id
        WHERE u.email = $1 AND n.entity_type = 'report' AND n.entity_id = $2`,
      [BARAKA, reportId],
    );
    expect(Number(notification?.count)).toBeGreaterThan(0);

    // Moderation history is append-only: closing a report records an action row.
    const audit = await queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM moderation_actions
        WHERE entity_type = 'report' AND entity_id = $1 AND action = 'report_status_changed'`,
      [reportId],
    );
    expect(Number(audit?.count)).toBeGreaterThan(0);

    const history = await admin.get<{ id: string }[]>(`/admin/moderation-history?entityType=report&entityId=${reportId}`);
    expect(history.status).toBe(200);
    expect(history.body!.data!.length).toBeGreaterThan(0);
  });

  it('never deletes a resolved report and keeps the moderation notes', async () => {
    const resolved = await admin.get<{ status: string; resolution: string | null; notes: { body: string }[] }>(
      `/admin/reports/${reportId}`,
    );
    expect(resolved.status).toBe(200);
    expect(resolved.body!.data!.status).toBe('resolved');
    expect(resolved.body!.data!.resolution).toContain('suspended');
    expect(resolved.body!.data!.notes.some((note) => note.body.includes('original purchase receipt'))).toBe(true);

    const row = await queryOne<{ status: string; resolution: string | null }>(
      'SELECT status, resolution FROM reports WHERE id = $1',
      [reportId],
    );
    expect(row?.status).toBe('resolved');
    expect(row?.resolution).toBeTruthy();

    // The queue no longer lists it as open, but it is still retrievable.
    const openQueue = await admin.get<{ id: string }[]>('/admin/reports?status=open&perPage=60');
    expect(openQueue.status).toBe(200);
    expect((openQueue.body!.data ?? []).some((item) => item.id === reportId)).toBe(false);
  });

  it('refuses report resolution by anyone but an administrator', async () => {
    const attempt = await baraka.post(`/admin/reports/${reportId}/resolve`, {
      status: 'dismissed',
      resolution: 'Self-serving dismissal attempt that must be refused.',
    });
    expect(attempt.status).toBe(403);
    const stillResolved = await queryOne<{ status: string }>('SELECT status FROM reports WHERE id = $1', [reportId]);
    expect(stillResolved?.status).toBe('resolved');
  });
});

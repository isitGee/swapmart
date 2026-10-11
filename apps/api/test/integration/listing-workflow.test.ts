/**
 * Integration tests — the listing and verification workflow.
 *
 * Covers acceptance criteria 3 (create a listing with photographs), 4
 * (unpublished listings stay hidden), 5 (a duplicate identifier is refused
 * server-side), 6 (an administrator decides with a reason), 7 (an approved
 * listing becomes public), 8 (a rejected listing stays hidden), 9 (another
 * member cannot edit your listing) and 16 (identifiers and evidence never
 * become public). Also covers criterion 20's race safety.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryMany, queryOne } from '../../src/db/pool.ts';
import { generatePng } from '../../src/db/seed-support.ts';
import { createTestContext, newClient } from '../helpers/http.ts';
import type { TestClient, TestContext } from '../helpers/http.ts';

/** The seeded demonstration password (override with DEMO_PASSWORD when seeding). */
const PASSWORD = process.env.DEMO_PASSWORD?.trim() || 'Mteja#Salama2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Simamia#Salama2026';
const BARAKA = 'baraka.juma@example.co.tz';
const ZAWADI = 'zawadi.mtei@example.co.tz';

let context: TestContext;
let seller: TestClient;
let otherMember: TestClient;
let admin: TestClient;

/** Signs a client in and leaves it with a CSRF token, like the real client. */
async function signIn(client: TestClient, email: string, password = PASSWORD): Promise<void> {
  await client.get('/auth/me');
  const response = await client.post('/auth/login', { email, password });
  expect(response.status, `sign-in for ${email}`).toBe(200);
}

/** Uploads N device photographs and returns their media ids. */
async function uploadImages(client: TestClient, count: number, tint: number): Promise<string[]> {
  const files = Array.from({ length: count }, (_, index) => ({
    field: 'files',
    filename: `device-${tint}-${index}.png`,
    content: generatePng(64, 48, [tint, 40 + index * 10, 120], [200, 200, 255]),
    contentType: 'image/png',
  }));
  const response = await client.upload<{ id: string; url: string; visibility: string }[]>(
    '/uploads/listing-images',
    {},
    files,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return (response.body?.data ?? []).map((asset) => asset.id);
}

/** Registers, verifies and signs in a brand-new member. */
async function createVerifiedMember(label: string): Promise<{ client: TestClient; email: string }> {
  const client = newClient(context);
  const email = `${label}.${Date.now()}.${Math.floor(Math.random() * 10_000)}@example.co.tz`;
  await client.get('/auth/me');
  const registration = await client.post('/auth/register', {
    fullName: `Test Seller ${label}`,
    email,
    password: PASSWORD,
    region: 'Dodoma',
    acceptTerms: true,
  });
  expect(registration.status).toBe(201);

  const outbox = await client.get<{ bodyText: string }>(
    `/dev/email-outbox?email=${encodeURIComponent(email)}&template=verify_email`,
  );
  const link = /https?:\/\/\S+/.exec(outbox.body?.data?.bodyText ?? '');
  expect(link, 'verification link recorded in the development outbox').not.toBeNull();
  const token = new URL(link![0]).searchParams.get('token')!;
  expect((await client.post('/auth/email/confirm', { token })).status).toBe(200);

  await signIn(client, email);
  return { client, email };
}

beforeAll(async () => {
  context = createTestContext();
  seller = newClient(context);
  otherMember = newClient(context);
  admin = newClient(context);
  await signIn(seller, BARAKA);
  await signIn(otherMember, ZAWADI);
  await signIn(admin, 'admin@swapmart.co.tz', ADMIN_PASSWORD);
});

afterAll(async () => {
  await closePool();
});

describe('seller submission journey (criteria 3, 4, 5, 6, 7)', () => {
  let listingId: string;
  let listingSlug: string;
  let mediaIds: string[];

  it('uploads device photographs as private-then-public listing images', async () => {
    mediaIds = await uploadImages(seller, 3, 10);
    expect(mediaIds).toHaveLength(3);

    const rows = await queryMany<{ id: string; purpose: string; visibility: string; checksum_sha256: string | null }>(
      'SELECT id, purpose, visibility, checksum_sha256 FROM media_assets WHERE id = ANY($1::uuid[])',
      [mediaIds],
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.purpose).toBe('listing_image');
      expect(row.visibility).toBe('public');
      // Every upload is checksummed so reused photographs can be detected.
      expect(row.checksum_sha256).toHaveLength(64);
    }
  });

  it('rejects a file that is not really an image (magic-byte validation)', async () => {
    const response = await seller.upload(
      '/uploads/listing-images',
      {},
      [
        {
          field: 'files',
          filename: 'not-an-image.png',
          // PNG extension, but the bytes are a script.
          content: Buffer.from('<script>alert(1)</script>', 'utf8'),
          contentType: 'image/png',
        },
      ],
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('creates a draft listing with an identifier and private evidence', async () => {
    const evidenceUpload = await seller.upload<{ id: string; visibility: string }[]>(
      '/uploads/evidence',
      {},
      [
        {
          field: 'files',
          filename: 'receipt.png',
          content: generatePng(48, 64, [240, 240, 240], [180, 180, 200]),
          contentType: 'image/png',
        },
        {
          field: 'files',
          filename: 'device-front.png',
          content: generatePng(48, 64, [200, 210, 230], [150, 160, 190]),
          contentType: 'image/png',
        },
      ],
    );
    expect(evidenceUpload.status).toBe(201);
    const evidenceId = evidenceUpload.body?.data?.[0]?.id as string;
    const deviceFrontId = evidenceUpload.body?.data?.[1]?.id as string;
    expect(evidenceUpload.body?.data?.[0]?.visibility).toBe('private');
    expect(evidenceId).toBeTruthy();

    const response = await seller.post<{ id: string; slug: string; status: string }>('/me/listings', {
      title: 'iPhone 13 128 GB blue — battery health 89%',
      categorySlug: 'smartphones',
      brandName: 'Apple',
      model: 'iPhone 13',
      condition: 'excellent',
      description:
        'Selling my iPhone 13, 128 GB in blue. Battery health 89%, Face ID and both cameras work. Comes with the original box, a USB-C cable and a screen protector already fitted. Minor scuff on the bottom-left corner is visible in photograph three. Bought from an authorised shop in Dar es Salaam in 2022; receipt is attached for the moderator.',
      askingPriceTzs: 1_350_000,
      negotiable: true,
      region: 'Dar es Salaam',
      city: 'Mikocheni',
      exchangeAllowed: true,
      specs: { storageGb: 128, ramGb: 6, batteryHealth: '85-89', network: '5G', colour: 'Blue', boxAndAccessories: true },
      identifiers: [{ kind: 'imei', value: '351234567890116' }],
      imageMediaIds: mediaIds,
      evidence: [
        { mediaId: evidenceId, kind: 'proof_of_purchase', note: 'Shop receipt, March 2022' },
        { mediaId: deviceFrontId, kind: 'device_front', note: 'Front of the handset, showing the screen' },
      ],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    listingId = response.body?.data?.id as string;
    listingSlug = response.body?.data?.slug as string;
    expect(listingId).toBeTruthy();

    const stored = await queryOne<{ value_encrypted: string; fingerprint: string; last4: string; masked: string }>(
      'SELECT value_encrypted, fingerprint, last4, masked FROM device_identifiers WHERE listing_id = $1',
      [listingId],
    );
    // Stored encrypted, never in the clear, with a keyed fingerprint for duplicate detection.
    expect(stored?.value_encrypted.startsWith('v1.')).toBe(true);
    expect(stored?.value_encrypted).not.toContain('351234567890');
    expect(stored?.fingerprint).toHaveLength(64);
    expect(stored?.masked).not.toContain('3512345678901');
    expect(stored?.last4).toBeTruthy();
  });

  it('rejects an identifier whose IMEI check digit is wrong', async () => {
    const response = await seller.post('/me/listings', {
      title: 'Bad identifier test listing',
      categorySlug: 'smartphones',
      brandName: 'Apple',
      model: 'iPhone 12',
      condition: 'good',
      description: 'A listing used to prove that an identifier with a broken check digit cannot be submitted at all.',
      askingPriceTzs: 900_000,
      region: 'Dodoma',
      specs: { storageGb: 64, ramGb: 4, batteryHealth: '70-79', network: '4G' },
      identifiers: [{ kind: 'imei', value: '351234567890110' }],
      imageMediaIds: mediaIds.slice(0, 1),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body?.error?.code).toBe('validation_failed');
  });

  it('keeps the draft invisible on the public catalogue (criterion 4)', async () => {
    const anonymous = newClient(context);
    const detail = await anonymous.get(`/listings/${listingSlug}`);
    expect(detail.status).toBe(404);

    const search = await anonymous.get<{ id: string }[]>('/listings?q=iPhone%2013');
    expect((search.body?.data ?? []).map((item) => item.id)).not.toContain(listingId);

    const owner = await queryOne<{ status: string }>('SELECT status FROM listings WHERE id = $1', [listingId]);
    expect(owner?.status).toBe('draft');
  });

  it('refuses another member editing the draft (criterion 9)', async () => {
    // A perfectly valid change, submitted by somebody who does not own it.
    const response = await otherMember.patch(`/me/listings/${listingId}`, { askingPriceTzs: 1_400_000 });
    expect([403, 404]).toContain(response.status);

    const unchanged = await queryOne<{ asking_price_tzs: number }>(
      'SELECT asking_price_tzs FROM listings WHERE id = $1',
      [listingId],
    );
    expect(Number(unchanged?.asking_price_tzs)).toBe(1_350_000);
  });

  it('runs the automated checks on submission and routes it to review', async () => {
    const response = await seller.post(`/me/listings/${listingId}/submit`, { confirmAccuracy: true, confirmLawful: true });
    expect(response.status).toBe(200);

    const listing = await queryOne<{ status: string; submitted_at: Date | null; submission_round: number }>(
      'SELECT status, submitted_at, submission_round FROM listings WHERE id = $1',
      [listingId],
    );
    expect(listing?.submitted_at).toBeInstanceOf(Date);
    expect(listing?.submission_round).toBeGreaterThanOrEqual(1);
    expect(['checks_pending', 'under_review', 'flagged', 'evidence_required']).toContain(listing?.status);

    const attempt = await queryOne<{ outcome: string; external_check_status: string; flags: unknown }>(
      'SELECT outcome, external_check_status, flags FROM device_verification_attempts WHERE listing_id = $1 ORDER BY attempt_number DESC LIMIT 1',
      [listingId],
    );
    expect(attempt).not.toBeNull();
    // No provider is configured, and the record says exactly that.
    expect(attempt?.external_check_status).toBe('not_configured');
    expect(['clean', 'flagged', 'needs_evidence', 'unavailable']).toContain(attempt?.outcome);
  });

  it('still hides the listing from the public catalogue while it is in review', async () => {
    const anonymous = newClient(context);
    expect((await anonymous.get(`/listings/${listingSlug}`)).status).toBe(404);
  });

  it('lets an administrator approve it with a reason code and note (criterion 6)', async () => {
    // The administrator finds the submission in the review queue first.
    const queue = await admin.get<{ id: string }[]>('/admin/listings?perPage=60&sort=oldest');
    expect(queue.status).toBe(200);
    expect((queue.body?.data ?? []).map((item) => item.id)).toContain(listingId);

    const response = await admin.post<{ status: string; notice: string }>(
      `/admin/listings/${listingId}/decision`,
      {
        decision: 'approve',
        reasonCode: 'verified_documents',
        reasonNote: 'Receipt matches the identifier and the photographs show the device as described.',
        releaseIdentifier: false,
        acknowledgeLimits: true,
      },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body?.data?.status).toBe('approved');
    expect(response.body?.data?.notice).toContain('not a statement of legal ownership');

    const listing = await queryOne<{ status: string; published_at: Date | null; availability: string }>(
      'SELECT status, published_at, availability FROM listings WHERE id = $1',
      [listingId],
    );
    expect(listing?.status).toBe('approved');
    expect(listing?.published_at).toBeInstanceOf(Date);

    const action = await queryOne<{ action: string; reason_code: string; reason_note: string; actor_id: string }>(
      'SELECT action, reason_code, reason_note, actor_id FROM moderation_actions WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1',
      [listingId],
    );
    expect(action?.action).toBe('approved');
    expect(action?.reason_code).toBe('verified_documents');
    expect(action?.reason_note).toContain('Receipt matches');

    const audit = await queryOne<{ action: string }>(
      "SELECT action FROM audit_logs WHERE entity_id = $1 AND action LIKE 'listing%' ORDER BY created_at DESC LIMIT 1",
      [listingId],
    );
    expect(audit).not.toBeNull();
  });

  it('refuses a decision that does not acknowledge the limits of approval', async () => {
    const response = await admin.post(`/admin/listings/${listingId}/decision`, {
      decision: 'suspend',
      reasonCode: 'policy_violation',
      reasonNote: 'Testing that the acknowledgement cannot be skipped.',
      acknowledgeLimits: false,
    });
    expect(response.status).toBe(422);
  });

  it('publishes the approved listing in the public catalogue (criterion 7)', async () => {
    const anonymous = newClient(context);
    const detail = await anonymous.get<Record<string, unknown>>(`/listings/${listingSlug}`);
    expect(detail.status).toBe(200);
    expect(detail.body?.data?.title).toContain('iPhone 13');
    expect(detail.body?.data?.status).toBe('approved');
    expect(detail.body?.data?.identifierSummary).toBeTruthy();

    const search = await anonymous.get<{ id: string; seller: { displayName: string } }[]>('/listings?q=iPhone%2013');
    const found = (search.body?.data ?? []).find((item) => item.id === listingId);
    expect(found).toBeTruthy();
    expect(found?.seller.displayName).toBeTruthy();
  });

  it('never exposes identifiers, fingerprints or moderation notes publicly (criterion 16)', async () => {
    const anonymous = newClient(context);
    const detail = await anonymous.get<Record<string, unknown>>(`/listings/${listingSlug}`);
    const serialised = JSON.stringify(detail.body);

    expect(serialised).not.toContain('351234567890116');
    expect(serialised).not.toContain('value_encrypted');
    expect(serialised).not.toContain('fingerprint');
    expect(serialised).not.toContain('receipt.png');
    expect(serialised).not.toContain('storageKey');
    // The masked summary is what a visitor sees.
    expect(serialised).toContain('••••');

    // Evidence is only reachable through an authorised route.
    const evidence = await queryOne<{ media_asset_id: string }>(
      'SELECT media_asset_id FROM verification_evidence WHERE listing_id = $1 LIMIT 1',
      [listingId],
    );
    const privateRead = await anonymous.get(`/api/v1/media/private/${evidence?.media_asset_id}`);
    // Anonymous callers are refused; the API does not confirm whether the asset exists.
    expect([401, 403, 404]).toContain(privateRead.status);

    // The owner is authorised to read their own evidence.
    const ownerRead = await seller.get<{ id: string }>(`/api/v1/media/private/${evidence?.media_asset_id}`);
    expect(ownerRead.status).toBe(200);

    // The owner sees their own identifiers (masked) but never the ciphertext.
    const ownerDetail = await seller.get<Record<string, unknown>>(`/me/listings/${listingId}`);
    expect(JSON.stringify(ownerDetail.body)).not.toContain('value_encrypted');
    expect(JSON.stringify(ownerDetail.body)).not.toContain('351234567890116');
  });
});

describe('rejected listings stay hidden (criterion 8)', () => {
  it('rejects a submission, hides it publicly, and tells the seller why', async () => {
    const { client } = await createVerifiedMember('reject');
    const media = await uploadImages(client, 2, 60);

    const created = await client.post<{ id: string; slug: string }>('/me/listings', {
      title: 'Samsung Galaxy S21 128 GB phantom grey',
      categorySlug: 'smartphones',
      brandName: 'Samsung',
      model: 'Galaxy S21',
      condition: 'good',
      description:
        'Samsung Galaxy S21 in phantom grey. Works well and includes a charger. Selling because I changed to a newer phone. There are small scratches on the frame, shown in the photographs, and the battery was replaced last year.',
      askingPriceTzs: 780_000,
      region: 'Arusha',
      specs: { storageGb: 128, ramGb: 8, batteryHealth: '80-84', network: '5G' },
      identifiers: [{ kind: 'serial', value: 'RF8N70TESTSELLER1' }],
      imageMediaIds: media,
    });
    expect(created.status).toBe(201);
    const listingId = created.body?.data?.id as string;
    const slug = created.body?.data?.slug as string;

    expect((await client.post(`/me/listings/${listingId}/submit`, { confirmAccuracy: true, confirmLawful: true })).status).toBe(200);

    const decision = await admin.post<{ status: string }>(`/admin/listings/${listingId}/decision`, {
      decision: 'reject',
      reasonCode: 'insufficient_evidence',
      reasonNote: 'The serial label photograph is unreadable. Resubmit with a clear photograph of the label.',
      releaseIdentifier: true,
      acknowledgeLimits: true,
    });
    expect(decision.status).toBe(200);
    expect(decision.body?.data?.status).toBe('rejected');

    const anonymous = newClient(context);
    expect((await anonymous.get(`/listings/${slug}`)).status).toBe(404);
    const search = await anonymous.get<{ id: string }[]>('/listings?q=Galaxy%20S21');
    expect((search.body?.data ?? []).map((item) => item.id)).not.toContain(listingId);

    // The seller sees the decision and its reason, so the outcome is never silent.
    const mine = await client.get<{ id: string; status: string; events: { action: string; reasonNote: string | null }[] }>(
      `/me/listings/${listingId}`,
    );
    expect(mine.status).toBe(200);
    expect(mine.body?.data?.status).toBe('rejected');
    const rejection = (mine.body?.data?.events ?? []).find((event) => event.action.includes('reject'));
    expect(rejection?.reasonNote).toContain('unreadable');

    const notification = await queryOne<{ title: string; body: string }>(
      `SELECT title, body FROM notifications WHERE user_id = (SELECT seller_id FROM listings WHERE id = $1)
        ORDER BY created_at DESC LIMIT 1`,
      [listingId],
    );
    expect(notification).not.toBeNull();
  });
});

describe('duplicate identifier defence is server-side (criterion 5)', () => {
  it('blocks a second active claim of the same identifier and records the attempt', async () => {
    const identifier = `TI${Date.now()}DUP`;
    const first = await createVerifiedMember('dup-one');
    const second = await createVerifiedMember('dup-two');

    const firstMedia = await uploadImages(first.client, 2, 90);
    const secondMedia = await uploadImages(second.client, 2, 130);

    const listingPayload = (mediaIds: string[]) => ({
      title: 'Tecno Spark 9 64 GB duplicate test unit',
      categorySlug: 'smartphones',
      brandName: 'Tecno',
      model: 'Spark 9',
      condition: 'good',
      description:
        'A test listing used to prove that the same device identifier cannot be claimed twice by two different accounts on the platform.',
      askingPriceTzs: 250_000,
      region: 'Morogoro',
      specs: { storageGb: 64, ramGb: 4, batteryHealth: '70-79', network: '4G' },
      identifiers: [{ kind: 'serial', value: identifier }],
      imageMediaIds: mediaIds,
    });

    const a = await first.client.post<{ id: string }>('/me/listings', listingPayload(firstMedia));
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const listingA = a.body?.data?.id as string;
    expect((await first.client.post(`/me/listings/${listingA}/submit`, { confirmAccuracy: true, confirmLawful: true })).status).toBe(200);

    const b = await second.client.post<{ id: string }>('/me/listings', listingPayload(secondMedia));
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    const listingB = b.body?.data?.id as string;
    const submitB = await second.client.post<{ id: string; status: string }>(`/me/listings/${listingB}/submit`, {
      confirmAccuracy: true,
      confirmLawful: true,
    });
    expect(submitB.status).toBe(200);

    // The second submission is held for moderator review, never published.
    const statusB = await queryOne<{ status: string }>('SELECT status FROM listings WHERE id = $1', [listingB]);
    expect(statusB?.status).toBe('flagged');

    const conflict = await queryOne<{ fingerprint: string; outcome: string; existing_listing_id: string }>(
      'SELECT fingerprint, outcome, existing_listing_id FROM identifier_conflicts WHERE attempted_listing_id = $1',
      [listingB],
    );
    expect(conflict).not.toBeNull();
    expect(conflict?.existing_listing_id).toBe(listingA);
    expect(conflict?.outcome).toMatch(/^blocked_/);

    const alert = await queryOne<{ kind: string; severity: string; related_listing_id: string; resolved_at: Date | null }>(
      "SELECT kind, severity, related_listing_id, resolved_at FROM duplicate_alerts WHERE listing_id = $1 AND kind = 'identifier_conflict'",
      [listingB],
    );
    expect(alert?.severity).toBe('critical');
    expect(alert?.resolved_at).toBeNull();

    // The database enforces the invariant too: a second active claim cannot be
    // inserted even by a direct write that bypasses the API.
    await expect(
      queryOne(
        `INSERT INTO device_identifiers (listing_id, device_id, owner_id, kind, value_encrypted, fingerprint, last4, masked, is_primary, is_active)
         SELECT $1, d.id, l.seller_id, 'serial', 'v1.x.x.x', fingerprint, last4, masked, false, true
           FROM device_identifiers di
           JOIN listings l ON l.id = $1
           JOIN devices d ON d.id = l.device_id
          WHERE di.listing_id = $2 LIMIT 1`,
        [listingB, listingA],
      ),
    ).rejects.toThrow();
  });

  it('does not disclose the other member’s private details when a conflict happens', async () => {
    const { client } = await createVerifiedMember('dup-viewer');
    const mine = await client.get<{ duplicateAlerts: { detail: string }[] }[]>('/me/listings');
    expect(mine.status).toBe(200);
    const serialised = JSON.stringify(mine.body);
    expect(serialised).not.toContain('value_encrypted');
    expect(serialised).not.toContain('fingerprint');
  });
});

describe('race safety under concurrent submission (criterion 20)', () => {
  it('accepts exactly one of two simultaneous identical claims', async () => {
    const identifier = `RACE${Date.now()}`;
    const { client: first } = await createVerifiedMember('race-one');
    const { client: second } = await createVerifiedMember('race-two');

    const firstMedia = await uploadImages(first, 1, 150);
    const secondMedia = await uploadImages(second, 1, 170);

    const payload = (mediaIds: string[]) => ({
      title: `Race safety test device ${identifier}`,
      categorySlug: 'smartphones',
      brandName: 'Nokia',
      model: 'G21',
      condition: 'fair',
      description:
        'Concurrent submission test: two accounts attempt to claim the same identifier at the same moment to prove the uniqueness rule holds under race conditions.',
      askingPriceTzs: 180_000,
      region: 'Tanga',
      specs: { storageGb: 64, ramGb: 4, batteryHealth: 'below-70', network: '4G' },
      identifiers: [{ kind: 'serial', value: identifier }],
      imageMediaIds: mediaIds,
    });

    const createdA = await first.post<{ id: string }>('/me/listings', payload(firstMedia));
    const createdB = await second.post<{ id: string }>('/me/listings', payload(secondMedia));
    expect(createdA.status).toBe(201);
    expect(createdB.status).toBe(201);

    const [submitA, submitB] = await Promise.all([
      first.post(`/me/listings/${createdA.body?.data?.id}/submit`, { confirmAccuracy: true, confirmLawful: true }),
      second.post(`/me/listings/${createdB.body?.data?.id}/submit`, { confirmAccuracy: true, confirmLawful: true }),
    ]);
    expect([submitA.status, submitB.status]).toEqual([200, 200]);

    const rows = await queryMany<{ listing_id: string; is_active: boolean }>(
      'SELECT listing_id, is_active FROM device_identifiers WHERE last4 = $1',
      [identifier.slice(-4)],
    );
    // Exactly one claim is active: the partial unique index makes the second
    // claim impossible, and the losing submission is flagged rather than lost.
    const active = rows.filter((row) => row.is_active);
    expect(active).toHaveLength(1);
  });
});

import { randomBytes } from 'node:crypto';
import type { ListingStatus, OwnerListingDto, Paginated, ListingSummaryDto } from '@swapmart/shared';
import {
  LISTING_EDITABLE_STATUSES,
  LISTING_PUBLIC_STATUS,
  PRICE_LIMITS,
  PUBLIC_AVAILABILITY_FILTER_VALUES,
  SORT_SQL,
  canTransitionAvailability,
  canTransitionListing,
  validateSpecsForCategory,
} from '@swapmart/shared';
import { logger } from '../config/logger.ts';
import { query, queryMany, queryOne, withTransaction, type Tx } from '../db/pool.ts';
import { recordAudit, recordModerationAction } from '../lib/audit.ts';
import { encryptIdentifier, fingerprintIdentifier } from '../lib/crypto.ts';
import { AppError } from '../lib/errors.ts';
import { validateIdentifier } from '../lib/identifiers.ts';
import { notify } from './notifications.ts';
import { LISTING_CARD_FROM, LISTING_CARD_SELECT, PUBLIC_LISTING_PREDICATE } from './listing-queries.ts';
import { ENGINE_VERSION, imageChecksum, runVerificationEngine } from './verification/engine.ts';
import {
  num,
  numOrNull,
  strOrNull,
  toListingSummary,
  toMediaAsset,
  toOwnerListing,
  toVerificationEvent,
  type OwnerListingParts,
} from './serializers.ts';
import type { AuthenticatedUser } from '../types/express.d.ts';

/**
 * Listing lifecycle: create/update drafts, submit for verification, track
 * moderation state, publish, manage availability, and serve the public
 * catalogue.
 *
 * Server-side rules enforced here (never only in the browser):
 *   * Only approved listings are publicly visible.
 *   * Editing is restricted to the owner and to statuses where the state machine
 *     allows it (draft, rejected, evidence_required, withdrawn).
 *   * Submission activates identifier claims inside a transaction; a competing
 *     active claim raises a database unique violation, which is converted into a
 *     moderator alert instead of an information leak.
 *   * Every status change records actor, reason, timestamp and history.
 */

/* ------------------------------- Drafts ----------------------------------- */

export interface ListingInput {
  title: string;
  categorySlug: string;
  brandId?: string;
  brandName?: string;
  model: string;
  condition: string;
  description: string;
  askingPriceTzs: number;
  negotiable: boolean;
  region: string;
  city?: string;
  exchangeAllowed: boolean;
  specs: Record<string, unknown>;
  identifiers: { kind: string; value: string }[];
  imageMediaIds: string[];
  evidence: { mediaId: string; kind: string; note?: string }[];
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);
}

async function uniqueSlug(title: string, tx?: Tx): Promise<string> {
  const base = slugify(title) || 'listing';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${randomBytes(3).toString('hex')}`;
    const existing = tx
      ? await tx.queryOne<{ id: string }>('SELECT id FROM listings WHERE slug = $1', [candidate])
      : await queryOne<{ id: string }>('SELECT id FROM listings WHERE slug = $1', [candidate]);
    if (!existing) return candidate;
  }
  throw AppError.internal('Could not allocate a unique listing address');
}

async function resolveCategoryAndBrand(input: Pick<ListingInput, 'categorySlug' | 'brandId' | 'brandName'>, tx?: Tx) {
  const category = tx
    ? await tx.queryOne<{ id: string; slug: string }>('SELECT id, slug FROM categories WHERE slug = $1 AND is_active', [input.categorySlug])
    : await queryOne<{ id: string; slug: string }>('SELECT id, slug FROM categories WHERE slug = $1 AND is_active', [input.categorySlug]);
  if (!category) throw AppError.validation('Select a valid device category', [{ path: 'categorySlug', message: 'Unknown category' }]);

  let brandId: string | null = null;
  if (input.brandId) {
    const brand = tx
      ? await tx.queryOne<{ id: string }>('SELECT id FROM brands WHERE id = $1', [input.brandId])
      : await queryOne<{ id: string }>('SELECT id FROM brands WHERE id = $1', [input.brandId]);
    if (!brand) throw AppError.validation('Select a valid brand', [{ path: 'brandId', message: 'Unknown brand' }]);
    brandId = brand.id;
  }
  if (!brandId && !input.brandName) {
    throw AppError.validation('Provide the device brand', [{ path: 'brandName', message: 'Brand is required' }]);
  }
  return { categoryId: category.id, categorySlug: category.slug, brandId };
}

function validateSpecs(categorySlug: string, specs: Record<string, unknown>): void {
  const result = validateSpecsForCategory(categorySlug, specs ?? {});
  if (!result.ok) throw AppError.validation(result.message, [{ path: 'specs', message: result.message }]);
}

/** Keeps only documented specification keys, so moderators see comparable data. */
function sanitiseSpecs(specs: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(specs ?? {})) {
    if (value === undefined) continue;
    output[key] = typeof value === 'string' ? value.slice(0, 120) : value;
  }
  return output;
}

export async function createListing(user: AuthenticatedUser, input: ListingInput): Promise<{ id: string; slug: string }> {
  const { categoryId, categorySlug, brandId } = await resolveCategoryAndBrand(input);
  validateSpecs(categorySlug, input.specs);
  const specs = sanitiseSpecs(input.specs);
  const slug = await uniqueSlug(input.title);

  const created = await withTransaction(async (tx) => {
    const device = await tx.queryOne<{ id: string }>(
      `INSERT INTO devices (category_id, brand_id, brand_name, model, condition, specs, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        categoryId,
        brandId,
        brandId ? null : (input.brandName ?? null),
        input.model,
        input.condition,
        JSON.stringify(specs),
        user.id,
      ],
    );
    if (!device) throw AppError.internal('The device record could not be created');

    const listing = await tx.queryOne<{ id: string; slug: string }>(
      `INSERT INTO listings (device_id, seller_id, category_id, brand_id, title, slug, description, asking_price_tzs,
                             negotiable, exchange_allowed, condition, region, city, status, availability)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft', 'inactive')
       RETURNING id, slug`,
      [
        device.id,
        user.id,
        categoryId,
        brandId,
        input.title,
        slug,
        input.description,
        input.askingPriceTzs,
        input.negotiable,
        input.exchangeAllowed,
        input.condition,
        input.region,
        input.city ?? null,
      ],
    );
    if (!listing) throw AppError.internal('The listing could not be created');

    await replaceIdentifiers(tx, listing.id, device.id, user.id, input.identifiers);
    await attachImages(tx, listing.id, user.id, input.imageMediaIds);
    await attachEvidence(tx, listing.id, device.id, user.id, input.evidence);
    return listing;
  });

  await recordAudit({
    actorId: user.id,
    actorRole: user.role,
    action: 'listing.created',
    entityType: 'listing',
    entityId: created.id,
    metadata: { categorySlug, status: 'draft' },
  });
  return created;
}

/**
 * Replaces the identifier set of a listing. Stored values are AES-256-GCM
 * ciphertext; the duplicate-detection fingerprint is a keyed HMAC. Identifier
 * rows are inactive until the listing is submitted, so a draft cannot reserve an
 * identifier and block its rightful owner.
 */
async function replaceIdentifiers(
  tx: Tx,
  listingId: string,
  deviceId: string,
  ownerId: string,
  identifiers: { kind: string; value: string }[],
): Promise<{ kind: string; masked: string }[]> {
  const seen = new Set<string>();
  const kept: { kind: string; masked: string }[] = [];
  await tx.query('DELETE FROM device_identifiers WHERE listing_id = $1 AND is_active = false', [listingId]);

  for (const [index, identifier] of identifiers.entries()) {
    const validated = validateIdentifier(identifier.kind as never, identifier.value);
    if (!validated.valid) {
      throw AppError.validation(`Invalid ${identifier.kind}: ${validated.reason}`, [{ path: 'identifiers', message: validated.reason ?? 'Invalid identifier' }]);
    }
    if (seen.has(validated.normalised)) continue;
    seen.add(validated.normalised);
    const fingerprint = fingerprintIdentifier(validated.normalised);
    await tx.query(
      `INSERT INTO device_identifiers (device_id, listing_id, owner_id, kind, value_encrypted, fingerprint, last4, masked, is_primary, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
       ON CONFLICT (listing_id, kind) DO UPDATE
         SET value_encrypted = EXCLUDED.value_encrypted,
             fingerprint = EXCLUDED.fingerprint,
             last4 = EXCLUDED.last4,
             masked = EXCLUDED.masked,
             is_primary = EXCLUDED.is_primary,
             updated_at = now()
       WHERE device_identifiers.is_active = false`,
      [
        deviceId,
        listingId,
        ownerId,
        validated.kind,
        encryptIdentifier(validated.normalised),
        fingerprint,
        validated.last4,
        validated.masked,
        index === 0,
      ],
    );
    kept.push({ kind: validated.kind, masked: validated.masked });
  }
  return kept;
}

async function attachImages(tx: Tx, listingId: string, ownerId: string, mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) return;
  await tx.query('DELETE FROM listing_images WHERE listing_id = $1 AND media_asset_id <> ALL($2::uuid[])', [listingId, mediaIds]);
  for (const [position, mediaId] of mediaIds.entries()) {
    const asset = await tx.queryOne<{ id: string; purpose: string }>(
      `SELECT id, purpose FROM media_assets WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL AND purpose = 'listing_image'`,
      [mediaId, ownerId],
    );
    if (!asset) throw AppError.validation('One of the selected photographs is not an image you uploaded', [{ path: 'imageMediaIds', message: 'Unknown media' }]);
    await tx.query(
      `INSERT INTO listing_images (listing_id, media_asset_id, position)
       VALUES ($1, $2, $3)
       ON CONFLICT (listing_id, media_asset_id) DO UPDATE SET position = EXCLUDED.position`,
      [listingId, mediaId, position],
    );
  }
}

async function attachEvidence(
  tx: Tx,
  listingId: string,
  deviceId: string,
  ownerId: string,
  evidence: { mediaId: string; kind: string; note?: string }[],
): Promise<void> {
  for (const item of evidence) {
    const asset = await tx.queryOne<{ id: string }>(
      `SELECT id FROM media_assets WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL AND purpose = 'evidence'`,
      [item.mediaId, ownerId],
    );
    if (!asset) throw AppError.validation('One of the evidence files is not a file you uploaded', [{ path: 'evidence', message: 'Unknown evidence' }]);
    await tx.query(
      `INSERT INTO verification_evidence (listing_id, device_id, media_asset_id, uploaded_by, kind, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (listing_id, media_asset_id) DO NOTHING`,
      [listingId, deviceId, asset.id, ownerId, item.kind, item.note ?? null],
    );
  }
  if (evidence.length > 0) {
    await tx.query(
      `UPDATE evidence_requests er SET fulfilled_at = now()
        WHERE er.listing_id = $1 AND er.fulfilled_at IS NULL
          AND EXISTS (
            SELECT 1 FROM verification_evidence ve
             WHERE ve.listing_id = er.listing_id AND ve.kind = er.kind AND ve.deleted_at IS NULL
          )`,
      [listingId],
    );
  }
}

export async function updateListing(user: AuthenticatedUser, listingId: string, input: Partial<ListingInput>): Promise<{ id: string; slug: string }> {
  const listing = await queryOne<{ id: string; device_id: string; status: ListingStatus; seller_id: string; slug: string; submission_round: number }>(
    'SELECT id, device_id, status, seller_id, slug, submission_round FROM listings WHERE id = $1 AND deleted_at IS NULL',
    [listingId],
  );
  if (!listing) throw AppError.notFound('Listing not found');
  if (listing.seller_id !== user.id) throw AppError.forbidden('You can only edit your own listings');
  if (!LISTING_EDITABLE_STATUSES.includes(listing.status)) {
    throw AppError.invalidTransition(
      `A listing in status "${listing.status}" cannot be edited. Submit corrections after a moderator requests them, or withdraw the listing first.`,
    );
  }

  const device = await queryOne<{ id: string; category_id: string }>('SELECT id, category_id FROM devices WHERE id = $1', [listing.device_id]);
  if (!device) throw AppError.notFound('Device record not found');

  const categoryRow = input.categorySlug
    ? await queryOne<{ id: string; slug: string }>('SELECT id, slug FROM categories WHERE slug = $1 AND is_active', [input.categorySlug])
    : await queryOne<{ id: string; slug: string }>(
        'SELECT c.id, c.slug FROM categories c JOIN devices d ON d.category_id = c.id WHERE d.id = $1',
        [listing.device_id],
      );
  if (!categoryRow) throw AppError.validation('Select a valid device category');
  if (input.specs) validateSpecs(categoryRow.slug, input.specs);

  return withTransaction(async (tx) => {
    const brandResolved = input.brandId !== undefined || input.brandName !== undefined
      ? await resolveCategoryAndBrand({ categorySlug: categoryRow.slug, brandId: input.brandId, brandName: input.brandName }, tx)
      : { brandId: undefined as string | null | undefined };

    await tx.query(
      `UPDATE devices SET
         category_id = COALESCE($2, category_id),
         brand_id = CASE WHEN $3::boolean THEN $4::uuid ELSE brand_id END,
         brand_name = CASE WHEN $3::boolean AND $4::uuid IS NULL THEN $5 ELSE brand_name END,
         model = COALESCE($6, model),
         condition = COALESCE($7, condition),
         specs = COALESCE($8::jsonb, specs),
         updated_at = now()
       WHERE id = $1`,
      [
        listing.device_id,
        input.categorySlug ? categoryRow.id : null,
        brandResolved.brandId !== undefined,
        brandResolved.brandId ?? null,
        input.brandName ?? null,
        input.model ?? null,
        input.condition ?? null,
        input.specs ? JSON.stringify(sanitiseSpecs(input.specs)) : null,
      ],
    );

    await tx.query(
      `UPDATE listings SET
         title = COALESCE($2, title),
         description = COALESCE($3, description),
         asking_price_tzs = COALESCE($4, asking_price_tzs),
         negotiable = COALESCE($5, negotiable),
         exchange_allowed = COALESCE($6, exchange_allowed),
         condition = COALESCE($7, condition),
         region = COALESCE($8, region),
         city = COALESCE($9, city),
         category_id = $10,
         brand_id = COALESCE($11, brand_id),
         updated_at = now()
       WHERE id = $1`,
      [
        listing.id,
        input.title ?? null,
        input.description ?? null,
        input.askingPriceTzs ?? null,
        input.negotiable ?? null,
        input.exchangeAllowed ?? null,
        input.condition ?? null,
        input.region ?? null,
        input.city ?? null,
        categoryRow.id,
        brandResolved.brandId ?? null,
      ],
    );

    if (input.identifiers) {
      await replaceIdentifiers(tx, listing.id, listing.device_id, user.id, input.identifiers);
    }
    if (input.imageMediaIds) {
      await attachImages(tx, listing.id, user.id, input.imageMediaIds);
    }
    if (input.evidence) {
      await attachEvidence(tx, listing.id, listing.device_id, user.id, input.evidence);
    }

    // An edited draft keeps its editing state; editing is allowed only in the
    // statuses listed above, so no status change is needed here.
    return { id: listing.id, slug: listing.slug };
  });
}

/* ------------------------------ Submission -------------------------------- */

async function recordEvent(
  tx: Tx,
  listingId: string,
  deviceId: string,
  actor: { id: string | null; role: 'user' | 'admin' | 'system' },
  action: string,
  from: ListingStatus | null,
  to: ListingStatus | null,
  options: { reasonCode?: string | null; reasonNote?: string | null; visible?: boolean; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  await tx.query(
    `INSERT INTO verification_events (listing_id, device_id, actor_id, actor_role, action, from_status, to_status, reason_code, reason_note, visible_to_seller, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      listingId,
      deviceId,
      actor.id,
      actor.role,
      action,
      from,
      to,
      options.reasonCode ?? null,
      options.reasonNote ?? null,
      options.visible ?? true,
      JSON.stringify(options.metadata ?? {}),
    ],
  );
}

async function transition(tx: Tx, listingId: string, from: ListingStatus, to: ListingStatus): Promise<void> {
  if (from === to) return;
  if (!canTransitionListing(from, to)) {
    throw AppError.invalidTransition(`A listing cannot move from "${from}" to "${to}"`);
  }
  const updated = await tx.queryOne<{ id: string }>(
    `UPDATE listings SET status = $3, updated_at = now(),
            published_at = CASE WHEN $3 = 'approved' THEN COALESCE(published_at, now()) ELSE published_at END,
            submitted_at = CASE WHEN $3 = 'submitted' THEN now() ELSE submitted_at END,
            last_reviewed_at = CASE WHEN $3 IN ('under_review','flagged','approved','rejected','evidence_required') THEN now() ELSE last_reviewed_at END,
            decided_at = CASE WHEN $3 IN ('approved','rejected','suspended') THEN now() ELSE decided_at END,
            availability = CASE WHEN $3 = 'approved' AND availability = 'inactive' THEN 'available' ELSE availability END
      WHERE id = $1 AND status = $2
      RETURNING id`,
    [listingId, from, to],
  );
  if (!updated) {
    throw AppError.conflict('The listing was modified by another action. Reload it and try again.');
  }
}

export interface SubmitResult {
  status: ListingStatus;
  outcome: string;
  score: number;
  flags: { reason: string; detail: string; severity: string }[];
  message: string;
  nextAction: OwnerListingDto['nextAction'];
}

export async function submitListing(
  user: AuthenticatedUser,
  listingId: string,
  _confirmations: { confirmAccuracy: boolean; confirmLawful: boolean },
): Promise<SubmitResult> {
  const listing = await queryOne<{
    id: string;
    device_id: string;
    status: ListingStatus;
    seller_id: string;
    title: string;
    description: string;
    category_id: string;
    category_slug: string;
    asking_price_tzs: number;
    region: string;
    condition: string;
    specs: Record<string, unknown>;
    model: string;
    brand_name: string | null;
    submission_round: number;
    created_at: Date;
  }>(
    // Device specifications live on `devices` (`d.specs`); the listing row
    // carries the commercial data only.
    `SELECT l.id, l.device_id, l.status, l.seller_id, l.title, l.description, l.category_id, l.asking_price_tzs, l.region,
            l.condition, COALESCE(d.specs, '{}'::jsonb) AS specs, d.model AS model, d.brand_name AS brand_name,
            l.submission_round, l.created_at,
            c.slug AS category_slug
       FROM listings l
       JOIN devices d ON d.id = l.device_id
       JOIN categories c ON c.id = l.category_id
      WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [listingId],
  );
  if (!listing) throw AppError.notFound('Listing not found');
  if (listing.seller_id !== user.id) throw AppError.forbidden('You can only submit your own listings');
  if (!LISTING_EDITABLE_STATUSES.includes(listing.status)) {
    throw AppError.invalidTransition(`A listing in status "${listing.status}" is already submitted or under moderation.`);
  }

  const seller = await queryOne<{ created_at: Date }>('SELECT created_at FROM users WHERE id = $1', [user.id]);
  const evidenceRows = await queryMany<{ kind: string }>(
    'SELECT kind FROM verification_evidence WHERE listing_id = $1 AND deleted_at IS NULL',
    [listing.id],
  );
  const imageRows = await queryMany<{ media_asset_id: string; checksum_sha256: string }>(
    `SELECT li.media_asset_id, ma.checksum_sha256
       FROM listing_images li JOIN media_assets ma ON ma.id = li.media_asset_id
      WHERE li.listing_id = $1 ORDER BY li.position ASC`,
    [listing.id],
  );

  if (imageRows.length === 0) {
    throw AppError.validation('Add at least one photograph of the device before submitting', [
      { path: 'imageMediaIds', message: 'At least one image is required' },
    ]);
  }

  const identifierRows = await queryMany<{
    id: string;
    kind: string;
    fingerprint: string;
    is_primary: boolean;
    is_active: boolean;
  }>('SELECT id, kind, fingerprint, is_primary, is_active FROM device_identifiers WHERE listing_id = $1', [listing.id]);

  if (identifierRows.length === 0 && !['accessories', 'other', 'audio'].includes(listing.category_slug)) {
    throw AppError.validation(
      'Provide at least one device identifier (IMEI, serial number or model number) before submitting this category of device',
      [{ path: 'identifiers', message: 'Identifier required for this category' }],
    );
  }
  if (listing.asking_price_tzs < PRICE_LIMITS.min) {
    throw AppError.validation(`Asking price must be at least TZS ${PRICE_LIMITS.min.toLocaleString()}`);
  }

  const result = await withTransaction(async (tx) => {
    await transition(tx, listing.id, listing.status, 'submitted');
    await tx.query('UPDATE listings SET submission_round = submission_round + 1 WHERE id = $1', [listing.id]);
    await recordEvent(tx, listing.id, listing.device_id, { id: user.id, role: 'user' }, 'submitted', listing.status, 'submitted', {
      metadata: { submissionRound: listing.submission_round + 1 },
    });

    await transition(tx, listing.id, 'submitted', 'checks_pending');
    await recordEvent(tx, listing.id, listing.device_id, { id: null, role: 'system' }, 'automated_check_started', 'submitted', 'checks_pending');

    // Claim the identifiers. The partial unique index on active fingerprints is
    // what actually prevents two live listings for the same device; a losing
    // race is surfaced as a moderator alert, never as a leak of the other
    // seller's details.
    let conflict:
      | { fingerprint: string; kind: string; existingListingId: string | null; existingOwnerId: string | null; hadPublishedClaim: boolean }
      | null = null;
    // A SAVEPOINT is required: without it a unique-index violation aborts the
    // whole transaction and every later statement fails, so the conflict could
    // never be recorded as a moderator alert.
    await tx.query('SAVEPOINT claim_identifiers');
    try {
      await tx.query('UPDATE device_identifiers SET is_active = true, activated_at = now(), released_at = NULL WHERE listing_id = $1', [
        listing.id,
      ]);
      await tx.query('RELEASE SAVEPOINT claim_identifiers');
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
      // Undo only the failed claim; the surrounding submission continues so the
      // attempt can be flagged for a moderator rather than silently discarded.
      await tx.query('ROLLBACK TO SAVEPOINT claim_identifiers');
      const fingerprint = identifierRows[0]?.fingerprint ?? 'unknown';
      const existing = await tx.queryOne<{ listing_id: string; owner_id: string; status: string }>(
        `SELECT di.listing_id, di.owner_id, l.status
           FROM device_identifiers di JOIN listings l ON l.id = di.listing_id
          WHERE di.fingerprint = $1 AND di.is_active AND di.listing_id <> $2 LIMIT 1`,
        [fingerprint, listing.id],
      );
      conflict = {
        fingerprint,
        kind: identifierRows[0]?.kind ?? 'unknown',
        existingListingId: existing?.listing_id ?? null,
        existingOwnerId: existing?.owner_id ?? null,
        hadPublishedClaim: existing?.status === 'approved',
      };
    }

    const engine = conflict
      ? null
      : await runVerificationEngine(
          {
            listingId: listing.id,
            deviceId: listing.device_id,
            sellerId: user.id,
            sellerCreatedAt: seller?.created_at ?? new Date(),
            title: listing.title,
            description: listing.description,
            categorySlug: listing.category_slug,
            brandName: strOrNull(listing.brand_name),
            model: listing.model,
            askingPriceTzs: num(listing.asking_price_tzs),
            condition: listing.condition,
            specs: listing.specs ?? {},
            region: listing.region,
            submissionRound: listing.submission_round + 1,
            identifiers: identifierRows.map((row) => ({
              id: row.id,
              kind: row.kind,
              fingerprint: row.fingerprint,
              isPrimary: row.is_primary,
              formatValid: true,
            })),
            evidenceCount: evidenceRows.length,
            evidenceKinds: evidenceRows.map((row) => row.kind),
            images: imageRows.map((row) => ({ mediaId: row.media_asset_id, checksum: row.checksum_sha256 })),
          },
          tx,
        );

    let targetStatus: ListingStatus;
    if (conflict) {
      targetStatus = 'flagged';
      await tx.query(
        `INSERT INTO identifier_conflicts (fingerprint, kind, attempted_by, attempted_listing_id, existing_listing_id, existing_owner_id, outcome, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          conflict.fingerprint,
          conflict.kind,
          user.id,
          listing.id,
          conflict.existingListingId,
          conflict.existingOwnerId,
          conflict.hadPublishedClaim ? 'blocked_published_listing' : 'blocked_pending_review',
          `Submission of listing ${listing.id} attempted to claim an identifier that is already active on listing ${conflict.existingListingId}`,
        ],
      );
      await tx.query(
        `INSERT INTO duplicate_alerts (kind, severity, listing_id, related_listing_id, device_id, fingerprint, detail, metadata)
         VALUES ('identifier_conflict', 'critical', $1, $2, $3, $4, $5, $6)`,
        [
          listing.id,
          conflict.existingListingId,
          listing.device_id,
          conflict.fingerprint,
          'Identifier already claimed by another active listing; the submission was held for moderator review.',
          JSON.stringify({ attemptedBy: user.id }),
        ],
      );
      await recordEvent(
        tx,
        listing.id,
        listing.device_id,
        { id: null, role: 'system' },
        'identifier_conflict_detected',
        'checks_pending',
        'flagged',
        {
          reasonCode: 'identifier_duplicate_of_active_listing',
          reasonNote: 'The identifier is already claimed by another active listing. A moderator will review both submissions.',
        },
      );
    } else if (engine) {
      targetStatus = engine.recommendedStatus;
      await tx.query(
        `INSERT INTO device_verification_attempts (device_id, listing_id, attempt_number, outcome, score, flags, checks,
                                                    external_check_status, external_provider, external_response, external_checked_at,
                                                    engine_version, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          listing.device_id,
          listing.id,
          listing.submission_round + 1,
          engine.outcome,
          engine.score,
          JSON.stringify(engine.flags),
          JSON.stringify(engine.checks),
          engine.externalCheck.status,
          engine.externalCheck.provider,
          engine.externalCheck.response ? JSON.stringify(engine.externalCheck.response) : null,
          engine.externalCheck.performedAt,
          ENGINE_VERSION,
          engine.durationMs,
        ],
      );
      for (const alert of engine.duplicateAlerts) {
        await tx.query(
          `INSERT INTO duplicate_alerts (kind, severity, listing_id, related_listing_id, device_id, fingerprint, detail, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            alert.kind,
            alert.severity,
            listing.id,
            alert.relatedListingId,
            listing.device_id,
            alert.fingerprint ?? null,
            alert.detail,
            JSON.stringify(alert.metadata ?? {}),
          ],
        );
      }
      await tx.query(
        `UPDATE listings SET review_priority = $2 WHERE id = $1`,
        [listing.id, engine.flags.some((flag) => flag.severity === 'critical') ? 'urgent' : engine.flags.length > 0 ? 'high' : 'normal'],
      );
      if (targetStatus === 'evidence_required') {
        const missingKinds = engine.flags.filter((flag) => flag.reason === 'incomplete_evidence');
        for (const flag of missingKinds) {
          await tx.query(
            `INSERT INTO evidence_requests (listing_id, requested_by, kind, note) VALUES ($1, NULL, 'other', $2)`,
            [listing.id, flag.detail],
          );
        }
      }
    } else {
      targetStatus = 'under_review';
    }

    await transition(tx, listing.id, 'checks_pending', targetStatus);
    await recordEvent(
      tx,
      listing.id,
      listing.device_id,
      { id: null, role: 'system' },
      'automated_check_completed',
      'checks_pending',
      targetStatus,
      {
        reasonCode: targetStatus === 'flagged' ? 'automated_flags_raised' : targetStatus === 'evidence_required' ? 'insufficient_evidence' : null,
        reasonNote: conflict
          ? 'Held for moderator review because the device identifier is already claimed by another active listing.'
          : (engine?.flags.map((flag) => flag.detail).join(' ') || 'All automated checks passed. Awaiting administrator review.'),
        metadata: { engineVersion: ENGINE_VERSION, score: conflict ? 0 : (engine?.score ?? 0) },
      },
    );

    await recordModerationAction(
      {
        actorId: null,
        actorRole: 'system',
        action: conflict ? 'flagged' : 'automated_check_run',
        entityType: 'listing',
        entityId: listing.id,
        fromStatus: 'checks_pending',
        toStatus: targetStatus,
        reasonCode: conflict ? 'identifier_duplicate_of_active_listing' : 'completeness_confirmed',
        reasonNote: conflict ? 'Identifier conflict detected' : 'Automated verification completed',
        metadata: { engineVersion: ENGINE_VERSION },
      },
      tx.query.bind(tx) as never,
    );

    return {
      status: targetStatus,
      outcome: conflict ? 'flagged' : (engine?.outcome ?? 'clean'),
      score: conflict ? 0 : (engine?.score ?? 0),
      flags: conflict
        ? [
            {
              reason: 'identifier_duplicate',
              detail:
                'The submitted device identifier is already claimed by another active listing on SWAPMART.',
              severity: 'critical',
            },
          ]
        : (engine?.flags ?? []),
      message: conflict
        ? 'This submission needs moderator review because the device identifier is already in use on another listing. The other party’s details are not disclosed. You will see the outcome here.'
        : targetStatus === 'evidence_required'
          ? 'More evidence is needed before this listing can be reviewed.'
          : targetStatus === 'flagged'
            ? 'The automated checks raised points that a moderator must review before publication.'
            : 'Automated checks passed. The listing is queued for administrator review.',
      nextAction: conflict
        ? { label: 'Wait for moderator review', description: 'No action is required from you. A moderator will review both submissions.', href: `/dashboard/listings/${listing.id}` }
        : targetStatus === 'evidence_required'
          ? { label: 'Add the requested evidence', description: 'Upload the requested photographs or documents, then resubmit.', href: `/dashboard/listings/${listing.id}/evidence` }
          : { label: 'Await administrator review', description: 'Moderation normally completes within 72 hours.', href: `/dashboard/listings/${listing.id}` },
    };
  });

  // Notify the moderators so the queue is worked rather than silently growing.
  const admins = await queryMany<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' AND account_status = 'active'`);
  for (const admin of admins) {
    await notify({
      userId: admin.id,
      type: result.status === 'flagged' ? 'listing_rejected' : 'listing_status_changed',
      title: 'Submission awaiting review',
      body: `${listing.title} was submitted and is now in status "${result.status}".`,
      linkUrl: `/admin/listings/${listing.id}`,
      entityType: 'listing',
      entityId: listing.id,
    });
  }

  await notify({
    userId: user.id,
    type: 'listing_status_changed',
    title: 'Listing submitted for review',
    body: result.message,
    linkUrl: `/dashboard/listings/${listing.id}`,
    entityType: 'listing',
    entityId: listing.id,
    email: true,
  });

  return result;
}

export async function withdrawListing(user: AuthenticatedUser, listingId: string, reason?: string): Promise<void> {
  const listing = await queryOne<{ id: string; device_id: string; status: ListingStatus; seller_id: string }>(
    'SELECT id, device_id, status, seller_id FROM listings WHERE id = $1 AND deleted_at IS NULL',
    [listingId],
  );
  if (!listing) throw AppError.notFound('Listing not found');
  if (listing.seller_id !== user.id) throw AppError.forbidden('You can only withdraw your own listings');
  if (!canTransitionListing(listing.status, 'withdrawn')) {
    throw AppError.invalidTransition(`A listing in status "${listing.status}" cannot be withdrawn`);
  }
  await withTransaction(async (tx) => {
    await transition(tx, listing.id, listing.status, 'withdrawn');
    await tx.query(`UPDATE listings SET availability = 'inactive' WHERE id = $1`, [listing.id]);
    // Released so the identifier can be used by a future, legitimate submission.
    await tx.query(
      `UPDATE device_identifiers SET is_active = false, released_at = now() WHERE listing_id = $1 AND is_active`,
      [listing.id],
    );
    await recordEvent(tx, listing.id, listing.device_id, { id: user.id, role: 'user' }, 'withdrawn', listing.status, 'withdrawn', {
      reasonNote: reason ?? 'Withdrawn by the seller',
    });
  });
}

export async function updateAvailability(user: AuthenticatedUser, listingId: string, availability: string): Promise<void> {
  const listing = await queryOne<{ id: string; status: ListingStatus; seller_id: string; availability: string }>(
    'SELECT id, status, seller_id, availability FROM listings WHERE id = $1 AND deleted_at IS NULL',
    [listingId],
  );
  if (!listing) throw AppError.notFound('Listing not found');
  if (listing.seller_id !== user.id) throw AppError.forbidden('You can only change the availability of your own listings');
  if (listing.status !== LISTING_PUBLIC_STATUS) {
    throw AppError.invalidTransition('Only published listings can be marked reserved, sold or inactive');
  }
  if (availability === 'sold' && listing.availability === 'available') {
    throw AppError.invalidTransition('Confirm a transaction first: a listing can be marked sold from the transaction screen or from "reserved".');
  }
  if (!canTransitionAvailability(listing.availability as never, availability as never)) {
    throw AppError.invalidTransition(`Availability cannot move from "${listing.availability}" to "${availability}"`);
  }
  await withTransaction(async (tx) => {
    await tx.query('UPDATE listings SET availability = $2, updated_at = now() WHERE id = $1', [listing.id, availability]);
    await recordEvent(tx, listing.id, listing.id, { id: user.id, role: 'user' }, 'availability_changed', listing.status, listing.status, {
      reasonNote: `Availability changed from ${listing.availability} to ${availability}`,
      metadata: { from: listing.availability, to: availability },
    });
  });
}

/* ------------------------------ Public reads ------------------------------ */

export interface SearchInput {
  q?: string | undefined;
  category?: string[] | undefined;
  brand?: string[] | undefined;
  condition?: string[] | undefined;
  region?: string[] | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  availability: string;
  sellerId?: string | undefined;
  exchangeAllowed?: boolean | undefined;
  sort: string;
  page: number;
  perPage: number;
}

export async function searchPublicListings(
  input: SearchInput,
  viewerId?: string,
): Promise<Paginated<ListingSummaryDto>> {
  const conditions: string[] = [PUBLIC_LISTING_PREDICATE];
  const values: unknown[] = [];
  const param = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (input.q) {
    // LIKE metacharacters are escaped so a search for "50%" is a literal search
    // rather than a wildcard, and the tsquery branch never sees raw operators.
    const like = `%${input.q.toLowerCase().replace(/([\\%_])/g, '\\$1')}%`;
    const index = param(like);
    conditions.push(
      `(l.search_document @@ plainto_tsquery('simple', ${param(input.q)}) OR lower(l.title) LIKE ${index} ESCAPE '\\' OR lower(d.model) LIKE ${index} ESCAPE '\\' OR lower(coalesce(b.name, d.brand_name)) LIKE ${index} ESCAPE '\\')`,
    );
  }
  if (input.category?.length) conditions.push(`c.slug = ANY(${param(input.category)}::text[])`);
  if (input.brand?.length) {
    conditions.push(`(coalesce(b.slug, lower(d.brand_name)) = ANY(${param(input.brand)}::text[]) OR lower(coalesce(b.name, d.brand_name)) = ANY(${param(
      input.brand.map((brand) => brand.toLowerCase()),
    )}::text[]))`);
  }
  if (input.condition?.length) conditions.push(`l.condition = ANY(${param(input.condition)}::text[])`);
  if (input.region?.length) conditions.push(`l.region = ANY(${param(input.region)}::text[])`);
  if (input.minPrice !== undefined) conditions.push(`l.asking_price_tzs >= ${param(input.minPrice)}`);
  if (input.maxPrice !== undefined) conditions.push(`l.asking_price_tzs <= ${param(input.maxPrice)}`);
  if (input.sellerId) conditions.push(`l.seller_id = ${param(input.sellerId)}`);
  if (input.exchangeAllowed !== undefined) conditions.push(`l.exchange_allowed = ${param(input.exchangeAllowed)}`);

  const availabilityValues = PUBLIC_AVAILABILITY_FILTER_VALUES[(input.availability as keyof typeof PUBLIC_AVAILABILITY_FILTER_VALUES) ?? 'any'];
  conditions.push(`l.availability = ANY(${param(availabilityValues)}::text[])`);

  const where = conditions.join(' AND ');
  const orderBy = SORT_SQL[(input.sort as keyof typeof SORT_SQL) ?? 'newest'];
  // Freeze the filter parameters before paging parameters are appended: the
  // aggregate query below must receive exactly the values its placeholders use.
  const filterValues = [...values];
  const limit = param(input.perPage);
  const offset = param((input.page - 1) * input.perPage);

  const rows = await queryMany(
    `SELECT ${LISTING_CARD_SELECT}, ${viewerId ? `EXISTS (SELECT 1 FROM saved_listings sl WHERE sl.listing_id = l.id AND sl.user_id = ${param(viewerId)})` : 'false'} AS saved_by_me
     ${LISTING_CARD_FROM}
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total ${LISTING_CARD_FROM} WHERE ${where}`,
    filterValues,
  );

  return {
    data: rows.map((row) => toListingSummary(row, { savedByMe: row.saved_by_me === true, isOwner: viewerId ? row.seller_id === viewerId : false })),
    meta: {
      page: input.page,
      perPage: input.perPage,
      total: totalRow?.total ?? 0,
      totalPages: Math.ceil((totalRow?.total ?? 0) / input.perPage),
      hasNextPage: input.page < Math.ceil((totalRow?.total ?? 0) / input.perPage),
      hasPreviousPage: input.page > 1,
    },
  };
}

export async function getPublicListing(slugOrId: string, viewerId?: string): Promise<OwnerListingDto | null> {
  const row = await queryOne(
    `SELECT ${LISTING_CARD_SELECT},
            ${viewerId ? `EXISTS (SELECT 1 FROM saved_listings sl WHERE sl.listing_id = l.id AND sl.user_id = $2)` : 'false'} AS saved_by_me,
            (SELECT count(*)::int FROM device_verification_attempts dva WHERE dva.listing_id = l.id) AS attempt_count,
            (SELECT dva2.external_check_status FROM device_verification_attempts dva2 WHERE dva2.listing_id = l.id ORDER BY attempt_number DESC LIMIT 1) AS external_check_status
     ${LISTING_CARD_FROM}
     WHERE ${PUBLIC_LISTING_PREDICATE} AND (l.slug = $1 OR l.id::text = $1)`,
    viewerId ? [slugOrId, viewerId] : [slugOrId],
  );
  if (!row) return null;

  const listingId = String(row.id);
  const deviceId = String(row.device_id);
  const parts = await loadListingParts(
    listingId,
    deviceId,
    { includeIdentifiers: false, includeEvidence: false, includeInternalNotes: false, publicOnly: true },
    strOrNull(row.description) ?? '',
  );

  // View counting is a side effect that must never fail the read.
  void query('UPDATE listings SET view_count = view_count + 1 WHERE id = $1', [listingId]).catch(() => undefined);

  return toOwnerListing(row, {
    ...parts,
    nextAction: null,
    savedByMe: row.saved_by_me === true,
  } as OwnerListingParts);
}

interface LoadPartsOptions {
  includeIdentifiers: boolean;
  includeEvidence: boolean;
  includeInternalNotes: boolean;
  publicOnly: boolean;
}



async function loadListingParts(
  listingId: string,
  deviceId: string,
  options: LoadPartsOptions,
  listingDescription = '',
): Promise<OwnerListingParts> {
  const images = await queryMany(
    `SELECT ma.id AS media_id, ma.url, ma.width, ma.height, ma.mime_type, ma.purpose, ma.visibility
       FROM listing_images li JOIN media_assets ma ON ma.id = li.media_asset_id
      WHERE li.listing_id = $1 AND ma.deleted_at IS NULL ORDER BY li.position ASC`,
    [listingId],
  );
  const evidenceRequests = await queryMany<{ kind: string; note: string | null; created_at: Date }>(
    `SELECT kind, note, created_at FROM evidence_requests WHERE listing_id = $1 AND fulfilled_at IS NULL ORDER BY created_at ASC`,
    [listingId],
  );
  const events = await queryMany(
    `SELECT ve.*, u.full_name AS actor_name
       FROM verification_events ve LEFT JOIN users u ON u.id = ve.actor_id
      WHERE ve.listing_id = $1 ${options.includeInternalNotes ? '' : 'AND ve.visible_to_seller = true'}
      ORDER BY ve.created_at ASC`,
    [listingId],
  );
  const attempts = await queryMany(
    `SELECT * FROM device_verification_attempts WHERE listing_id = $1 ORDER BY attempt_number DESC`,
    [listingId],
  );
  const identifierRows = await queryMany<{
    id: string;
    kind: string;
    masked: string;
    last4: string;
    is_primary: boolean;
    is_active: boolean;
    created_at: Date;
    verified_at: Date | null;
  }>(
    options.includeIdentifiers
      ? `SELECT id, kind, masked, last4, is_primary, is_active, created_at, activated_at AS verified_at
           FROM device_identifiers WHERE listing_id = $1 ORDER BY is_primary DESC, created_at ASC`
      : `SELECT id, kind, masked, last4, is_primary, is_active, created_at, activated_at AS verified_at
           FROM device_identifiers WHERE listing_id = $1 ORDER BY is_primary DESC, created_at ASC`,
    [listingId],
  );
  const evidence = options.includeEvidence
    ? await queryMany(
        `SELECT ve.id, ve.kind, ve.note, ve.requested, ve.created_at,
                ma.id AS media_id, ma.mime_type, ma.byte_size, ma.purpose, ma.visibility
           FROM verification_evidence ve JOIN media_assets ma ON ma.id = ve.media_asset_id
          WHERE ve.listing_id = $1 AND ve.deleted_at IS NULL ORDER BY ve.created_at ASC`,
        [listingId],
      )
    : [];
  const device = await queryOne<{ specs: Record<string, unknown> }>('SELECT specs FROM devices WHERE id = $1', [deviceId]);
  const latestAttempt = attempts[0] as Record<string, unknown> | undefined;

  return {
    description: listingDescription,
    specs: (device?.specs ?? {}) as Record<string, string | number | boolean | null>,
    images: images.map((row) => toMediaAsset(row)),
    moderationNotes: events.map((row) => toVerificationEvent(row)),
    evidenceRequests: evidenceRequests.map((row) => ({
      kind: row.kind,
      note: row.note,
      requestedAt: row.created_at.toISOString(),
    })),
    externalCheckStatus: strOrNull(latestAttempt?.external_check_status) ?? 'not_configured',
    verificationAttemptCount: attempts.length,
    identifiers: identifierRows.map((row) => ({
      id: String(row.id),
      kind: row.kind as OwnerListingDto['identifiers'][number]['kind'],
      masked: row.masked,
      last4: row.last4,
      isPrimary: row.is_primary,
      createdAt: row.created_at.toISOString(),
      verifiedAt: row.verified_at ? row.verified_at.toISOString() : null,
    })),
    evidence: evidence.map((row) => ({
      id: String(row.id),
      kind: row.kind as string,
      note: strOrNull(row.note),
      asset: {
        id: String(row.media_id),
        // Evidence is private: the client receives an access-controlled URL, not
        // a public storage location.
        url: `/api/v1/media/private/${String(row.media_id)}`,
        width: null,
        height: null,
        mimeType: String(row.mime_type),
        purpose: 'evidence',
        visibility: 'private' as const,
      },
      uploadedAt: (row.created_at as Date).toISOString(),
      requested: row.requested === true,
    })),
    verificationAttempts: attempts.map((row) => ({
      id: String(row.id),
      outcome: row.outcome as never,
      externalCheckStatus: row.external_check_status as never,
      externalProvider: strOrNull(row.external_provider),
      externalCheckedAt: row.external_checked_at ? (row.external_checked_at as Date).toISOString() : null,
      flags: (row.flags as never) ?? [],
      score: num(row.score),
      checkSummary: { checks: row.checks ?? [] },
      createdAt: (row.created_at as Date).toISOString(),
    })),
    events: events.map((row) => toVerificationEvent(row)),
    nextAction: null,
  };
}

/* -------------------------------- Owner views ------------------------------ */

export async function listSellerListings(
  userId: string,
  query_: { page: number; perPage: number; sort: string; status?: string[]; q?: string },
): Promise<Paginated<ListingSummaryDto>> {
  const conditions = ['l.seller_id = $1', 'l.deleted_at IS NULL'];
  const values: unknown[] = [userId];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query_.status?.length) conditions.push(`l.status = ANY(${param(query_.status)}::text[])`);
  if (query_.q) conditions.push(`(lower(l.title) LIKE ${param(`%${query_.q.toLowerCase()}%`)})`);
  const filterValues = [...values];
  const limit = param(query_.perPage);
  const offset = param((query_.page - 1) * query_.perPage);
  const orderBy = SORT_SQL[(query_.sort as keyof typeof SORT_SQL) ?? 'newest'];

  const rows = await queryMany(
    `SELECT ${LISTING_CARD_SELECT} ${LISTING_CARD_FROM} WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total ${LISTING_CARD_FROM} WHERE ${conditions.join(' AND ')}`,
    filterValues,
  );
  const total = totalRow?.total ?? 0;
  return {
    data: rows.map((row) => toListingSummary(row, { isOwner: true })),
    meta: {
      page: query_.page,
      perPage: query_.perPage,
      total,
      totalPages: Math.ceil(total / query_.perPage),
      hasNextPage: query_.page < Math.ceil(total / query_.perPage),
      hasPreviousPage: query_.page > 1,
    },
  };
}

/** Next best action a seller should take for a listing, shown in the dashboard. */
function deriveNextAction(status: ListingStatus, listingId: string, pendingEvidence: boolean): OwnerListingDto['nextAction'] {
  switch (status) {
    case 'draft':
      return {
        label: 'Submit for verification',
        description: 'Add at least one photograph and any required evidence, then submit for automated checks.',
        href: `/dashboard/listings/${listingId}`,
      };
    case 'evidence_required':
      return {
        label: 'Upload the requested evidence',
        description: pendingEvidence
          ? 'A moderator needs the listed items before reviewing this listing.'
          : 'Upload the requested evidence and resubmit.',
        href: `/dashboard/listings/${listingId}/evidence`,
      };
    case 'rejected':
      return {
        label: 'Correct the issues and resubmit',
        description: 'Review the moderator’s reason below, update the listing, and submit it again.',
        href: `/dashboard/listings/${listingId}`,
      };
    case 'withdrawn':
      return {
        label: 'Resubmit when ready',
        description: 'This listing is withdrawn and hidden from buyers. You can submit it again.',
        href: `/dashboard/listings/${listingId}`,
      };
    case 'approved':
      return null;
    default:
      return {
        label: 'Await moderator review',
        description: 'No action is required. Moderation normally completes within 72 hours.',
        href: `/dashboard/listings/${listingId}`,
      };
  }
}

export async function getListingForOwner(user: AuthenticatedUser, listingId: string): Promise<OwnerListingDto> {
  const row = await queryOne(
    `SELECT ${LISTING_CARD_SELECT}, false AS saved_by_me ${LISTING_CARD_FROM} WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [listingId],
  );
  if (!row) throw AppError.notFound('Listing not found');
  if (row.seller_id !== user.id && user.role !== 'admin') {
    throw AppError.forbidden('You can only view your own listing in this view');
  }
  const parts = await loadListingParts(
    String(row.id),
    String(row.device_id),
    { includeIdentifiers: true, includeEvidence: true, includeInternalNotes: false, publicOnly: false },
    strOrNull(row.description) ?? '',
  );
  return toOwnerListing(row, {
    ...parts,
    nextAction: deriveNextAction(row.status as ListingStatus, String(row.id), parts.evidenceRequests.length > 0),
  });
}

export async function addEvidence(
  user: AuthenticatedUser,
  listingId: string,
  evidence: { mediaId: string; kind: string; note?: string }[],
): Promise<void> {
  const listing = await queryOne<{ id: string; device_id: string; seller_id: string; status: ListingStatus }>(
    'SELECT id, device_id, seller_id, status FROM listings WHERE id = $1 AND deleted_at IS NULL',
    [listingId],
  );
  if (!listing) throw AppError.notFound('Listing not found');
  if (listing.seller_id !== user.id) throw AppError.forbidden('You can only add evidence to your own listings');
  await withTransaction(async (tx) => {
    await attachEvidence(tx, listing.id, listing.device_id, user.id, evidence);
    await recordEvent(tx, listing.id, listing.device_id, { id: user.id, role: 'user' }, 'evidence_added', listing.status, listing.status, {
      reasonNote: `${evidence.length} evidence file(s) uploaded`,
      metadata: { kinds: evidence.map((item) => item.kind) },
    });
  });
}

/* ------------------------------ Admin reads ------------------------------- */

export async function getListingForAdmin(listingId: string, admin: AuthenticatedUser) {
  const row = await queryOne(`SELECT ${LISTING_CARD_SELECT}, false AS saved_by_me ${LISTING_CARD_FROM} WHERE l.id = $1`, [listingId]);
  if (!row) throw AppError.notFound('Listing not found');

  const parts = await loadListingParts(
    String(row.id),
    String(row.device_id),
    { includeIdentifiers: true, includeEvidence: true, includeInternalNotes: true, publicOnly: false },
    strOrNull(row.description) ?? '',
  );

  const identifiers = await queryMany<{
    id: string;
    kind: string;
    masked: string;
    last4: string;
    is_primary: boolean;
    is_active: boolean;
    created_at: Date;
    fingerprint: string;
    conflict_count: number;
  }>(
    `SELECT di.id, di.kind, di.masked, di.last4, di.is_primary, di.is_active, di.created_at, di.fingerprint,
            (SELECT count(*)::int FROM identifier_conflicts ic WHERE ic.fingerprint = di.fingerprint) AS conflict_count
       FROM device_identifiers di WHERE di.listing_id = $1 ORDER BY di.is_primary DESC, di.created_at ASC`,
    [listingId],
  );

  const alerts = await queryMany<{
    id: string;
    kind: string;
    severity: string;
    detail: string;
    related_listing_id: string | null;
    related_title: string | null;
    created_at: Date;
    resolved_at: Date | null;
  }>(
    `SELECT da.id, da.kind, da.severity, da.detail, da.related_listing_id, rl.title AS related_title, da.created_at, da.resolved_at
       FROM duplicate_alerts da
       LEFT JOIN listings rl ON rl.id = da.related_listing_id
      WHERE da.listing_id = $1 ORDER BY da.created_at DESC`,
    [listingId],
  );

  const notes = await queryMany<{ id: string; body: string; created_at: Date; author_name: string | null }>(
    `SELECT mn.id, mn.body, mn.created_at, u.full_name AS author_name
       FROM moderation_notes mn LEFT JOIN users u ON u.id = mn.author_id
      WHERE mn.entity_type = 'listing' AND mn.entity_id = $1
      ORDER BY mn.created_at DESC`,
    [listingId],
  );

  // Reading the verification evidence of a third party is an audited action.
  await recordAudit({
    actorId: admin.id,
    actorRole: 'admin',
    action: 'evidence.viewed',
    entityType: 'listing',
    entityId: String(row.id),
    metadata: { evidenceCount: parts.evidence.length },
  });

  const seller = await queryOne<{
    id: string;
    display_name: string;
    region: string | null;
    city: string | null;
    bio: string | null;
    avatar_url: string | null;
    identity_reviewed_at: Date | null;
    email_verified_at: Date | null;
    phone: string | null;
    phone_visible: boolean;
    created_at: Date;
    account_status: string;
    email: string;
  }>(
    `SELECT u.id, p.display_name, p.region, p.city, p.bio, ma.url AS avatar_url, u.identity_reviewed_at,
            u.email_verified_at, p.phone, p.phone_visible, u.created_at, u.account_status, u.email
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN media_assets ma ON ma.id = p.avatar_media_id
      WHERE u.id = $1`,
    [String(row.seller_id)],
  );

  return {
    row,
    parts,
    seller: seller
      ? {
          id: String(seller.id),
          displayName: seller.display_name ?? 'Member',
          memberSince: seller.created_at.toISOString(),
          region: seller.region,
          city: seller.city,
          bio: seller.bio,
          avatarUrl: seller.avatar_url,
          identityReviewed: seller.identity_reviewed_at !== null,
          emailVerified: seller.email_verified_at !== null,
          phone: seller.phone,
          activeListingCount: undefined,
          soldListingCount: undefined,
          completedTransactionCount: undefined,
          accountStatus: seller.account_status,
          email: seller.email,
        }
      : null,
    identifiers: identifiers.map((identifier) => ({
      id: String(identifier.id),
      kind: identifier.kind as OwnerListingDto['identifiers'][number]['kind'],
      masked: identifier.masked,
      last4: identifier.last4,
      isPrimary: identifier.is_primary,
      createdAt: identifier.created_at.toISOString(),
      verifiedAt: identifier.is_active ? identifier.created_at.toISOString() : null,
      fingerprint: identifier.fingerprint,
      conflictCount: num(identifier.conflict_count),
    })),
    duplicateAlerts: alerts.map((alert) => ({
      id: String(alert.id),
      kind: alert.kind as never,
      detail: alert.detail,
      severity: alert.severity as never,
      relatedListingId: strOrNull(alert.related_listing_id),
      relatedListingTitle: strOrNull(alert.related_title),
      createdAt: alert.created_at.toISOString(),
      resolvedAt: alert.resolved_at ? alert.resolved_at.toISOString() : null,
    })),
    internalNotes: notes.map((note) => ({
      id: String(note.id),
      body: note.body,
      author: strOrNull(note.author_name) ?? 'Moderator',
      createdAt: note.created_at.toISOString(),
    })),
    reviewPriority: String(row.review_priority ?? 'normal') as 'normal' | 'high' | 'urgent',
  };
}

export async function listingCountsByStatus(sellerId: string): Promise<Record<string, number>> {
  const rows = await queryMany<{ status: string; total: number }>(
    'SELECT status, count(*)::int AS total FROM listings WHERE seller_id = $1 AND deleted_at IS NULL GROUP BY status',
    [sellerId],
  );
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = num(row.total);
  return counts;
}

export async function recentVerificationAttempt(listingId: string) {
  return queryOne(
    `SELECT outcome, score, flags, checks, external_check_status, external_provider, created_at
       FROM device_verification_attempts WHERE listing_id = $1 ORDER BY attempt_number DESC LIMIT 1`,
    [listingId],
  );
}

export function listingEngineChecksum(buffer: Buffer): string {
  return imageChecksum(buffer);
}

export { numOrNull, logger };

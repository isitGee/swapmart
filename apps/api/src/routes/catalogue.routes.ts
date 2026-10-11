import { Router } from 'express';
import { z } from 'zod';
import {
  availabilityUpdateSchema,
  commentListQuerySchema,
  createCommentSchema,
  createExchangeSchema,
  createListingSchema,
  createReportSchema,
  createTransactionSchema,
  identifierAvailabilityQuerySchema,
  listingSearchQuerySchema,
  paginationQuerySchema,
  savedListingSchema,
  sellerListingQuerySchema,
  submitListingSchema,
  updateListingSchema,
  uuidSchema,
} from '@swapmart/shared';
import { queryMany, queryOne } from '../db/pool.ts';
import { asyncHandler } from '../lib/http.ts';
import { AppError } from '../lib/errors.ts';
import { validateIdentifier } from '../lib/identifiers.ts';
import { optionalAuth, requireAuth, requireCapability } from '../middleware/auth.ts';
import { body, params, query, validate } from '../middleware/validate.ts';
import { sensitiveLimiter } from '../middleware/security.ts';
import { addEvidence, createListing, getPublicListing, submitListing, updateAvailability, updateListing, withdrawListing } from '../services/listing-service.ts';
import { storeUpload } from '../services/media-service.ts';
import { imageUpload, validateUploadedFile } from '../middleware/upload.ts';
import { createComment, listComments, saveListing, unsaveListing, startConversation } from '../services/engagement-service.ts';
import { createExchangeRequest } from '../services/exchange-service.ts';
import { createPurchaseTransaction } from '../services/transaction-service.ts';
import { createReport } from '../services/trust-service.ts';
import { toCategory, toListingSummary, toSellerPublic } from '../services/serializers.ts';
import { LISTING_CARD_FROM, LISTING_CARD_SELECT, PUBLIC_LISTING_PREDICATE } from '../services/listing-queries.ts';
import type { ListingInput, SearchInput } from '../services/listing-service.ts';
import type { AuthenticatedUser } from '../types/express.d.ts';

/**
 * Public marketplace routes: catalogue browsing, listing detail, seller
 * profiles, listing questions, and the authenticated-but-not-moderated actions
 * a signed-in member performs from a listing page (save, message, propose
 * exchange, open a transaction, report, upload).
 */
export const catalogueRouter = Router();

/* ------------------------------ Reference data ----------------------------- */

catalogueRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const rows = await queryMany(
      `SELECT c.slug, c.name, c.description, c.icon,
              (SELECT count(*)::int FROM listings l WHERE l.category_id = c.id AND l.status = 'approved'
                 AND l.availability <> 'inactive' AND l.deleted_at IS NULL) AS listing_count
         FROM categories c WHERE c.is_active ORDER BY c.sort_order ASC`,
    );
    res.json({ data: rows.map((row) => toCategory(row)) });
  }),
);

catalogueRouter.get(
  '/brands',
  asyncHandler(async (_req, res) => {
    const rows = await queryMany(
      `SELECT b.id, b.slug, b.name,
              (SELECT count(*)::int FROM listings l WHERE l.brand_id = b.id AND l.status = 'approved'
                 AND l.availability <> 'inactive' AND l.deleted_at IS NULL) AS listing_count
         FROM brands b WHERE b.is_active ORDER BY b.name ASC`,
    );
    res.json({
      data: rows.map((row) => ({
        id: String(row.id),
        slug: String(row.slug),
        name: String(row.name),
        listingCount: Number(row.listing_count ?? 0),
      })),
    });
  }),
);

catalogueRouter.get(
  '/marketplace/highlights',
  asyncHandler(async (_req, res) => {
    const featured = await queryMany(
      `SELECT ${LISTING_CARD_SELECT} ${LISTING_CARD_FROM}
        WHERE ${PUBLIC_LISTING_PREDICATE} AND l.availability = 'available'
        ORDER BY l.published_at DESC NULLS LAST
        LIMIT 8`,
    );
    const recent = await queryMany(
      `SELECT ${LISTING_CARD_SELECT} ${LISTING_CARD_FROM}
        WHERE ${PUBLIC_LISTING_PREDICATE}
        ORDER BY l.published_at DESC NULLS LAST
        LIMIT 8`,
    );
    const stats = await queryOne<{ listings: number; sellers: number; categories: number; verified_sellers: number }>(
      `SELECT
         (SELECT count(*)::int FROM listings WHERE status = 'approved' AND availability <> 'inactive' AND deleted_at IS NULL) AS listings,
         (SELECT count(DISTINCT seller_id)::int FROM listings WHERE status = 'approved' AND deleted_at IS NULL) AS sellers,
         (SELECT count(*)::int FROM categories WHERE is_active) AS categories,
         (SELECT count(*)::int FROM users WHERE identity_reviewed_at IS NOT NULL) AS verified_sellers`,
    );
    res.json({
      data: {
        featured: featured.map((row) => toListingSummary(row)),
        recent: recent.map((row) => toListingSummary(row)),
        stats: {
          publishedListings: stats?.listings ?? 0,
          activeSellers: stats?.sellers ?? 0,
          categories: stats?.categories ?? 0,
          identityReviewedSellers: stats?.verified_sellers ?? 0,
        },
      },
    });
  }),
);

/* --------------------------------- Search ---------------------------------- */

catalogueRouter.get(
  '/listings',
  optionalAuth,
  validate({ query: listingSearchQuerySchema }),
  asyncHandler(async (req, res) => {
    const input = query<SearchInput>(req);
    const { searchPublicListings } = await import('../services/listing-service.ts');
    const result = await searchPublicListings(input, req.auth?.user.id);
    res.json(result);
  }),
);

catalogueRouter.get(
  '/listings/:slugOrId',
  optionalAuth,
  validate({ params: z.object({ slugOrId: z.string().min(4).max(140) }) }),
  asyncHandler(async (req, res) => {
    const { slugOrId } = params<{ slugOrId: string }>(req);
    const listing = await getPublicListing(slugOrId, req.auth?.user.id);
    if (!listing) {
      throw AppError.notFound('This listing is not available. It may still be under review, or it may have been removed.');
    }
    res.json({ data: listing });
  }),
);

catalogueRouter.get(
  '/listings/:slugOrId/related',
  validate({ params: z.object({ slugOrId: z.string().min(4).max(140) }), query: paginationQuerySchema }),
  asyncHandler(async (req, res) => {
    const { slugOrId } = params<{ slugOrId: string }>(req);
    const listing = await queryOne<{ id: string; category_id: string; asking_price_tzs: number }>(
      'SELECT id, category_id, asking_price_tzs FROM listings WHERE (slug = $1 OR id::text = $1) AND status = $2',
      [slugOrId, 'approved'],
    );
    if (!listing) throw AppError.notFound('Listing not found');
    const rows = await queryMany(
      `SELECT ${LISTING_CARD_SELECT} ${LISTING_CARD_FROM}
        WHERE ${PUBLIC_LISTING_PREDICATE} AND l.category_id = $1 AND l.id <> $2
        ORDER BY abs(l.asking_price_tzs - $3) ASC, l.published_at DESC NULLS LAST
        LIMIT 6`,
      [listing.category_id, listing.id, listing.asking_price_tzs],
    );
    res.json({ data: rows.map((row) => toListingSummary(row)) });
  }),
);

/* ------------------------------- Seller profile ---------------------------- */

catalogueRouter.get(
  '/sellers/:id',
  optionalAuth,
  validate({ params: z.object({ id: uuidSchema }), query: paginationQuerySchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const seller = await queryOne(
      `SELECT u.id, u.created_at, u.identity_reviewed_at, u.email_verified_at, p.display_name, p.region, p.city, p.bio,
              p.phone, p.phone_visible, p.public_profile, ma.url AS avatar_url,
              (SELECT count(*)::int FROM listings l WHERE l.seller_id = u.id AND l.status = 'approved' AND l.availability <> 'inactive' AND l.deleted_at IS NULL) AS active_listing_count,
              (SELECT count(*)::int FROM listings l WHERE l.seller_id = u.id AND l.availability = 'sold') AS sold_listing_count,
              (SELECT count(*)::int FROM transactions t WHERE (t.seller_id = u.id OR t.buyer_id = u.id) AND t.status = 'completed') AS completed_transaction_count
         FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
         LEFT JOIN media_assets ma ON ma.id = p.avatar_media_id
        WHERE u.id = $1 AND u.account_status <> 'suspended' AND u.account_status <> 'deactivated'`,
      [id],
    );
    if (!seller) throw AppError.notFound('Seller profile not found');
    if (seller.public_profile === false) throw AppError.notFound('This member has hidden their public profile');

    const listings = await queryMany(
      `SELECT ${LISTING_CARD_SELECT} ${LISTING_CARD_FROM}
        WHERE l.seller_id = $1 AND ${PUBLIC_LISTING_PREDICATE}
        ORDER BY l.published_at DESC NULLS LAST LIMIT 24`,
      [id],
    );

    res.json({
      data: {
        seller: toSellerPublic(seller),
        listings: listings.map((row) => toListingSummary(row)),
      },
    });
  }),
);

/* --------------------------- Listing questions ----------------------------- */

catalogueRouter.get(
  '/listings/:id/comments',
  optionalAuth,
  validate({ params: z.object({ id: uuidSchema }), query: commentListQuerySchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const comments = await listComments(id, req.auth?.user.id);
    res.json({ data: comments });
  }),
);

catalogueRouter.post(
  '/listings/:id/comments',
  requireAuth,
  requireCapability('message'),
  sensitiveLimiter,
  validate({ params: z.object({ id: uuidSchema }), body: createCommentSchema.omit({ listingId: true }) }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const input = body<{ body: string; parentId?: string | null }>(req);
    const comment = await createComment(user, { listingId: id, body: input.body, parentId: input.parentId ?? null });
    res.status(201).json({ data: comment });
  }),
);

/* ------------------------ Authenticated listing actions -------------------- */

catalogueRouter.post(
  '/listings/:id/save',
  requireAuth,
  validate({ params: z.object({ id: uuidSchema }), body: savedListingSchema.optional() }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    await saveListing(user.id, id);
    res.status(201).json({ data: { saved: true } });
  }),
);

catalogueRouter.delete(
  '/listings/:id/save',
  requireAuth,
  validate({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    await unsaveListing(user.id, id);
    res.json({ data: { saved: false } });
  }),
);

catalogueRouter.post(
  '/listings/:id/inquiries',
  requireAuth,
  requireCapability('message'),
  sensitiveLimiter,
  validate({ params: z.object({ id: uuidSchema }), body: z.object({ message: z.string().trim().min(1).max(4000).optional() }) }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const input = body<{ message?: string }>(req);
    const result = await startConversation(user, { listingId: id, message: input.message });
    res.status(201).json({ data: result });
  }),
);

catalogueRouter.post(
  '/exchanges',
  requireAuth,
  requireCapability('exchange'),
  sensitiveLimiter,
  validate({ body: createExchangeSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const input = body<{
      listingId: string;
      offeredListingId: string;
      message: string;
      priceDifferenceTzs: number;
      expiresAt?: Date;
    }>(req);
    const exchange = await createExchangeRequest(user, input);
    res.status(201).json({ data: exchange });
  }),
);

catalogueRouter.post(
  '/transactions',
  requireAuth,
  requireCapability('transact'),
  sensitiveLimiter,
  validate({ body: createTransactionSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const input = body<{ listingId: string; agreedAmountTzs?: number; note?: string }>(req);
    const transaction = await createPurchaseTransaction(user, input);
    res.status(201).json({ data: transaction });
  }),
);

catalogueRouter.post(
  '/reports',
  requireAuth,
  requireCapability('report'),
  sensitiveLimiter,
  validate({ body: createReportSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const report = await createReport(user, body<Parameters<typeof createReport>[1]>(req));
    res.status(201).json({ data: report });
  }),
);

/* ------------------------------ Seller listing CRUD ------------------------ */

catalogueRouter.post(
  '/me/listings',
  requireAuth,
  requireCapability('createListing'),
  sensitiveLimiter,
  validate({ body: createListingSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const created = await createListing(user, body<ListingInput>(req));
    res.status(201).json({ data: created });
  }),
);

catalogueRouter.patch(
  '/me/listings/:id',
  requireAuth,
  requireCapability('createListing'),
  validate({ params: z.object({ id: uuidSchema }), body: updateListingSchema.omit({ id: true }) }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const updated = await updateListing(user, id, body<Partial<ListingInput>>(req));
    res.json({ data: updated });
  }),
);

catalogueRouter.post(
  '/me/listings/:id/submit',
  requireAuth,
  requireCapability('createListing'),
  sensitiveLimiter,
  validate({ params: z.object({ id: uuidSchema }), body: submitListingSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const result = await submitListing(user, id, body<{ confirmAccuracy: boolean; confirmLawful: boolean }>(req));
    res.json({ data: result });
  }),
);

catalogueRouter.post(
  '/me/listings/:id/withdraw',
  requireAuth,
  validate({ params: z.object({ id: uuidSchema }), body: z.object({ reason: z.string().max(300).optional() }).optional() }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    await withdrawListing(user, id, body<{ reason?: string }>(req)?.reason);
    res.json({ data: { withdrawn: true } });
  }),
);

catalogueRouter.patch(
  '/me/listings/:id/availability',
  requireAuth,
  validate({ params: z.object({ id: uuidSchema }), body: availabilityUpdateSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const input = body<{ availability: string }>(req);
    await updateAvailability(user, id, input.availability);
    res.json({ data: { availability: input.availability } });
  }),
);

catalogueRouter.post(
  '/me/listings/:id/evidence',
  requireAuth,
  requireCapability('createListing'),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({
      evidence: z
        .array(
          z.object({
            mediaId: uuidSchema,
            kind: z.string().min(2).max(40),
            note: z.string().trim().max(300).optional(),
          }),
        )
        .min(1)
        .max(5),
    }),
  }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const input = body<{ evidence: { mediaId: string; kind: string; note?: string }[] }>(req);
    await addEvidence(user, id, input.evidence);
    res.status(201).json({ data: { added: input.evidence.length } });
  }),
);

/* --------------------------------- Uploads --------------------------------- */

catalogueRouter.post(
  '/uploads/listing-images',
  requireAuth,
  requireCapability('createListing'),
  sensitiveLimiter,
  imageUpload.array('files', 8),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw AppError.validation('Select at least one photograph to upload');
    const results = [];
    for (const file of files) {
      const validated = validateUploadedFile(
        { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname, size: file.size },
        { kind: 'image' },
      );
      const stored = await storeUpload({
        ownerId: user.id,
        purpose: 'listing_image',
        buffer: validated.buffer,
        mimeType: validated.mimeType,
        extension: validated.extension,
      });
      results.push(stored.asset);
    }
    res.status(201).json({ data: results });
  }),
);

catalogueRouter.post(
  '/uploads/evidence',
  requireAuth,
  requireCapability('createListing'),
  sensitiveLimiter,
  imageUpload.array('files', 5),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw AppError.validation('Select at least one file to upload');
    const results = [];
    for (const file of files) {
      const validated = validateUploadedFile(
        { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname, size: file.size },
        { kind: 'evidence' },
      );
      const stored = await storeUpload({
        ownerId: user.id,
        purpose: 'evidence',
        buffer: validated.buffer,
        mimeType: validated.mimeType,
        extension: validated.extension,
      });
      results.push({ id: stored.asset.id, mimeType: stored.asset.mimeType, visibility: 'private', url: stored.asset.url });
    }
    res.status(201).json({
      data: results,
      meta: {
        notice:
          'Evidence files are stored privately. They are visible to you and to SWAPMART moderators only, and are never shown on the public listing.',
      },
    });
  }),
);

catalogueRouter.post(
  '/uploads/avatar',
  requireAuth,
  sensitiveLimiter,
  imageUpload.single('file'),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const file = req.file as Express.Multer.File | undefined;
    if (!file) throw AppError.validation('Select a photograph to upload');
    const validated = validateUploadedFile(
      { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname, size: file.size },
      { kind: 'image' },
    );
    const stored = await storeUpload({
      ownerId: user.id,
      purpose: 'avatar',
      buffer: validated.buffer,
      mimeType: validated.mimeType,
      extension: validated.extension,
    });
    res.status(201).json({ data: stored.asset });
  }),
);

/**
 * Identifier availability pre-check.
 *
 * Returns whether an identifier can still be claimed, in a form that never
 * discloses another member's data: no titles, no owners, no timestamps.
 */
catalogueRouter.post(
  '/identifiers/check',
  requireAuth,
  requireCapability('createListing'),
  sensitiveLimiter,
  validate({ body: identifierAvailabilityQuerySchema }),
  asyncHandler(async (req, res) => {
    const input = body<{ kind: string; value: string }>(req);
    const validated = validateIdentifier(input.kind as never, input.value);
    if (!validated.valid) {
      res.json({
        data: {
          valid: false,
          available: false,
          reason: validated.reason,
          formatHint: validated.masked,
          message: validated.reason,
        },
      });
      return;
    }
    const { fingerprintIdentifier } = await import('../lib/crypto.ts');
    const fingerprint = fingerprintIdentifier(validated.normalised);
    const conflict = await queryOne<{ is_active: boolean; status: string }>(
      `SELECT di.is_active, l.status FROM device_identifiers di JOIN listings l ON l.id = di.listing_id
        WHERE di.fingerprint = $1 AND l.deleted_at IS NULL ORDER BY di.is_active DESC LIMIT 1`,
      [fingerprint],
    );
    let available = true;
    let message = 'This identifier is not currently claimed by another active listing.';
    let reason: string | null = null;
    if (conflict?.is_active) {
      available = false;
      reason = conflict.status === 'approved' ? 'identifier_in_use' : 'identifier_under_review';
      message =
        conflict.status === 'approved'
          ? 'This identifier is already used by a published listing. If you believe this is your device, submit the listing anyway: a moderator will review both submissions and contact you.'
          : 'This identifier is already claimed by another submission that is under review. You may continue: a moderator will compare the submissions and decide.';
    }
    res.json({
      data: {
        valid: true,
        available,
        reason,
        masked: validated.masked,
        plausibilityWarning: validated.plausibilityReason ?? null,
        message,
        notice:
          'SWAPMART does not disclose details of other members’ submissions. Checks here are limited to whether an identifier is already claimed.',
      },
    });
  }),
);

export { listingSearchQuerySchema, sellerListingQuerySchema };

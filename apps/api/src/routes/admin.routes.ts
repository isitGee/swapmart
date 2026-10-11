import { Router } from 'express';
import { z } from 'zod';
import {
  accountRestrictionSchema,
  adminListingQueueQuerySchema,
  adminNoteSchema,
  adminStatsQuerySchema,
  adminTransactionQuerySchema,
  adminUserQuerySchema,
  auditLogQuerySchema,
  disputeListQuerySchema,
  listingDecisionSchema,
  moderationHistoryQuerySchema,
  paginationQuerySchema,
  reportListQuerySchema,
  reportResolveSchema,
  uuidSchema,
} from '@swapmart/shared';
import { asyncHandler } from '../lib/http.ts';
import { AppError } from '../lib/errors.ts';
import { query as sqlQuery, queryOne as sqlQueryOne } from '../db/pool.ts';
import { requireAdmin } from '../middleware/auth.ts';
import { body, params, query, validate } from '../middleware/validate.ts';
import { sensitiveLimiter } from '../middleware/security.ts';
import {
  addModerationNote,
  adminTransactions,
  changeAccountStatus,
  decideListing,
  listAuditLogs,
  listDuplicateAlerts,
  listModerationQueue,
  listUsers,
  moderationHistory,
  overviewStatistics,
  resolveDuplicateAlert,
} from '../services/admin-service.ts';
import { getListingForAdmin } from '../services/listing-service.ts';
import { adminListingDtoFromDetail } from '../services/admin-mappers.ts';
import { hideComment } from '../services/engagement-service.ts';
import { getReport, listReports, resolveReport } from '../services/trust-service.ts';
import { toSellerPublic } from '../services/serializers.ts';

/**
 * Administrator API.
 *
 * The whole router is behind `requireAdmin`, which checks the database row for
 * the session — never a client-supplied value (role material added to a request
 * body or JWT claim would be ignored, because nothing here reads a role from
 * input). Every consequential action is audited.
 */
export const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.use(sensitiveLimiter);

adminRouter.get(
  '/overview',
  validate({ query: adminStatsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { range } = query<{ range: '7d' | '30d' | '90d' | 'all' }>(req);
    res.json({ data: await overviewStatistics(range) });
  }),
);

adminRouter.get(
  '/listings',
  validate({ query: adminListingQueueQuerySchema }),
  asyncHandler(async (req, res) => {
    const options = query<{
      page: number;
      perPage: number;
      status?: string;
      q?: string;
      flaggedOnly?: boolean;
      categorySlug?: string;
      sellerId?: string;
      sort: 'oldest' | 'newest' | 'priority';
    }>(req);
    res.json(await listModerationQueue(options));
  }),
);

/** Every listing, filterable by any status — the moderation console "all listings" tab. */
adminRouter.get(
  '/listings/all',
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(60).default(20),
      status: z.string().optional(),
      q: z.string().trim().max(120).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const options = query<{ page: number; perPage: number; status?: string; q?: string }>(req);
    res.json(await listModerationQueue({ ...options, sort: 'newest' }));
  }),
);

adminRouter.get(
  '/listings/:id',
  validate({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const user = req.auth!.user;
    const { id } = params<{ id: string }>(req);
    const detail = await getListingForAdmin(id, user);
    res.json({ data: adminListingDtoFromDetail(detail) });
  }),
);

adminRouter.post(
  '/listings/:id/decision',
  validate({ params: z.object({ id: uuidSchema }), body: listingDecisionSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth!.user;
    const { id } = params<{ id: string }>(req);
    const input = body<{
      decision: 'approve' | 'reject' | 'request_evidence' | 'suspend' | 'reinstate' | 'claim';
      reasonCode: string;
      reasonNote: string;
      requiredEvidence?: { kind: string; note?: string }[];
      releaseIdentifier: boolean;
    }>(req);
    const result = await decideListing(user, id, input);
    res.json({
      data: {
        status: result.status,
        notice:
          input.decision === 'approve'
            ? 'Listing approved and published. Approval confirms the automated checks and your review; it is not a statement of legal ownership or stolen-device status.'
            : 'Decision recorded with its reason and attributed to your account.',
      },
    });
  }),
);

adminRouter.get(
  '/duplicate-alerts',
  validate({
    query: paginationQuerySchema.extend({
      includeResolved: z
        .enum(['true', 'false'])
        .transform((value) => value === 'true')
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const options = query<{ page: number; perPage: number; includeResolved?: boolean }>(req);
    res.json(await listDuplicateAlerts(options));
  }),
);

adminRouter.post(
  '/duplicate-alerts/:id/resolve',
  validate({ params: z.object({ id: uuidSchema }), body: z.object({ note: z.string().trim().min(5).max(500) }) }),
  asyncHandler(async (req, res) => {
    const user = req.auth!.user;
    const { id } = params<{ id: string }>(req);
    const { note } = body<{ note: string }>(req);
    await resolveDuplicateAlert(user, id, note);
    res.json({ data: { resolved: true } });
  }),
);

adminRouter.get(
  '/users',
  validate({ query: adminUserQuerySchema }),
  asyncHandler(async (req, res) => {
    const options = query<{ page: number; perPage: number; q?: string; status?: string; role?: string; sort: 'newest' | 'oldest' | 'reports' }>(req);
    res.json(await listUsers(options));
  }),
);

adminRouter.get(
  '/users/:id',
  validate({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const user = await sqlQueryOne(
      `SELECT u.id, u.email, u.full_name, u.role, u.account_status, u.email_verified_at, u.created_at, u.last_login_at,
              u.identity_reviewed_at, u.status_reason, u.restricted_until, p.display_name, p.region, p.city, p.bio,
              p.phone, p.phone_visible, p.public_profile, ma.url AS avatar_url,
              (SELECT count(*)::int FROM listings l WHERE l.seller_id = u.id AND l.deleted_at IS NULL) AS listing_count,
              (SELECT count(*)::int FROM reports r WHERE r.reported_user_id = u.id) AS report_count,
              (SELECT count(*)::int FROM disputes d WHERE d.opened_by = u.id OR d.counterparty_id = u.id) AS dispute_count,
              (SELECT count(*)::int FROM transactions t WHERE t.buyer_id = u.id OR t.seller_id = u.id) AS transaction_count
         FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
         LEFT JOIN media_assets ma ON ma.id = p.avatar_media_id
        WHERE u.id = $1`,
      [id],
    );
    if (!user) throw AppError.notFound('Account not found');

    const listings = await sqlQuery(
      `SELECT l.id, l.slug, l.title, l.status, l.availability, l.created_at, l.asking_price_tzs
         FROM listings l WHERE l.seller_id = $1 AND l.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 25`,
      [id],
    );
    const reportsAgainst = await sqlQuery(
      `SELECT r.id, r.reference, r.category, r.status, r.priority, r.created_at FROM reports r
        WHERE r.reported_user_id = $1 ORDER BY r.created_at DESC LIMIT 25`,
      [id],
    );
    const moderation = await sqlQuery(
      `SELECT m.id, m.action, m.entity_type, m.entity_id, m.reason_note, m.created_at, au.full_name AS actor_name
         FROM moderation_actions m LEFT JOIN users au ON au.id = m.actor_id
        WHERE (m.entity_type = 'user' AND m.entity_id = $1) OR (m.entity_type = 'listing' AND m.entity_id IN (SELECT id FROM listings WHERE seller_id = $1))
        ORDER BY m.created_at DESC LIMIT 25`,
      [id],
    );

    res.json({
      data: {
        user: {
          id: String(user.id),
          email: String(user.email),
          fullName: String(user.full_name),
          displayName: String(user.display_name ?? user.full_name),
          role: String(user.role),
          accountStatus: String(user.account_status),
          emailVerified: user.email_verified_at !== null,
          createdAt: (user.created_at as Date).toISOString(),
          lastLoginAt: user.last_login_at ? (user.last_login_at as Date).toISOString() : null,
          identityReviewedAt: user.identity_reviewed_at ? (user.identity_reviewed_at as Date).toISOString() : null,
          restrictionReason: user.status_reason ? String(user.status_reason) : null,
          restrictedUntil: user.restricted_until ? (user.restricted_until as Date).toISOString() : null,
          profile: {
            region: user.region ? String(user.region) : null,
            city: user.city ? String(user.city) : null,
            bio: user.bio ? String(user.bio) : null,
            phone: user.phone ? String(user.phone) : null,
            phoneVisible: user.phone_visible === true,
            publicProfile: user.public_profile !== false,
            avatarUrl: user.avatar_url ? String(user.avatar_url) : null,
          },
          counts: {
            listings: Number(user.listing_count ?? 0),
            reports: Number(user.report_count ?? 0),
            disputes: Number(user.dispute_count ?? 0),
            transactions: Number(user.transaction_count ?? 0),
          },
        },
        listings: listings.rows.map((row) => ({
          id: String(row.id),
          slug: String(row.slug),
          title: String(row.title),
          status: String(row.status),
          availability: String(row.availability),
          askingPriceTzs: Number(row.asking_price_tzs),
          createdAt: (row.created_at as Date).toISOString(),
        })),
        reports: reportsAgainst.rows.map((row) => ({
          id: String(row.id),
          reference: String(row.reference),
          category: String(row.category),
          status: String(row.status),
          priority: String(row.priority),
          createdAt: (row.created_at as Date).toISOString(),
        })),
        moderation: moderation.rows.map((row) => ({
          id: String(row.id),
          action: String(row.action),
          entityType: String(row.entity_type),
          entityId: String(row.entity_id),
          reasonNote: row.reason_note ? String(row.reason_note) : null,
          actorName: row.actor_name ? String(row.actor_name) : 'System',
          createdAt: (row.created_at as Date).toISOString(),
        })),
      },
    });
  }),
);

adminRouter.post(
  '/users/:id/status',
  validate({ params: z.object({ id: uuidSchema }), body: accountRestrictionSchema }),
  asyncHandler(async (req, res) => {
    const admin = req.auth!.user;
    const { id } = params<{ id: string }>(req);
    const input = body<{
      action: 'restrict' | 'unrestrict' | 'suspend' | 'reactivate' | 'verify_identity' | 'revoke_identity';
      reason: string;
      restrictedUntil?: Date;
      notifyUser: boolean;
    }>(req);
    await changeAccountStatus(admin, id, input);
    res.json({ data: { updated: true, action: input.action } });
  }),
);

adminRouter.get(
  '/reports',
  validate({ query: reportListQuerySchema }),
  asyncHandler(async (req, res) => {
    const admin = req.auth!.user;
    const options = query<{ page: number; perPage: number; status?: string; category?: string; priority?: string; q?: string }>(req);
    res.json(await listReports(admin, options));
  }),
);

adminRouter.get(
  '/reports/:id',
  validate({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const admin = req.auth!.user;
    const { id } = params<{ id: string }>(req);
    res.json({ data: await getReport(admin, id) });
  }),
);

adminRouter.post(
  '/reports/:id/resolve',
  validate({ params: z.object({ id: uuidSchema }), body: reportResolveSchema }),
  asyncHandler(async (req, res) => {
    const admin = req.auth!.user;
    const { id } = params<{ id: string }>(req);
    const input = body<{ status: string; priority?: string; resolution: string; listingAction: 'none' | 'suspend' | 'reinstate' | 'none_request_evidence' }>(req);
    res.json({ data: await resolveReport(admin, id, input) });
  }),
);

adminRouter.get(
  '/disputes',
  validate({ query: disputeListQuerySchema }),
  asyncHandler(async (req, res) => {
    const admin = req.auth!.user;
    const options = query<{ page: number; perPage: number; status?: string; category?: string; q?: string }>(req);
    const { listDisputes } = await import('../services/trust-service.ts');
    res.json(await listDisputes(admin, options));
  }),
);

adminRouter.get(
  '/transactions',
  validate({ query: adminTransactionQuerySchema }),
  asyncHandler(async (req, res) => {
    const options = query<{ page: number; perPage: number; status?: string; q?: string }>(req);
    res.json(await adminTransactions(options));
  }),
);

adminRouter.post(
  '/notes',
  validate({ body: adminNoteSchema }),
  asyncHandler(async (req, res) => {
    const admin = req.auth!.user;
    const input = body<{ entityType: string; entityId: string; body: string; visibility: 'moderator_note' | 'user_visible' }>(req);
    await addModerationNote(admin, input);
    res.status(201).json({ data: { added: true } });
  }),
);

adminRouter.post(
  '/comments/:id/hide',
  validate({ params: z.object({ id: uuidSchema }), body: z.object({ reason: z.string().trim().min(5).max(500) }) }),
  asyncHandler(async (req, res) => {
    const admin = req.auth!.user;
    const { id } = params<{ id: string }>(req);
    const { reason } = body<{ reason: string }>(req);
    await hideComment(admin, id, reason);
    res.json({ data: { hidden: true } });
  }),
);

adminRouter.get(
  '/audit-logs',
  validate({ query: auditLogQuerySchema }),
  asyncHandler(async (req, res) => {
    const options = query<{
      page: number;
      perPage: number;
      action?: string;
      actorId?: string;
      entityType?: string;
      entityId?: string;
      from?: Date;
      to?: Date;
    }>(req);
    res.json(await listAuditLogs(options));
  }),
);

adminRouter.get(
  '/moderation-history',
  validate({ query: moderationHistoryQuerySchema }),
  asyncHandler(async (req, res) => {
    const options = query<{ page: number; perPage: number; entityType?: string; entityId?: string; actorId?: string }>(req);
    res.json(await moderationHistory(options));
  }),
);

adminRouter.get(
  '/system-status',
  asyncHandler(async (_req, res) => {
    const { emailConfigurationStatus } = await import('../services/email.ts');
    const { mediaConfigurationStatus } = await import('../services/media/storage.ts');
    const { externalProviderStatus } = await import('../services/verification/providers.ts');
    const { loadConfig, APP_VERSION } = await import('../config/env.ts');
    const config = loadConfig();
    const counters = await sqlQueryOne<{ listings: number; media: number }>(
      `SELECT (SELECT count(*)::int FROM listings) AS listings, (SELECT count(*)::int FROM media_assets) AS media`,
    );
    res.json({
      data: {
        environment: config.env,
        version: APP_VERSION,
        email: emailConfigurationStatus(),
        media: mediaConfigurationStatus(),
        stolenCheck: externalProviderStatus(),
        security: {
          sessionTtlDays: config.security.sessionTtlDays,
          usingDevelopmentSecrets: config.security.usingDevelopmentSecrets,
          rateLimits: config.security.rateLimit,
          identifierPolicy: 'Identifiers are stored with AES-256-GCM; duplicate detection uses HMAC-SHA256 fingerprints.',
        },
        counts: { listings: counters?.listings ?? 0, mediaAssets: counters?.media ?? 0 },
      },
    });
  }),
);

export { toSellerPublic };

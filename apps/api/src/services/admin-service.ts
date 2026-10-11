import type {
  AdminOverviewStatsDto,
  AdminUserDto,
  AuditLogDto,
  DashboardSummaryDto,
  ListingStatus,
  Paginated,
  TransactionDto,
} from '@swapmart/shared';
import { DISPUTE_STATUSES, LISTING_STATUSES, REPORT_STATUSES, TRANSACTION_STATUSES, canTransitionListing } from '@swapmart/shared';
import { logger } from '../config/logger.ts';
import { query, queryMany, queryOne, withTransaction } from '../db/pool.ts';
import { recordAudit, recordModerationAction } from '../lib/audit.ts';
import { AppError } from '../lib/errors.ts';
import { notify } from './notifications.ts';
import { LISTING_CARD_FROM, LISTING_CARD_SELECT } from './listing-queries.ts';
import { toAuditLog, toHistoryEntry, toListingSummary, toTransaction } from './serializers.ts';
import { transactionSummaryForUser } from './transaction-service.ts';
import { trustSummaryForUser } from './trust-service.ts';
import { unreadCounts } from './notifications.ts';
import type { AuthenticatedUser } from '../types/express.d.ts';

/**
 * Administrator operations: moderation queue, listing decisions, duplicate
 * alerts, account management, platform statistics, moderation history and the
 * audit log.
 *
 * Two properties are load-bearing here:
 *   * Every decision is written with actor, timestamp, structured reason code
 *     and free-text reason, and mirrored into `moderation_actions` + `audit_logs`
 *     (nothing is ever silently deleted).
 *   * Statistics are computed from the database at request time. No dashboard
 *     number is hard-coded.
 */

/* ----------------------------- Moderation queue ---------------------------- */

export async function listModerationQueue(
  options: { page: number; perPage: number; status?: string; q?: string; flaggedOnly?: boolean; categorySlug?: string; sellerId?: string; sort: 'oldest' | 'newest' | 'priority' },
): Promise<Paginated<ReturnType<typeof toListingSummary>>> {
  const conditions: string[] = [
    `l.deleted_at IS NULL`,
    `l.status IN ('submitted','checks_pending','flagged','under_review','evidence_required')`,
  ];
  const values: unknown[] = [];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (options.status) conditions.push(`l.status = ${param(options.status)}`);
  if (options.flaggedOnly) conditions.push(`l.status IN ('flagged','evidence_required')`);
  if (options.q) conditions.push(`(l.title ILIKE ${param(`%${options.q}%`)} OR l.slug ILIKE ${param(`%${options.q}%`)})`);
  if (options.categorySlug) conditions.push(`c.slug = ${param(options.categorySlug)}`);
  if (options.sellerId) conditions.push(`l.seller_id = ${param(options.sellerId)}`);

  const orderBy =
    options.sort === 'priority'
      ? `CASE l.review_priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, l.submitted_at ASC NULLS LAST`
      : options.sort === 'newest'
        ? 'l.submitted_at DESC NULLS LAST'
        : 'l.submitted_at ASC NULLS LAST';

  const limit = param(options.perPage);
  const offset = param((options.page - 1) * options.perPage);
  const rows = await queryMany(
    `SELECT ${LISTING_CARD_SELECT} ${LISTING_CARD_FROM} WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total ${LISTING_CARD_FROM} WHERE ${conditions.join(' AND ')}`,
    values.slice(0, values.length - 2),
  );
  const total = totalRow?.total ?? 0;
  return {
    data: rows.map((row) => toListingSummary(row)),
    meta: {
      page: options.page,
      perPage: options.perPage,
      total,
      totalPages: Math.ceil(total / options.perPage),
      hasNextPage: options.page < Math.ceil(total / options.perPage),
      hasPreviousPage: options.page > 1,
    },
  };
}

export interface DecisionInput {
  decision: 'approve' | 'reject' | 'request_evidence' | 'suspend' | 'reinstate' | 'claim';
  reasonCode: string;
  reasonNote: string;
  requiredEvidence?: { kind: string; note?: string }[];
  releaseIdentifier?: boolean;
}

const DECISION_TARGET_STATUS: Record<DecisionInput['decision'], ListingStatus | null> = {
  approve: 'approved',
  reject: 'rejected',
  request_evidence: 'evidence_required',
  suspend: 'suspended',
  reinstate: 'under_review',
  claim: null,
};

/**
 * Records a moderation decision. The state machine (shared with the frontend)
 * is consulted first, so an invalid transition is rejected before any write.
 */
export async function decideListing(admin: AuthenticatedUser, listingId: string, input: DecisionInput): Promise<{ status: ListingStatus }> {
  const listing = await queryOne<{
    id: string;
    device_id: string;
    status: ListingStatus;
    seller_id: string;
    title: string;
    slug: string;
    submission_round: number;
  }>(
    'SELECT id, device_id, status, seller_id, title, slug, submission_round FROM listings WHERE id = $1 AND deleted_at IS NULL',
    [listingId],
  );
  if (!listing) throw AppError.notFound('Listing not found');
  const target = DECISION_TARGET_STATUS[input.decision];

  if (input.decision === 'claim') {
    await withTransaction(async (tx) => {
      await tx.query('UPDATE listings SET review_priority = $2, last_reviewed_at = now(), updated_at = now() WHERE id = $1', [
        listing.id,
        'high',
      ]);
      await recordModerationAction(
        {
          actorId: admin.id,
          actorRole: 'admin',
          action: 'claimed_for_review',
          entityType: 'listing',
          entityId: listing.id,
          fromStatus: listing.status,
          toStatus: listing.status,
          reasonNote: input.reasonNote,
          reasonCode: input.reasonCode,
        },
        tx.query.bind(tx) as never,
      );
    });
    return { status: listing.status };
  }

  if (!target) throw AppError.validation('Unknown moderation decision');
  if (!canTransitionListing(listing.status, target)) {
    throw AppError.invalidTransition(
      `A listing in status "${listing.status}" cannot be moved to "${target}" by this action. Complete the required prior step first.`,
    );
  }
  if (input.decision === 'request_evidence' && (!input.requiredEvidence || input.requiredEvidence.length === 0)) {
    throw AppError.validation('Specify which evidence items the seller must provide', [
      { path: 'requiredEvidence', message: 'At least one evidence item is required' },
    ]);
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE listings SET status = $2, updated_at = now(),
              last_reviewed_at = now(),
              decided_at = CASE WHEN $2 IN ('approved','rejected','suspended') THEN now() ELSE decided_at END,
              published_at = CASE WHEN $2 = 'approved' THEN COALESCE(published_at, now()) ELSE published_at END,
              decision_reason_code = $3,
              decision_reason_note = $4,
              review_priority = CASE WHEN $2 = 'flagged' THEN 'high' WHEN $2 IN ('approved','rejected') THEN 'normal' ELSE review_priority END,
              availability = CASE
                WHEN $2 = 'approved' THEN CASE WHEN availability = 'inactive' THEN 'available' ELSE availability END
                WHEN $2 IN ('rejected','suspended') THEN 'inactive'
                ELSE availability END
        WHERE id = $1 AND status = $5`,
      [listing.id, target, input.reasonCode, input.reasonNote, listing.status],
    );

    await tx.query(
      `INSERT INTO verification_events (listing_id, device_id, actor_id, actor_role, action, from_status, to_status, reason_code, reason_note, visible_to_seller)
       VALUES ($1, $2, $3, 'admin', $4, $5, $6, $7, $8, true)`,
      [listing.id, listing.device_id, admin.id, `moderator_${input.decision}`, listing.status, target, input.reasonCode, input.reasonNote],
    );

    if (input.decision === 'request_evidence') {
      for (const item of input.requiredEvidence ?? []) {
        await tx.query(`INSERT INTO evidence_requests (listing_id, requested_by, kind, note) VALUES ($1, $2, $3, $4)`, [
          listing.id,
          admin.id,
          item.kind,
          item.note ?? null,
        ]);
      }
    }
    if (input.decision === 'request_evidence' || input.decision === 'reject') {
      // Return the listing to an editable state so the seller can correct it.
      await tx.query(
        `UPDATE listings SET availability = 'inactive' WHERE id = $1 AND status IN ('rejected','evidence_required')`,
        [listing.id],
      );
    }
    if ((input.decision === 'reject' || input.decision === 'suspend') && input.releaseIdentifier) {
      // Releasing frees the identifier for a legitimate resubmission. Suspension
      // keeps the claim by default because an investigation is open.
      await tx.query(`UPDATE device_identifiers SET is_active = false, released_at = now() WHERE listing_id = $1 AND is_active`, [listing.id]);
    }
    if (input.decision === 'approve') {
      // The identifier claim is confirmed on publication.
      await tx.query(`UPDATE device_identifiers SET is_active = true, activated_at = COALESCE(activated_at, now()) WHERE listing_id = $1`, [listing.id]);
      await tx.query(`UPDATE duplicate_alerts SET resolved_at = now(), resolved_by = $2, resolution_note = $3 WHERE listing_id = $1 AND resolved_at IS NULL`, [
        listing.id,
        admin.id,
        `Resolved by approval decision: ${input.reasonNote}`,
      ]);
    }

    await recordModerationAction(
      {
        actorId: admin.id,
        actorRole: 'admin',
        action:
          input.decision === 'approve'
            ? 'approved'
            : input.decision === 'reject'
              ? 'rejected'
              : input.decision === 'suspend'
                ? 'suspended'
                : input.decision === 'reinstate'
                  ? 'reinstated'
                  : 'requested_evidence',
        entityType: 'listing',
        entityId: listing.id,
        fromStatus: listing.status,
        toStatus: target,
        reasonCode: input.reasonCode,
        reasonNote: input.reasonNote,
        metadata: { submissionRound: listing.submission_round },
      },
      tx.query.bind(tx) as never,
    );

    await notify(
      {
        userId: listing.seller_id,
        type:
          input.decision === 'approve'
            ? 'listing_approved'
            : input.decision === 'reject'
              ? 'listing_rejected'
              : input.decision === 'request_evidence'
                ? 'evidence_requested'
                : 'listing_status_changed',
        title:
          input.decision === 'approve'
            ? 'Your listing was approved and is now public'
            : input.decision === 'reject'
              ? 'Your listing was not approved'
              : input.decision === 'request_evidence'
                ? 'Additional evidence is required'
                : `Listing status: ${target}`,
        body:
          `${listing.title}: ${input.reasonNote}` +
          (input.decision === 'approve'
            ? ' Approval means the submission passed automated checks and human moderation. It is not a certificate of ownership or of stolen-device status.'
            : ''),
        linkUrl: `/dashboard/listings/${listing.id}`,
        entityType: 'listing',
        entityId: listing.id,
        email: true,
      },
      tx.query.bind(tx) as never,
    );
  });

  await recordAudit({
    actorId: admin.id,
    actorRole: 'admin',
    action: `listing.decision.${input.decision}`,
    entityType: 'listing',
    entityId: listing.id,
    metadata: { from: listing.status, to: target, reasonCode: input.reasonCode },
  });

  return { status: target };
}

export async function listDuplicateAlerts(options: { page: number; perPage: number; includeResolved?: boolean }) {
  const rows = await queryMany(
    `SELECT da.*, l.title AS listing_title, l.slug AS listing_slug, rl.title AS related_title
       FROM duplicate_alerts da
       LEFT JOIN listings l ON l.id = da.listing_id
       LEFT JOIN listings rl ON rl.id = da.related_listing_id
      WHERE ($1::boolean OR da.resolved_at IS NULL)
      ORDER BY CASE da.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, da.created_at DESC
      LIMIT $2 OFFSET $3`,
    [options.includeResolved ?? false, options.perPage, (options.page - 1) * options.perPage],
  );
  const totalRow = await queryOne<{ total: number }>(
    'SELECT count(*)::int AS total FROM duplicate_alerts WHERE ($1::boolean OR resolved_at IS NULL)',
    [options.includeResolved ?? false],
  );
  const total = totalRow?.total ?? 0;
  return {
    data: rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      severity: String(row.severity),
      detail: String(row.detail),
      listingId: row.listing_id ? String(row.listing_id) : null,
      listingTitle: row.listing_title ? String(row.listing_title) : null,
      listingSlug: row.listing_slug ? String(row.listing_slug) : null,
      relatedListingId: row.related_listing_id ? String(row.related_listing_id) : null,
      relatedListingTitle: row.related_title ? String(row.related_title) : null,
      createdAt: (row.created_at as Date).toISOString(),
      resolvedAt: row.resolved_at ? (row.resolved_at as Date).toISOString() : null,
    })),
    meta: {
      page: options.page,
      perPage: options.perPage,
      total,
      totalPages: Math.ceil(total / options.perPage),
      hasNextPage: options.page < Math.ceil(total / options.perPage),
      hasPreviousPage: options.page > 1,
    },
  };
}

export async function resolveDuplicateAlert(admin: AuthenticatedUser, alertId: string, note: string): Promise<void> {
  const alert = await queryOne<{ id: string }>('SELECT id FROM duplicate_alerts WHERE id = $1', [alertId]);
  if (!alert) throw AppError.notFound('Alert not found');
  await query('UPDATE duplicate_alerts SET resolved_at = now(), resolved_by = $2, resolution_note = $3 WHERE id = $1', [
    alertId,
    admin.id,
    note,
  ]);
  await recordModerationAction({
    actorId: admin.id,
    actorRole: 'admin',
    action: 'flagged',
    entityType: 'duplicate_alert',
    entityId: alertId,
    reasonNote: note,
  });
  await recordAudit({
    actorId: admin.id,
    actorRole: 'admin',
    action: 'duplicate_alert.resolved',
    entityType: 'duplicate_alert',
    entityId: alertId,
    metadata: { note },
  });
}

/* ------------------------------ User management ---------------------------- */

export async function listUsers(
  options: { page: number; perPage: number; q?: string; status?: string; role?: string; sort: 'newest' | 'oldest' | 'reports' },
): Promise<Paginated<AdminUserDto>> {
  const conditions: string[] = ['true'];
  const values: unknown[] = [];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (options.q) conditions.push(`(u.full_name ILIKE ${param(`%${options.q}%`)} OR u.email ILIKE ${param(`%${options.q}%`)})`);
  if (options.status) conditions.push(`u.account_status = ${param(options.status)}`);
  if (options.role) conditions.push(`u.role = ${param(options.role)}`);

  const orderBy =
    options.sort === 'reports'
      ? 'open_reports DESC, u.created_at DESC'
      : options.sort === 'oldest'
        ? 'u.created_at ASC'
        : 'u.created_at DESC';

  const limit = param(options.perPage);
  const offset = param((options.page - 1) * options.perPage);
  const rows = await queryMany(
    `SELECT u.id, u.email, u.full_name, u.role, u.account_status, u.email_verified_at, u.created_at, u.last_login_at,
            u.identity_reviewed_at, u.status_reason, u.restricted_until,
            p.region,
            (SELECT count(*)::int FROM listings l WHERE l.seller_id = u.id AND l.deleted_at IS NULL) AS listing_count,
            (SELECT count(*)::int FROM reports r WHERE r.reported_user_id = u.id AND r.status NOT IN ('resolved','dismissed')) AS open_reports,
            (SELECT count(*)::int FROM reports r WHERE r.reported_user_id = u.id) AS report_count_against,
            (SELECT count(*)::int FROM disputes d WHERE d.opened_by = u.id OR d.counterparty_id = u.id) AS dispute_count,
            (SELECT count(*)::int FROM transactions t WHERE t.buyer_id = u.id OR t.seller_id = u.id) AS transaction_count
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM users u WHERE ${conditions.join(' AND ')}`,
    values.slice(0, values.length - 2),
  );
  const total = totalRow?.total ?? 0;
  return {
    data: rows.map((row) => ({
      id: String(row.id),
      email: String(row.email),
      fullName: String(row.full_name),
      role: String(row.role) as 'user' | 'admin',
      accountStatus: String(row.account_status) as AdminUserDto['accountStatus'],
      emailVerified: row.email_verified_at !== null,
      createdAt: (row.created_at as Date).toISOString(),
      lastLoginAt: row.last_login_at ? (row.last_login_at as Date).toISOString() : null,
      region: row.region ? String(row.region) : null,
      listingCount: Number(row.listing_count ?? 0),
      reportCountAgainst: Number(row.report_count_against ?? 0),
      disputeCount: Number(row.dispute_count ?? 0),
      transactionCount: Number(row.transaction_count ?? 0),
      identityReviewedAt: row.identity_reviewed_at ? (row.identity_reviewed_at as Date).toISOString() : null,
      restrictionReason: row.status_reason ? String(row.status_reason) : null,
      restrictedUntil: row.restricted_until ? (row.restricted_until as Date).toISOString() : null,
    })),
    meta: {
      page: options.page,
      perPage: options.perPage,
      total,
      totalPages: Math.ceil(total / options.perPage),
      hasNextPage: options.page < Math.ceil(total / options.perPage),
      hasPreviousPage: options.page > 1,
    },
  };
}

export async function changeAccountStatus(
  admin: AuthenticatedUser,
  userId: string,
  input: { action: 'restrict' | 'unrestrict' | 'suspend' | 'reactivate' | 'verify_identity' | 'revoke_identity'; reason: string; restrictedUntil?: Date; notifyUser: boolean },
): Promise<void> {
  const user = await queryOne<{ id: string; role: string; account_status: string; full_name: string }>(
    'SELECT id, role, account_status, full_name FROM users WHERE id = $1',
    [userId],
  );
  if (!user) throw AppError.notFound('Account not found');
  if (user.id === admin.id && input.action !== 'verify_identity') {
    throw AppError.forbidden('You cannot change the status of your own administrator account');
  }
  if (user.role === 'admin' && ['restrict', 'suspend'].includes(input.action)) {
    throw AppError.forbidden('Administrator accounts cannot be restricted or suspended from this screen. Remove the administrator role first.');
  }

  const mapping: Record<string, { status: string | null; action: string; message: string }> = {
    restrict: { status: 'restricted', action: 'account_restricted', message: 'Your account has been restricted' },
    unrestrict: { status: 'active', action: 'account_unrestricted', message: 'Your account restriction has been lifted' },
    suspend: { status: 'suspended', action: 'account_restricted', message: 'Your account has been suspended' },
    reactivate: { status: 'active', action: 'account_unrestricted', message: 'Your account has been reactivated' },
    verify_identity: { status: null, action: 'identity_verified', message: 'Your identity documents were reviewed' },
    revoke_identity: { status: null, action: 'identity_verified', message: 'Your identity review was revoked' },
  };
  const config = mapping[input.action];
  if (!config) throw AppError.validation('Unknown account action');

  await withTransaction(async (tx) => {
    if (config.status) {
      await tx.query(
        `UPDATE users SET account_status = $2, status_reason = $3, restricted_until = $4,
                suspended_at = CASE WHEN $2 = 'suspended' THEN now() ELSE suspended_at END,
                deactivated_at = CASE WHEN $2 <> 'deactivated' THEN NULL ELSE deactivated_at END,
                updated_at = now()
          WHERE id = $1`,
        [userId, config.status, input.reason, input.restrictedUntil ?? null],
      );
      const sessionRevoked = await tx.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, `account_${config.status}`],
      );
      if (config.status === 'suspended' && (sessionRevoked.rowCount ?? 0) > 0) {
        logger.info({ userId, sessions: sessionRevoked.rowCount }, 'suspended account had active sessions revoked');
      }
      // Suspended sellers' listings are hidden from the catalogue immediately.
      if (config.status === 'suspended') {
        await tx.query(
          `UPDATE listings SET status = 'suspended', availability = 'inactive', updated_at = now()
            WHERE seller_id = $1 AND status = 'approved' AND deleted_at IS NULL`,
          [userId],
        );
      }
    }
    if (input.action === 'verify_identity') {
      await tx.query('UPDATE users SET identity_reviewed_at = now(), identity_reviewed_by = $2 WHERE id = $1', [userId, admin.id]);
    }
    if (input.action === 'revoke_identity') {
      await tx.query('UPDATE users SET identity_reviewed_at = NULL, identity_reviewed_by = NULL WHERE id = $1', [userId]);
    }
    await recordModerationAction(
      {
        actorId: admin.id,
        actorRole: 'admin',
        action: config.action,
        entityType: 'user',
        entityId: userId,
        fromStatus: user.account_status,
        toStatus: config.status ?? user.account_status,
        reasonNote: input.reason,
      },
      tx.query.bind(tx) as never,
    );
    if (input.notifyUser) {
      await notify(
        {
          userId,
          type: config.action === 'account_restricted' ? 'account_restricted' : config.action === 'identity_verified' ? 'identity_verified' : 'account_unrestricted',
          title: config.message,
          body: `${config.message}. Reason recorded by moderation: ${input.reason}`,
          linkUrl: '/dashboard',
          entityType: 'user',
          entityId: userId,
          email: true,
        },
        tx.query.bind(tx) as never,
      );
    }
  });

  await recordAudit({
    actorId: admin.id,
    actorRole: 'admin',
    action: `account.${input.action}`,
    entityType: 'user',
    entityId: userId,
    metadata: { reason: input.reason, previousStatus: user.account_status },
  });
}

export async function addModerationNote(
  admin: AuthenticatedUser,
  input: { entityType: string; entityId: string; body: string; visibility: 'moderator_note' | 'user_visible' },
): Promise<void> {
  await query(
    `INSERT INTO moderation_notes (entity_type, entity_id, author_id, body, visibility) VALUES ($1, $2, $3, $4, $5)`,
    [input.entityType, input.entityId, admin.id, input.body, input.visibility],
  );
  await recordAudit({
    actorId: admin.id,
    actorRole: 'admin',
    action: 'moderation.note_added',
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: { visibility: input.visibility },
  });
}

/* -------------------------------- Statistics ------------------------------- */

export async function overviewStatistics(range: '7d' | '30d' | '90d' | 'all'): Promise<AdminOverviewStatsDto> {
  // `range` only selects a label for the client; every figure below is counted
  // from the database at request time.
  void range;

  const listingStatusRows = await queryMany<{ status: string; total: number }>(
    'SELECT status, count(*)::int AS total FROM listings WHERE deleted_at IS NULL GROUP BY status',
  );
  const byStatus = Object.fromEntries(LISTING_STATUSES.map((status) => [status, 0])) as Record<ListingStatus, number>;
  for (const row of listingStatusRows) byStatus[row.status as ListingStatus] = Number(row.total);

  const listingTotals = await queryOne<{
    total: number;
    pending_review: number;
    published: number;
    flagged: number;
    approved_recent: number;
    overdue: number;
  }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('submitted','checks_pending','flagged','under_review','evidence_required'))::int AS pending_review,
            count(*) FILTER (WHERE status = 'approved' AND availability <> 'inactive')::int AS published,
            count(*) FILTER (WHERE status IN ('flagged','evidence_required'))::int AS flagged,
            count(*) FILTER (WHERE status = 'approved' AND published_at > now() - interval '7 days')::int AS approved_recent,
            count(*) FILTER (WHERE status IN ('submitted','checks_pending','flagged','under_review') AND submitted_at < now() - interval '72 hours')::int AS overdue
       FROM listings WHERE deleted_at IS NULL`,
  );

  const users = await queryOne<{
    total: number;
    recent: number;
    active_recent: number;
    restricted: number;
    suspended: number;
    admins: number;
  }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS recent,
            count(*) FILTER (WHERE last_login_at > now() - interval '30 days')::int AS active_recent,
            count(*) FILTER (WHERE account_status = 'restricted')::int AS restricted,
            count(*) FILTER (WHERE account_status = 'suspended')::int AS suspended,
            count(*) FILTER (WHERE role = 'admin')::int AS admins
       FROM users`,
  );

  const verification = await queryOne<{
    checks_recent: number;
    open_alerts: number;
    evidence_awaiting: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM device_verification_attempts WHERE created_at > now() - interval '7 days') AS checks_recent,
       (SELECT count(*)::int FROM duplicate_alerts WHERE resolved_at IS NULL) AS open_alerts,
       (SELECT count(*)::int FROM evidence_requests WHERE fulfilled_at IS NULL) AS evidence_awaiting`,
  );

  const transactionRows = await queryMany<{ status: string; total: number }>(
    'SELECT status, count(*)::int AS total FROM transactions GROUP BY status',
  );
  const transactionByStatus = Object.fromEntries(TRANSACTION_STATUSES.map((status) => [status, 0])) as Record<
    (typeof TRANSACTION_STATUSES)[number],
    number
  >;
  for (const row of transactionRows) {
    transactionByStatus[row.status as (typeof TRANSACTION_STATUSES)[number]] = Number(row.total);
  }
  const completedRecent = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM transactions WHERE status = 'completed' AND completed_at > now() - interval '30 days'`,
  );

  const reportRows = await queryMany<{ status: string; total: number }>('SELECT status, count(*)::int AS total FROM reports GROUP BY status');
  const reportByStatus = Object.fromEntries(REPORT_STATUSES.map((status) => [status, 0])) as Record<
    (typeof REPORT_STATUSES)[number],
    number
  >;
  for (const row of reportRows) reportByStatus[row.status as (typeof REPORT_STATUSES)[number]] = Number(row.total);
  const reportOpen = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM reports WHERE status NOT IN ('resolved','dismissed')`,
  );

  const disputeRows = await queryMany<{ status: string; total: number }>('SELECT status, count(*)::int AS total FROM disputes GROUP BY status');
  const disputeByStatus = Object.fromEntries(DISPUTE_STATUSES.map((status) => [status, 0])) as Record<
    (typeof DISPUTE_STATUSES)[number],
    number
  >;
  for (const row of disputeRows) disputeByStatus[row.status as (typeof DISPUTE_STATUSES)[number]] = Number(row.total);

  const media = await queryOne<{ public_assets: number; private_assets: number }>(
    `SELECT count(*) FILTER (WHERE visibility = 'public')::int AS public_assets,
            count(*) FILTER (WHERE visibility = 'private')::int AS private_assets
       FROM media_assets WHERE deleted_at IS NULL`,
  );

  const { externalProviderStatus } = await import('./verification/providers.ts');
  const provider = externalProviderStatus();

  const overdue = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM reports WHERE status IN ('open','under_review') AND created_at < now() - interval '72 hours'`,
  );

  return {
    listings: {
      total: Number(listingTotals?.total ?? 0),
      byStatus,
      pendingReview: Number(listingTotals?.pending_review ?? 0),
      approvedLast7Days: Number(listingTotals?.approved_recent ?? 0),
      published: Number(listingTotals?.published ?? 0),
      flagged: Number(listingTotals?.flagged ?? 0),
    },
    users: {
      total: Number(users?.total ?? 0),
      newLast7Days: Number(users?.recent ?? 0),
      activeLast30Days: Number(users?.active_recent ?? 0),
      restricted: Number(users?.restricted ?? 0),
      suspended: Number(users?.suspended ?? 0),
      administrators: Number(users?.admins ?? 0),
    },
    verification: {
      automatedChecksLast7Days: Number(verification?.checks_recent ?? 0),
      duplicateAlertsOpen: Number(verification?.open_alerts ?? 0),
      externalCheckAvailable: provider.configured,
      externalCheckStatus: provider.status,
      externalProvider: provider.provider === 'none' ? null : provider.provider,
      evidenceAwaiting: Number(verification?.evidence_awaiting ?? 0),
    },
    transactions: {
      total: Object.values(transactionByStatus).reduce((sum, value) => sum + value, 0),
      byStatus: transactionByStatus,
      completedLast30Days: Number(completedRecent?.total ?? 0),
    },
    trust: {
      reportsOpen: Number(reportOpen?.total ?? 0),
      reportsByStatus: reportByStatus,
      disputesOpen: DISPUTE_STATUSES.filter((status) => !['resolved', 'closed'].includes(status)).reduce(
        (sum, status) => sum + disputeByStatus[status],
        0,
      ),
      disputesByStatus: disputeByStatus,
      overdueModeration: Number(listingTotals?.overdue ?? 0) + Number(overdue?.total ?? 0),
    },
    media: { publicAssets: Number(media?.public_assets ?? 0), privateAssets: Number(media?.private_assets ?? 0) },
    generatedAt: new Date().toISOString(),
    range,
  } satisfies AdminOverviewStatsDto & { notice?: string } as AdminOverviewStatsDto;
}

export async function listAuditLogs(options: {
  page: number;
  perPage: number;
  action?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
}): Promise<Paginated<AuditLogDto>> {
  const conditions: string[] = ['true'];
  const values: unknown[] = [];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (options.action) conditions.push(`a.action = ${param(options.action)}`);
  if (options.actorId) conditions.push(`a.actor_id = ${param(options.actorId)}`);
  if (options.entityType) conditions.push(`a.entity_type = ${param(options.entityType)}`);
  if (options.entityId) conditions.push(`a.entity_id = ${param(options.entityId)}`);
  if (options.from) conditions.push(`a.created_at >= ${param(options.from)}`);
  if (options.to) conditions.push(`a.created_at <= ${param(options.to)}`);

  const limit = param(options.perPage);
  const offset = param((options.page - 1) * options.perPage);
  const rows = await queryMany(
    `SELECT a.*, u.full_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE ${conditions.join(' AND ')} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM audit_logs a WHERE ${conditions.join(' AND ')}`,
    values.slice(0, values.length - 2),
  );
  const total = totalRow?.total ?? 0;
  return {
    data: rows.map((row) => toAuditLog(row)),
    meta: {
      page: options.page,
      perPage: options.perPage,
      total,
      totalPages: Math.ceil(total / options.perPage),
      hasNextPage: options.page < Math.ceil(total / options.perPage),
      hasPreviousPage: options.page > 1,
    },
  };
}

export async function moderationHistory(options: { page: number; perPage: number; entityType?: string; entityId?: string; actorId?: string }) {
  const conditions: string[] = ['true'];
  const values: unknown[] = [];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (options.entityType) conditions.push(`m.entity_type = ${param(options.entityType)}`);
  if (options.entityId) conditions.push(`m.entity_id = ${param(options.entityId)}`);
  if (options.actorId) conditions.push(`m.actor_id = ${param(options.actorId)}`);

  const limit = param(options.perPage);
  const offset = param((options.page - 1) * options.perPage);
  const rows = await queryMany(
    `SELECT m.*, u.full_name AS actor_name FROM moderation_actions m LEFT JOIN users u ON u.id = m.actor_id
      WHERE ${conditions.join(' AND ')} ORDER BY m.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM moderation_actions m WHERE ${conditions.join(' AND ')}`,
    values.slice(0, values.length - 2),
  );
  const total = totalRow?.total ?? 0;
  return {
    data: rows.map((row) => ({
      id: String(row.id),
      action: String(row.action),
      entityType: String(row.entity_type),
      entityId: String(row.entity_id),
      fromStatus: row.from_status ? String(row.from_status) : null,
      toStatus: row.to_status ? String(row.to_status) : null,
      reasonCode: row.reason_code ? String(row.reason_code) : null,
      reasonNote: row.reason_note ? String(row.reason_note) : null,
      actor: { id: row.actor_id ? String(row.actor_id) : null, name: String(row.actor_name ?? 'System') },
      createdAt: (row.created_at as Date).toISOString(),
    })),
    meta: {
      page: options.page,
      perPage: options.perPage,
      total,
      totalPages: Math.ceil(total / options.perPage),
      hasNextPage: options.page < Math.ceil(total / options.perPage),
      hasPreviousPage: options.page > 1,
    },
  };
}

export async function adminTransactions(options: { page: number; perPage: number; status?: string; q?: string }): Promise<Paginated<TransactionDto>> {
  const conditions: string[] = ['true'];
  const values: unknown[] = [];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (options.status) conditions.push(`t.status = ${param(options.status)}`);
  if (options.q) conditions.push(`(t.reference ILIKE ${param(`%${options.q}%`)} OR l.title ILIKE ${param(`%${options.q}%`)})`);

  const limit = param(options.perPage);
  const offset = param((options.page - 1) * options.perPage);
  const rows = await queryMany(
    `SELECT t.id FROM transactions t JOIN listings l ON l.id = t.listing_id
      WHERE ${conditions.join(' AND ')} ORDER BY t.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM transactions t JOIN listings l ON l.id = t.listing_id WHERE ${conditions.join(' AND ')}`,
    values.slice(0, values.length - 2),
  );
  const total = totalRow?.total ?? 0;

  const data: TransactionDto[] = [];
  for (const row of rows) {
    const detail = await queryOne(
      `SELECT t.*, b.full_name AS buyer_name, s.full_name AS seller_name, l.title AS listing_title, l.slug AS listing_slug,
              img.url AS listing_image_url,
              (SELECT id FROM disputes d WHERE d.transaction_id = t.id AND d.status NOT IN ('resolved','closed') LIMIT 1) AS open_dispute_id
         FROM transactions t
         JOIN users b ON b.id = t.buyer_id
         JOIN users s ON s.id = t.seller_id
         JOIN listings l ON l.id = t.listing_id
         LEFT JOIN LATERAL (SELECT li.media_asset_id FROM listing_images li WHERE li.listing_id = l.id ORDER BY position ASC LIMIT 1) li0 ON true
         LEFT JOIN media_assets img ON img.id = li0.media_asset_id
        WHERE t.id = $1`,
      [String(row.id)],
    );
    if (!detail) continue;
    const history = await queryMany(
      `SELECT h.*, u.full_name AS actor_name FROM transaction_status_history h LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.transaction_id = $1 ORDER BY h.created_at ASC`,
      [String(row.id)],
    );
    data.push(toTransaction(detail, '00000000-0000-0000-0000-000000000000', history.map((entry) => toHistoryEntry(entry)), []));
  }

  return {
    data,
    meta: {
      page: options.page,
      perPage: options.perPage,
      total,
      totalPages: Math.ceil(total / options.perPage),
      hasNextPage: options.page < Math.ceil(total / options.perPage),
      hasPreviousPage: options.page > 1,
    },
  };
}

/* --------------------------- User dashboard summary ------------------------ */

export async function dashboardSummary(userId: string): Promise<DashboardSummaryDto> {
  const statusCounts = await queryMany<{ status: string; total: number }>(
    'SELECT status, count(*)::int AS total FROM listings WHERE seller_id = $1 AND deleted_at IS NULL GROUP BY status',
    [userId],
  );
  const counts = statusCounts.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.status] = Number(row.total);
    return accumulator;
  }, {});

  const actions = await queryMany<{ id: string; title: string; status: string; decision_reason_note: string | null }>(
    `SELECT id, title, status, decision_reason_note FROM listings
      WHERE seller_id = $1 AND status IN ('draft','rejected','evidence_required','withdrawn') AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT 10`,
    [userId],
  );

  const unread = await unreadCounts(userId);
  const transactions = await transactionSummaryForUser(userId);
  const trust = await trustSummaryForUser(userId);

  const savedRow = await queryOne<{ total: number }>('SELECT count(*)::int AS total FROM saved_listings WHERE user_id = $1', [userId]);
  const exchangeRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM exchange_requests
      WHERE (requester_id = $1 OR recipient_id = $1) AND status IN ('pending','accepted','countered')`,
    [userId],
  );

  return {
    listings: {
      draft: counts.draft ?? 0,
      inReview:
        (counts.submitted ?? 0) + (counts.checks_pending ?? 0) + (counts.flagged ?? 0) + (counts.under_review ?? 0) + (counts.evidence_required ?? 0),
      approved: counts.approved ?? 0,
      rejected: counts.rejected ?? 0,
      suspended: counts.suspended ?? 0,
      withdrawn: counts.withdrawn ?? 0,
    },
    actionsRequired: actions.map((row) => ({
      listingId: String(row.id),
      listingTitle: String(row.title),
      reason:
        row.status === 'draft'
          ? 'Draft not submitted yet'
          : row.status === 'rejected'
            ? (row.decision_reason_note ?? 'Rejected by moderation — review the reason and resubmit')
            : row.status === 'evidence_required'
              ? (row.decision_reason_note ?? 'Additional evidence requested by a moderator')
              : 'Withdrawn — resubmit when you are ready',
      href: `/dashboard/listings/${String(row.id)}`,
    })),
    unreadMessages: unread.messages,
    unreadNotifications: unread.notifications,
    openExchanges: Number(exchangeRow?.total ?? 0),
    activeTransactions: transactions.active,
    savedListings: Number(savedRow?.total ?? 0),
    openReports: trust.openReports,
    openDisputes: trust.openDisputes,
  };
}

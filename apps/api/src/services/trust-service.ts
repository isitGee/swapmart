import type { DisputeDto, Paginated, ReportDto } from '@swapmart/shared';
import { canTransitionDispute, canTransitionReport } from '@swapmart/shared';
import { query, queryMany, queryOne, withTransaction } from '../db/pool.ts';
import { recordAudit, recordModerationAction } from '../lib/audit.ts';
import { AppError } from '../lib/errors.ts';
import { notify } from './notifications.ts';
import { toDispute, toDisputeMessage, toReport } from './serializers.ts';
import type { AuthenticatedUser } from '../types/express.d.ts';

/**
 * Reports and disputes.
 *
 * Neither is ever deleted: a report moves through statuses and keeps its notes,
 * and a dispute keeps its message history (including internal moderator notes,
 * which are filtered out for the parties). Both are reference-numbered
 * (RPT-YYYY-NNNNNN / DSP-YYYY-NNNNNN) so a case can be discussed unambiguously.
 */

async function loadReport(id: string, viewer: { id: string; isAdmin: boolean }): Promise<ReportDto> {
  const row = await queryOne(
    `SELECT r.*, rep.full_name AS reporter_name, l.title AS listing_title, l.slug AS listing_slug, l.status AS listing_status,
            ru.full_name AS reported_user_name, ru.account_status AS reported_user_status,
            m.body AS message_excerpt, m.created_at AS message_created_at,
            t.reference AS transaction_reference, adm.full_name AS assigned_admin_name
       FROM reports r
       LEFT JOIN users rep ON rep.id = r.reporter_id
       LEFT JOIN listings l ON l.id = r.listing_id
       LEFT JOIN users ru ON ru.id = r.reported_user_id
       LEFT JOIN messages m ON m.id = r.message_id
       LEFT JOIN transactions t ON t.id = r.transaction_id
       LEFT JOIN users adm ON adm.id = r.assigned_admin_id
      WHERE r.id = $1`,
    [id],
  );
  if (!row) throw AppError.notFound('Report not found');

  const notes = await queryMany<{ id: string; body: string; visibility: string; created_at: Date; author_id: string | null; author_name: string | null }>(
    `SELECT rn.id, rn.body, rn.visibility, rn.created_at, rn.author_id, u.full_name AS author_name
       FROM report_notes rn LEFT JOIN users u ON u.id = rn.author_id
      WHERE rn.report_id = $1 ORDER BY rn.created_at ASC`,
    [id],
  );

  const visibleNotes = viewer.isAdmin ? notes : notes.filter((note) => note.visibility === 'reporter_visible');
  return toReport(row, visibleNotes.map((note) => ({
    id: String(note.id),
    body: note.visibility === 'moderator_note' && !viewer.isAdmin ? '[internal moderator note]' : note.body,
    visibility: note.visibility as 'moderator_note' | 'reporter_visible',
    author: { id: String(note.author_id ?? 'system'), name: note.author_name ?? 'Moderator' },
    createdAt: note.created_at.toISOString(),
  })));
}

export async function createReport(
  user: AuthenticatedUser,
  input: {
    category: string;
    description: string;
    listingId?: string;
    reportedUserId?: string;
    messageId?: string;
    transactionId?: string;
    contactConsent?: boolean;
  },
): Promise<ReportDto> {
  // Basic abuse control: cap the number of reports one account can file per day.
  const recent = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM reports WHERE reporter_id = $1 AND created_at > now() - interval '1 day'`,
    [user.id],
  );
  if ((recent?.total ?? 0) >= 15) {
    throw AppError.rateLimited('You have submitted the maximum number of reports for today. A moderator will review the ones already filed.');
  }

  if (input.listingId) {
    const listing = await queryOne<{ id: string }>('SELECT id FROM listings WHERE id = $1', [input.listingId]);
    if (!listing) throw AppError.validation('The listing you are reporting no longer exists');
  }
  if (input.messageId) {
    const message = await queryOne<{ id: string }>(
      `SELECT m.id FROM messages m
         JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $2
        WHERE m.id = $1`,
      [input.messageId, user.id],
    );
    if (!message) throw AppError.validation('You can only report messages from conversations you took part in');
  }

  const created = await withTransaction(async (tx) => {
    const reference = await tx.queryOne<{ reference: string }>(`SELECT next_reference('RPT') AS reference`);
    if (!reference) throw AppError.internal('Could not allocate a report reference');
    const priority = input.category === 'suspected_stolen_device' || input.category === 'fraudulent_seller' ? 'high' : 'normal';
    const row = await tx.queryOne<{ id: string }>(
      `INSERT INTO reports (reference, reporter_id, category, description, listing_id, reported_user_id, message_id, transaction_id, priority, contact_consent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        reference.reference,
        user.id,
        input.category,
        input.description,
        input.listingId ?? null,
        input.reportedUserId ?? null,
        input.messageId ?? null,
        input.transactionId ?? null,
        priority,
        input.contactConsent ?? false,
      ],
    );
    if (!row) throw AppError.internal('The report could not be saved');
    // An open report about a user raises their listings' review priority.
    if (input.reportedUserId && ['suspected_stolen_device', 'fraudulent_seller', 'counterfeit_device'].includes(input.category)) {
      await tx.query(
        `UPDATE listings SET review_priority = 'urgent'
          WHERE seller_id = $1 AND status IN ('submitted', 'checks_pending', 'flagged', 'under_review')`,
        [input.reportedUserId],
      );
    }
    return row.id;
  });

  const admins = await queryMany<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' AND account_status = 'active'`);
  for (const admin of admins) {
    await notify({
      userId: admin.id,
      type: 'report_status_changed',
      title: 'New report submitted',
      body: `${user.displayName} submitted a report (${input.category}).`,
      linkUrl: `/admin/reports/${created}`,
      entityType: 'report',
      entityId: created,
    });
  }
  await recordAudit({
    actorId: user.id,
    actorRole: user.role,
    action: 'report.created',
    entityType: 'report',
    entityId: created,
    metadata: { category: input.category, listingId: input.listingId ?? null, reportedUserId: input.reportedUserId ?? null },
  });

  return loadReport(created, { id: user.id, isAdmin: user.role === 'admin' });
}

export async function listReports(
  viewer: AuthenticatedUser,
  options: { page: number; perPage: number; status?: string; category?: string; priority?: string; q?: string; mine?: boolean },
): Promise<Paginated<ReportDto>> {
  const isAdmin = viewer.role === 'admin';
  const conditions: string[] = [];
  const values: unknown[] = [];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (isAdmin) {
    conditions.push('true');
  } else {
    conditions.push(`r.reporter_id = ${param(viewer.id)}`);
  }
  if (options.status) conditions.push(`r.status = ${param(options.status)}`);
  if (options.category) conditions.push(`r.category = ${param(options.category)}`);
  if (options.priority) conditions.push(`r.priority = ${param(options.priority)}`);
  if (options.q) conditions.push(`(r.reference ILIKE ${param(`%${options.q}%`)} OR r.description ILIKE ${param(`%${options.q}%`)})`);

  // The count runs first: it reuses the filter parameters only. Binding the
  // LIMIT/OFFSET placeholders into it would fail, because the aggregate query
  // has no placeholders of its own.
  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM reports r WHERE ${conditions.join(' AND ')}`,
    values,
  );
  const total = totalRow?.total ?? 0;

  const limit = param(options.perPage);
  const offset = param((options.page - 1) * options.perPage);

  const rows = await queryMany(
    `SELECT r.id FROM reports r WHERE ${conditions.join(' AND ')}
      ORDER BY CASE r.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, r.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    values,
  );

  const data: ReportDto[] = [];
  for (const row of rows) {
    data.push(await loadReport(String(row.id), { id: viewer.id, isAdmin }));
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

export async function getReport(viewer: AuthenticatedUser, id: string): Promise<ReportDto> {
  const row = await queryOne<{ reporter_id: string | null }>('SELECT reporter_id FROM reports WHERE id = $1', [id]);
  if (!row) throw AppError.notFound('Report not found');
  const isAdmin = viewer.role === 'admin';
  if (!isAdmin && row.reporter_id !== viewer.id) {
    throw AppError.forbidden('You can only view reports you submitted');
  }
  return loadReport(id, { id: viewer.id, isAdmin });
}

export async function resolveReport(
  admin: AuthenticatedUser,
  id: string,
  input: { status: string; priority?: string; resolution: string; listingAction: 'none' | 'suspend' | 'reinstate' | 'none_request_evidence' },
): Promise<ReportDto> {
  const report = await queryOne<{ id: string; status: string; listing_id: string | null; reporter_id: string | null; reported_user_id: string | null; category: string }>(
    'SELECT id, status, listing_id, reporter_id, reported_user_id, category FROM reports WHERE id = $1',
    [id],
  );
  if (!report) throw AppError.notFound('Report not found');
  if (!canTransitionReport(report.status as never, input.status as never)) {
    throw AppError.invalidTransition(`A report in status "${report.status}" cannot be moved to "${input.status}"`);
  }
  if (['resolved', 'dismissed'].includes(input.status) && input.resolution.trim().length < 10) {
    throw AppError.validation('Provide the resolution or reason for closing this report', [
      { path: 'resolution', message: 'A resolution explanation is required' },
    ]);
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE reports SET status = $2, priority = COALESCE($3, priority), resolution = $4,
              resolved_at = CASE WHEN $2 IN ('resolved','dismissed') THEN now() ELSE resolved_at END,
              closed_at = CASE WHEN $2 IN ('resolved','dismissed') THEN now() ELSE closed_at END,
              resolved_by = CASE WHEN $2 IN ('resolved','dismissed') THEN $5::uuid ELSE resolved_by END,
              assigned_admin_id = COALESCE(assigned_admin_id, $5::uuid),
              updated_at = now()
        WHERE id = $1`,
      [id, input.status, input.priority ?? null, input.resolution, admin.id],
    );
    await tx.query(
      `INSERT INTO report_notes (report_id, author_id, author_role, body, visibility)
       VALUES ($1, $2, 'admin', $3, 'reporter_visible')`,
      [id, admin.id, `Status set to ${input.status}: ${input.resolution}`],
    );
    await recordModerationAction(
      {
        actorId: admin.id,
        actorRole: 'admin',
        action: 'report_status_changed',
        entityType: 'report',
        entityId: id,
        fromStatus: report.status,
        toStatus: input.status,
        reasonNote: input.resolution,
      },
      tx.query.bind(tx) as never,
    );

    if (report.listing_id && input.listingAction !== 'none') {
      const desiredStatus = input.listingAction === 'suspend' ? 'suspended' : input.listingAction === 'reinstate' ? 'under_review' : 'evidence_required';
      const listing = await tx.queryOne<{ status: string; device_id: string; seller_id: string }>(
        'SELECT status, device_id, seller_id FROM listings WHERE id = $1',
        [report.listing_id],
      );
      if (listing) {
        if (desiredStatus === 'suspended') {
          await tx.query(`UPDATE listings SET status = 'suspended', availability = 'inactive', updated_at = now() WHERE id = $1`, [report.listing_id]);
          // Suspension keeps the identifier claim in place: it is an active
          // investigation, so a second listing must not be able to claim it.
        } else {
          await tx.query(`UPDATE listings SET status = $2, updated_at = now() WHERE id = $1`, [report.listing_id, desiredStatus]);
        }
        await tx.query(
          `INSERT INTO verification_events (listing_id, device_id, actor_id, actor_role, action, from_status, to_status, reason_code, reason_note, visible_to_seller)
           VALUES ($1, $2, $3, 'admin', 'report_action', $4, $5, 'policy_violation', $6, true)`,
          [report.listing_id, listing.device_id, admin.id, listing.status, desiredStatus, input.resolution],
        );
        await recordModerationAction(
          {
            actorId: admin.id,
            actorRole: 'admin',
            action: desiredStatus === 'suspended' ? 'suspended' : 'requested_evidence',
            entityType: 'listing',
            entityId: report.listing_id,
            fromStatus: listing.status,
            toStatus: desiredStatus,
            reasonCode: 'policy_violation',
            reasonNote: input.resolution,
          },
          tx.query.bind(tx) as never,
        );
        await notify(
          {
            userId: listing.seller_id,
            type: 'listing_status_changed',
            title: 'Your listing was updated by moderation',
            body: `A moderator changed the status of your listing to "${desiredStatus}" while reviewing a report. Reason: ${input.resolution}`,
            linkUrl: `/dashboard/listings/${report.listing_id}`,
            entityType: 'listing',
            entityId: report.listing_id,
            email: true,
          },
          tx.query.bind(tx) as never,
        );
      }
    }
  });

  if (report.reporter_id) {
    await notify({
      userId: report.reporter_id,
      type: 'report_status_changed',
      title: `Report ${input.status}`,
      body: `Your report was reviewed: ${input.resolution}`,
      linkUrl: `/dashboard/reports/${id}`,
      entityType: 'report',
      entityId: id,
      email: true,
    });
  }
  await recordAudit({
    actorId: admin.id,
    actorRole: 'admin',
    action: 'report.resolved',
    entityType: 'report',
    entityId: id,
    metadata: { status: input.status, listingAction: input.listingAction },
  });

  return loadReport(id, { id: admin.id, isAdmin: true });
}

export async function addReportNote(
  actor: AuthenticatedUser,
  id: string,
  input: { body: string; visibility: 'moderator_note' | 'reporter_visible' },
): Promise<ReportDto> {
  const report = await queryOne<{ id: string; reporter_id: string | null }>('SELECT id, reporter_id FROM reports WHERE id = $1', [id]);
  if (!report) throw AppError.notFound('Report not found');
  const isAdmin = actor.role === 'admin';
  if (!isAdmin && report.reporter_id !== actor.id) {
    throw AppError.forbidden('You can only add information to your own report');
  }
  // Only moderators may post internal notes; a reporter adding context posts a
  // reporter-visible note.
  const visibility = isAdmin ? input.visibility : 'reporter_visible';
  await query(
    `INSERT INTO report_notes (report_id, author_id, author_role, body, visibility) VALUES ($1, $2, $3, $4, $5)`,
    [id, actor.id, isAdmin ? 'admin' : 'user', input.body, visibility],
  );
  if (isAdmin && report.reporter_id) {
    await notify({
      userId: report.reporter_id,
      type: 'report_status_changed',
      title: 'Update on your report',
      body: input.body.slice(0, 200),
      linkUrl: `/dashboard/reports/${id}`,
      entityType: 'report',
      entityId: id,
    });
  }
  return loadReport(id, { id: actor.id, isAdmin });
}

/* --------------------------------- Disputes -------------------------------- */

async function loadDispute(id: string, viewer: { id: string; isAdmin: boolean }): Promise<DisputeDto> {
  const row = await queryOne(
    `SELECT d.*, ob.full_name AS opened_by_name, cp.full_name AS counterparty_name, adm.full_name AS assigned_admin_name,
            t.reference AS transaction_reference, t.status AS transaction_status, l.title AS listing_title
       FROM disputes d
       JOIN users ob ON ob.id = d.opened_by
       JOIN users cp ON cp.id = d.counterparty_id
       JOIN transactions t ON t.id = d.transaction_id
       JOIN listings l ON l.id = t.listing_id
       LEFT JOIN users adm ON adm.id = d.assigned_admin_id
      WHERE d.id = $1`,
    [id],
  );
  if (!row) throw AppError.notFound('Dispute not found');

  const messages = await queryMany(
    `SELECT dm.*, u.full_name AS author_name, ma.mime_type AS attachment_mime
       FROM dispute_messages dm
       LEFT JOIN users u ON u.id = dm.author_id
       LEFT JOIN media_assets ma ON ma.id = dm.attachment_media_id
      WHERE dm.dispute_id = $1 AND ($2::boolean OR dm.visibility = 'participants')
      ORDER BY dm.created_at ASC`,
    [id, viewer.isAdmin],
  );
  return toDispute(row, messages.map((message) => toDisputeMessage(message)), viewer);
}

export async function openDispute(
  user: AuthenticatedUser,
  input: { transactionId: string; category: string; description: string; alsoReport?: boolean },
): Promise<DisputeDto> {
  const transaction = await queryOne<{ id: string; buyer_id: string; seller_id: string; reference: string; listing_id: string }>(
    'SELECT id, buyer_id, seller_id, reference, listing_id FROM transactions WHERE id = $1',
    [input.transactionId],
  );
  if (!transaction) throw AppError.notFound('Transaction not found');
  const isParty = transaction.buyer_id === user.id || transaction.seller_id === user.id;
  if (!isParty) throw AppError.forbidden('Only the buyer or the seller can open a dispute for this transaction');

  const existingOpen = await queryOne<{ id: string }>(
    `SELECT id FROM disputes WHERE transaction_id = $1 AND status NOT IN ('resolved', 'closed')`,
    [transaction.id],
  );
  if (existingOpen) throw AppError.conflict('An open dispute already exists for this transaction');

  const counterpartyId = transaction.buyer_id === user.id ? transaction.seller_id : transaction.buyer_id;

  const disputeId = await withTransaction(async (tx) => {
    const reference = await tx.queryOne<{ reference: string }>(`SELECT next_reference('DSP') AS reference`);
    if (!reference) throw AppError.internal('Could not allocate a dispute reference');
    const created = await tx.queryOne<{ id: string }>(
      `INSERT INTO disputes (reference, transaction_id, opened_by, counterparty_id, category, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [reference.reference, transaction.id, user.id, counterpartyId, input.category, input.description],
    );
    if (!created) throw AppError.internal('The dispute could not be created');
    await tx.query(
      `UPDATE transactions SET status = 'disputed', updated_at = now() WHERE id = $1 AND status <> 'disputed'`,
      [transaction.id],
    );
    await tx.query(
      `INSERT INTO transaction_status_history (transaction_id, from_status, to_status, actor_id, actor_role, note)
       VALUES ($1, (SELECT status FROM transactions WHERE id = $1), 'disputed', $2, 'user', $3)`,
      [transaction.id, user.id, `Dispute opened: ${input.category}`],
    );
    await tx.query(
      `INSERT INTO dispute_messages (dispute_id, author_id, author_role, body, visibility)
       VALUES ($1, $2, 'user', $3, 'participants')`,
      [created.id, user.id, input.description],
    );
    if (input.alsoReport) {
      const reportReference = await tx.queryOne<{ reference: string }>(`SELECT next_reference('RPT') AS reference`);
      if (reportReference) {
        await tx.query(
          `INSERT INTO reports (reference, reporter_id, category, description, listing_id, reported_user_id, transaction_id, priority)
           VALUES ($1, $2, 'fraudulent_seller', $3, $4, $5, $6, 'high')`,
          [
            reportReference.reference,
            user.id,
            `Dispute ${reference.reference}: ${input.description}`,
            transaction.listing_id,
            counterpartyId,
            transaction.id,
          ],
        );
      }
    }
    return created.id;
  });

  const admins = await queryMany<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' AND account_status = 'active'`);
  for (const admin of admins) {
    await notify({
      userId: admin.id,
      type: 'dispute_status_changed',
      title: 'Dispute opened',
      body: `${user.displayName} opened a dispute on transaction ${transaction.reference}.`,
      linkUrl: `/admin/disputes/${disputeId}`,
      entityType: 'dispute',
      entityId: disputeId,
    });
  }
  await notify({
    userId: counterpartyId,
    type: 'dispute_status_changed',
    title: 'A dispute was opened',
    body: `${user.displayName} opened a dispute on transaction ${transaction.reference}. You can respond in the dispute thread.`,
    linkUrl: `/dashboard/disputes/${disputeId}`,
    entityType: 'dispute',
    entityId: disputeId,
    email: true,
  });
  await recordAudit({
    actorId: user.id,
    actorRole: user.role,
    action: 'dispute.created',
    entityType: 'dispute',
    entityId: disputeId,
    metadata: { transactionId: transaction.id, category: input.category },
  });

  return loadDispute(disputeId, { id: user.id, isAdmin: user.role === 'admin' });
}

export async function listDisputes(
  viewer: AuthenticatedUser,
  options: { page: number; perPage: number; status?: string; category?: string; q?: string; mine?: boolean },
): Promise<Paginated<DisputeDto>> {
  const isAdmin = viewer.role === 'admin';
  const conditions: string[] = [];
  const values: unknown[] = [];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (isAdmin) conditions.push('true');
  else conditions.push(`(d.opened_by = ${param(viewer.id)} OR d.counterparty_id = ${param(viewer.id)})`);
  if (options.status) conditions.push(`d.status = ${param(options.status)}`);
  if (options.category) conditions.push(`d.category = ${param(options.category)}`);
  if (options.q) conditions.push(`(d.reference ILIKE ${param(`%${options.q}%`)} OR d.description ILIKE ${param(`%${options.q}%`)})`);

  // Count first so the aggregate query receives only the filter parameters.
  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM disputes d WHERE ${conditions.join(' AND ')}`,
    values,
  );
  const total = totalRow?.total ?? 0;

  const limit = param(options.perPage);
  const offset = param((options.page - 1) * options.perPage);
  const rows = await queryMany(
    `SELECT d.id FROM disputes d WHERE ${conditions.join(' AND ')} ORDER BY d.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  const data: DisputeDto[] = [];
  for (const row of rows) data.push(await loadDispute(String(row.id), { id: viewer.id, isAdmin }));

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

export async function getDispute(viewer: AuthenticatedUser, id: string): Promise<DisputeDto> {
  const row = await queryOne<{ opened_by: string; counterparty_id: string }>(
    'SELECT opened_by, counterparty_id FROM disputes WHERE id = $1',
    [id],
  );
  if (!row) throw AppError.notFound('Dispute not found');
  const isAdmin = viewer.role === 'admin';
  if (!isAdmin && row.opened_by !== viewer.id && row.counterparty_id !== viewer.id) {
    throw AppError.forbidden('You are not a party to this dispute');
  }
  return loadDispute(id, { id: viewer.id, isAdmin });
}

export async function postDisputeMessage(
  actor: AuthenticatedUser,
  id: string,
  input: { body: string; visibility: 'participants' | 'admins_only'; attachmentMediaId?: string },
): Promise<DisputeDto> {
  const dispute = await queryOne<{ opened_by: string; counterparty_id: string; status: string }>(
    'SELECT opened_by, counterparty_id, status FROM disputes WHERE id = $1',
    [id],
  );
  if (!dispute) throw AppError.notFound('Dispute not found');
  const isParty = actor.id === dispute.opened_by || actor.id === dispute.counterparty_id;
  const isAdmin = actor.role === 'admin';
  if (!isParty && !isAdmin) throw AppError.forbidden('You are not a party to this dispute');
  if (['resolved', 'closed'].includes(dispute.status) && !isAdmin) {
    throw AppError.forbidden('This dispute is closed. Contact support if you need it reopened.');
  }
  // Only moderators can post internal notes.
  const visibility = isAdmin ? input.visibility : 'participants';

  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO dispute_messages (dispute_id, author_id, author_role, body, visibility, attachment_media_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, actor.id, isAdmin ? 'admin' : 'user', input.body, visibility, input.attachmentMediaId ?? null],
    );
    await tx.query('UPDATE disputes SET updated_at = now() WHERE id = $1', [id]);
  });

  if (visibility === 'participants') {
    const recipients = [dispute.opened_by, dispute.counterparty_id].filter((userId) => userId !== actor.id);
    for (const userId of recipients) {
      await notify({
        userId,
        type: 'dispute_status_changed',
        title: 'New message in your dispute',
        body: `${actor.displayName}: ${input.body.slice(0, 160)}`,
        linkUrl: `/dashboard/disputes/${id}`,
        entityType: 'dispute',
        entityId: id,
      });
    }
  }
  await recordAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'dispute.message_posted',
    entityType: 'dispute',
    entityId: id,
    metadata: { visibility },
  });

  return loadDispute(id, { id: actor.id, isAdmin });
}

export async function updateDispute(
  admin: AuthenticatedUser,
  id: string,
  input: { status: string; resolution?: string; assignedToMe?: boolean },
): Promise<DisputeDto> {
  const dispute = await queryOne<{ status: string; transaction_id: string; opened_by: string; counterparty_id: string; reference: string }>(
    'SELECT status, transaction_id, opened_by, counterparty_id, reference FROM disputes WHERE id = $1',
    [id],
  );
  if (!dispute) throw AppError.notFound('Dispute not found');
  if (!canTransitionDispute(dispute.status as never, input.status as never)) {
    throw AppError.invalidTransition(`A dispute in status "${dispute.status}" cannot be moved to "${input.status}"`);
  }
  if (['resolved', 'closed'].includes(input.status) && (!input.resolution || input.resolution.trim().length < 10)) {
    throw AppError.validation('Record how the dispute was resolved', [{ path: 'resolution', message: 'A resolution summary is required' }]);
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE disputes SET status = $2, resolution = COALESCE($3, resolution), updated_at = now(),
              resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN now() ELSE resolved_at END,
              closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END,
              resolved_by = CASE WHEN $2 IN ('resolved','closed') THEN $4::uuid ELSE resolved_by END,
              assigned_admin_id = CASE WHEN $5::boolean THEN $4::uuid ELSE COALESCE(assigned_admin_id, $4::uuid) END
        WHERE id = $1`,
      [id, input.status, input.resolution ?? null, admin.id, input.assignedToMe === true],
    );
    if (input.resolution) {
      await tx.query(
        `INSERT INTO dispute_messages (dispute_id, author_id, author_role, body, visibility)
         VALUES ($1, $2, 'admin', $3, 'participants')`,
        [id, admin.id, `Moderator update (${input.status}): ${input.resolution}`],
      );
    }
    await tx.query('UPDATE transactions SET updated_at = now() WHERE id = $1', [dispute.transaction_id]);
    if (input.status === 'closed' || input.status === 'resolved') {
      await tx.query('UPDATE listings SET availability = availability WHERE id = (SELECT listing_id FROM transactions WHERE id = $1)', [dispute.transaction_id]);
    }
    await recordModerationAction(
      {
        actorId: admin.id,
        actorRole: 'admin',
        action: 'dispute_status_changed',
        entityType: 'dispute',
        entityId: id,
        fromStatus: dispute.status,
        toStatus: input.status,
        reasonNote: input.resolution ?? null,
      },
      tx.query.bind(tx) as never,
    );
  });

  for (const userId of [dispute.opened_by, dispute.counterparty_id]) {
    await notify({
      userId,
      type: 'dispute_status_changed',
      title: `Dispute ${input.status}`,
      body: input.resolution ?? `The dispute status changed to ${input.status}.`,
      linkUrl: `/dashboard/disputes/${id}`,
      entityType: 'dispute',
      entityId: id,
      email: true,
    });
  }
  await recordAudit({
    actorId: admin.id,
    actorRole: 'admin',
    action: 'dispute.updated',
    entityType: 'dispute',
    entityId: id,
    metadata: { status: input.status },
  });

  return loadDispute(id, { id: admin.id, isAdmin: true });
}

export async function trustSummaryForUser(userId: string): Promise<{ openReports: number; openDisputes: number }> {
  const row = await queryOne<{ open_reports: number; open_disputes: number }>(
    `SELECT
       (SELECT count(*)::int FROM reports WHERE reporter_id = $1 AND status NOT IN ('resolved','dismissed')) AS open_reports,
       (SELECT count(*)::int FROM disputes WHERE (opened_by = $1 OR counterparty_id = $1) AND status NOT IN ('resolved','closed')) AS open_disputes`,
    [userId],
  );
  return { openReports: row?.open_reports ?? 0, openDisputes: row?.open_disputes ?? 0 };
}

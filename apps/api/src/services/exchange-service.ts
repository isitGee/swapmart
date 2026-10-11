import type { ExchangeRequestDto, Paginated } from '@swapmart/shared';
import { canTransitionExchange, canTransitionTransaction } from '@swapmart/shared';
import { logger } from '../config/logger.ts';
import { query, queryMany, queryOne, withTransaction, type Tx } from '../db/pool.ts';
import { recordAudit } from '../lib/audit.ts';
import { AppError } from '../lib/errors.ts';
import { notify } from './notifications.ts';
import { toExchange } from './serializers.ts';
import { createTransactionRecord } from './transaction-service.ts';
import type { AuthenticatedUser } from '../types/express.d.ts';

/**
 * Exchange requests.
 *
 * Proposal → accepted | rejected | countered | cancelled | expired. Every
 * transition is validated against the shared state machine before the row is
 * updated, and only the recipient may accept/reject/counter while only the
 * requester or recipient may cancel. Accepting an exchange does not move money:
 * it reserves both listings and opens a transaction record in `initiated`
 * state (SWAPMART processes no payments) for the parties to coordinate.
 */
async function loadExchange(id: string): Promise<Record<string, unknown>> {
  const row = await queryOne(
    `SELECT er.*, rp.display_name AS requester_name, rcp.display_name AS recipient_name,
            l.title AS listing_title, l.slug AS listing_slug, l.asking_price_tzs AS listing_price,
            l.availability AS listing_availability, li.url AS listing_image_url,
            ol.title AS offered_listing_title, ol.slug AS offered_listing_slug,
            ol.asking_price_tzs AS offered_listing_price, ol.availability AS offered_listing_availability,
            oli.url AS offered_listing_image_url,
            (SELECT id FROM exchange_requests child WHERE child.parent_request_id = er.id ORDER BY created_at DESC LIMIT 1) AS child_request_id
       FROM exchange_requests er
       JOIN users req ON req.id = er.requester_id
       LEFT JOIN user_profiles rp ON rp.user_id = er.requester_id
       JOIN users rec ON rec.id = er.recipient_id
       LEFT JOIN user_profiles rcp ON rcp.user_id = er.recipient_id
       JOIN listings l ON l.id = er.listing_id
       LEFT JOIN LATERAL (
         SELECT li.media_asset_id FROM listing_images li WHERE li.listing_id = l.id ORDER BY position ASC LIMIT 1
       ) li0 ON true
       LEFT JOIN media_assets li ON li.id = li0.media_asset_id
       LEFT JOIN listings ol ON ol.id = er.offered_listing_id
       LEFT JOIN LATERAL (
         SELECT li.media_asset_id FROM listing_images li WHERE li.listing_id = ol.id ORDER BY position ASC LIMIT 1
       ) oli0 ON true
       LEFT JOIN media_assets oli ON oli.id = oli0.media_asset_id
      WHERE er.id = $1`,
    [id],
  );
  if (!row) throw AppError.notFound('Exchange request not found');
  return row;
}

function availableActionsFor(row: Record<string, unknown>, viewerId: string): ExchangeRequestDto['availableActions'] {
  const status = String(row.status);
  const isRecipient = String(row.recipient_id) === viewerId;
  const isRequester = String(row.requester_id) === viewerId;
  const actions: ExchangeRequestDto['availableActions'] = [];
  if (status === 'pending' && isRecipient) actions.push('accept', 'reject', 'counter');
  if (status === 'pending' && (isRequester || isRecipient)) actions.push('cancel');
  if (status === 'accepted' && (isRequester || isRecipient)) actions.push('complete', 'cancel');
  return actions;
}

export async function createExchangeRequest(
  user: AuthenticatedUser,
  input: { listingId: string; offeredListingId: string; message: string; priceDifferenceTzs: number; expiresAt?: Date },
): Promise<ExchangeRequestDto> {
  const target = await queryOne<{ id: string; seller_id: string; status: string; availability: string; exchange_allowed: boolean; title: string }>(
    'SELECT id, seller_id, status, availability, exchange_allowed, title FROM listings WHERE id = $1 AND deleted_at IS NULL',
    [input.listingId],
  );
  if (!target) throw AppError.notFound('The listing you want to exchange for was not found');
  const offered = await queryOne<{ id: string; seller_id: string; status: string; availability: string; title: string }>(
    'SELECT id, seller_id, status, availability, title FROM listings WHERE id = $1 AND deleted_at IS NULL',
    [input.offeredListingId],
  );
  if (!offered) throw AppError.notFound('The listing you are offering was not found');

  if (target.seller_id === user.id) throw AppError.conflict('You cannot propose an exchange for your own listing');
  if (offered.seller_id !== user.id) throw AppError.forbidden('You can only offer a device that you listed');
  if (!target.exchange_allowed) throw AppError.conflict('The seller has disabled exchange proposals for this listing');
  if (target.status !== 'approved' || target.availability === 'inactive') {
    throw AppError.conflict('This listing is not available for exchange');
  }
  if (offered.status !== 'approved' || offered.availability !== 'available') {
    throw AppError.conflict('The device you are offering must be a published, available listing of your own');
  }

  const created = await withTransaction(async (tx) => {
    const row = await tx.queryOne<{ id: string }>(
      `INSERT INTO exchange_requests (listing_id, offered_listing_id, requester_id, recipient_id, message, price_difference_tzs, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        target.id,
        offered.id,
        user.id,
        target.seller_id,
        input.message,
        input.priceDifferenceTzs,
        input.expiresAt ?? new Date(Date.now() + 14 * 86_400_000),
      ],
    );
    if (!row) throw AppError.internal('The exchange request could not be created');
    return row.id;
  });

  await notify({
    userId: target.seller_id,
    type: 'exchange_proposed',
    title: 'New exchange proposal',
    body: `${user.displayName} proposed an exchange for ${target.title}.`,
    linkUrl: `/dashboard/exchanges/${created}`,
    entityType: 'exchange_request',
    entityId: created,
    email: true,
  });
  await recordAudit({
    actorId: user.id,
    actorRole: user.role,
    action: 'exchange.created',
    entityType: 'exchange_request',
    entityId: created,
    metadata: { listingId: target.id, offeredListingId: offered.id, priceDifferenceTzs: input.priceDifferenceTzs },
  });

  const row = await loadExchange(created);
  return toExchange(row, user.id, availableActionsFor(row, user.id));
}

export async function listExchangeRequests(
  user: AuthenticatedUser,
  options: { page: number; perPage: number; role: 'all' | 'incoming' | 'outgoing'; status?: string },
): Promise<Paginated<ExchangeRequestDto>> {
  const conditions = ['(er.requester_id = $1 OR er.recipient_id = $1)'];
  const values: unknown[] = [user.id];
  if (options.role === 'incoming') conditions.push('er.recipient_id = $1');
  if (options.role === 'outgoing') conditions.push('er.requester_id = $1');
  if (options.status === 'open') {
    conditions.push(`er.status IN ('pending', 'accepted', 'countered')`);
  } else if (options.status) {
    values.push(options.status);
    conditions.push(`er.status = $${values.length}`);
  }
  const limit = options.perPage;
  const offset = (options.page - 1) * options.perPage;

  const rows = await queryMany(
    `SELECT er.id FROM exchange_requests er WHERE ${conditions.join(' AND ')}
      ORDER BY er.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM exchange_requests er WHERE ${conditions.join(' AND ')}`,
    values,
  );
  const ids = rows.map((row) => String(row.id));
  const full = ids.length
    ? await queryMany(
        `SELECT er.*, rp.display_name AS requester_name, rcp.display_name AS recipient_name,
                l.title AS listing_title, l.slug AS listing_slug, l.asking_price_tzs AS listing_price,
                l.availability AS listing_availability, li.url AS listing_image_url,
                ol.title AS offered_listing_title, ol.slug AS offered_listing_slug,
                ol.asking_price_tzs AS offered_listing_price, ol.availability AS offered_listing_availability,
                oli.url AS offered_listing_image_url, NULL AS child_request_id
           FROM exchange_requests er
           JOIN users req ON req.id = er.requester_id
           LEFT JOIN user_profiles rp ON rp.user_id = er.requester_id
           JOIN users rec ON rec.id = er.recipient_id
           LEFT JOIN user_profiles rcp ON rcp.user_id = er.recipient_id
           JOIN listings l ON l.id = er.listing_id
           LEFT JOIN LATERAL (SELECT li.media_asset_id FROM listing_images li WHERE li.listing_id = l.id ORDER BY position ASC LIMIT 1) li0 ON true
           LEFT JOIN media_assets li ON li.id = li0.media_asset_id
           LEFT JOIN listings ol ON ol.id = er.offered_listing_id
           LEFT JOIN LATERAL (SELECT li.media_asset_id FROM listing_images li WHERE li.listing_id = ol.id ORDER BY position ASC LIMIT 1) oli0 ON true
           LEFT JOIN media_assets oli ON oli.id = oli0.media_asset_id
          WHERE er.id = ANY($1::uuid[])
          ORDER BY er.created_at DESC`,
        [ids],
      )
    : [];

  const total = totalRow?.total ?? 0;
  return {
    data: full.map((row) => toExchange(row, user.id, availableActionsFor(row, user.id))),
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

export async function getExchangeRequest(user: AuthenticatedUser, id: string): Promise<ExchangeRequestDto> {
  const row = await loadExchange(id);
  if (String(row.requester_id) !== user.id && String(row.recipient_id) !== user.id && user.role !== 'admin') {
    throw AppError.forbidden('You are not a party to this exchange request');
  }
  return toExchange(row, user.id, availableActionsFor(row, user.id));
}

export async function respondToExchange(
  user: AuthenticatedUser,
  id: string,
  input: { action: 'accept' | 'reject' | 'counter' | 'cancel' | 'complete'; message?: string; counterPriceDifferenceTzs?: number },
): Promise<ExchangeRequestDto> {
  const row = await loadExchange(id);
  const isRequester = String(row.requester_id) === user.id;
  const isRecipient = String(row.recipient_id) === user.id;
  if (!isRequester && !isRecipient && user.role !== 'admin') {
    throw AppError.forbidden('You are not a party to this exchange request');
  }
  const status = String(row.status);
  const targetStatus =
    input.action === 'accept' ? 'accepted' : input.action === 'reject' ? 'rejected' : input.action === 'counter' ? 'countered' : input.action === 'cancel' ? 'cancelled' : 'completed';

  if (input.action !== 'cancel' && input.action !== 'complete' && !isRecipient) {
    throw AppError.forbidden('Only the recipient of the proposal can accept, reject or counter it');
  }
  if (input.action === 'cancel' && !['pending', 'accepted', 'countered'].includes(status)) {
    throw AppError.invalidTransition('Only a pending or accepted proposal can be cancelled');
  }
  if (!canTransitionExchange(status as never, targetStatus as never)) {
    throw AppError.invalidTransition(`An exchange request in status "${status}" cannot be moved to "${targetStatus}"`);
  }
  if (input.action === 'counter' && input.counterPriceDifferenceTzs === undefined) {
    throw AppError.validation('Provide the counter price difference', [{ path: 'counterPriceDifferenceTzs', message: 'Required for a counter-proposal' }]);
  }
  if (input.action === 'complete' && status !== 'accepted') {
    throw AppError.invalidTransition('Only an accepted exchange can be marked complete');
  }

  await withTransaction(async (tx) => {
    if (input.action === 'counter') {
      await tx.query(`UPDATE exchange_requests SET status = 'countered', responded_at = now(), updated_at = now() WHERE id = $1`, [id]);
      const counter = await tx.queryOne<{ id: string }>(
        `INSERT INTO exchange_requests (listing_id, offered_listing_id, requester_id, recipient_id, parent_request_id, message,
                                        price_difference_tzs, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '14 days') RETURNING id`,
        [
          row.listing_id,
          row.offered_listing_id,
          row.recipient_id,
          row.requester_id,
          id,
          input.message?.trim() || 'Counter-proposal',
          input.counterPriceDifferenceTzs ?? 0,
        ],
      );
      if (counter) {
        await notifyExchangeCountered(tx, row, counter.id, user.id);
      }
      return;
    }

    await tx.query(
      `UPDATE exchange_requests SET status = $2, responded_at = now(), updated_at = now() WHERE id = $1`,
      [id, targetStatus],
    );

    if (input.action === 'accept') {
      // Reserve both devices while the parties coordinate the handover.
      await tx.query(
        `UPDATE listings SET availability = 'reserved', updated_at = now()
          WHERE id = ANY($1::uuid[]) AND status = 'approved' AND availability = 'available'`,
        [[row.listing_id, row.offered_listing_id].filter(Boolean)],
      );
      const transaction = await createTransactionRecord(tx, {
        type: 'exchange',
        listingId: String(row.listing_id),
        sellerId: String(row.recipient_id),
        buyerId: String(row.requester_id),
        exchangeRequestId: id,
        offeredListingId: row.offered_listing_id ? String(row.offered_listing_id) : null,
        agreedAmountTzs: Number(row.price_difference_tzs ?? 0),
        createdBy: user.id,
        note: 'Exchange proposal accepted. SWAPMART does not process or verify payments: agree the handover and any top-up directly, then mark the transaction completed.',
      });
      await tx.query('UPDATE exchange_requests SET transaction_id = $2 WHERE id = $1', [id, transaction.id]);
      if (row.offered_listing_id) {
        await tx.query('UPDATE exchange_requests SET transaction_id = $2 WHERE id = $1', [row.offered_listing_id, transaction.id]);
      }
    }

    if (input.action === 'complete') {
      await tx.query(
        `UPDATE listings SET availability = 'sold', updated_at = now() WHERE id = ANY($1::uuid[])`,
        [[row.listing_id, row.offered_listing_id].filter(Boolean)],
      );
      if (row.transaction_id) {
        // Confirming the exchange *is* the parties' agreement, so the history
        // trail is written honestly: the real current status is read first and
        // the agreement is recorded before the completion, never fabricated.
        const previous = await tx.queryOne<{ status: string }>(
          'SELECT status FROM transactions WHERE id = $1 FOR UPDATE',
          [row.transaction_id],
        );
        const previousStatus = String(previous?.status ?? 'initiated');
        if (previousStatus !== 'completed') {
          if (previousStatus !== 'agreed') {
            if (!canTransitionTransaction(previousStatus as never, 'agreed')) {
              throw AppError.invalidTransition(
                `This exchange's transaction is "${previousStatus}" and can no longer be completed`,
              );
            }
            await tx.query(`UPDATE transactions SET status = 'agreed', updated_at = now() WHERE id = $1`, [row.transaction_id]);
            // The timestamps are explicit and ordered: `now()` is the transaction
            // timestamp, so two rows written in one transaction would otherwise
            // share a timestamp and the trail could be read out of order.
            await tx.query(
              `INSERT INTO transaction_status_history (transaction_id, from_status, to_status, actor_id, actor_role, note, created_at)
               VALUES ($1, $2, 'agreed', $3, 'user', 'Exchange confirmed by a party; recorded as agreed before completion', now())`,
              [row.transaction_id, previousStatus, user.id],
            );
          }
          await tx.query(
            `UPDATE transactions SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = $1`,
            [row.transaction_id],
          );
          await tx.query(
            `INSERT INTO transaction_status_history (transaction_id, from_status, to_status, actor_id, actor_role, note, created_at)
             VALUES ($1, 'agreed', 'completed', $2, 'user', 'Exchange completed and confirmed by a party', now() + interval '1 millisecond')`,
            [row.transaction_id, user.id],
          );
        }
      }
    }

    if (input.action === 'reject' || input.action === 'cancel') {
      // A rejected or cancelled proposal releases any reservation it created.
      if (status === 'accepted') {
        await tx.query(
          `UPDATE listings SET availability = 'available', updated_at = now()
            WHERE id = ANY($1::uuid[]) AND status = 'approved' AND availability = 'reserved'`,
          [[row.listing_id, row.offered_listing_id].filter(Boolean)],
        );
      }
    }
  });

  const counterpartId = isRequester ? String(row.recipient_id) : String(row.requester_id);
  const notificationType =
    input.action === 'accept'
      ? 'exchange_accepted'
      : input.action === 'reject'
        ? 'exchange_rejected'
        : input.action === 'cancel'
          ? 'exchange_cancelled'
          : 'transaction_status_changed';
  await notify({
    userId: counterpartId,
    type: notificationType,
    title: `Exchange ${targetStatus}`,
    body: `${user.displayName} ${input.action === 'accept' ? 'accepted' : input.action === 'complete' ? 'completed' : input.action === 'cancel' ? 'cancelled' : 'rejected'} the exchange proposal for ${String(row.listing_title)}.${input.message ? ` Message: ${input.message}` : ''}`,
    linkUrl: `/dashboard/exchanges/${id}`,
    entityType: 'exchange_request',
    entityId: id,
    email: true,
  });
  await recordAudit({
    actorId: user.id,
    actorRole: user.role,
    action: `exchange.${input.action}`,
    entityType: 'exchange_request',
    entityId: id,
    metadata: { from: status, to: targetStatus, priceDifferenceTzs: input.counterPriceDifferenceTzs ?? null },
  });

  const updated = await loadExchange(id);
  return toExchange(updated, user.id, availableActionsFor(updated, user.id));
}

async function notifyExchangeCountered(
  tx: Tx,
  row: Record<string, unknown>,
  counterId: string,
  actorId: string,
): Promise<void> {
  try {
    await notify(
      {
        userId: String(row.requester_id),
        type: 'exchange_countered',
        title: 'Exchange counter-proposal received',
        body: 'The other party sent a counter-proposal. Review it and respond.',
        linkUrl: `/dashboard/exchanges/${counterId}`,
        entityType: 'exchange_request',
        entityId: counterId,
        email: true,
      },
      tx.query.bind(tx) as never,
    );
  } catch (error) {
    // A notification failure must not roll back the counter-proposal itself.
    logger.error({ err: error, counterId, actorId }, 'failed to notify about counter-proposal');
  }
}

/** Expires proposals whose window has passed. Used on read and by the CLI. */
export async function expireStaleExchangeRequests(): Promise<number> {
  const result = await query(
    `UPDATE exchange_requests SET status = 'expired', updated_at = now()
      WHERE status IN ('pending', 'countered') AND expires_at IS NOT NULL AND expires_at < now()`,
  );
  return result.rowCount ?? 0;
}

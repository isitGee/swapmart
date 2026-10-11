import type { Paginated, TransactionDto } from '@swapmart/shared';
import { canTransitionTransaction } from '@swapmart/shared';
import { query, queryMany, queryOne, withTransaction, type Tx } from '../db/pool.ts';
import { recordAudit } from '../lib/audit.ts';
import { AppError } from '../lib/errors.ts';
import { notify } from './notifications.ts';
import { toHistoryEntry, toTransaction } from './serializers.ts';
import type { AuthenticatedUser } from '../types/express.d.ts';

/**
 * Transaction coordination.
 *
 * A transaction records that two parties agreed (or are negotiating) a purchase
 * or exchange. It is explicitly NOT a payment record: SWAPMART does not process,
 * hold or verify money in this version, and every response carries that
 * disclaimer so no screen can imply a payment was made.
 *
 * Status changes are restricted to the two parties (or an administrator acting
 * on a dispute) and every change appends to `transaction_status_history` with
 * the actor, reason and timestamp.
 */
export interface CreateTransactionInput {
  type: 'purchase' | 'exchange';
  listingId: string;
  sellerId: string;
  buyerId: string;
  exchangeRequestId?: string | null;
  offeredListingId?: string | null;
  agreedAmountTzs?: number | null;
  note?: string | null;
  createdBy: string;
}

/** Creates the transaction row plus its first history entry inside a transaction. */
export async function createTransactionRecord(tx: Tx, input: CreateTransactionInput): Promise<{ id: string; reference: string }> {
  const referenceRow = await tx.queryOne<{ reference: string }>(`SELECT next_reference('TXN') AS reference`);
  if (!referenceRow) throw AppError.internal('Could not allocate a transaction reference');

  const created = await tx.queryOne<{ id: string; reference: string }>(
    `INSERT INTO transactions (reference, type, status, listing_id, seller_id, buyer_id, exchange_request_id,
                               offered_listing_id, agreed_amount_tzs, settlement_note, created_by)
     VALUES ($1, $2, 'initiated', $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, reference`,
    [
      referenceRow.reference,
      input.type,
      input.listingId,
      input.sellerId,
      input.buyerId,
      input.exchangeRequestId ?? null,
      input.offeredListingId ?? null,
      input.agreedAmountTzs ?? null,
      input.note ?? null,
      input.createdBy,
    ],
  );
  if (!created) throw AppError.internal('The transaction could not be created');

  await tx.query(
    `INSERT INTO transaction_status_history (transaction_id, from_status, to_status, actor_id, actor_role, note)
     VALUES ($1, NULL, 'initiated', $2, 'user', $3)`,
    [created.id, input.createdBy, input.note ?? 'Transaction record created'],
  );
  return created;
}

async function loadTransaction(id: string): Promise<Record<string, unknown>> {
  const row = await queryOne(
    `SELECT t.*, b.full_name AS buyer_name, s.full_name AS seller_name,
            l.title AS listing_title, l.slug AS listing_slug, img.url AS listing_image_url,
            (SELECT id FROM disputes d WHERE d.transaction_id = t.id AND d.status NOT IN ('resolved', 'closed') ORDER BY created_at DESC LIMIT 1) AS open_dispute_id
       FROM transactions t
       JOIN users b ON b.id = t.buyer_id
       JOIN users s ON s.id = t.seller_id
       JOIN listings l ON l.id = t.listing_id
       LEFT JOIN LATERAL (SELECT li.media_asset_id FROM listing_images li WHERE li.listing_id = l.id ORDER BY position ASC LIMIT 1) li0 ON true
       LEFT JOIN media_assets img ON img.id = li0.media_asset_id
      WHERE t.id = $1`,
    [id],
  );
  if (!row) throw AppError.notFound('Transaction not found');
  return row;
}

function ensureParty(row: Record<string, unknown>, user: AuthenticatedUser): boolean {
  const isParty = String(row.buyer_id) === user.id || String(row.seller_id) === user.id;
  if (!isParty && user.role !== 'admin') {
    throw AppError.forbidden('Only the buyer, the seller or an administrator can access this transaction');
  }
  return isParty;
}

export async function listTransactions(
  user: AuthenticatedUser,
  options: { page: number; perPage: number; status?: string; type?: string; role: 'all' | 'buyer' | 'seller' },
): Promise<Paginated<TransactionDto>> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (user.role === 'admin' && options.role === 'all' && !options.status && !options.type) {
    conditions.push('true');
  }
  const buyerIndex = param(user.id);
  const sellerIndex = param(user.id);
  if (options.role === 'buyer') conditions.push(`t.buyer_id = ${buyerIndex}`);
  else if (options.role === 'seller') conditions.push(`t.seller_id = ${sellerIndex}`);
  else conditions.push(`(t.buyer_id = ${buyerIndex} OR t.seller_id = ${sellerIndex})`);

  if (options.status) conditions.push(`t.status = ${param(options.status)}`);
  if (options.type) conditions.push(`t.type = ${param(options.type)}`);

  const filterValues = [...values];
  const limit = param(options.perPage);
  const offset = param((options.page - 1) * options.perPage);

  const rows = await queryMany(
    `SELECT t.id FROM transactions t WHERE ${conditions.join(' AND ')} ORDER BY t.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM transactions t WHERE ${conditions.join(' AND ')}`,
    filterValues,
  );
  const total = totalRow?.total ?? 0;

  const ids = rows.map((row) => String(row.id));
  const transactions: TransactionDto[] = [];
  for (const id of ids) {
    const row = await loadTransaction(id);
    const history = await queryMany(
      `SELECT h.*, u.full_name AS actor_name FROM transaction_status_history h
         LEFT JOIN users u ON u.id = h.actor_id WHERE h.transaction_id = $1 ORDER BY h.created_at ASC`,
      [id],
    );
    transactions.push(
      toTransaction(
        row,
        user.id,
        history.map((entry) => toHistoryEntry(entry)),
        allowedStatuses(row, user),
      ),
    );
  }

  return {
    data: transactions,
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

function allowedStatuses(row: Record<string, unknown>, user: AuthenticatedUser): TransactionDto['availableStatuses'] {
  const from = String(row.status);
  const isParty = String(row.buyer_id) === user.id || String(row.seller_id) === user.id;
  if (!isParty && user.role !== 'admin') return [];
  // `completed` and `cancelled` are set by the flow that proves them (handover
  // confirmation or cancellation) rather than being freely selectable.
  const candidates: TransactionDto['availableStatuses'] = ['negotiating', 'agreed', 'cancelled', 'disputed'];
  if (from === 'agreed') candidates.push('completed');
  return candidates.filter((status) => canTransitionTransaction(from as never, status));
}

export async function getTransaction(user: AuthenticatedUser, id: string): Promise<TransactionDto> {
  const row = await loadTransaction(id);
  ensureParty(row, user);
  const history = await queryMany(
    `SELECT h.*, u.full_name AS actor_name FROM transaction_status_history h
       LEFT JOIN users u ON u.id = h.actor_id WHERE h.transaction_id = $1 ORDER BY h.created_at ASC`,
    [id],
  );
  return toTransaction(row, user.id, history.map((entry) => toHistoryEntry(entry)), allowedStatuses(row, user));
}

export async function updateTransactionStatus(
  user: AuthenticatedUser,
  id: string,
  input: { status: string; note?: string },
): Promise<TransactionDto> {
  const row = await loadTransaction(id);
  const isParty = ensureParty(row, user);
  const from = String(row.status);
  if (!canTransitionTransaction(from as never, input.status as never)) {
    throw AppError.invalidTransition(`A transaction cannot move from "${from}" to "${input.status}"`);
  }
  if (input.status === 'completed' && !isParty && user.role !== 'admin') {
    throw AppError.forbidden('Only the buyer, the seller or an administrator can complete a transaction');
  }
  if (from === 'completed' && input.status !== 'disputed') {
    throw AppError.invalidTransition('A completed transaction can only be reopened as disputed');
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE transactions SET status = $2, updated_at = now(),
              completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END,
              cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END,
              cancel_reason = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancel_reason END
        WHERE id = $1`,
      [id, input.status, input.note ?? null],
    );
    await tx.query(
      `INSERT INTO transaction_status_history (transaction_id, from_status, to_status, actor_id, actor_role, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, from, input.status, user.id, user.role === 'admin' ? 'admin' : 'user', input.note ?? null],
    );
    if (input.status === 'completed') {
      await tx.query(`UPDATE listings SET availability = 'sold', updated_at = now() WHERE id = $1`, [row.listing_id]);
    }
    if (input.status === 'cancelled') {
      await tx.query(
        `UPDATE listings SET availability = 'available', updated_at = now()
          WHERE id = ANY($1::uuid[]) AND availability = 'reserved'`,
        [[row.listing_id, row.offered_listing_id].filter(Boolean)],
      );
    }
    if (input.status === 'disputed') {
      await tx.query(`UPDATE listings SET availability = 'reserved', updated_at = now() WHERE id = $1 AND status = 'approved'`, [row.listing_id]);
    }
  });

  const counterpartId = String(row.buyer_id) === user.id ? String(row.seller_id) : String(row.buyer_id);
  await notify({
    userId: counterpartId,
    type: 'transaction_status_changed',
    title: 'Transaction updated',
    body: `${user.displayName} moved transaction ${String(row.reference)} to "${input.status}".${input.note ? ` Note: ${input.note}` : ''}`,
    linkUrl: `/dashboard/transactions/${id}`,
    entityType: 'transaction',
    entityId: id,
    email: true,
  });
  await recordAudit({
    actorId: user.id,
    actorRole: user.role,
    action: 'transaction.status_changed',
    entityType: 'transaction',
    entityId: id,
    metadata: { from, to: input.status, note: input.note ?? null },
  });

  return getTransaction(user, id);
}

/** Buyer-initiated arrangement record for a listing (no payment is processed). */
export async function createPurchaseTransaction(
  user: AuthenticatedUser,
  input: { listingId: string; agreedAmountTzs?: number; note?: string },
): Promise<TransactionDto> {
  const listing = await queryOne<{ id: string; seller_id: string; status: string; availability: string; asking_price_tzs: number; title: string }>(
    'SELECT id, seller_id, status, availability, asking_price_tzs, title FROM listings WHERE id = $1 AND deleted_at IS NULL',
    [input.listingId],
  );
  if (!listing) throw AppError.notFound('Listing not found');
  if (listing.seller_id === user.id) throw AppError.conflict('You cannot open a transaction for your own listing');
  if (listing.status !== 'approved' || listing.availability === 'inactive') {
    throw AppError.conflict('This listing is not available for a purchase arrangement');
  }
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM transactions WHERE listing_id = $1 AND buyer_id = $2 AND status NOT IN ('completed', 'cancelled')`,
    [listing.id, user.id],
  );
  if (existing) throw AppError.conflict('You already have an open transaction for this listing');

  const created = await withTransaction(async (tx) => {
    const transaction = await createTransactionRecord(tx, {
      type: 'purchase',
      listingId: listing.id,
      sellerId: listing.seller_id,
      buyerId: user.id,
      agreedAmountTzs: input.agreedAmountTzs ?? listing.asking_price_tzs,
      note:
        input.note ??
        'Buyer opened a transaction record to coordinate the sale. SWAPMART does not process payments: agree the price and handover directly.',
      createdBy: user.id,
    });
    await tx.query(`UPDATE listings SET availability = 'reserved', updated_at = now() WHERE id = $1 AND availability = 'available'`, [listing.id]);
    return transaction;
  });

  await notify({
    userId: listing.seller_id,
    type: 'transaction_status_changed',
    title: 'New transaction record',
    body: `${user.displayName} opened a transaction for ${listing.title}.`,
    linkUrl: `/dashboard/transactions/${created.id}`,
    entityType: 'transaction',
    entityId: created.id,
    email: true,
  });
  await recordAudit({
    actorId: user.id,
    actorRole: user.role,
    action: 'transaction.created',
    entityType: 'transaction',
    entityId: created.id,
    metadata: { listingId: listing.id, amount: input.agreedAmountTzs ?? listing.asking_price_tzs },
  });

  return getTransaction(user, created.id);
}

export async function transactionSummaryForUser(userId: string): Promise<{ active: number; disputed: number; completed: number }> {
  const row = await queryOne<{ active: number; disputed: number; completed: number }>(
    `SELECT
       count(*) FILTER (WHERE status IN ('initiated', 'negotiating', 'agreed'))::int AS active,
       count(*) FILTER (WHERE status = 'disputed')::int AS disputed,
       count(*) FILTER (WHERE status = 'completed')::int AS completed
       FROM transactions WHERE buyer_id = $1 OR seller_id = $1`,
    [userId],
  );
  return { active: row?.active ?? 0, disputed: row?.disputed ?? 0, completed: row?.completed ?? 0 };
}

export { query as rawQuery };

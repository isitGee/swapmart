import type { ConversationSummaryDto, ListingCommentDto, MessageDto, NotificationDto, Paginated, SavedListingDto } from '@swapmart/shared';
import { PAGINATION } from '@swapmart/shared';
import { query, queryMany, queryOne, withTransaction } from '../db/pool.ts';
import { recordAudit } from '../lib/audit.ts';
import { AppError } from '../lib/errors.ts';
import { LISTING_CARD_FROM, LISTING_CARD_SELECT, PUBLIC_LISTING_PREDICATE } from './listing-queries.ts';
import { notify } from './notifications.ts';
import { toComment, toConversation, toListingSummary, toMessage, toNotification } from './serializers.ts';
import type { AuthenticatedUser } from '../types/express.d.ts';

/**
 * Conversations, messages, listing questions, saved listings and notifications.
 *
 * Access control: every read and write resolves the caller's participation from
 * `conversation_participants` before touching a message. There is no code path
 * that returns messages for a conversation the caller is not part of. Messages
 * are stored in PostgreSQL, so they survive refreshes and new sign-ins.
 */

async function assertParticipant(conversationId: string, userId: string): Promise<{ role: string; status: string; listingId: string | null }> {
  const row = await queryOne<{ role: string; status: string; listing_id: string | null; is_muted: boolean }>(
    `SELECT cp.role, c.status, c.listing_id, cp.is_muted
       FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id
      WHERE cp.conversation_id = $1 AND cp.user_id = $2`,
    [conversationId, userId],
  );
  if (!row) throw AppError.forbidden('You are not a participant of this conversation');
  return { role: row.role, status: row.status, listingId: row.listing_id };
}

export async function startConversation(
  user: AuthenticatedUser,
  input: { listingId: string; message?: string },
): Promise<{ conversationId: string; created: boolean }> {
  const listing = await queryOne<{ id: string; seller_id: string; status: string; availability: string; title: string }>(
    'SELECT id, seller_id, status, availability, title FROM listings WHERE id = $1 AND deleted_at IS NULL',
    [input.listingId],
  );
  if (!listing) throw AppError.notFound('Listing not found');
  if (listing.seller_id === user.id) {
    throw AppError.conflict('This is your own listing. Buyers will contact you through their own inquiries.');
  }
  if (listing.status !== 'approved' || listing.availability === 'inactive') {
    throw AppError.conflict('This listing is not currently open for inquiries');
  }

  return withTransaction(async (tx) => {
    const existing = await tx.queryOne<{ id: string }>(
      `SELECT id FROM conversations WHERE kind = 'listing_inquiry' AND listing_id = $1 AND initiator_id = $2`,
      [listing.id, user.id],
    );
    if (existing) {
      if (input.message) {
        await insertMessage(tx, existing.id, user.id, input.message);
      }
      return { conversationId: existing.id, created: false };
    }
    const conversation = await tx.queryOne<{ id: string }>(
      `INSERT INTO conversations (kind, listing_id, initiator_id, subject)
       VALUES ('listing_inquiry', $1, $2, $3) RETURNING id`,
      [listing.id, user.id, `Inquiry: ${listing.title}`],
    );
    if (!conversation) throw AppError.internal('The conversation could not be created');
    await tx.query(
      `INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1, $2, 'buyer'), ($1, $3, 'seller')`,
      [conversation.id, user.id, listing.seller_id],
    );
    if (input.message) {
      await insertMessage(tx, conversation.id, user.id, input.message);
    }
    return { conversationId: conversation.id, created: true };
  });
}

async function insertMessage(
  tx: { query: (sql: string, params?: readonly unknown[]) => Promise<unknown> },
  conversationId: string,
  senderId: string | null,
  body: string,
  options: { isSystem?: boolean; notifyRecipient?: boolean } = {},
): Promise<void> {
  const trimmed = body.trim().slice(0, 4000);
  await tx.query(
    `INSERT INTO messages (conversation_id, sender_id, body, is_system) VALUES ($1, $2, $3, $4)`,
    [conversationId, senderId, trimmed, options.isSystem === true],
  );
  await tx.query(
    `UPDATE conversations SET last_message_at = now(), last_message_excerpt = $2, updated_at = now() WHERE id = $1`,
    [conversationId, trimmed.slice(0, 160)],
  );
}

export async function sendMessage(user: AuthenticatedUser, conversationId: string, body: string): Promise<MessageDto> {
  const participant = await assertParticipant(conversationId, user.id);
  if (participant.status === 'locked') {
    throw AppError.forbidden('This conversation has been locked by a moderator and can no longer receive messages');
  }
  const messageId = await withTransaction(async (tx) => {
    await insertMessage(tx, conversationId, user.id, body);
    const created = await tx.queryOne<{ id: string }>(
      'SELECT id FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
      [conversationId],
    );
    return created?.id ?? null;
  });
  if (!messageId) throw AppError.internal('The message could not be saved');

  const recipients = await queryMany<{ user_id: string }>(
    'SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id <> $2',
    [conversationId, user.id],
  );
  for (const recipient of recipients) {
    await notify({
      userId: recipient.user_id,
      type: 'new_message',
      title: 'New message',
      body: `${user.displayName}: ${body.slice(0, 120)}`,
      linkUrl: `/messages/${conversationId}`,
      entityType: 'conversation',
      entityId: conversationId,
    });
  }

  const row = await queryOne(
    `SELECT m.*, u.full_name AS sender_name, NULL::timestamptz AS read_at FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = $1`,
    [messageId],
  );
  return toMessage(row as Record<string, unknown>, user.id);
}

export async function listConversations(
  user: AuthenticatedUser,
  options: { page: number; perPage: number; filter: 'all' | 'unread' | 'buying' | 'selling' },
): Promise<Paginated<ConversationSummaryDto>> {
  const rows = await queryMany(
    `SELECT c.id, c.listing_id, c.status, c.created_at, c.updated_at, c.last_message_at,
            l.title AS listing_title, l.slug AS listing_slug, img.url AS listing_thumbnail_url,
            lm.body AS last_message_body, lm.sender_id AS last_message_sender_id,
            (SELECT count(*)::int FROM messages m2
              WHERE m2.conversation_id = c.id AND m2.sender_id <> $1 AND m2.state = 'visible'
                AND (cp.last_read_at IS NULL OR m2.created_at > cp.last_read_at)) AS unread_count
       FROM conversations c
       JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $1
       LEFT JOIN listings l ON l.id = c.listing_id
       LEFT JOIN LATERAL (
         SELECT li.media_asset_id FROM listing_images li WHERE li.listing_id = l.id ORDER BY li.position ASC LIMIT 1
       ) li0 ON true
       LEFT JOIN media_assets img ON img.id = li0.media_asset_id
       LEFT JOIN LATERAL (
         SELECT m.body, m.sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1
       ) lm ON true
      WHERE ($2::text = 'all'
             OR ($2 = 'unread' AND EXISTS (SELECT 1 FROM messages m3 WHERE m3.conversation_id = c.id AND m3.sender_id <> $1
                                            AND (cp.last_read_at IS NULL OR m3.created_at > cp.last_read_at)))
             OR ($2 = 'buying' AND cp.role = 'buyer')
             OR ($2 = 'selling' AND cp.role = 'seller'))
      ORDER BY coalesce(c.last_message_at, c.created_at) DESC
      LIMIT $3 OFFSET $4`,
    [user.id, options.filter, options.perPage, (options.page - 1) * options.perPage],
  );

  const conversationIds = rows.map((row) => String(row.id));
  const participants = conversationIds.length
    ? await queryMany<{
        conversation_id: string;
        user_id: string;
        role: string;
        last_read_at: Date | null;
        display_name: string | null;
        avatar_url: string | null;
        identity_reviewed_at: Date | null;
      }>(
        `SELECT cp.conversation_id, cp.user_id, cp.role, cp.last_read_at, p.display_name, ma.url AS avatar_url,
                u.identity_reviewed_at
           FROM conversation_participants cp
           LEFT JOIN users u ON u.id = cp.user_id
           LEFT JOIN user_profiles p ON p.user_id = cp.user_id
           LEFT JOIN media_assets ma ON ma.id = p.avatar_media_id
          WHERE cp.conversation_id = ANY($1::uuid[])`,
        [conversationIds],
      )
    : [];

  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM conversations c
       JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $1`,
    [user.id],
  );
  const total = totalRow?.total ?? 0;

  return {
    data: rows.map((row) =>
      toConversation(
        row,
        participants
          .filter((participant) => participant.conversation_id === String(row.id))
          .map((participant) => ({
            userId: String(participant.user_id),
            displayName: participant.display_name ?? 'SWAPMART member',
            role: participant.role as 'buyer' | 'seller',
            avatarUrl: participant.avatar_url,
            lastReadAt: participant.last_read_at ? participant.last_read_at.toISOString() : null,
            identityReviewed: participant.identity_reviewed_at !== null,
          })),
        user.id,
      ),
    ),
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

export async function getConversation(user: AuthenticatedUser, conversationId: string): Promise<ConversationSummaryDto> {
  await assertParticipant(conversationId, user.id);
  const row = await queryOne(
    `SELECT c.id, c.listing_id, c.status, c.created_at, c.updated_at, c.last_message_at,
            l.title AS listing_title, l.slug AS listing_slug, img.url AS listing_thumbnail_url,
            lm.body AS last_message_body, lm.sender_id AS last_message_sender_id, 0 AS unread_count
       FROM conversations c
       LEFT JOIN listings l ON l.id = c.listing_id
       LEFT JOIN LATERAL (
         SELECT li.media_asset_id FROM listing_images li WHERE li.listing_id = l.id ORDER BY li.position ASC LIMIT 1
       ) li0 ON true
       LEFT JOIN media_assets img ON img.id = li0.media_asset_id
       LEFT JOIN LATERAL (
         SELECT m.body, m.sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1
       ) lm ON true
      WHERE c.id = $1`,
    [conversationId],
  );
  if (!row) throw AppError.notFound('Conversation not found');
  const participants = await queryMany<{
    user_id: string;
    role: string;
    last_read_at: Date | null;
    display_name: string | null;
    avatar_url: string | null;
    identity_reviewed_at: Date | null;
  }>(
    `SELECT cp.user_id, cp.role, cp.last_read_at, p.display_name, ma.url AS avatar_url, u.identity_reviewed_at
       FROM conversation_participants cp
       LEFT JOIN users u ON u.id = cp.user_id
       LEFT JOIN user_profiles p ON p.user_id = cp.user_id
       LEFT JOIN media_assets ma ON ma.id = p.avatar_media_id
      WHERE cp.conversation_id = $1`,
    [conversationId],
  );
  return toConversation(
    row,
    participants.map((participant) => ({
      userId: String(participant.user_id),
      displayName: participant.display_name ?? 'SWAPMART member',
      role: participant.role as 'buyer' | 'seller',
      avatarUrl: participant.avatar_url,
      lastReadAt: participant.last_read_at ? participant.last_read_at.toISOString() : null,
      identityReviewed: participant.identity_reviewed_at !== null,
    })),
    user.id,
  );
}

export async function listMessages(
  user: AuthenticatedUser,
  conversationId: string,
  options: { page: number; perPage: number; after?: string },
): Promise<Paginated<MessageDto>> {
  await assertParticipant(conversationId, user.id);
  // The viewer's id is only used for the participation check above; passing it
  // as an unused placeholder would leave Postgres unable to type the parameter.
  const params: unknown[] = [conversationId];
  let afterClause = '';
  if (options.after) {
    params.push(options.after);
    afterClause = `AND m.created_at > (SELECT created_at FROM messages WHERE id = $${params.length})`;
  }
  params.push(options.perPage, (options.page - 1) * options.perPage);
  const rows = await queryMany(
    `SELECT m.id, m.conversation_id, m.sender_id, m.body, m.state, m.is_system, m.created_at, m.edited_at,
            u.full_name AS sender_name,
            (SELECT min(cp2.last_read_at) FROM conversation_participants cp2
              WHERE cp2.conversation_id = m.conversation_id AND cp2.user_id <> m.sender_id) AS read_at
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = $1 AND m.state <> 'hidden' ${afterClause}
      ORDER BY m.created_at ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const totalRow = await queryOne<{ total: number }>(
    'SELECT count(*)::int AS total FROM messages WHERE conversation_id = $1 AND state <> \'hidden\'',
    [conversationId],
  );
  const total = totalRow?.total ?? 0;
  return {
    data: rows.map((row) => toMessage(row, user.id)),
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

/** Marks the caller's read cursor, which drives the unread badge. */
export async function markConversationRead(user: AuthenticatedUser, conversationId: string): Promise<void> {
  await assertParticipant(conversationId, user.id);
  await query(
    'UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, user.id],
  );
}

/* --------------------------- Listing questions ----------------------------- */

export async function createComment(user: AuthenticatedUser, input: { listingId: string; body: string; parentId?: string | null }): Promise<ListingCommentDto> {
  const listing = await queryOne<{ id: string; seller_id: string; status: string; title: string; slug: string }>(
    'SELECT id, seller_id, status, title, slug FROM listings WHERE id = $1 AND deleted_at IS NULL',
    [input.listingId],
  );
  if (!listing) throw AppError.notFound('Listing not found');
  if (listing.status !== 'approved') throw AppError.conflict('Questions can only be asked on published listings');
  if (input.parentId) {
    const parent = await queryOne<{ id: string }>('SELECT id FROM listing_comments WHERE id = $1 AND listing_id = $2', [
      input.parentId,
      listing.id,
    ]);
    if (!parent) throw AppError.validation('The question you are replying to no longer exists');
  }

  const created = await withTransaction(async (tx) => {
    const comment = await tx.queryOne<{ id: string }>(
      `INSERT INTO listing_comments (listing_id, author_id, parent_id, body, is_seller_answer)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [listing.id, user.id, input.parentId ?? null, input.body, listing.seller_id === user.id],
    );
    if (!comment) throw AppError.internal('The question could not be saved');
    const target = listing.seller_id === user.id ? null : listing.seller_id;
    if (target) {
      await notify({
        userId: target,
        type: 'listing_question',
        title: 'New question on your listing',
        body: `${user.displayName} asked about ${listing.title}`,
        linkUrl: `/listings/${listing.slug}`,
        entityType: 'listing',
        entityId: listing.id,
      });
    }
    return comment.id;
  });

  const row = await queryOne(
    `SELECT lc.*, u.full_name AS author_name, (u.identity_reviewed_at IS NOT NULL) AS author_identity_reviewed,
            (SELECT count(*)::int FROM listing_comments r WHERE r.parent_id = lc.id AND r.state = 'visible') AS reply_count
       FROM listing_comments lc JOIN users u ON u.id = lc.author_id WHERE lc.id = $1`,
    [created],
  );
  return toComment(row as Record<string, unknown>, user.id);
}

export async function listComments(listingId: string, viewerId?: string): Promise<ListingCommentDto[]> {
  const rows = await queryMany(
    `SELECT lc.*, u.full_name AS author_name, (u.identity_reviewed_at IS NOT NULL) AS author_identity_reviewed,
            (SELECT count(*)::int FROM listing_comments r WHERE r.parent_id = lc.id AND r.state = 'visible') AS reply_count
       FROM listing_comments lc JOIN users u ON u.id = lc.author_id
      WHERE lc.listing_id = $1 AND lc.state = 'visible' AND lc.deleted_at IS NULL
      ORDER BY lc.created_at ASC LIMIT 200`,
    [listingId],
  );
  const comments = rows.map((row) => toComment(row, viewerId ?? ''));
  const byParent = new Map<string, ListingCommentDto[]>();
  for (const comment of comments) {
    const parentId = String((rows.find((row) => String(row.id) === comment.id)?.parent_id ?? '') || '');
    if (!parentId) continue;
    const list = byParent.get(parentId) ?? [];
    list.push(comment);
    byParent.set(parentId, list);
  }
  return comments.filter((comment) => {
    const row = rows.find((item) => String(item.id) === comment.id);
    return !row?.parent_id;
  }).map((comment) => ({ ...comment, replies: byParent.get(comment.id) ?? [] }));
}

export async function hideComment(admin: AuthenticatedUser, commentId: string, reason: string): Promise<void> {
  const comment = await queryOne<{ id: string; listing_id: string }>('SELECT id, listing_id FROM listing_comments WHERE id = $1', [commentId]);
  if (!comment) throw AppError.notFound('Comment not found');
  await query(`UPDATE listing_comments SET state = 'hidden', updated_at = now() WHERE id = $1`, [commentId]);
  await recordAudit({
    actorId: admin.id,
    actorRole: 'admin',
    action: 'comment_hidden',
    entityType: 'comment',
    entityId: commentId,
    metadata: { reason, listingId: comment.listing_id },
  });
}

/* ------------------------------ Saved listings ----------------------------- */

export async function saveListing(userId: string, listingId: string): Promise<void> {
  const listing = await queryOne(`SELECT 1 FROM listings l WHERE l.id = $1 AND ${PUBLIC_LISTING_PREDICATE}`, [listingId]);
  if (!listing) throw AppError.notFound('Listing not found');
  await query(
    `INSERT INTO saved_listings (user_id, listing_id) VALUES ($1, $2)
     ON CONFLICT (user_id, listing_id) DO NOTHING`,
    [userId, listingId],
  );
}

export async function unsaveListing(userId: string, listingId: string): Promise<void> {
  await query('DELETE FROM saved_listings WHERE user_id = $1 AND listing_id = $2', [userId, listingId]);
}

export async function listSavedListings(
  userId: string,
  options: { page: number; perPage: number },
): Promise<Paginated<SavedListingDto>> {
  const rows = await queryMany(
    `SELECT sl.id AS saved_id, sl.created_at AS saved_at, ${LISTING_CARD_SELECT}
       ${LISTING_CARD_FROM}
       JOIN saved_listings sl ON sl.listing_id = l.id
      WHERE sl.user_id = $1
      ORDER BY sl.created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, options.perPage, (options.page - 1) * options.perPage],
  );
  const totalRow = await queryOne<{ total: number }>('SELECT count(*)::int AS total FROM saved_listings WHERE user_id = $1', [userId]);
  const total = totalRow?.total ?? 0;
  return {
    data: rows.map((row) => ({
      id: String(row.saved_id),
      listing: toListingSummary(row, { savedByMe: true, isOwner: row.seller_id === userId }),
      createdAt: new Date(row.saved_at as string).toISOString(),
      availabilityNote:
        row.status !== 'approved' || row.availability === 'inactive'
          ? 'This listing is no longer published.'
          : row.availability === 'sold'
            ? 'This device has been marked sold.'
            : row.availability === 'reserved'
              ? 'This device is currently reserved.'
              : null,
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

/* ------------------------------ Notifications ------------------------------ */

export async function listNotifications(
  userId: string,
  options: { page: number; perPage: number; unreadOnly?: boolean },
): Promise<Paginated<NotificationDto>> {
  const rows = await queryMany(
    `SELECT * FROM notifications WHERE user_id = $1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL)
      ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
    [userId, options.unreadOnly ?? false, options.perPage, (options.page - 1) * options.perPage],
  );
  const totalRow = await queryOne<{ total: number }>(
    'SELECT count(*)::int AS total FROM notifications WHERE user_id = $1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL)',
    [userId, options.unreadOnly ?? false],
  );
  const total = totalRow?.total ?? 0;
  return {
    data: rows.map((row) => toNotification(row)),
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

export async function markNotificationsRead(userId: string, input: { ids?: string[]; all?: boolean }): Promise<number> {
  if (input.all) {
    const result = await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
    return result.rowCount ?? 0;
  }
  if (!input.ids?.length) return 0;
  const result = await query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL',
    [userId, input.ids],
  );
  return result.rowCount ?? 0;
}

export async function getUnreadCounts(userId: string): Promise<{ notifications: number; messages: number }> {
  const row = await queryOne<{ notifications: number; messages: number }>(
    `SELECT
       (SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL) AS notifications,
       (SELECT count(*)::int FROM messages m
          JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
         WHERE m.sender_id <> $1 AND m.state = 'visible' AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)) AS messages`,
    [userId],
  );
  return { notifications: row?.notifications ?? 0, messages: row?.messages ?? 0 };
}

export { PAGINATION };

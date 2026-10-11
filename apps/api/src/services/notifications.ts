import { NOTIFICATION_LABELS } from '@swapmart/shared';
import type { NotificationType } from '@swapmart/shared';
import { loadConfig } from '../config/env.ts';
import type { Executor } from '../lib/audit.ts';
import { query } from '../db/pool.ts';
import { sendEmail } from './email.ts';

/**
 * In-app notifications, with optional email mirroring.
 *
 * A notification row is always written for events that affect a user
 * (moderation decisions, new messages, exchange and transaction updates), which
 * is what the unread badge and the notification centre read from. Email is
 * additional and only sent when the transport can actually deliver.
 */
export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title?: string;
  body: string;
  linkUrl?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Send an email copy when a real transport is configured. */
  email?: boolean;
}

const config = loadConfig();

export async function notify(input: NotifyInput, executor: Executor = query): Promise<string | null> {
  const title = input.title ?? NOTIFICATION_LABELS[input.type] ?? 'SWAPMART update';
  const result = await executor(
    `INSERT INTO notifications (user_id, type, title, body, link_url, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.userId, input.type, title, input.body, input.linkUrl ?? null, input.entityType ?? null, input.entityId ?? null],
  );
  const notificationId = (result.rows[0] as { id: string } | undefined)?.id ?? null;

  if (input.email && config.email.transport === 'smtp' && notificationId) {
    const recipient = await query<{ email: string; full_name: string }>('SELECT email, full_name FROM users WHERE id = $1', [
      input.userId,
    ]);
    const user = recipient.rows[0];
    if (user) {
      const link = input.linkUrl ? `${config.appUrl}${input.linkUrl}` : config.appUrl;
      void sendEmail({
        to: user.email,
        subject: `SWAPMART: ${title}`,
        template: 'new_message',
        text: `Hello ${user.full_name},\n\n${input.body}\n\nOpen SWAPMART: ${link}\n\n— SWAPMART, Tanzania`,
        metadata: { notificationId, type: input.type },
      }).then(async (result_) => {
        if (result_.delivered) {
          await query('UPDATE notifications SET emailed_at = now() WHERE id = $1', [notificationId]);
        }
      });
    }
  }
  return notificationId;
}

export async function unreadCounts(userId: string): Promise<{ notifications: number; messages: number }> {
  const result = await query<{ notifications: number; messages: number }>(
    `SELECT
       (SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL) AS notifications,
       (SELECT count(*)::int FROM messages m
          JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
         WHERE m.sender_id <> $1 AND m.state = 'visible'
           AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)) AS messages`,
    [userId],
  );
  return { notifications: result.rows[0]?.notifications ?? 0, messages: result.rows[0]?.messages ?? 0 };
}

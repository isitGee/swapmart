import { z } from 'zod';
import { PLATFORM_LIMITS } from '../constants.js';
import { EXCHANGE_STATUSES, TRANSACTION_STATUSES, TRANSACTION_TYPES } from '../enums.js';
import { moneySchema, paginationQuerySchema, safeText, uuidSchema } from './common.js';

/* ------------------------------- Conversations ---------------------------- */

export const startConversationSchema = z.object({
  listingId: uuidSchema,
  /** Optional opening message so the conversation is never empty. */
  message: safeText(PLATFORM_LIMITS.maxMessageLength, 1, 'message').optional(),
});
export type StartConversationInput = z.infer<typeof startConversationSchema>;

export const conversationIdParamSchema = z.object({ id: uuidSchema });

export const sendMessageSchema = z.object({
  body: safeText(PLATFORM_LIMITS.maxMessageLength, 1, 'message'),
});

export const messageListQuerySchema = paginationQuerySchema.extend({
  /** Return messages created after this id (used by the polling transport). */
  after: uuidSchema.optional(),
});

export const conversationListQuerySchema = paginationQuerySchema.extend({
  filter: z.enum(['all', 'unread', 'buying', 'selling']).default('all'),
});

export const markReadSchema = z.object({ upTo: uuidSchema.optional() });

/* ------------------------------ Listing comments -------------------------- */

export const createCommentSchema = z.object({
  listingId: uuidSchema,
  body: safeText(PLATFORM_LIMITS.maxCommentLength, 2, 'question'),
  /** One level of replies is supported; deeper threading renders flat. */
  parentId: uuidSchema.nullable().optional(),
});

export const commentListQuerySchema = paginationQuerySchema;

export const commentIdParamSchema = z.object({ id: uuidSchema });

/* ------------------------------ Exchange requests -------------------------- */

export const createExchangeSchema = z
  .object({
    /** The listing the requester wants. */
    listingId: uuidSchema,
    /** The requester's own listing offered in exchange. */
    offeredListingId: uuidSchema,
    message: safeText(PLATFORM_LIMITS.maxMessageLength, 10, 'message'),
    /** Positive: requester tops up. Negative: requester expects the difference. */
    priceDifferenceTzs: z
      .number()
      .int('Amounts must be whole shillings')
      .min(-500_000_000)
      .max(500_000_000)
      .default(0),
    /** ISO date after which the proposal expires automatically. */
    expiresAt: z.coerce.date().optional(),
  })
  .refine((value) => value.listingId !== value.offeredListingId, {
    message: 'You cannot propose an exchange using the same listing',
    path: ['offeredListingId'],
  });
export type CreateExchangeInput = z.infer<typeof createExchangeSchema>;

export const exchangeIdParamSchema = z.object({ id: uuidSchema });

export const respondExchangeSchema = z.object({
  /** `complete` is offered once a proposal is accepted (the exchange happened). */
  action: z.enum(['accept', 'reject', 'counter', 'cancel', 'complete']),
  message: safeText(PLATFORM_LIMITS.maxMessageLength, 0, 'message').optional(),
  /** Required when action = counter. */
  counterPriceDifferenceTzs: z.number().int().min(-500_000_000).max(500_000_000).optional(),
  /**
   * Accepting does not move money: it creates a transaction record in
   * `negotiating` state that both parties coordinate off-platform.
   */
});
export type RespondExchangeInput = z.infer<typeof respondExchangeSchema>;

export const exchangeListQuerySchema = paginationQuerySchema.extend({
  role: z.enum(['all', 'incoming', 'outgoing']).default('all'),
  status: z
    .enum(EXCHANGE_STATUSES)
    .or(z.literal('open'))
    .optional(),
});

/* -------------------------------- Transactions ---------------------------- */

export const transactionListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(TRANSACTION_STATUSES).optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  role: z.enum(['all', 'buyer', 'seller']).default('all'),
});

export const transactionIdParamSchema = z.object({ id: uuidSchema });

export const updateTransactionStatusSchema = z.object({
  status: z.enum(TRANSACTION_STATUSES),
  note: safeText(1000, 0, 'note').optional(),
});
export type UpdateTransactionStatusInput = z.infer<typeof updateTransactionStatusSchema>;

export const createTransactionSchema = z.object({
  listingId: uuidSchema,
  type: z.enum(TRANSACTION_TYPES).default('purchase'),
  agreedAmountTzs: moneySchema.optional(),
  note: safeText(1000, 0, 'note').optional(),
});

/* ------------------------------ Saved listings ---------------------------- */

export const savedListingSchema = z.object({ listingId: uuidSchema });

/* ------------------------------- Notifications ---------------------------- */

export const notificationListQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const notificationIdParamSchema = z.object({ id: uuidSchema });

export const markNotificationsSchema = z.object({
  ids: z.array(uuidSchema).max(200).optional(),
  all: z.boolean().optional(),
});

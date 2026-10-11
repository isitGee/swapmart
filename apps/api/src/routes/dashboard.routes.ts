import { Router } from 'express';
import { z } from 'zod';
import {
  conversationListQuerySchema,
  createDisputeSchema,
  disputeIdParamSchema,
  disputeListQuerySchema,
  disputeMessageSchema,
  exchangeIdParamSchema,
  exchangeListQuerySchema,
  markNotificationsSchema,
  messageListQuerySchema,
  notificationListQuerySchema,
  reportIdParamSchema,
  reportListQuerySchema,
  reportNoteSchema,
  respondExchangeSchema,
  sendMessageSchema,
  startConversationSchema,
  transactionIdParamSchema,
  transactionListQuerySchema,
  updateTransactionStatusSchema,
  uuidSchema,
} from '@swapmart/shared';
import { asyncHandler } from '../lib/http.ts';
import { AppError } from '../lib/errors.ts';
import { requireAuth, requireCapability } from '../middleware/auth.ts';
import { body, params, query, validate } from '../middleware/validate.ts';
import { sensitiveLimiter } from '../middleware/security.ts';
import {
  getConversation,
  getUnreadCounts,
  listConversations,
  listMessages,
  listNotifications,
  listSavedListings,
  markConversationRead,
  markNotificationsRead,
  sendMessage,
  startConversation,
} from '../services/engagement-service.ts';
import { getExchangeRequest, listExchangeRequests, respondToExchange } from '../services/exchange-service.ts';
import { getTransaction, listTransactions, updateTransactionStatus } from '../services/transaction-service.ts';
import { addReportNote, getDispute, getReport, listDisputes, listReports, openDispute, postDisputeMessage, updateDispute } from '../services/trust-service.ts';
import { dashboardSummary, listModerationQueue } from '../services/admin-service.ts';
import { getListingForAdmin, getListingForOwner, listSellerListings } from '../services/listing-service.ts';
import { adminListingDtoFromDetail } from '../services/admin-mappers.ts';
import { transactionSummaryForUser } from '../services/transaction-service.ts';
import type { AuthenticatedUser } from '../types/express.d.ts';

/**
 * Member dashboard routes: listings, saved items, messages, exchanges,
 * transactions, reports, disputes, notifications.
 *
 * Everything here is scoped to the authenticated account: the dashboard never
 * accepts a user id from the client, and each query is filtered by the session's
 * user id (or by verified participation) rather than trusting parameters.
 */
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/me/dashboard',
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const summary = await dashboardSummary(user.id);
    const transactions = await transactionSummaryForUser(user.id);
    res.json({ data: { ...summary, transactions } });
  }),
);

dashboardRouter.get(
  '/me/listings',
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(60).default(20),
      sort: z.enum(['newest', 'oldest', 'price_asc', 'price_desc', 'relevance']).default('newest'),
      status: z
        .string()
        .optional()
        .transform((value) => (value ? value.split(',').filter(Boolean) : undefined)),
      q: z.string().trim().max(120).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const options = query<{ page: number; perPage: number; sort: string; status?: string[]; q?: string }>(req);
    const result = await listSellerListings(user.id, options);
    res.json(result);
  }),
);

dashboardRouter.get(
  '/me/listings/:id',
  validate({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const listing = await getListingForOwner(user, id);
    res.json({ data: listing });
  }),
);

/* --------------------------- Preview of the public view -------------------- */

dashboardRouter.get(
  '/me/listings/:id/preview',
  validate({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const listing = await getListingForOwner(user, id);
    res.json({
      data: {
        ...listing,
        meta: {
          publiclyVisible: listing.status === 'approved' && listing.availability !== 'inactive',
          notice:
            listing.status === 'approved'
              ? 'This is how buyers see the listing.'
              : 'Buyers cannot see this listing yet, because it is not approved. Other members can never see drafts, rejected or suspended listings.',
        },
      },
    });
  }),
);

/* ------------------------------- Saved listings ---------------------------- */

dashboardRouter.get(
  '/me/saved',
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(60).default(12),
    }),
  }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const options = query<{ page: number; perPage: number }>(req);
    res.json(await listSavedListings(user.id, options));
  }),
);

/* ------------------------------- Conversations ----------------------------- */

dashboardRouter.get(
  '/conversations',
  validate({ query: conversationListQuerySchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const options = query<{ page: number; perPage: number; filter: 'all' | 'unread' | 'buying' | 'selling' }>(req);
    res.json(await listConversations(user, options));
  }),
);

dashboardRouter.post(
  '/conversations',
  requireCapability('message'),
  sensitiveLimiter,
  validate({ body: startConversationSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const input = body<{ listingId: string; message?: string }>(req);
    const result = await startConversation(user, input);
    res.status(result.created ? 201 : 200).json({ data: result });
  }),
);

dashboardRouter.get(
  '/conversations/:id',
  validate({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    res.json({ data: await getConversation(user, id) });
  }),
);

dashboardRouter.get(
  '/conversations/:id/messages',
  validate({ params: z.object({ id: uuidSchema }), query: messageListQuerySchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const options = query<{ page: number; perPage: number; after?: string }>(req);
    res.json(await listMessages(user, id, options));
  }),
);

dashboardRouter.post(
  '/conversations/:id/messages',
  requireCapability('message'),
  sensitiveLimiter,
  validate({ params: z.object({ id: uuidSchema }), body: sendMessageSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const input = body<{ body: string }>(req);
    const message = await sendMessage(user, id, input.body);
    res.status(201).json({ data: message });
  }),
);

dashboardRouter.post(
  '/conversations/:id/read',
  validate({ params: z.object({ id: uuidSchema }), body: z.object({ upTo: uuidSchema.optional() }).optional() }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    await markConversationRead(user, id);
    res.json({ data: { read: true } });
  }),
);

/* --------------------------------- Exchanges ------------------------------- */

dashboardRouter.get(
  '/exchanges',
  validate({ query: exchangeListQuerySchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const options = query<{ page: number; perPage: number; role: 'all' | 'incoming' | 'outgoing'; status?: string }>(req);
    res.json(await listExchangeRequests(user, options));
  }),
);

dashboardRouter.get(
  '/exchanges/:id',
  validate({ params: exchangeIdParamSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    res.json({ data: await getExchangeRequest(user, id) });
  }),
);

dashboardRouter.post(
  '/exchanges/:id/respond',
  requireCapability('exchange'),
  sensitiveLimiter,
  validate({ params: exchangeIdParamSchema, body: respondExchangeSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const input = body<{ action: 'accept' | 'reject' | 'counter' | 'cancel' | 'complete'; message?: string; counterPriceDifferenceTzs?: number }>(req);
    res.json({ data: await respondToExchange(user, id, input) });
  }),
);

/* ------------------------------- Transactions ------------------------------ */

dashboardRouter.get(
  '/transactions',
  validate({ query: transactionListQuerySchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const options = query<{ page: number; perPage: number; status?: string; type?: string; role: 'all' | 'buyer' | 'seller' }>(req);
    res.json(await listTransactions(user, options));
  }),
);

dashboardRouter.get(
  '/transactions/:id',
  validate({ params: transactionIdParamSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    res.json({ data: await getTransaction(user, id) });
  }),
);

dashboardRouter.patch(
  '/transactions/:id/status',
  sensitiveLimiter,
  validate({ params: transactionIdParamSchema, body: updateTransactionStatusSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const input = body<{ status: string; note?: string }>(req);
    res.json({ data: await updateTransactionStatus(user, id, input) });
  }),
);

/* ---------------------------------- Reports -------------------------------- */

dashboardRouter.get(
  '/reports',
  validate({ query: reportListQuerySchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const options = query<{ page: number; perPage: number; status?: string; category?: string; priority?: string; q?: string }>(req);
    if (user.role !== 'admin') {
      // A member sees the reports they filed; the admin endpoint lists all.
      res.json(await listReports(user, { ...options, mine: true }));
      return;
    }
    res.json(await listReports(user, options));
  }),
);

dashboardRouter.get(
  '/reports/:id',
  validate({ params: reportIdParamSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    res.json({ data: await getReport(user, id) });
  }),
);

dashboardRouter.post(
  '/reports/:id/notes',
  validate({ params: reportIdParamSchema, body: reportNoteSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const input = body<{ body: string; visibility: 'moderator_note' | 'reporter_visible' }>(req);
    res.status(201).json({ data: await addReportNote(user, id, input) });
  }),
);

/* ---------------------------------- Disputes ------------------------------- */

dashboardRouter.get(
  '/disputes',
  validate({ query: disputeListQuerySchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const options = query<{ page: number; perPage: number; status?: string; category?: string; q?: string }>(req);
    res.json(await listDisputes(user, options));
  }),
);

dashboardRouter.post(
  '/disputes',
  sensitiveLimiter,
  validate({ body: createDisputeSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const input = body<{ transactionId: string; category: string; description: string; alsoReport?: boolean }>(req);
    res.status(201).json({ data: await openDispute(user, input) });
  }),
);

dashboardRouter.get(
  '/disputes/:id',
  validate({ params: disputeIdParamSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    res.json({ data: await getDispute(user, id) });
  }),
);

dashboardRouter.post(
  '/disputes/:id/messages',
  sensitiveLimiter,
  validate({ params: disputeIdParamSchema, body: disputeMessageSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const input = body<{ body: string; visibility: 'participants' | 'admins_only'; attachmentMediaId?: string }>(req);
    res.status(201).json({ data: await postDisputeMessage(user, id, input) });
  }),
);

/**
 * Moderator-only dispute update. Mounted here (rather than in the admin router)
 * because disputes are also part of the member experience; the admin check is
 * applied to this route only.
 */
dashboardRouter.patch(
  '/disputes/:id',
  validate({
    params: disputeIdParamSchema,
    body: z.object({
      status: z.enum(['open', 'investigating', 'awaiting_parties', 'escalated', 'resolved', 'closed']),
      resolution: z.string().trim().max(2000).optional(),
      assignedToMe: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    if (user.role !== 'admin') throw AppError.forbidden('Administrator access is required for this action');
    const { id } = params<{ id: string }>(req);
    const input = body<{ status: string; resolution?: string; assignedToMe?: boolean }>(req);
    res.json({ data: await updateDispute(user, id, input) });
  }),
);

/* ------------------------------ Notifications ------------------------------ */

dashboardRouter.get(
  '/notifications',
  validate({ query: notificationListQuerySchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const options = query<{ page: number; perPage: number; unreadOnly?: boolean }>(req);
    res.json(await listNotifications(user.id, options));
  }),
);

dashboardRouter.get(
  '/notifications/counts',
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    res.json({ data: await getUnreadCounts(user.id) });
  }),
);

dashboardRouter.post(
  '/notifications/read',
  validate({ body: markNotificationsSchema }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const input = body<{ ids?: string[]; all?: boolean }>(req);
    const updated = await markNotificationsRead(user.id, input);
    res.json({ data: { updated } });
  }),
);

/**
 * Admin preview of the moderation queue entry for a listing. Kept here so the
 * dashboard can show a moderator the same listing record the admin console
 * shows, without duplicating the mapping logic.
 */
dashboardRouter.get(
  '/moderation/queue/:id',
  validate({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    if (user.role !== 'admin') throw AppError.forbidden('Administrator access is required for this action');
    const { id } = params<{ id: string }>(req);
    const detail = await getListingForAdmin(id, user);
    res.json({ data: adminListingDtoFromDetail(detail) });
  }),
);

export { listModerationQueue };

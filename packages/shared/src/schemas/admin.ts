import { z } from 'zod';
import {
  ACCOUNT_STATUSES,
  DECISION_REASON_CODES,
  LISTING_STATUSES,
  MODERATION_ACTIONS,
} from '../enums.js';
import { CERTIFICATION_NOTE } from '../constants.js';
import { paginationQuerySchema, safeText, uuidSchema } from './common.js';
export const adminListingQueueQuerySchema = paginationQuerySchema.extend({
  status: z.enum(LISTING_STATUSES).optional(),
  q: safeText(120, 0, 'search term').optional(),
  flaggedOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  categorySlug: z.string().min(2).max(60).optional(),
  sellerId: uuidSchema.optional(),
  sort: z.enum(['oldest', 'newest', 'priority']).default('oldest'),
});
/**
 * Moderation decision. `reasonCode` is structured (used for reporting and
 * analytics) and `reasonNote` is the free-text explanation the seller sees.
 */
export const listingDecisionSchema = z.object({
  decision: z.enum([
    'approve',
    'reject',
    'request_evidence',
    'suspend',
    'reinstate',
    'claim',
  ]),
  reasonCode: z.enum(DECISION_REASON_CODES),
  reasonNote: safeText(2000, 10, 'note'),
  /** For request_evidence: the specific items the seller must provide. */
  requiredEvidence: z
    .array(
      z.object({
        kind: z.string().min(2).max(40),
        note: safeText(300, 0, 'note').optional(),
      }),
    )
    .max(5)
    .optional(),
  /** When suspending/rejecting, whether to keep the identifier reserved. */
  releaseIdentifier: z.boolean().default(false),
  /** Acknowledges the platform statement that approval is not a title check. */
  acknowledgeLimits: z.literal(true, {
    errorMap: () => ({ message: CERTIFICATION_NOTE }),
  }),
});
export type ListingDecisionInput = z.infer<typeof listingDecisionSchema>;
export const adminUserQuerySchema = paginationQuerySchema.extend({
  q: safeText(120, 0, 'search term').optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  role: z.enum(['user', 'admin']).optional(),
  sort: z.enum(['newest', 'oldest', 'reports']).default('newest'),
});
export const accountRestrictionSchema = z.object({
  action: z.enum(['restrict', 'unrestrict', 'suspend', 'reactivate', 'verify_identity', 'revoke_identity']),
  reason: safeText(1000, 10, 'reason'),
  /** For temporal restrictions only; omit for indefinite. */
  restrictedUntil: z.coerce.date().optional(),
  notifyUser: z.boolean().default(true),
});
export type AccountRestrictionInput = z.infer<typeof accountRestrictionSchema>;
export const adminNoteSchema = z.object({
  entityType: z.enum(['listing', 'user', 'report', 'dispute', 'transaction', 'device']),
  entityId: uuidSchema,
  body: safeText(2000, 2, 'note'),
  /** `moderation_notes` distinguishes an internal note from one shown to the member. */
  visibility: z.enum(['moderator_note', 'user_visible']).default('moderator_note'),
});
export const auditLogQuerySchema = paginationQuerySchema.extend({
  action: z.enum(MODERATION_ACTIONS).optional(),
  actorId: uuidSchema.optional(),
  entityType: z.string().min(2).max(40).optional(),
  entityId: uuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export const moderationHistoryQuerySchema = paginationQuerySchema.extend({
  entityType: z.string().min(2).max(40).optional(),
  entityId: uuidSchema.optional(),
  actorId: uuidSchema.optional(),
});
export const adminStatsQuerySchema = z.object({
  range: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});
export const adminTransactionQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['initiated', 'negotiating', 'agreed', 'completed', 'cancelled', 'disputed']).optional(),
  q: safeText(120, 0, 'search term').optional(),
});

import { z } from 'zod';
import { DISPUTE_CATEGORIES, NOTE_VISIBILITIES, REPORT_CATEGORIES, REPORT_PRIORITIES, REPORT_STATUSES, DISPUTE_STATUSES } from '../enums.js';
import { PLATFORM_LIMITS } from '../constants.js';
import { paginationQuerySchema, safeText, uuidSchema } from './common.js';

/* ---------------------------------- Reports -------------------------------- */

export const createReportSchema = z
  .object({
    category: z.enum(REPORT_CATEGORIES),
    description: safeText(PLATFORM_LIMITS.maxReportDescriptionLength, 20, 'description'),
    listingId: uuidSchema.optional(),
    reportedUserId: uuidSchema.optional(),
    messageId: uuidSchema.optional(),
    transactionId: uuidSchema.optional(),
    /** Optional contact detail for follow-up; kept private to moderators. */
    contactConsent: z.boolean().default(false),
  })
  .refine((value) => value.listingId || value.reportedUserId || value.messageId || value.transactionId, {
    message: 'Select what you are reporting (a listing, message, user or transaction)',
    path: ['listingId'],
  });
export type CreateReportInput = z.infer<typeof createReportSchema>;

export const reportIdParamSchema = z.object({ id: uuidSchema });

export const reportListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(REPORT_STATUSES).optional(),
  category: z.enum(REPORT_CATEGORIES).optional(),
  priority: z.enum(REPORT_PRIORITIES).optional(),
  q: safeText(120, 0, 'search term').optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const reportResolveSchema = z.object({
  status: z.enum(REPORT_STATUSES),
  priority: z.enum(REPORT_PRIORITIES).optional(),
  resolution: safeText(2000, 10, 'resolution'),
  /** Applies to the referenced listing, when the outcome requires it. */
  listingAction: z.enum(['none', 'suspend', 'reinstate', 'none_request_evidence']).default('none'),
  /** Notes on a report: `reporter_visible` notes are shown to the person who filed it. */
  noteVisibility: z.enum(['moderator_note', 'reporter_visible']).default('reporter_visible'),
});
export type ReportResolveInput = z.infer<typeof reportResolveSchema>;

export const reportNoteSchema = z.object({
  body: safeText(2000, 2, 'note'),
  visibility: z.enum(['moderator_note', 'reporter_visible']).default('moderator_note'),
});

/* --------------------------------- Disputes -------------------------------- */

export const createDisputeSchema = z.object({
  transactionId: uuidSchema,
  category: z.enum(DISPUTE_CATEGORIES),
  description: safeText(PLATFORM_LIMITS.maxDisputeDescriptionLength, 20, 'description'),
  /** Optionally open the dispute together with a formal report. */
  alsoReport: z.boolean().default(false),
});
export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;

export const disputeIdParamSchema = z.object({ id: uuidSchema });

export const disputeListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(DISPUTE_STATUSES).optional(),
  category: z.enum(DISPUTE_CATEGORIES).optional(),
  q: safeText(120, 0, 'search term').optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const disputeMessageSchema = z.object({
  body: safeText(2000, 2, 'message'),
  visibility: z.enum(NOTE_VISIBILITIES).default('participants'),
  attachmentMediaId: uuidSchema.optional(),
});

export const disputeUpdateSchema = z.object({
  status: z.enum(DISPUTE_STATUSES),
  resolution: safeText(2000, 0, 'resolution').optional(),
  assignedToMe: z.boolean().optional(),
});
export type DisputeUpdateInput = z.infer<typeof disputeUpdateSchema>;

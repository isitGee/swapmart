import type {
  AvailabilityFilter,
  DisputeStatus,
  ExchangeStatus,
  ListingAvailability,
  ListingStatus,
  ReportStatus,
  SortOption,
  TransactionStatus,
} from './enums.js';

/**
 * Allowed state transitions. These maps are the single source of truth used by
 * the API (which rejects any transition that is not listed here) and by the
 * automated tests. The database additionally enforces the value domain of the
 * status columns, so an invalid status can neither be written by the API nor by
 * hand.
 */

export const LISTING_TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['checks_pending', 'flagged', 'evidence_required', 'withdrawn'],
  checks_pending: ['flagged', 'under_review', 'evidence_required', 'withdrawn'],
  flagged: ['under_review', 'evidence_required', 'rejected', 'withdrawn'],
  under_review: ['approved', 'rejected', 'evidence_required', 'withdrawn', 'suspended'],
  evidence_required: ['submitted', 'checks_pending', 'withdrawn', 'rejected'],
  approved: ['suspended', 'withdrawn'],
  rejected: ['submitted', 'withdrawn'],
  suspended: ['under_review', 'approved', 'rejected', 'withdrawn'],
  withdrawn: ['submitted'],
};

/** Statuses in which a listing is visible to its owner only. */
export const LISTING_PRIVATE_STATUSES: readonly ListingStatus[] = [
  'draft',
  'submitted',
  'checks_pending',
  'flagged',
  'under_review',
  'evidence_required',
  'rejected',
  'suspended',
  'withdrawn',
];

/** The only status that is publicly searchable. */
export const LISTING_PUBLIC_STATUS: ListingStatus = 'approved';

/** Seller-editable statuses (a listing under review is frozen for editing). */
export const LISTING_EDITABLE_STATUSES: readonly ListingStatus[] = [
  'draft',
  'rejected',
  'evidence_required',
  'withdrawn',
];

export function canTransitionListing(from: ListingStatus, to: ListingStatus): boolean {
  return LISTING_TRANSITIONS[from].includes(to);
}

export const EXCHANGE_TRANSITIONS: Record<ExchangeStatus, readonly ExchangeStatus[]> = {
  pending: ['accepted', 'rejected', 'countered', 'cancelled', 'expired'],
  accepted: ['completed', 'cancelled'],
  rejected: [],
  countered: ['accepted', 'rejected', 'cancelled', 'expired'],
  cancelled: [],
  completed: [],
  expired: [],
};

export function canTransitionExchange(from: ExchangeStatus, to: ExchangeStatus): boolean {
  return EXCHANGE_TRANSITIONS[from].includes(to);
}

export const TRANSACTION_TRANSITIONS: Record<TransactionStatus, readonly TransactionStatus[]> = {
  initiated: ['negotiating', 'agreed', 'cancelled', 'disputed'],
  negotiating: ['agreed', 'cancelled', 'disputed'],
  agreed: ['completed', 'cancelled', 'disputed'],
  completed: ['disputed'],
  cancelled: [],
  disputed: ['completed', 'cancelled', 'agreed'],
};

export function canTransitionTransaction(from: TransactionStatus, to: TransactionStatus): boolean {
  return TRANSACTION_TRANSITIONS[from].includes(to);
}

/** Transaction statuses that either party (participant) may set. */
export const TRANSACTION_PARTICIPANT_TARGETS: readonly TransactionStatus[] = [
  'negotiating',
  'agreed',
  'cancelled',
  'completed',
  'disputed',
];

/** Statuses an administrator may set (superset used for dispute resolution). */
export const TRANSACTION_ADMIN_TARGETS: readonly TransactionStatus[] = TRANSACTION_PARTICIPANT_TARGETS;

export const REPORT_TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  open: ['under_review', 'escalated', 'resolved', 'dismissed'],
  under_review: ['escalated', 'resolved', 'dismissed', 'open'],
  escalated: ['under_review', 'resolved', 'dismissed'],
  resolved: ['under_review'],
  dismissed: ['under_review'],
};

export function canTransitionReport(from: ReportStatus, to: ReportStatus): boolean {
  return REPORT_TRANSITIONS[from].includes(to);
}

export const DISPUTE_TRANSITIONS: Record<DisputeStatus, readonly DisputeStatus[]> = {
  open: ['investigating', 'awaiting_parties', 'escalated', 'resolved', 'closed'],
  investigating: ['awaiting_parties', 'escalated', 'resolved', 'closed'],
  awaiting_parties: ['investigating', 'escalated', 'resolved', 'closed'],
  escalated: ['investigating', 'awaiting_parties', 'resolved', 'closed'],
  resolved: ['investigating', 'closed'],
  closed: ['investigating'],
};

export function canTransitionDispute(from: DisputeStatus, to: DisputeStatus): boolean {
  return DISPUTE_TRANSITIONS[from].includes(to);
}

/**
 * Availability transitions. A listing may only be marked `sold` once a
 * transaction has been agreed, and a `sold` listing may not be returned to
 * `available` without an administrator reinstating it.
 */
export const AVAILABILITY_TRANSITIONS: Record<ListingAvailability, readonly ListingAvailability[]> = {
  available: ['reserved', 'inactive'],
  reserved: ['available', 'sold', 'inactive'],
  sold: ['inactive'],
  inactive: ['available'],
};

export function canTransitionAvailability(from: ListingAvailability, to: ListingAvailability): boolean {
  return AVAILABILITY_TRANSITIONS[from].includes(to);
}

export const PUBLIC_AVAILABILITY_FILTER_VALUES: Record<AvailabilityFilter, readonly ListingAvailability[]> = {
  available: ['available'],
  reserved: ['available', 'reserved'],
  sold: ['available', 'reserved', 'sold'],
  any: ['available', 'reserved', 'sold', 'inactive'],
};

export const SORT_SQL: Record<SortOption, string> = {
  newest: 'l.published_at DESC NULLS LAST, l.created_at DESC',
  oldest: 'l.published_at ASC NULLS LAST, l.created_at ASC',
  price_asc: 'l.asking_price_tzs ASC NULLS LAST, l.created_at DESC',
  price_desc: 'l.asking_price_tzs DESC NULLS LAST, l.created_at DESC',
  relevance: 'l.published_at DESC NULLS LAST, l.created_at DESC',
};

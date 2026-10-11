import type {
  AccountStatus,
  AvailabilityFilter,
  DeviceCondition,
  DisputeStatus,
  ExchangeStatus,
  ListingStatus,
  ReportStatus,
  TransactionStatus,
} from '@swapmart/shared';

/**
 * Display formatting. Tanzanian shillings are whole numbers held as integers
 * everywhere in the system, so prices are formatted from `number` with no
 * floating point arithmetic anywhere in the client either.
 */

const tzsFormatter = new Intl.NumberFormat('en-TZ', {
  style: 'decimal',
  maximumFractionDigits: 0,
});

/** `1250000` → `TZS 1,250,000`. */
export function formatTzs(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return 'Price on request';
  return `TZS ${tzsFormatter.format(Math.trunc(amount))}`;
}

/** Compact form used in dense tables: `TZS 1.25M`. */
export function formatTzsCompact(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const value = Math.trunc(amount);
  if (Math.abs(value) >= 1_000_000) return `TZS ${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 2)}M`;
  if (Math.abs(value) >= 1_000) return `TZS ${Math.round(value / 1_000)}K`;
  return formatTzs(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return tzsFormatter.format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Human friendly relative time, falling back to an absolute date after a month. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(date);
}

/* ----------------------------- Enum labels ------------------------------ */

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  checks_pending: 'Automated checks pending',
  flagged: 'Flagged for review',
  under_review: 'Under administrator review',
  evidence_required: 'Awaiting additional evidence',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
  withdrawn: 'Withdrawn',
};

export const LISTING_STATUS_TONES: Record<ListingStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral',
  submitted: 'info',
  checks_pending: 'info',
  flagged: 'warning',
  under_review: 'info',
  evidence_required: 'warning',
  approved: 'success',
  rejected: 'danger',
  suspended: 'danger',
  withdrawn: 'neutral',
};

export const CONDITION_LABELS: Record<DeviceCondition, string> = {
  new_sealed: 'New — sealed',
  like_new: 'Like new',
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  for_parts: 'For parts / repair',
};

export const AVAILABILITY_LABELS: Record<AvailabilityFilter | 'inactive', string> = {
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
  inactive: 'Inactive',
  any: 'Any availability',
};

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  initiated: 'Initiated',
  negotiating: 'Negotiating',
  agreed: 'Agreed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
};

export const EXCHANGE_STATUS_LABELS: Record<ExchangeStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
  countered: 'Countered',
  cancelled: 'Cancelled',
  completed: 'Completed',
  expired: 'Expired',
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  open: 'Open',
  under_review: 'Under investigation',
  escalated: 'Escalated',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  awaiting_parties: 'Awaiting parties',
  escalated: 'Escalated',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: 'Active',
  restricted: 'Restricted',
  suspended: 'Suspended',
  deactivated: 'Deactivated',
};

/** Turns a snake_case enum member into a readable label as a last resort. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural ?? `${singular}s`}`;
}

/** `2026-02-14T09:30:00.000Z` → value for `<input type="datetime-local">`. */
export function toDateTimeLocalValue(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

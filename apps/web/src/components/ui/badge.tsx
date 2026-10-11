import type { ReactNode } from 'react';
import type { AccountStatus, ListingAvailability, ListingStatus, TransactionStatus } from '@swapmart/shared';
import { cn } from '@/lib/cn';
import {
  ACCOUNT_STATUS_LABELS,
  AVAILABILITY_LABELS,
  LISTING_STATUS_LABELS,
  LISTING_STATUS_TONES,
  TRANSACTION_STATUS_LABELS,
} from '@/lib/format';
import { Icon } from './icon';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-sunken text-ink-700 border-line-strong',
  info: 'bg-info-50 text-brand-700 border-brand-200',
  brand: 'bg-brand-600 text-white border-brand-600',
  success: 'bg-success-50 text-success-700 border-success-600/30',
  warning: 'bg-warning-50 text-warning-700 border-warning-600/30',
  danger: 'bg-danger-50 text-danger-700 border-danger-600/30',
};

export function Badge({
  tone = 'neutral',
  children,
  icon,
  className,
  size = 'md',
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-[0.6875rem]' : 'px-2.5 py-0.5 text-xs',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Workflow state of a listing, with the tone matching its meaning. */
export function ListingStatusBadge({ status, size = 'md' }: { status: ListingStatus; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={LISTING_STATUS_TONES[status] ?? 'neutral'} size={size}>
      {LISTING_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export function AvailabilityBadge({ availability, size = 'md' }: { availability: ListingAvailability; size?: 'sm' | 'md' }) {
  const tone: Tone = availability === 'available' ? 'success' : availability === 'reserved' ? 'warning' : 'neutral';
  return (
    <Badge tone={tone} size={size}>
      {AVAILABILITY_LABELS[availability]}
    </Badge>
  );
}

export function TransactionStatusBadge({ status }: { status: TransactionStatus }) {
  const tone: Tone =
    status === 'completed' ? 'success' : status === 'disputed' ? 'danger' : status === 'cancelled' ? 'neutral' : 'info';
  return <Badge tone={tone}>{TRANSACTION_STATUS_LABELS[status]}</Badge>;
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const tone: Tone = status === 'active' ? 'success' : status === 'restricted' ? 'warning' : status === 'suspended' ? 'danger' : 'neutral';
  return <Badge tone={tone}>{ACCOUNT_STATUS_LABELS[status]}</Badge>;
}

/**
 * Approval is the outcome of a verification review, not a legal guarantee of
 * ownership — the wording of this badge is deliberately precise.
 */
export function VerifiedBadge({ size = 'md', label = 'Identifier reviewed' }: { size?: 'sm' | 'md'; label?: string }) {
  return (
    <Badge tone="success" size={size} icon={<Icon name="shield-check" size={size === 'sm' ? 11 : 13} />}>
      {label}
    </Badge>
  );
}

export function PendingVerificationBadge({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <Badge tone="warning" size={size} icon={<Icon name="clock" size={size === 'sm' ? 11 : 13} />}>
      Verification pending
    </Badge>
  );
}

export function NotConfiguredBadge({ label = 'Not performed (provider not configured)' }: { label?: string }) {
  return (
    <Badge tone="neutral" size="sm" icon={<Icon name="info" size={12} />}>
      {label}
    </Badge>
  );
}

import Link from 'next/link';
import type { ListingSummaryDto } from '@swapmart/shared';
import { Badge, PendingVerificationBadge, VerifiedBadge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { AVAILABILITY_LABELS, CONDITION_LABELS, formatTzs, formatRelative } from '@/lib/format';

/**
 * Catalogue card. Only fields that are safe for the public are rendered: the
 * device identifier is summarised as "identifier checked" / "pending", never
 * shown.
 */
export function ListingCard({ listing, className }: { listing: ListingSummaryDto; className?: string }) {
  const verified = listing.status === 'approved';
  const unavailable = listing.availability === 'sold' || listing.availability === 'reserved';

  return (
    <article
      className={cn(
        'sm-card group flex flex-col overflow-hidden transition-shadow duration-150 hover:shadow-raised',
        className,
      )}
    >
      <Link href={`/listings/${listing.slug}`} className="relative block aspect-[4/3] overflow-hidden bg-surface-sunken">
        {listing.primaryImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.primaryImage.url}
            alt={listing.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-ink-400">
            <Icon name="image" size={28} />
          </span>
        )}
        <div className="absolute left-2.5 top-2.5 flex flex-wrap gap-1.5">
          {verified ? (
            <VerifiedBadge size="sm" />
          ) : (
            <PendingVerificationBadge size="sm" />
          )}
        </div>
        {listing.imageCount > 1 ? (
          <span className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-ink-900/70 px-2 py-0.5 text-[0.6875rem] font-medium text-white">
            <Icon name="image" size={11} />
            {listing.imageCount}
          </span>
        ) : null}
        {unavailable ? (
          <span className="absolute inset-0 flex items-center justify-center bg-ink-900/45">
            <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-800">
              {AVAILABILITY_LABELS[listing.availability]}
            </span>
          </span>
        ) : null}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-ink-500">
          <span>{listing.category.name}</span>
          <span aria-hidden="true">·</span>
          <span>{CONDITION_LABELS[listing.condition]}</span>
        </div>

        <h3 className="text-sm font-semibold leading-snug text-ink-900">
          <Link href={`/listings/${listing.slug}`} className="transition-colors hover:text-brand-700">
            {listing.title}
          </Link>
        </h3>

        <p className="text-xs text-ink-500">
          {listing.brand} {listing.model}
        </p>

        <p className="mt-0.5 text-base font-semibold tabular-nums text-ink-900">{formatTzs(listing.askingPriceTzs)}</p>

        <div className="flex flex-wrap items-center gap-1.5">
          {listing.negotiable ? <Badge size="sm" tone="neutral">Negotiable</Badge> : null}
          {listing.exchangeAllowed ? (
            <Badge size="sm" tone="info" icon={<Icon name="arrow-swap" size={11} />}>
              Exchange
            </Badge>
          ) : null}
          {listing.savedByMe ? (
            <Badge size="sm" tone="brand">
              Saved
            </Badge>
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-2.5 text-xs text-ink-500">
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon name="map" size={13} className="shrink-0 text-ink-400" />
            <span className="truncate">
              {listing.city ? `${listing.city}, ` : ''}
              {listing.region}
            </span>
          </span>
          <span className="shrink-0">{formatRelative(listing.publishedAt ?? listing.createdAt)}</span>
        </div>
      </div>
    </article>
  );
}

/** Compact horizontal variant used in dashboards and related-product rails. */
export function ListingRow({ listing, href }: { listing: ListingSummaryDto; href?: string }) {
  return (
    <Link
      href={href ?? `/listings/${listing.slug}`}
      className="flex items-center gap-3 rounded-card border border-line bg-surface p-2.5 transition-colors hover:border-line-strong hover:bg-surface-muted"
    >
      <span className="h-14 w-14 shrink-0 overflow-hidden rounded-control bg-surface-sunken">
        {listing.primaryImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.primaryImage.url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-ink-400">
            <Icon name="image" size={18} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink-900">{listing.title}</span>
        <span className="mt-0.5 block text-xs text-ink-500">
          {formatTzs(listing.askingPriceTzs)} · {listing.region}
        </span>
      </span>
      <span className="shrink-0 text-ink-400">
        <Icon name="chevron" size={16} />
      </span>
    </Link>
  );
}

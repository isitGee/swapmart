import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ListingCommentDto, ListingDetailDto, ListingSummaryDto } from '@swapmart/shared';
import { ImageGallery } from '@/components/marketplace/image-gallery';
import { ListingActions } from '@/components/marketplace/listing-actions';
import { ListingCard } from '@/components/marketplace/listing-card';
import { SaveListingButton } from '@/components/marketplace/save-button';
import { CommentThread } from '@/components/marketplace/comment-thread';
import { AvailabilityBadge, Badge, PendingVerificationBadge, VerifiedBadge } from '@/components/ui/badge';
import { DisclaimerNote, Panel, UnavailableState } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { getCurrentUser, serverFetchSafe, ServerApiError } from '@/lib/server-api';
import { CONDITION_LABELS, formatDateTime, formatRelative, formatTzs, humanize } from '@/lib/format';

export const metadata = { title: 'Listing' };

export default async function ListingDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let listing: ListingDetailDto;
  try {
    listing = await serverFetchSafe<ListingDetailDto>('/listings/' + encodeURIComponent(slug), null as unknown as ListingDetailDto);
    if (!listing) notFound();
  } catch (error) {
    if (error instanceof ServerApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const [user, related, comments] = await Promise.all([
    getCurrentUser(),
    serverFetchSafe<ListingSummaryDto[]>(`/listings/${listing.id}/related`, []),
    serverFetchSafe<ListingCommentDto[]>(`/listings/${listing.id}/comments`, []),
  ]);

  const isOwner = user?.id === listing.seller.id;
  const myListings = user
    ? await serverFetchSafe<ListingSummaryDto[]>('/me/listings', [], { params: { status: 'approved', perPage: 50 } })
    : [];

  const specEntries = Object.entries(listing.specs ?? {}).filter(([, value]) => value !== null && value !== '');

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
        <Link href="/" className="hover:text-brand-700">
          Home
        </Link>
        <Icon name="chevron" size={12} />
        <Link href={`/categories/${listing.category.slug}`} className="hover:text-brand-700">
          {listing.category.name}
        </Link>
        <Icon name="chevron" size={12} />
        <span className="truncate text-ink-700">{listing.title}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0">
          <ImageGallery images={listing.images} title={listing.title} />

          <Panel title="Description" className="mt-5">
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700">{listing.description}</p>
          </Panel>

          {specEntries.length > 0 ? (
            <Panel title="Specifications" className="mt-5">
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {specEntries.map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{humanize(key)}</dt>
                    <dd className="mt-0.5 text-sm text-ink-800">
                      {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ) : null}

          <Panel title="Device verification record" className="mt-5">
            <div className="flex flex-wrap items-center gap-2">
              {listing.status === 'approved' ? <VerifiedBadge label="Identifier reviewed and approved" /> : <PendingVerificationBadge />}
              <Badge tone="neutral">Automated checks: {listing.verificationAttemptCount}</Badge>
              <Badge tone={listing.externalCheckStatus === 'not_configured' ? 'neutral' : 'info'}>
                Stolen-device lookup: {humanize(listing.externalCheckStatus)}
              </Badge>
            </div>

            {listing.identifierSummary.length > 0 ? (
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Identifier summary (masked)</h3>
                <ul className="mt-2 divide-y divide-line rounded-control border border-line">
                  {listing.identifierSummary.map((identifier) => (
                    <li key={`${identifier.kind}-${identifier.masked}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="text-ink-600">{humanize(identifier.kind)}</span>
                      <span className="font-mono text-ink-900">{identifier.masked}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-500">
                  Full identifiers are encrypted at rest and are never published. An administrator can inspect the verification
                  record during a review.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-600">
                No device identifier is attached to this listing. Some device types — accessories and parts — do not have one.
              </p>
            )}

            {listing.externalCheckStatus === 'not_configured' || listing.externalCheckStatus === 'not_performed' ? (
              <div className="mt-4">
                <UnavailableState
                  title="Stolen-device database lookup was not performed"
                  description="No authoritative stolen-device or blacklist provider is connected to this deployment, so no claim is made about a device's theft history. An administrator reviewed the seller's evidence manually instead."
                  setupHint="Operators can connect a provider through the STOLEN_CHECK_PROVIDER configuration; until then the system records “not performed (provider not configured)”."
                />
              </div>
            ) : null}

            {listing.moderationNotes.length > 0 ? (
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Review history</h3>
                <ol className="mt-2 space-y-2.5">
                  {listing.moderationNotes.map((event) => (
                    <li key={event.id} className="flex gap-2.5 text-sm">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                      <span>
                        <span className="text-ink-800">{humanize(event.action)}</span>
                        {event.reasonCode ? <span className="text-ink-500"> · {humanize(event.reasonCode)}</span> : null}
                        <span className="block text-xs text-ink-500">{formatDateTime(event.createdAt)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            <DisclaimerNote className="mt-4">
              Approval means the seller supplied a plausible, non-duplicated identifier and evidence that an administrator
              reviewed. It is not a legal guarantee of ownership, and SWAPMART cannot recover a device or funds.
            </DisclaimerNote>
          </Panel>

          <div className="mt-5">
            <CommentThread
              listingId={listing.id}
              comments={comments}
              signedIn={Boolean(user)}
              currentUserId={user?.id ?? null}
            />
          </div>
        </div>

        {/* Purchase column */}
        <div className="min-w-0">
          <div className="sm-card sticky top-20 flex flex-col gap-4 p-5">
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                {listing.status === 'approved' ? <VerifiedBadge size="sm" /> : <PendingVerificationBadge size="sm" />}
                <AvailabilityBadge availability={listing.availability} size="sm" />
                <Badge tone="neutral" size="sm">
                  {CONDITION_LABELS[listing.condition]}
                </Badge>
              </div>
              <h1 className="mt-2.5 text-xl font-semibold leading-snug tracking-tight text-ink-900">{listing.title}</h1>
              <p className="mt-1 text-sm text-ink-600">
                {listing.brand} {listing.model} · {listing.category.name}
              </p>
            </div>

            <div className="border-y border-line py-3">
              <p className="text-2xl font-semibold tabular-nums text-ink-900">{formatTzs(listing.askingPriceTzs)}</p>
              <p className="mt-0.5 text-sm text-ink-500">
                {listing.negotiable ? 'Price is negotiable' : 'Fixed price'}
                {listing.exchangeAllowed ? ' · accepts exchange offers' : ''}
              </p>
            </div>

            <ul className="space-y-2 text-sm text-ink-600">
              <li className="flex items-center gap-2">
                <Icon name="map" size={15} className="text-ink-400" />
                {listing.city ? `${listing.city}, ` : ''}
                {listing.region}
              </li>
              <li className="flex items-center gap-2">
                <Icon name="clock" size={15} className="text-ink-400" />
                {listing.publishedAt ? `Published ${formatRelative(listing.publishedAt)}` : `Created ${formatRelative(listing.createdAt)}`}
              </li>
              <li className="flex items-center gap-2">
                <Icon name="eye" size={15} className="text-ink-400" />
                {listing.viewCount} views
              </li>
            </ul>

            <ListingActions
              listing={listing}
              signedIn={Boolean(user)}
              isOwner={isOwner}
              myListings={myListings}
              alreadySaved={Boolean(listing.savedByMe)}
              canExchange={user?.capabilities.canExchange ?? false}
              canMessage={user?.capabilities.canMessage ?? false}
              canReport={user?.capabilities.canReport ?? false}
              canTransact={Boolean(user) && user?.accountStatus === 'active'}
            />

            <div className="flex items-center justify-center">
              <SaveListingButton listingId={listing.id} saved={Boolean(listing.savedByMe)} signedIn={Boolean(user)} size="sm" />
            </div>
          </div>

          {/* Seller */}
          <Panel title="Seller" className="mt-5">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                {listing.seller.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={listing.seller.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  listing.seller.displayName.slice(0, 2).toUpperCase()
                )}
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-900">
                  {listing.seller.displayName}
                  {listing.seller.identityReviewed ? <VerifiedBadge size="sm" label="Identity reviewed" /> : null}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {listing.seller.region ?? 'Region not stated'}
                </p>
                <Link
                  href={`/sellers/${listing.seller.id}`}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
                >
                  View seller profile and listings
                  <Icon name="arrow-right" size={14} />
                </Link>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {related.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-lg font-semibold tracking-tight text-ink-900">Related devices</h2>
          <p className="mt-1 text-sm text-ink-600">Similar approved listings in the same category.</p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.slice(0, 4).map((item) => (
              <ListingCard key={item.id} listing={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

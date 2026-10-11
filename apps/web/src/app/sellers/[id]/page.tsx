import { notFound } from 'next/navigation';
import type { ListingSummaryDto, SellerPublicDto } from '@swapmart/shared';
import { ListingCard } from '@/components/marketplace/listing-card';
import { Badge, VerifiedBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { DataList, EmptyState, Panel, StatCard } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { serverFetchSafe } from '@/lib/server-api';
import { formatDate, formatNumber } from '@/lib/format';

export const metadata = { title: 'Seller profile' };

export default async function SellerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const payload = await serverFetchSafe<{ seller: SellerPublicDto; listings: ListingSummaryDto[] } | null>(
    `/sellers/${id}`,
    null,
  );
  if (!payload) notFound();

  const seller = payload.seller;
  const listings = payload.listings;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <div className="sm-card flex flex-wrap items-start gap-4 p-5">
            <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-lg font-semibold text-brand-700">
              {seller.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={seller.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                seller.displayName.slice(0, 2).toUpperCase()
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-ink-900">
                {seller.displayName}
                {seller.identityReviewed ? <VerifiedBadge label="Identity reviewed" /> : null}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-600">
                <span className="flex items-center gap-1.5">
                  <Icon name="map" size={15} className="text-ink-400" />
                  {seller.city ? `${seller.city}, ` : ''}
                  {seller.region ?? 'Region not stated'}
                </span>
                <span className="text-ink-400">·</span>
                <span>Member since {formatDate(seller.memberSince)}</span>
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {seller.emailVerified ? <Badge tone="success" size="sm">Email verified</Badge> : <Badge tone="neutral" size="sm">Email unverified</Badge>}
                {seller.identityReviewed ? (
                  <Badge tone="info" size="sm">Identity documents reviewed by an administrator</Badge>
                ) : (
                  <Badge tone="neutral" size="sm">Identity not reviewed</Badge>
                )}
              </div>
              {seller.bio ? <p className="mt-3 whitespace-pre-line text-sm text-ink-600">{seller.bio}</p> : null}
            </div>
          </div>

          <section className="mt-8">
            <h2 className="text-lg font-semibold tracking-tight text-ink-900">Listings from this seller</h2>
            <p className="mt-1 text-sm text-ink-600">Only approved listings are shown publicly.</p>
            {listings.length === 0 ? (
              <div className="sm-card mt-4">
                <EmptyState icon="box" title="No public listings" description="This seller has no approved listings at the moment." />
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="min-w-0">
          <Panel title="Seller record">
            <DataList
              items={[
                { label: 'Active listings', value: formatNumber(seller.activeListingCount ?? 0) },
                { label: 'Listings sold', value: formatNumber(seller.soldListingCount ?? 0) },
                { label: 'Completed transactions', value: formatNumber(seller.completedTransactionCount ?? 0) },
                {
                  label: 'Identity review',
                  value: seller.identityReviewed ? 'Reviewed by an administrator' : 'Not reviewed',
                  hint: seller.identityReviewed
                    ? 'Supporting identity documents were checked.'
                    : 'This seller has not completed an identity review.',
                },
              ]}
            />
            {seller.phone && seller.phone !== '' ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-ink-700">
                <Icon name="phone" size={15} className="text-ink-400" />
                {seller.phone}
              </p>
            ) : null}
          </Panel>

          <Panel title="Trade safely" className="mt-5">
            <ul className="space-y-2.5 text-sm text-ink-600">
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-success-600" />Meet in a public place and inspect the device before paying.</li>
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-success-600" />Compare the identifier shown on the device with the one recorded in the listing record.</li>
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-success-600" />Keep the conversation inside SWAPMART so there is a record if something goes wrong.</li>
            </ul>
            <ButtonLink href="/how-verification-works" variant="secondary" size="sm" className="mt-4" block>
              How verification works
            </ButtonLink>
          </Panel>

          <div className="mt-5 grid gap-3">
            <StatCard label="Approved listings" value={formatNumber(seller.activeListingCount ?? 0)} icon="box" />
            <StatCard label="Completed transactions" value={formatNumber(seller.completedTransactionCount ?? 0)} icon="handshake" tone="success" />
          </div>
        </div>
      </div>
    </div>
  );
}

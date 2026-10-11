import Link from 'next/link';
import type { OwnerListingDto } from '@swapmart/shared';
import { Badge, ListingStatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Panel, Table, Td, Th } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { serverFetchPage } from '@/lib/server-api';
import { CONDITION_LABELS, formatTzs, formatRelative, LISTING_STATUS_LABELS } from '@/lib/format';

const TABS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'checks_pending,under_review,flagged,submitted', label: 'In review' },
  { value: 'evidence_required', label: 'Needs evidence' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected,suspended', label: 'Rejected / suspended' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

export default async function MyListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  let result: Awaited<ReturnType<typeof serverFetchPage<OwnerListingDto>>>;
  try {
    result = await serverFetchPage<OwnerListingDto>('/me/listings', {
      params: { page, perPage: 20, status: params.status },
    });
  } catch (error) {
    return (
      <ErrorState
        title="Your listings could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/dashboard/listings" variant="secondary">Try again</ButtonLink>}
      />
    );
  }

  const activeTab = params.status ?? '';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="My listings"
        description="Every draft, submission and decision, with what to do next on anything that is blocked."
        actions={
          <>
            <ButtonLink href="/search" variant="secondary" size="sm">View public catalogue</ButtonLink>
            <ButtonLink href="/dashboard/listings/new" variant="primary" size="sm" icon="plus">New listing</ButtonLink>
          </>
        }
      />

      <nav className="flex flex-wrap gap-1.5" aria-label="Filter listings by status">
        {TABS.map((tab) => {
          const active = activeTab === tab.value;
          const href = tab.value ? `/dashboard/listings?status=${encodeURIComponent(tab.value)}` : '/dashboard/listings';
          return (
            <Link
              key={tab.label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'rounded-full border border-brand-600 bg-brand-600 px-3 py-1.5 text-sm font-medium text-white'
                  : 'rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink-700 transition-colors hover:bg-surface-muted'
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {result.data.length === 0 ? (
        <div className="sm-card">
          <EmptyState
            icon="box"
            title={activeTab ? 'Nothing in this state' : 'You have no listings yet'}
            description={
              activeTab
                ? 'Try a different filter, or create a new listing to sell a device.'
                : 'Create your first listing, attach photographs and evidence, then submit it for verification.'
            }
            action={<ButtonLink href="/dashboard/listings/new" variant="primary" icon="plus">Create a listing</ButtonLink>}
          />
        </div>
      ) : (
        <Panel bodyClassName="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Listing</Th>
                <Th>State</Th>
                <Th className="text-right">Price</Th>
                <Th>Updated</Th>
                <Th>Next step</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {result.data.map((listing) => (
                <tr key={listing.id} className="transition-colors hover:bg-surface-muted">
                  <Td>
                    <div className="flex items-center gap-3">
                      <span className="h-11 w-11 shrink-0 overflow-hidden rounded-control bg-surface-sunken">
                        {listing.primaryImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={listing.primaryImage.url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-ink-400">
                            <Icon name="image" size={16} />
                          </span>
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-900">{listing.title}</p>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {listing.category.name} · {CONDITION_LABELS[listing.condition]} · {listing.region}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <ListingStatusBadge status={listing.status} size="sm" />
                      {listing.evidenceRequests.length > 0 && listing.status === 'evidence_required' ? (
                        <Badge tone="warning" size="sm">
                          {listing.evidenceRequests.length} evidence request{listing.evidenceRequests.length === 1 ? '' : 's'}
                        </Badge>
                      ) : null}
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">{formatTzs(listing.askingPriceTzs)}</Td>
                  <Td className="whitespace-nowrap text-xs text-ink-500">{formatRelative(listing.updatedAt)}</Td>
                  <Td className="text-xs text-ink-600">{listing.nextAction?.description ?? 'No action needed'}</Td>
                  <Td>
                    <div className="flex justify-end gap-1.5">
                      <Link
                        href={`/dashboard/listings/${listing.id}`}
                        className="inline-flex h-8 items-center rounded-control border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink-800 hover:bg-surface-muted"
                      >
                        {listing.nextAction ? 'Resolve' : 'Open'}
                      </Link>
                      {listing.status === 'approved' ? (
                        <Link
                          href={`/listings/${listing.slug}`}
                          className="inline-flex h-8 items-center rounded-control border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink-800 hover:bg-surface-muted"
                        >
                          Public page
                        </Link>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-ink-500">
            <span>
              {result.meta.total} {result.meta.total === 1 ? 'listing' : 'listings'} · page {result.meta.page} of{' '}
              {Math.max(result.meta.totalPages, 1)}
            </span>
            <span className="flex gap-2">
              {result.meta.hasPreviousPage ? (
                <Link
                  href={`/dashboard/listings?${new URLSearchParams({ ...(params.status ? { status: params.status } : {}), page: String(page - 1) })}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  Previous
                </Link>
              ) : null}
              {result.meta.hasNextPage ? (
                <Link
                  href={`/dashboard/listings?${new URLSearchParams({ ...(params.status ? { status: params.status } : {}), page: String(page + 1) })}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  Next
                </Link>
              ) : null}
            </span>
          </div>
        </Panel>
      )}

      <Panel title="Statuses explained">
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.entries(LISTING_STATUS_LABELS).map(([status, label]) => (
            <li key={status} className="flex items-center gap-2 text-sm text-ink-600">
              <ListingStatusBadge status={status as OwnerListingDto['status']} size="sm" />
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

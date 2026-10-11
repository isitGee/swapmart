import Link from 'next/link';
import type { ListingSummaryDto } from '@swapmart/shared';
import { Badge, ListingStatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Panel, Table, Td, Th } from '@/components/ui/feedback';
import { serverFetchPage } from '@/lib/server-api';
import { formatNumber, formatRelative, formatTzs, humanize, LISTING_STATUS_LABELS } from '@/lib/format';

const QUEUE_TABS = [
  { value: '', label: 'Everything' },
  { value: 'checks_pending', label: 'Checks pending' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'under_review', label: 'Under review' },
  { value: 'evidence_required', label: 'Awaiting evidence' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
];

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; sort?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  let result;
  try {
    result = await serverFetchPage<ListingSummaryDto>('/admin/listings', {
      params: {
        page,
        perPage: 25,
        status: params.status,
        q: params.q,
        sort: params.sort ?? 'oldest',
      },
    });
  } catch (error) {
    return (
      <ErrorState
        title="The review queue could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/admin/listings" variant="secondary">Retry</ButtonLink>}
      />
    );
  }

  const activeTab = params.status ?? '';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Moderation"
        title="Listing review queue"
        description="Every submission with its automated-check outcome. Decisions record a reason code, a note, and your account — and they are written to the audit log."
      />

      <div className="flex flex-wrap items-center gap-3">
        <form action="/admin/listings" method="get" className="flex flex-1 flex-wrap items-center gap-2">
          <input
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Search by title, model or seller email"
            className="sm-input max-w-md"
            aria-label="Search the review queue"
          />
          {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
          <select name="sort" defaultValue={params.sort ?? 'oldest'} className="sm-input max-w-40" aria-label="Sort order">
            <option value="oldest">Oldest first (SLA)</option>
            <option value="newest">Newest first</option>
            <option value="priority">By priority</option>
          </select>
          <button
            type="submit"
            className="inline-flex h-10 items-center rounded-control bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
          >
            Apply
          </button>
        </form>
      </div>

      <nav className="flex flex-wrap gap-1.5" aria-label="Filter by status">
        {QUEUE_TABS.map((tab) => {
          const active = activeTab === tab.value;
          const search = new URLSearchParams();
          if (tab.value) search.set('status', tab.value);
          if (params.q) search.set('q', params.q);
          if (params.sort) search.set('sort', params.sort);
          const href = search.toString() ? `/admin/listings?${search}` : '/admin/listings';
          return (
            <Link
              key={tab.label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'rounded-full border border-ink-900 bg-ink-900 px-3 py-1.5 text-sm font-medium text-white'
                  : 'rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-surface-muted'
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
            icon="shield"
            title="Nothing in this part of the queue"
            description="Submissions appear here as soon as a seller submits them and the automated checks complete."
          />
        </div>
      ) : (
        <Panel bodyClassName="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Listing</Th>
                <Th>Seller</Th>
                <Th>State</Th>
                <Th>Submitted</Th>
                <Th className="text-right">Price</Th>
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
                        ) : null}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-900">{listing.title}</p>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {listing.category.name} · {listing.brand} {listing.model}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-sm">
                    {listing.seller.displayName}
                    <span className="mt-0.5 block text-xs text-ink-500">{listing.region}</span>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <ListingStatusBadge status={listing.status} size="sm" />
                      {listing.status === 'approved' ? (
                        <Badge size="sm" tone="success">Published</Badge>
                      ) : (
                        <Badge size="sm" tone="neutral">{LISTING_STATUS_LABELS[listing.status]}</Badge>
                      )}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-ink-500">
                    {listing.publishedAt ? formatRelative(listing.publishedAt) : humanize('not published')}
                  </Td>
                  <Td className="text-right tabular-nums">{formatTzs(listing.askingPriceTzs)}</Td>
                  <Td>
                    <Link
                      href={`/admin/listings/${listing.id}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      Review
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-ink-500">
            <span>{formatNumber(result.meta.total)} listings</span>
            <span className="flex gap-2">
              {result.meta.hasPreviousPage ? (
                <Link href={`/admin/listings?${new URLSearchParams({ ...(params.status ? { status: params.status } : {}), page: String(page - 1) })}`} className="font-medium text-brand-700 hover:underline">
                  Previous
                </Link>
              ) : null}
              {result.meta.hasNextPage ? (
                <Link href={`/admin/listings?${new URLSearchParams({ ...(params.status ? { status: params.status } : {}), page: String(page + 1) })}`} className="font-medium text-brand-700 hover:underline">
                  Next
                </Link>
              ) : null}
            </span>
          </div>
        </Panel>
      )}
    </div>
  );
}

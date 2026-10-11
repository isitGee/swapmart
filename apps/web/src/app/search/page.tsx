import { Suspense } from 'react';
import Link from 'next/link';
import type { BrandDto, CategoryDto, ListingSummaryDto } from '@swapmart/shared';
import { ListingCard } from '@/components/marketplace/listing-card';
import { ListingFilters } from '@/components/marketplace/listing-filters';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, SkeletonCardGrid } from '@/components/ui/feedback';
import { serverFetchPage, serverFetchSafe } from '@/lib/server-api';
import { formatNumber } from '@/lib/format';

interface SearchParams {
  q?: string;
  category?: string;
  brand?: string;
  condition?: string;
  region?: string;
  minPrice?: string;
  maxPrice?: string;
  availability?: string;
  exchangeAllowed?: string;
  sort?: string;
  page?: string;
}

export const metadata = { title: 'Browse listings' };

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Catalogue"
        title={params.q ? `Results for “${params.q}”` : 'All verified devices'}
        description="Every listing shown here has been approved by an administrator. Filter by category, condition, price and location — the URL keeps your filters so you can share the search."
      />

      <Suspense fallback={<SearchResultsSkeleton />}>
        <SearchResults params={params} />
      </Suspense>
    </div>
  );
}

async function SearchResults({ params }: { params: SearchParams }) {
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  const query: Record<string, string | number | undefined> = {
    page,
    perPage: 12,
    q: params.q,
    category: params.category,
    brand: params.brand,
    condition: params.condition,
    region: params.region,
    minPrice: params.minPrice,
    maxPrice: params.maxPrice,
    availability: params.availability ?? 'available',
    exchangeAllowed: params.exchangeAllowed,
    sort: params.sort ?? 'newest',
  };

  const [categories, brands] = await Promise.all([
    serverFetchSafe<CategoryDto[]>('/categories', []),
    serverFetchSafe<BrandDto[]>('/brands', []),
  ]);

  let results: { data: ListingSummaryDto[]; meta: { total: number; totalPages: number; page: number; perPage: number } };
  try {
    results = await serverFetchPage<ListingSummaryDto>('/listings', { params: query });
  } catch (error) {
    return (
      <ErrorState
        title="The catalogue could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/search" variant="secondary">Reset the search</ButtonLink>}
      />
    );
  }

  const activeFilterCount = ['category', 'brand', 'condition', 'region', 'minPrice', 'maxPrice', 'exchangeAllowed'].filter(
    (key) => params[key as keyof SearchParams],
  ).length;

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[16rem_1fr]">
      <ListingFilters categories={categories} brands={brands} resultCount={results.meta.total} />

      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-600">
            <span className="font-semibold text-ink-900">{formatNumber(results.meta.total)}</span>{' '}
            {results.meta.total === 1 ? 'listing' : 'listings'}
            {activeFilterCount > 0 ? ' match your filters' : ' published'}
          </p>
          {params.q ? (
            <Link href={`/search?${new URLSearchParams({ ...(params.sort ? { sort: params.sort } : {}) }).toString()}`} className="text-sm text-ink-600">
              Clear search term
            </Link>
          ) : null}
        </div>

        {results.data.length === 0 ? (
          <div className="sm-card">
            <EmptyState
              icon="search"
              title="No listings match these filters"
              description="Try widening the price range, choosing a different region, or clearing a filter or two."
              action={
                <>
                  <ButtonLink href="/search" variant="secondary" icon="refresh">
                    Reset filters
                  </ButtonLink>
                  <ButtonLink href="/dashboard/listings/new" variant="primary" icon="plus">
                    Sell your device
                  </ButtonLink>
                </>
              }
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {results.data.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>

            <PaginationBar
              page={results.meta.page}
              totalPages={results.meta.totalPages}
              total={results.meta.total}
              perPage={results.meta.perPage}
              params={params}
            />
          </>
        )}
      </div>
    </div>
  );
}

async function PaginationBar({
  page,
  totalPages,
  total,
  perPage,
  params,
}: {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  params: SearchParams;
}) {
  if (totalPages <= 1) return null;

  const linkFor = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (!value || key === 'page') continue;
      search.set(key, String(value));
    }
    if (target > 1) search.set('page', String(target));
    const query = search.toString();
    return query ? `/search?${query}` : '/search';
  };

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const windowStart = Math.max(1, Math.min(page - 2, totalPages - 4));
  const windowEnd = Math.min(totalPages, windowStart + 4);
  const numbers: number[] = [];
  for (let index = windowStart; index <= windowEnd; index += 1) numbers.push(index);

  return (
    <nav className="mt-8 flex flex-wrap items-center justify-between gap-3" aria-label="Pagination">
      <p className="text-xs text-ink-500">
        Showing {from}–{to} of {formatNumber(total)}
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={linkFor(page - 1)} className="rounded-control border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-surface-muted">
            Previous
          </Link>
        ) : (
          <span className="rounded-control border border-line px-3 py-1.5 text-sm text-ink-400">Previous</span>
        )}
        {numbers.map((number) => (
          <Link
            key={number}
            href={linkFor(number)}
            aria-current={number === page ? 'page' : undefined}
            className={
              number === page
                ? 'rounded-control border border-brand-600 bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white'
                : 'rounded-control border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-surface-muted'
            }
          >
            {number}
          </Link>
        ))}
        {page < totalPages ? (
          <Link href={linkFor(page + 1)} className="rounded-control border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-surface-muted">
            Next
          </Link>
        ) : (
          <span className="rounded-control border border-line px-3 py-1.5 text-sm text-ink-400">Next</span>
        )}
      </div>
    </nav>
  );
}

function SearchResultsSkeleton() {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[16rem_1fr]">
      <div className="hidden lg:block">
        <div className="sm-card h-96 animate-pulse p-4" />
      </div>
      <SkeletonCardGrid count={6} />
    </div>
  );
}

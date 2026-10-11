import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CategoryDto, ListingSummaryDto } from '@swapmart/shared';
import { ListingCard } from '@/components/marketplace/listing-card';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/ui/feedback';
import { Icon, categoryIcon } from '@/components/ui/icon';
import { serverFetchPage, serverFetchSafe } from '@/lib/server-api';
import { formatNumber } from '@/lib/format';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const categories = await serverFetchSafe<CategoryDto[]>('/categories', []);
  const category = categories.find((item) => item.slug === slug);
  return { title: category ? `${category.name} for sale` : 'Category' };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const categories = await serverFetchSafe<CategoryDto[]>('/categories', []);
  const category = categories.find((item) => item.slug === slug);
  if (!category) notFound();

  const results = await serverFetchPage<ListingSummaryDto>('/listings', {
    params: { category: slug, perPage: 24, sort: 'newest', availability: 'available' },
  }).catch(() => ({ data: [] as ListingSummaryDto[], meta: { page: 1, perPage: 24, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false } }));

  const others = categories.filter((item) => item.slug !== slug);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs text-ink-500">
        <Link href="/" className="hover:text-brand-700">Home</Link>
        <Icon name="chevron" size={12} />
        <Link href="/search" className="hover:text-brand-700">Catalogue</Link>
        <Icon name="chevron" size={12} />
        <span className="text-ink-700">{category.name}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          eyebrow="Category"
          title={
            <span className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-control bg-brand-50 text-brand-700">
                <Icon name={categoryIcon(category.icon)} size={18} />
              </span>
              {category.name}
            </span>
          }
          description={category.description}
        />
        <ButtonLink href={`/search?category=${category.slug}`} variant="secondary" icon="filter">
          Filter and sort
        </ButtonLink>
      </div>

      <p className="mt-4 text-sm text-ink-600">
        <span className="font-semibold text-ink-900">{formatNumber(results.meta.total)}</span> approved{' '}
        {results.meta.total === 1 ? 'listing' : 'listings'} available in this category
      </p>

      {results.data.length === 0 ? (
        <div className="sm-card mt-4">
          <EmptyState
            icon={categoryIcon(category.icon)}
            title={`No approved ${category.name.toLowerCase()} listings right now`}
            description="Listings only appear here once an administrator has approved them. Check back shortly, or browse another category."
            action={
              <>
                <ButtonLink href="/search" variant="secondary">Browse all categories</ButtonLink>
                <ButtonLink href="/dashboard/listings/new" variant="primary" icon="plus">Sell a device</ButtonLink>
              </>
            }
          />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {results.data.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}

      <section className="mt-12">
        <h2 className="text-base font-semibold text-ink-900">Other categories</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {others.map((item) => (
            <Link
              key={item.slug}
              href={`/categories/${item.slug}`}
              className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink-700 transition-colors hover:bg-surface-muted"
            >
              {item.name}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

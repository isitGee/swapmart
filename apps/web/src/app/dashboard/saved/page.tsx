import Link from 'next/link';
import type { SavedListingDto } from '@swapmart/shared';
import { ListingCard } from '@/components/marketplace/listing-card';
import { ButtonLink } from '@/components/ui/button';
import { Alert, EmptyState, ErrorState, PageHeader } from '@/components/ui/feedback';
import { serverFetchPage } from '@/lib/server-api';

export default async function SavedListingsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  let result;
  try {
    result = await serverFetchPage<SavedListingDto>('/me/saved', { params: { page, perPage: 24 } });
  } catch (error) {
    return (
      <ErrorState
        title="Saved listings could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/dashboard/saved" variant="secondary">Try again</ButtonLink>}
      />
    );
  }

  const unavailable = result.data.filter((entry) => entry.availabilityNote);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Saved listings"
        description="Devices you bookmarked to compare or come back to. If a saved listing is sold or withdrawn, it is flagged here rather than disappearing silently."
      />

      {unavailable.length > 0 ? (
        <Alert tone="warning" title={`${unavailable.length} saved listing${unavailable.length === 1 ? '' : 's'} no longer available`}>
          <ul className="mt-1 space-y-1">
            {unavailable.map((entry) => (
              <li key={entry.id}>
                <Link href={`/listings/${entry.listing.slug}`} className="font-medium underline">
                  {entry.listing.title}
                </Link>{' '}
                — {entry.availabilityNote}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {result.data.length === 0 ? (
        <div className="sm-card">
          <EmptyState
            icon="bookmark"
            title="Nothing saved yet"
            description="Use the Save button on any listing to keep it here for later."
            action={<ButtonLink href="/search" variant="primary" icon="search">Browse the catalogue</ButtonLink>}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {result.data.map((entry) => (
            <ListingCard key={entry.id} listing={entry.listing} />
          ))}
        </div>
      )}
    </div>
  );
}

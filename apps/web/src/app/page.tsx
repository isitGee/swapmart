import Link from 'next/link';
import type { CategoryDto, ListingSummaryDto } from '@swapmart/shared';
import { ListingCard } from '@/components/marketplace/listing-card';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, Panel, StatCard } from '@/components/ui/feedback';
import { Icon, categoryIcon } from '@/components/ui/icon';
import { serverFetchSafe } from '@/lib/server-api';
import { formatNumber } from '@/lib/format';

interface Highlights {
  featured: ListingSummaryDto[];
  recent: ListingSummaryDto[];
  stats: { publishedListings: number; activeSellers: number; categories: number; identityReviewedSellers: number };
}

export default async function HomePage() {
  const [categories, highlights] = await Promise.all([
    serverFetchSafe<CategoryDto[]>('/categories', []),
    serverFetchSafe<Highlights>('/marketplace/highlights', {
      featured: [],
      recent: [],
      stats: { publishedListings: 0, activeSellers: 0, categories: 0, identityReviewedSellers: 0 },
    }),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Hero: what the marketplace is and the single action that matters. */}
      <section className="grid items-center gap-8 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
            <Icon name="shield-check" size={13} />
            Structured device verification on every published listing
          </p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-4xl">
            Buy and sell second-hand electronics in Tanzania — with the device history checked first.
          </h1>
          <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-ink-600">
            Sellers submit identifier records and supporting evidence. Automated checks look for malformed, reused or
            duplicated identifiers, and an administrator reviews the submission before it appears in the public catalogue.
          </p>

          <form action="/search" method="get" role="search" className="mt-6 flex max-w-xl flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Icon name="search" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <label htmlFor="hero-search" className="sr-only">
                Search the catalogue
              </label>
              <input
                id="hero-search"
                name="q"
                type="search"
                placeholder="Try “iPhone 13”, “MacBook Air”, “PlayStation 5”"
                className="sm-input h-11 pl-10"
                autoComplete="off"
              />
            </div>
            <ButtonLink href="/search" variant="secondary" size="lg" iconRight="arrow-right">
              Browse everything
            </ButtonLink>
          </form>

          <dl className="mt-8 grid max-w-xl grid-cols-2 gap-4 sm:grid-cols-4">
            <HeroStat label="Published listings" value={highlights.stats.publishedListings} />
            <HeroStat label="Active sellers" value={highlights.stats.activeSellers} />
            <HeroStat label="Categories" value={highlights.stats.categories} />
            <HeroStat label="Identity reviewed" value={highlights.stats.identityReviewedSellers} />
          </dl>
        </div>

        <div className="sm-card p-5">
          <h2 className="text-base font-semibold text-ink-900">How a listing is verified</h2>
          <ol className="mt-4 flex flex-col gap-3.5">
            {[
              {
                icon: 'upload' as const,
                title: 'Seller submits the device record',
                body: 'Specification, condition, photographs, the identifier and supporting evidence such as a proof of purchase.',
              },
              {
                icon: 'gauge' as const,
                title: 'Automated checks run immediately',
                body: 'Identifier format and checksum, duplicate detection against other active claims, evidence completeness, price sanity and image reuse.',
              },
              {
                icon: 'shield' as const,
                title: 'An administrator decides',
                body: 'Approve, reject, suspend or request more evidence — always with a recorded reason. The decision and history stay on the audit trail.',
              },
              {
                icon: 'check-circle' as const,
                title: 'Approved listings go public',
                body: 'Only approved, available listings are visible. Identifiers stay masked and evidence remains private to moderators.',
              },
            ].map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <Icon name={step.icon} size={16} />
                </span>
                <div>
                  <p className="text-sm font-medium text-ink-900">
                    <span className="mr-1.5 text-ink-400">{index + 1}.</span>
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-600">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <Link
            href="/how-verification-works"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
          >
            What approval does and does not mean
            <Icon name="arrow-right" size={15} />
          </Link>
        </div>
      </section>

      {/* Categories */}
      <section className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink-900">Browse by category</h2>
            <p className="mt-1 text-sm text-ink-600">Six categories cover the consumer electronics traded on SWAPMART.</p>
          </div>
          <Link href="/search" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
            All listings
            <Icon name="arrow-right" size={15} />
          </Link>
        </div>

        {categories.length === 0 ? (
          <div className="sm-card mt-4">
            <EmptyState
              icon="grid"
              title="Categories are unavailable"
              description="The catalogue could not be loaded. The API or database may be starting up."
            />
          </div>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <li key={category.slug}>
                <Link
                  href={`/categories/${category.slug}`}
                  className="sm-card flex items-start gap-3.5 p-4 transition-shadow hover:shadow-raised"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-brand-700">
                    <Icon name={categoryIcon(category.icon)} size={19} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                      {category.name}
                      {category.listingCount !== undefined ? (
                        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-ink-600">
                          {formatNumber(category.listingCount)}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[0.8125rem] leading-relaxed text-ink-600">{category.description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recently published */}
      <section className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink-900">Recently verified devices</h2>
            <p className="mt-1 text-sm text-ink-600">
              Each of these passed automated checks and an administrator review before publication.
            </p>
          </div>
          <Link href="/search?sort=newest" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
            See more
            <Icon name="arrow-right" size={15} />
          </Link>
        </div>

        {highlights.recent.length === 0 ? (
          <div className="sm-card mt-4">
            <EmptyState
              icon="box"
              title="No published listings yet"
              description="Once a listing is approved by an administrator it appears here."
              action={<ButtonLink href="/dashboard/listings/new" variant="primary" icon="plus">Create the first listing</ButtonLink>}
            />
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {highlights.recent.slice(0, 8).map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>

      {/* Trust panel */}
      <section className="mt-14 grid gap-4 lg:grid-cols-3">
        <Panel title="Duplicate identifiers are blocked in the database" className="lg:col-span-2">
          <p className="text-sm text-ink-600">
            When a seller claims an identifier that is already attached to an active listing, PostgreSQL refuses the write.
            The attempt is recorded as a duplicate alert for administrators, and the second seller is told only that the
            identifier is unavailable — never who holds it.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <StatCard label="Detection" value="Transactional" hint="Partial unique index on active claims" />
            <StatCard label="Race handling" value="Serialised" hint="Concurrent submissions cannot both succeed" />
            <StatCard label="Disclosure" value="None" hint="No other member's data is revealed" />
          </div>
        </Panel>
        <Panel title="What SWAPMART cannot do">
          <ul className="space-y-2.5 text-sm text-ink-600">
            <li className="flex gap-2">
              <Icon name="x" size={15} className="mt-0.5 shrink-0 text-danger-600" />
              It cannot prove legal ownership of a device.
            </li>
            <li className="flex gap-2">
              <Icon name="x" size={15} className="mt-0.5 shrink-0 text-danger-600" />
              It does not process, hold or refund payments.
            </li>
            <li className="flex gap-2">
              <Icon name="x" size={15} className="mt-0.5 shrink-0 text-danger-600" />
              It cannot guarantee a device has never been reported stolen where no authoritative provider is connected.
            </li>
          </ul>
          <Link href="/how-verification-works" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
            Read the full limitations
            <Icon name="arrow-right" size={15} />
          </Link>
        </Panel>
      </section>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink-900">{formatNumber(value)}</dd>
    </div>
  );
}

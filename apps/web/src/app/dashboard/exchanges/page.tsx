import Link from 'next/link';
import type { ExchangeRequestDto } from '@swapmart/shared';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Panel } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { serverFetchPage } from '@/lib/server-api';
import { EXCHANGE_STATUS_LABELS, formatRelative, formatTzs } from '@/lib/format';
import { ExchangeResponse } from './exchange-response';

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'incoming', label: 'Incoming' },
  { value: 'outgoing', label: 'Sent' },
];

export default async function ExchangesPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const role = params.role ?? 'all';
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  let result;
  try {
    result = await serverFetchPage<ExchangeRequestDto>('/exchanges', { params: { role, page, perPage: 20, ...(params.status ? { status: params.status } : {}) } });
  } catch (error) {
    return (
      <ErrorState
        title="Exchange requests could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/dashboard/exchanges" variant="secondary">Try again</ButtonLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Exchange requests"
        description="Proposals to swap one device for another, sometimes with a price difference. Accepting creates a transaction record — no money is processed by SWAPMART."
      />

      <nav className="flex flex-wrap gap-1.5" aria-label="Filter exchange requests">
        {TABS.map((tab) => {
          const active = role === tab.value;
          return (
            <Link
              key={tab.value}
              href={`/dashboard/exchanges?role=${tab.value}`}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'rounded-full border border-brand-600 bg-brand-600 px-3 py-1.5 text-sm font-medium text-white'
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
            icon="arrow-swap"
            title="No exchange requests here"
            description="When a buyer proposes a swap for one of your listings it appears here, and you can accept, reject or counter it."
            action={<ButtonLink href="/search" variant="primary" icon="search">Find a device to swap for</ButtonLink>}
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {result.data.map((exchange) => (
            <li key={exchange.id}>
              <Panel
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={exchange.direction === 'incoming' ? 'info' : 'neutral'}>
                      {exchange.direction === 'incoming' ? 'Incoming' : 'Sent'}
                    </Badge>
                    <Badge
                      tone={
                        exchange.status === 'accepted'
                          ? 'success'
                          : exchange.status === 'rejected' || exchange.status === 'cancelled'
                            ? 'danger'
                            : exchange.status === 'pending'
                              ? 'warning'
                              : 'neutral'
                      }
                    >
                      {EXCHANGE_STATUS_LABELS[exchange.status]}
                    </Badge>
                    <span className="text-xs font-normal text-ink-500">
                      {exchange.direction === 'incoming'
                        ? `from ${exchange.requester.displayName}`
                        : `to ${exchange.recipient.displayName}`}{' '}
                      · {formatRelative(exchange.createdAt)}
                    </span>
                  </span>
                }
                bodyClassName="p-4"
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <SwapCard
                    label={exchange.direction === 'incoming' ? 'They want' : 'You want'}
                    title={exchange.targetListing.title}
                    price={exchange.targetListing.askingPriceTzs}
                    imageUrl={exchange.targetListing.primaryImageUrl}
                    slug={exchange.targetListing.slug}
                  />
                  <div className="flex items-center justify-center">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-sunken text-ink-500">
                      <Icon name="arrow-swap" size={16} />
                    </span>
                  </div>
                  {exchange.offeredListing ? (
                    <SwapCard
                      label={exchange.direction === 'incoming' ? 'They offer' : 'You offer'}
                      title={exchange.offeredListing.title}
                      price={exchange.offeredListing.askingPriceTzs}
                      imageUrl={exchange.offeredListing.primaryImageUrl}
                      slug={exchange.offeredListing.slug}
                    />
                  ) : (
                    <p className="text-sm text-ink-500">No device was offered — this proposal is cash-based.</p>
                  )}
                </div>

                <p className="mt-3 rounded-control bg-surface-muted px-3 py-2 text-sm text-ink-700">{exchange.message}</p>

                <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-ink-500">Price difference</dt>
                    <dd className="font-medium text-ink-800">
                      {exchange.priceDifferenceTzs === 0
                        ? 'No cash adjustment'
                        : exchange.priceDifferenceTzs > 0
                          ? `${formatTzs(exchange.priceDifferenceTzs)} top-up offered`
                          : `${formatTzs(Math.abs(exchange.priceDifferenceTzs))} expected back`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Responded</dt>
                    <dd className="text-ink-800">{exchange.respondedAt ? formatRelative(exchange.respondedAt) : 'Not yet'}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Transaction record</dt>
                    <dd className="text-ink-800">
                      {exchange.transactionId ? (
                        <Link href={`/dashboard/transactions/${exchange.transactionId}`} className="font-medium text-brand-700 hover:underline">
                          Open
                        </Link>
                      ) : (
                        'Created when accepted'
                      )}
                    </dd>
                  </div>
                </dl>

                {exchange.availableActions.length > 0 ? (
                  <div className="mt-4 border-t border-line pt-4">
                    <ExchangeResponse exchange={exchange} />
                  </div>
                ) : null}
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SwapCard({
  label,
  title,
  price,
  imageUrl,
  slug,
}: {
  label: string;
  title: string;
  price: number;
  imageUrl: string | null;
  slug: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-line p-2.5">
      <span className="h-14 w-14 shrink-0 overflow-hidden rounded-control bg-surface-sunken">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-ink-400">
            <Icon name="image" size={16} />
          </span>
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-[0.6875rem] uppercase tracking-wide text-ink-500">{label}</span>
        <Link href={`/listings/${slug}`} className="block truncate text-sm font-medium text-ink-900 hover:text-brand-700">
          {title}
        </Link>
        <span className="block text-xs text-ink-600">{formatTzs(price)}</span>
      </span>
    </div>
  );
}

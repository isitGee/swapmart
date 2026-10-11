import Link from 'next/link';
import type { TransactionDto } from '@swapmart/shared';
import { TransactionStatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Panel, Table, Td, Th } from '@/components/ui/feedback';
import { serverFetchPage } from '@/lib/server-api';
import { formatRelative, formatTzs, humanize } from '@/lib/format';

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'buyer', label: 'As buyer' },
  { value: 'seller', label: 'As seller' },
];

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ role?: string; status?: string }> }) {
  const params = await searchParams;
  const role = params.role ?? 'all';

  let result;
  try {
    result = await serverFetchPage<TransactionDto>('/transactions', { params: { role, perPage: 30, ...(params.status ? { status: params.status } : {}) } });
  } catch (error) {
    return (
      <ErrorState
        title="Transactions could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/dashboard/transactions" variant="secondary">Try again</ButtonLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Transactions"
        description="A shared, dated record of what you agreed with another member and how the hand-over progressed. SWAPMART does not process payments or hold funds."
      />

      <nav className="flex flex-wrap gap-1.5" aria-label="Filter transactions">
        {TABS.map((tab) => {
          const active = role === tab.value;
          return (
            <Link
              key={tab.value}
              href={`/dashboard/transactions?role=${tab.value}`}
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
            icon="handshake"
            title="No transactions yet"
            description="Record an offer from any listing, or accept an exchange proposal, and the transaction appears here with its full status history."
            action={<ButtonLink href="/search" variant="primary" icon="search">Browse listings</ButtonLink>}
          />
        </div>
      ) : (
        <Panel bodyClassName="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Device</Th>
                <Th>Counterpart</Th>
                <Th>Status</Th>
                <Th className="text-right">Amount</Th>
                <Th>Updated</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {result.data.map((transaction) => (
                <tr key={transaction.id} className="transition-colors hover:bg-surface-muted">
                  <Td className="font-mono text-xs">{transaction.reference}</Td>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <span className="h-9 w-9 shrink-0 overflow-hidden rounded-control bg-surface-sunken">
                        {transaction.listing.primaryImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={transaction.listing.primaryImageUrl} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink-900">{transaction.listing.title}</span>
                        <span className="text-xs text-ink-500">{humanize(transaction.type)}</span>
                      </span>
                    </div>
                  </Td>
                  <Td className="text-sm">
                    {transaction.buyer.id === transaction.seller.id
                      ? '—'
                      : transaction.buyer.displayName}
                    <span className="mt-0.5 block text-xs text-ink-500">
                      buyer {transaction.buyer.displayName} · seller {transaction.seller.displayName}
                    </span>
                  </Td>
                  <Td>
                    <TransactionStatusBadge status={transaction.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{formatTzs(transaction.agreedAmountTzs)}</Td>
                  <Td className="whitespace-nowrap text-xs text-ink-500">{formatRelative(transaction.updatedAt)}</Td>
                  <Td>
                    <Link
                      href={`/dashboard/transactions/${transaction.id}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      Open
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </div>
  );
}

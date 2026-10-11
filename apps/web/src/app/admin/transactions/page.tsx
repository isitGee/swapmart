import Link from 'next/link';
import type { TransactionDto } from '@swapmart/shared';
import { TransactionStatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Panel, Table, Td, Th } from '@/components/ui/feedback';
import { serverFetchPage } from '@/lib/server-api';
import { formatDateTime, formatNumber, formatRelative, formatTzs, humanize } from '@/lib/format';

const TABS = ['initiated', 'negotiating', 'agreed', 'completed', 'cancelled', 'disputed'];

export default async function AdminTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  let result;
  try {
    result = await serverFetchPage<TransactionDto>('/admin/transactions', {
      params: { page, perPage: 25, ...(params.status ? { status: params.status } : {}) },
    });
  } catch (error) {
    return (
      <ErrorState
        title="Transactions could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/admin/transactions" variant="secondary">Retry</ButtonLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Marketplace"
        title="Transaction monitoring"
        description="Every agreement recorded between members with its status history. SWAPMART processes no payments, so this view exists for dispute investigation and platform health — not for settling money."
      />

      <nav className="flex flex-wrap gap-1.5" aria-label="Filter transactions by status">
        <Link
          href="/admin/transactions"
          className={
            !params.status
              ? 'rounded-full border border-ink-900 bg-ink-900 px-3 py-1.5 text-sm font-medium text-white'
              : 'rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-surface-muted'
          }
        >
          All
        </Link>
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={`/admin/transactions?status=${tab}`}
            className={
              params.status === tab
                ? 'rounded-full border border-ink-900 bg-ink-900 px-3 py-1.5 text-sm font-medium text-white'
                : 'rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-surface-muted'
            }
          >
            {humanize(tab)}
          </Link>
        ))}
      </nav>

      {result.data.length === 0 ? (
        <div className="sm-card">
          <EmptyState icon="handshake" title="No transactions" description="No transaction records match this filter." />
        </div>
      ) : (
        <Panel bodyClassName="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Device</Th>
                <Th>Parties</Th>
                <Th>Status</Th>
                <Th className="text-right">Agreed amount</Th>
                <Th>Last change</Th>
                <Th>Dispute</Th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((transaction) => (
                <tr key={transaction.id} className="transition-colors hover:bg-surface-muted">
                  <Td className="font-mono text-xs">{transaction.reference}</Td>
                  <Td className="text-sm">
                    {transaction.listing.title}
                    <span className="mt-0.5 block text-xs text-ink-500">{humanize(transaction.type)}</span>
                  </Td>
                  <Td className="text-xs">
                    buyer {transaction.buyer.displayName}
                    <span className="block">seller {transaction.seller.displayName}</span>
                  </Td>
                  <Td>
                    <TransactionStatusBadge status={transaction.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{formatTzs(transaction.agreedAmountTzs)}</Td>
                  <Td className="whitespace-nowrap text-xs text-ink-500">{formatRelative(transaction.updatedAt)}</Td>
                  <Td className="text-xs">
                    {transaction.openDisputeId ? (
                      <Link href="/admin/disputes" className="font-medium text-danger-600 hover:underline">
                        Open dispute
                      </Link>
                    ) : (
                      <span className="text-ink-400">None</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-ink-500">
            <span>{formatNumber(result.meta.total)} transactions</span>
            <span className="flex gap-2">
              {result.meta.hasPreviousPage ? (
                <Link href={`/admin/transactions?page=${page - 1}`} className="font-medium text-brand-700 hover:underline">
                  Previous
                </Link>
              ) : null}
              {result.meta.hasNextPage ? (
                <Link href={`/admin/transactions?page=${page + 1}`} className="font-medium text-brand-700 hover:underline">
                  Next
                </Link>
              ) : null}
            </span>
          </div>
        </Panel>
      )}

      <p className="text-xs text-ink-500">
        Status histories are append-only. Administrators cannot edit a member&rsquo;s transaction, only the parties themselves
        can advance it — investigate through the dispute thread instead. Rows last generated {formatDateTime(result.data[0]?.updatedAt ?? null)}.
      </p>
    </div>
  );
}

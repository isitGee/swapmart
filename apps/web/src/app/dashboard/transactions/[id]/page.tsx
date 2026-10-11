import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { TransactionDto } from '@swapmart/shared';
import { TransactionStatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert, DataList, ErrorState, PageHeader, Panel } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { getCurrentUser, serverFetchSafe } from '@/lib/server-api';
import { formatDateTime, formatTzs, humanize, TRANSACTION_STATUS_LABELS } from '@/lib/format';
import { TransactionStatusControl } from './status-control';

export const metadata = { title: 'Transaction' };

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [transaction, user] = await Promise.all([
    serverFetchSafe<TransactionDto | null>(`/transactions/${id}`, null),
    getCurrentUser(),
  ]);

  if (!transaction) {
    return (
      <ErrorState
        title="Transaction not available"
        message="Only the buyer and the seller in a transaction can open its record."
        retry={<ButtonLink href="/dashboard/transactions" variant="secondary">Back to transactions</ButtonLink>}
      />
    );
  }

  const role = user?.id === transaction.buyer.id ? 'buyer' : user?.id === transaction.seller.id ? 'seller' : 'observer';

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-ink-500">
        <Link href="/dashboard/transactions" className="hover:text-brand-700">
          Transactions
        </Link>
        <Icon name="chevron" size={12} />
        <span className="font-mono text-ink-700">{transaction.reference}</span>
      </nav>

      <PageHeader
        eyebrow={`Reference ${transaction.reference}`}
        title={transaction.listing.title}
        description={`You are the ${role} in this transaction. Every status change is recorded with who made it and when.`}
        actions={<TransactionStatusBadge status={transaction.status} />}
      />

      <Alert tone="info" title="How SWAPMART handles this record">
        {transaction.paymentDisclaimer} Completing a transaction here records an agreement between two members; it does not
        transfer money, and it is not a guarantee about the device.
      </Alert>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-5">
          <Panel title="Parties and device">
            <DataList
              items={[
                { label: 'Buyer', value: transaction.buyer.displayName },
                { label: 'Seller', value: transaction.seller.displayName },
                {
                  label: 'Listing',
                  value: (
                    <Link href={`/listings/${transaction.listing.slug}`} className="font-medium text-brand-700 hover:underline">
                      {transaction.listing.title}
                    </Link>
                  ),
                },
                { label: 'Type', value: humanize(transaction.type) },
                { label: 'Agreed amount', value: formatTzs(transaction.agreedAmountTzs) },
                { label: 'Record opened', value: formatDateTime(transaction.createdAt) },
                ...(transaction.exchangeRequestId
                  ? [
                      {
                        label: 'Origin',
                        value: (
                          <Link href="/dashboard/exchanges" className="font-medium text-brand-700 hover:underline">
                            Exchange request
                          </Link>
                        ),
                      },
                    ]
                  : []),
                ...(transaction.openDisputeId
                  ? [
                      {
                        label: 'Dispute',
                        value: (
                          <Link href="/dashboard/disputes" className="font-medium text-danger-600 hover:underline">
                            An open dispute is attached to this transaction
                          </Link>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Panel>

          <Panel title="Status history" description="Nothing is overwritten — each change appends a row.">
            <ol className="space-y-4">
              {transaction.history.map((entry) => (
                <li key={entry.id} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                  <div>
                    <p className="text-sm text-ink-800">
                      <span className="font-medium">
                        {entry.fromStatus ? `${TRANSACTION_STATUS_LABELS[entry.fromStatus]} → ` : ''}
                        {TRANSACTION_STATUS_LABELS[entry.toStatus]}
                      </span>
                    </p>
                    {entry.note ? <p className="mt-0.5 text-sm text-ink-600">{entry.note}</p> : null}
                    <p className="mt-0.5 text-xs text-ink-500">
                      {entry.actor.name} · {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title="Update the status">
            <TransactionStatusControl transaction={transaction} />
          </Panel>

          <Panel title="Safe hand-over checklist">
            <ul className="space-y-2.5 text-sm text-ink-600">
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-success-600" />Meet in a public place during daylight.</li>
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-success-600" />Check the identifier on the device matches the listing record.</li>
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-success-600" />Test calls, charging, cameras and the touchscreen before paying.</li>
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-success-600" />Keep receipts and the chat history until you are satisfied.</li>
            </ul>
            <p className="mt-3 text-xs text-ink-500">
              If something goes wrong, open a dispute from this transaction. Administrators can see the full record but cannot
              reverse a payment.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

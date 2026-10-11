import Link from 'next/link';
import type { DisputeDto } from '@swapmart/shared';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert, EmptyState, ErrorState, PageHeader, Panel } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { getCurrentUser, serverFetchPage } from '@/lib/server-api';
import { DISPUTE_STATUS_LABELS, formatDateTime, humanize } from '@/lib/format';
import { DisputeThread } from './dispute-thread';

export default async function DisputesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  const [user, result] = await Promise.all([
    getCurrentUser(),
    serverFetchPage<DisputeDto>('/disputes', { params: { page, perPage: 20 } }).catch(() => null),
  ]);

  if (!result) {
    return (
      <ErrorState
        title="Disputes could not be loaded"
        message="The dispute list is available to the parties involved in a transaction."
        retry={<ButtonLink href="/dashboard/transactions" variant="secondary">Back to transactions</ButtonLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Disputes"
        description="Formal disagreements about a transaction, reviewed by administrators. Disputes retain their complete message history — nothing is removed."
      />

      <Alert tone="info" title="How to open a dispute">
        Open a dispute from the transaction record itself, so the administrators can see the agreed amount, the status history
        and any evidence in one place. Try messaging the other party first.
      </Alert>

      {result.data.length === 0 ? (
        <div className="sm-card">
          <EmptyState
            icon="scale"
            title="No disputes"
            description="You have no open or past disputes. Most problems are resolved by talking to the other member."
            action={<ButtonLink href="/dashboard/transactions" variant="secondary">Review your transactions</ButtonLink>}
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {result.data.map((dispute) => (
            <li key={dispute.id}>
              <Panel
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-ink-500">{dispute.reference}</span>
                    <Badge tone={dispute.status === 'resolved' || dispute.status === 'closed' ? 'success' : 'warning'}>
                      {DISPUTE_STATUS_LABELS[dispute.status]}
                    </Badge>
                    <Badge size="sm" tone="neutral">
                      {humanize(dispute.category)}
                    </Badge>
                    <span className="text-xs font-normal text-ink-500">
                      against {dispute.counterparty.displayName} · opened {formatDateTime(dispute.createdAt)}
                    </span>
                  </span>
                }
              >
                <p className="text-sm text-ink-700">{dispute.description}</p>

                <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-ink-500">Transaction</dt>
                    <dd className="text-ink-800">
                      <Link href={`/dashboard/transactions/${dispute.transaction.id}`} className="font-medium text-brand-700 hover:underline">
                        {dispute.transaction.reference}
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Device</dt>
                    <dd className="text-ink-800">{dispute.transaction.listingTitle}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Assigned administrator</dt>
                    <dd className="text-ink-800">{dispute.assignedTo?.name ?? 'Not yet assigned'}</dd>
                  </div>
                </dl>

                {dispute.resolution ? (
                  <div className="mt-3 rounded-control border border-success-600/30 bg-success-50 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-success-700">
                      <Icon name="check-circle" size={13} /> Resolution
                    </p>
                    <p className="mt-1 text-sm text-success-700">{dispute.resolution}</p>
                  </div>
                ) : null}

                <div className="mt-4 border-t border-line pt-4">
                  <DisputeThread dispute={dispute} currentUserId={user?.id ?? null} />
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

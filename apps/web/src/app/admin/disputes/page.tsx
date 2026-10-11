import Link from 'next/link';
import type { DisputeDto } from '@swapmart/shared';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Panel } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { serverFetchPage } from '@/lib/server-api';
import { DISPUTE_STATUS_LABELS, formatDateTime, humanize } from '@/lib/format';
import { DisputeAdminControls } from './dispute-admin-controls';

export default async function AdminDisputesPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  let result;
  try {
    result = await serverFetchPage<DisputeDto>('/admin/disputes', {
      params: { page, perPage: 20, ...(params.status ? { status: params.status } : {}) },
    });
  } catch (error) {
    return (
      <ErrorState
        title="Disputes could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/admin/disputes" variant="secondary">Retry</ButtonLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Trust & safety"
        title="Disputes"
        description="Formal disagreements between a buyer and a seller over a transaction. Both parties see the thread; internal notes are withheld from them."
      />

      {result.data.length === 0 ? (
        <div className="sm-card">
          <EmptyState icon="scale" title="No disputes" description="There are no disputes in this view." />
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
                      {dispute.openedBy.displayName} vs {dispute.counterparty.displayName} · {formatDateTime(dispute.createdAt)}
                    </span>
                  </span>
                }
              >
                <p className="text-sm text-ink-700">{dispute.description}</p>

                <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-ink-500">Transaction</dt>
                    <dd className="text-ink-800">
                      <Link href={`/admin/transactions?status=${dispute.transaction.status}`} className="font-medium text-brand-700 hover:underline">
                        {dispute.transaction.reference}
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Device</dt>
                    <dd className="text-ink-800">{dispute.transaction.listingTitle}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Assigned</dt>
                    <dd className="text-ink-800">{dispute.assignedTo?.name ?? 'Unassigned'}</dd>
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
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Thread ({dispute.messages.length} messages — full history retained)
                  </h3>
                  {dispute.messages.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-500">No messages yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2.5">
                      {dispute.messages.map((message) => (
                        <li key={message.id} className="rounded-control border border-line p-2.5">
                          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                            <span className="font-medium text-ink-800">{message.author.name}</span>
                            {message.author.role === 'admin' ? <Badge size="sm" tone="brand">Admin</Badge> : null}
                            {message.visibility === 'admins_only' ? <Badge size="sm" tone="danger">Admins only</Badge> : null}
                            <span>{formatDateTime(message.createdAt)}</span>
                          </p>
                          <p className="mt-1 whitespace-pre-line text-sm text-ink-700">{message.body}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="mt-4 border-t border-line pt-4">
                  <DisputeAdminControls dispute={dispute} />
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

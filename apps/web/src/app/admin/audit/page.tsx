import Link from 'next/link';
import type { AuditLogDto } from '@swapmart/shared';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { DataList, EmptyState, ErrorState, PageHeader, Panel, Table, Td, Th } from '@/components/ui/feedback';
import { serverFetchPage } from '@/lib/server-api';
import { formatDateTime, formatNumber, humanize } from '@/lib/format';

const ACTIONS = [
  'approved',
  'rejected',
  'suspended',
  'requested_evidence',
  'claimed_for_review',
  'account_restricted',
  'account_unrestricted',
  'report_status_changed',
  'dispute_status_changed',
  'comment_hidden',
  'message_hidden',
];

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  let result;
  try {
    result = await serverFetchPage<AuditLogDto>('/admin/audit-logs', {
      params: { page, perPage: 40, action: params.action, entityType: params.entityType },
    });
  } catch (error) {
    return (
      <ErrorState
        title="The audit log could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/admin/audit" variant="secondary">Retry</ButtonLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Accountability"
        title="Audit log"
        description="Append-only record of every consequential action: who did it, to what, from where and when. Entries cannot be edited or deleted through the application."
      />

      <Panel title="Recorded activity">
        <DataList
          items={[
            { label: 'Entries shown', value: formatNumber(result.data.length) },
            { label: 'Total entries', value: formatNumber(result.meta.total) },
            {
              label: 'Filter',
              value: params.action ? humanize(params.action) : 'All actions',
            },
          ]}
        />
      </Panel>

      <form action="/admin/audit" method="get" className="flex flex-wrap items-center gap-2">
        <select name="action" defaultValue={params.action ?? ''} className="sm-input max-w-56" aria-label="Action">
          <option value="">All actions</option>
          {ACTIONS.map((action) => (
            <option key={action} value={action}>
              {humanize(action)}
            </option>
          ))}
        </select>
        <select name="entityType" defaultValue={params.entityType ?? ''} className="sm-input max-w-48" aria-label="Entity type">
          <option value="">All entities</option>
          {['listing', 'user', 'report', 'dispute', 'transaction', 'device', 'media_asset', 'session'].map((entity) => (
            <option key={entity} value={entity}>
              {humanize(entity)}
            </option>
          ))}
        </select>
        <button type="submit" className="inline-flex h-10 items-center rounded-control bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
          Filter
        </button>
        {params.action || params.entityType ? (
          <Link href="/admin/audit" className="text-sm text-ink-600 hover:text-brand-700">
            Clear
          </Link>
        ) : null}
      </form>

      {result.data.length === 0 ? (
        <div className="sm-card">
          <EmptyState icon="list" title="No audit entries" description="Nothing matches this filter yet." />
        </div>
      ) : (
        <Panel bodyClassName="p-0">
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Actor</Th>
                <Th>Outcome</Th>
                <Th>IP</Th>
                <Th>Metadata</Th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((entry) => (
                <tr key={entry.id}>
                  <Td className="whitespace-nowrap text-xs text-ink-500">{formatDateTime(entry.createdAt)}</Td>
                  <Td className="text-sm">{humanize(entry.action)}</Td>
                  <Td className="text-xs">
                    {humanize(entry.entityType)}
                    {entry.entityId ? <span className="mt-0.5 block font-mono text-[0.625rem] text-ink-400">{entry.entityId.slice(0, 8)}…</span> : null}
                  </Td>
                  <Td className="text-xs">
                    {entry.actor.name}
                    <span className="mt-0.5 block text-ink-500">{entry.actor.role}</span>
                  </Td>
                  <Td>
                    <Badge size="sm" tone="neutral">
                      recorded
                    </Badge>
                  </Td>
                  <Td className="text-xs text-ink-500">{entry.ipAddress ?? '—'}</Td>
                  <Td className="max-w-64 truncate text-[0.6875rem] text-ink-500" title={JSON.stringify(entry.metadata)}>
                    {Object.keys(entry.metadata ?? {}).length > 0 ? JSON.stringify(entry.metadata) : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-ink-500">
            <span>Page {page}</span>
            <span className="flex gap-2">
              {result.meta.hasPreviousPage ? (
                <Link href={`/admin/audit?page=${page - 1}`} className="font-medium text-brand-700 hover:underline">
                  Previous
                </Link>
              ) : null}
              {result.meta.hasNextPage ? (
                <Link href={`/admin/audit?page=${page + 1}`} className="font-medium text-brand-700 hover:underline">
                  Next
                </Link>
              ) : null}
            </span>
          </div>
        </Panel>
      )}
    </div>
  );
}

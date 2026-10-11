import Link from 'next/link';
import type { ReportDto } from '@swapmart/shared';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Panel, Table, Td, Th } from '@/components/ui/feedback';
import { serverFetchPage } from '@/lib/server-api';
import { formatNumber, formatRelative, humanize, REPORT_STATUS_LABELS } from '@/lib/format';

const TABS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'under_review', label: 'Under investigation' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
];

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  let result;
  try {
    result = await serverFetchPage<ReportDto>('/admin/reports', {
      params: { page, perPage: 25, status: params.status, priority: params.priority, q: params.q },
    });
  } catch (error) {
    return (
      <ErrorState
        title="Reports could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/admin/reports" variant="secondary">Retry</ButtonLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Trust & safety"
        title="Reports"
        description="Reports from members, with the reporter's account attached. Nothing is deleted: dismissing a report records the reason and keeps the history."
      />

      <div className="flex flex-wrap items-center gap-3">
        <form action="/admin/reports" method="get" className="flex flex-wrap items-center gap-2">
          <input
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Search reference or description"
            className="sm-input max-w-md"
            aria-label="Search reports"
          />
          <select name="priority" defaultValue={params.priority ?? ''} className="sm-input max-w-40" aria-label="Priority">
            <option value="">Any priority</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
          <button type="submit" className="inline-flex h-10 items-center rounded-control bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
            Apply
          </button>
        </form>
      </div>

      <nav className="flex flex-wrap gap-1.5" aria-label="Filter reports">
        {TABS.map((tab) => {
          const active = (params.status ?? '') === tab.value;
          return (
            <Link
              key={tab.label}
              href={tab.value ? `/admin/reports?status=${tab.value}` : '/admin/reports'}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'rounded-full border border-ink-900 bg-ink-900 px-3 py-1.5 text-sm font-medium text-white'
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
          <EmptyState icon="flag" title="No reports here" description="Reports filed by members appear in this queue." />
        </div>
      ) : (
        <Panel bodyClassName="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Category</Th>
                <Th>About</Th>
                <Th>Status</Th>
                <Th>Priority</Th>
                <Th>Filed</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {result.data.map((report) => (
                <tr key={report.id} className="transition-colors hover:bg-surface-muted">
                  <Td className="font-mono text-xs">{report.reference}</Td>
                  <Td className="text-sm">{humanize(report.category)}</Td>
                  <Td className="text-sm">
                    {report.listing ? (
                      <span className="text-ink-800">{report.listing.title}</span>
                    ) : report.reportedUser ? (
                      report.reportedUser.displayName
                    ) : (
                      <span className="text-ink-500">Message or transaction</span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={report.status === 'resolved' ? 'success' : report.status === 'dismissed' ? 'neutral' : 'warning'}>
                      {REPORT_STATUS_LABELS[report.status]}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge size="sm" tone={report.priority === 'urgent' ? 'danger' : report.priority === 'high' ? 'warning' : 'neutral'}>
                      {report.priority}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-ink-500">{formatRelative(report.createdAt)}</Td>
                  <Td>
                    <Link href={`/admin/reports/${report.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                      Investigate
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="border-t border-line px-4 py-3 text-xs text-ink-500">{formatNumber(result.meta.total)} reports</div>
        </Panel>
      )}
    </div>
  );
}

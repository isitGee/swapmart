import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReportDto } from '@swapmart/shared';
import { AccountStatusBadge, Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert, DataList, ErrorState, PageHeader, Panel } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { serverFetchSafe } from '@/lib/server-api';
import { formatDateTime, humanize, REPORT_STATUS_LABELS } from '@/lib/format';
import { ReportResolution } from './report-resolution';

export const metadata = { title: 'Investigate report' };

export default async function AdminReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const report = await serverFetchSafe<ReportDto | null>(`/admin/reports/${id}`, null);

  if (!report) {
    return (
      <ErrorState
        title="Report not available"
        message="It may have been permanently removed, which the platform does not do through the interface."
        retry={<ButtonLink href="/admin/reports" variant="secondary">Back to reports</ButtonLink>}
      />
    );
  }

  const closed = report.status === 'resolved' || report.status === 'dismissed';

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-ink-500">
        <Link href="/admin/reports" className="hover:text-brand-700">
          Reports
        </Link>
        <Icon name="chevron" size={12} />
        <span className="font-mono text-ink-700">{report.reference}</span>
      </nav>

      <PageHeader
        eyebrow={`Report ${report.reference}`}
        title={humanize(report.category)}
        description={`Filed ${formatDateTime(report.createdAt)}${report.assignedTo ? ` · assigned to ${report.assignedTo.name}` : ''}`}
        actions={
          <>
            <Badge tone={report.status === 'resolved' ? 'success' : report.status === 'dismissed' ? 'neutral' : 'warning'}>
              {REPORT_STATUS_LABELS[report.status]}
            </Badge>
            <Badge tone={report.priority === 'urgent' ? 'danger' : report.priority === 'high' ? 'warning' : 'neutral'}>
              {report.priority} priority
            </Badge>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-5">
          <Panel title="What was reported">
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700">{report.description}</p>

            <DataList
              items={[
                { label: 'Reporter', value: report.reporter?.displayName ?? 'Anonymous' },
                {
                  label: 'Listing reported',
                  value: report.listing ? (
                    <Link href={`/admin/listings/${report.listing.id}`} className="font-medium text-brand-700 hover:underline">
                      {report.listing.title}
                    </Link>
                  ) : (
                    'None'
                  ),
                },
                {
                  label: 'Member reported',
                  value: report.reportedUser ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {report.reportedUser.displayName}
                      <AccountStatusBadge status={report.reportedUser.accountStatus} />
                    </span>
                  ) : (
                    'None'
                  ),
                },
                {
                  label: 'Message attached',
                  value: report.message ? `“${report.message.excerpt}”` : 'None',
                },
                { label: 'Transaction', value: report.transaction?.reference ?? 'None' },
              ]}
            />
          </Panel>

          <Panel title="Investigation notes" description="Internal notes stay internal; notes marked reporter-visible are shown to the person who filed the report.">
            {report.notes.length === 0 ? (
              <p className="text-sm text-ink-600">No notes yet.</p>
            ) : (
              <ul className="space-y-3">
                {report.notes.map((note) => (
                  <li
                    key={note.id}
                    className={
                      note.visibility === 'reporter_visible'
                        ? 'rounded-control border border-brand-200 bg-brand-50 p-3'
                        : 'rounded-control border border-line bg-surface-muted p-3'
                    }
                  >
                    <p className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                      <span className="font-medium text-ink-800">{note.author.name}</span>
                      <Badge size="sm" tone={note.visibility === 'reporter_visible' ? 'info' : 'neutral'}>
                        {note.visibility === 'reporter_visible' ? 'Reporter visible' : 'Internal'}
                      </Badge>
                      <span>{formatDateTime(note.createdAt)}</span>
                    </p>
                    <p className="mt-1 text-sm text-ink-700">{note.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {report.resolution ? (
            <Alert tone="success" title={`Resolved ${report.resolvedAt ? formatDateTime(report.resolvedAt) : ''}`}>
              {report.resolution}
            </Alert>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          {closed ? (
            <Panel title="Resolution">
              <Alert tone="info">
                This report is {report.status}. Its history is retained; reopening is not supported through the interface, so
                record a new report if new information arrives.
              </Alert>
            </Panel>
          ) : (
            <ReportResolution reportId={report.id} />
          )}

          <Panel title="Recommended checks">
            <ul className="space-y-2.5 text-sm text-ink-600">
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-success-600" />Compare the reported identifier with the submission record.</li>
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-success-600" />Review the seller&apos;s evidence and previous submissions from this account.</li>
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-success-600" />Check the conversation attached to the report for context.</li>
              <li className="flex gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-success-600" />Decide whether a listing action (suspend or reinstate) accompanies the resolution.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

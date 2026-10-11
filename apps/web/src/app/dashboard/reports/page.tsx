import Link from 'next/link';
import type { ReportDto } from '@swapmart/shared';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Panel } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { serverFetchPage } from '@/lib/server-api';
import { formatDateTime, humanize, REPORT_STATUS_LABELS } from '@/lib/format';

export default async function MyReportsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  let result;
  try {
    result = await serverFetchPage<ReportDto>('/reports', { params: { mine: 'true', page, perPage: 20 } });
  } catch (error) {
    return (
      <ErrorState
        title="Your reports could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/dashboard/reports" variant="secondary">Try again</ButtonLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="My reports"
        description="Reports you have filed and how they were resolved. Reports are never deleted, and every status change is kept."
        actions={<ButtonLink href="/report" variant="primary" size="sm" icon="flag">File a report</ButtonLink>}
      />

      {result.data.length === 0 ? (
        <div className="sm-card">
          <EmptyState
            icon="flag"
            title="You have not filed any reports"
            description="If you see a listing that looks fraudulent, duplicated or stolen, report it — an administrator reviews every report."
            action={<ButtonLink href="/report" variant="primary" icon="flag">File a report</ButtonLink>}
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {result.data.map((report) => (
            <li key={report.id}>
              <Panel
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-ink-500">{report.reference}</span>
                    <Badge
                      tone={
                        report.status === 'resolved'
                          ? 'success'
                          : report.status === 'dismissed'
                            ? 'neutral'
                            : report.status === 'escalated'
                              ? 'danger'
                              : 'warning'
                      }
                    >
                      {REPORT_STATUS_LABELS[report.status]}
                    </Badge>
                    <Badge size="sm" tone="neutral">
                      {humanize(report.category)}
                    </Badge>
                    <Badge size="sm" tone={report.priority === 'urgent' || report.priority === 'high' ? 'danger' : 'neutral'}>
                      {report.priority} priority
                    </Badge>
                  </span>
                }
              >
                <p className="text-sm text-ink-700">{report.description}</p>

                <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-ink-500">Filed</dt>
                    <dd className="text-ink-800">{formatDateTime(report.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">About</dt>
                    <dd className="text-ink-800">
                      {report.listing ? (
                        <Link href={`/listings/${report.listing.slug}`} className="font-medium text-brand-700 hover:underline">
                          {report.listing.title}
                        </Link>
                      ) : report.reportedUser ? (
                        report.reportedUser.displayName
                      ) : (
                        'A message or transaction'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Resolved</dt>
                    <dd className="text-ink-800">{report.resolvedAt ? formatDateTime(report.resolvedAt) : 'Still open'}</dd>
                  </div>
                </dl>

                {report.resolution ? (
                  <div className="mt-3 rounded-control border border-line bg-surface-muted p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                      <Icon name="check-circle" size={13} /> Outcome
                    </p>
                    <p className="mt-1 text-sm text-ink-700">{report.resolution}</p>
                  </div>
                ) : (
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500">
                    <Icon name="clock" size={13} /> An administrator is reviewing this report. You will be notified when the
                    status changes.
                  </p>
                )}

                {report.notes.filter((note) => note.visibility === 'reporter_visible').length > 0 ? (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Messages to you</p>
                    <ul className="mt-2 space-y-2">
                      {report.notes
                        .filter((note) => note.visibility === 'reporter_visible')
                        .map((note) => (
                          <li key={note.id} className="text-sm text-ink-700">
                            {note.body}
                            <span className="mt-0.5 block text-xs text-ink-500">
                              {note.author.name} · {formatDateTime(note.createdAt)}
                            </span>
                          </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-xs text-ink-500">
                      Internal administrator notes about this report are withheld from members.
                    </p>
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

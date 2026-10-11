import Link from 'next/link';
import type { DuplicateAlertDto } from '@swapmart/shared';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert, EmptyState, ErrorState, PageHeader, Panel } from '@/components/ui/feedback';
import { serverFetchPage } from '@/lib/server-api';
import { formatDateTime, formatRelative, humanize } from '@/lib/format';
import { AlertResolve } from './alert-resolve';

export default async function DuplicateAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ includeResolved?: string; page?: string }>;
}) {
  const params = await searchParams;
  const includeResolved = params.includeResolved === 'true';
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  let result;
  try {
    result = await serverFetchPage<DuplicateAlertDto>('/admin/duplicate-alerts', {
      params: { page, perPage: 20, includeResolved: includeResolved ? 'true' : 'false' },
    });
  } catch (error) {
    return (
      <ErrorState
        title="Duplicate alerts could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/admin/duplicates" variant="secondary">Retry</ButtonLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Trust & safety"
        title="Duplicate and suspicious identifier alerts"
        description="Recorded when a submission tried to claim an identifier that an active listing already holds, or when other suspicious patterns were detected. The database refused the write — no other member's data was exposed to the submitter."
        actions={
          <ButtonLink
            href={includeResolved ? '/admin/duplicates' : '/admin/duplicates?includeResolved=true'}
            variant="secondary"
            size="sm"
          >
            {includeResolved ? 'Hide resolved' : 'Include resolved'}
          </ButtonLink>
        }
      />

      {result.data.length === 0 ? (
        <div className="sm-card">
          <EmptyState
            icon="layers"
            title="No alerts to review"
            description="Nothing has attempted to reuse an active identifier claim since the last cleanup."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {result.data.map((alert) => (
            <li key={alert.id}>
              <Panel
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={alert.severity === 'critical' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'neutral'}>
                      {alert.severity}
                    </Badge>
                    <span>{humanize(alert.kind)}</span>
                    <span className="text-xs font-normal text-ink-500">
                      raised {formatRelative(alert.createdAt)}
                      {alert.resolvedAt ? ` · resolved ${formatDateTime(alert.resolvedAt)}` : ''}
                    </span>
                  </span>
                }
              >
                <p className="text-sm text-ink-700">{alert.detail}</p>

                {alert.relatedListingId ? (
                  <p className="mt-2 text-sm">
                    Related listing:{' '}
                    <Link href={`/admin/listings/${alert.relatedListingId}`} className="font-medium text-brand-700 hover:underline">
                      {alert.relatedListingTitle ?? 'open submission'}
                    </Link>
                  </p>
                ) : null}

                {alert.resolvedAt ? (
                  <Alert tone="success" className="mt-3">
                    Resolved on {formatDateTime(alert.resolvedAt)}. The decision and its reason remain in the audit log.
                  </Alert>
                ) : (
                  <div className="mt-4 border-t border-line pt-4">
                    <AlertResolve alertId={alert.id} />
                  </div>
                )}
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import Link from 'next/link';
import type { AdminOverviewStatsDto, AuditLogDto, DuplicateAlertDto } from '@swapmart/shared';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert, DataList, ErrorState, PageHeader, Panel, StatCard, Table, Td, Th } from '@/components/ui/feedback';
import { serverFetchSafe } from '@/lib/server-api';
import { formatDateTime, formatNumber, formatRelative, humanize } from '@/lib/format';

export default async function AdminOverviewPage() {
  const [stats, alerts, audit] = await Promise.all([
    serverFetchSafe<AdminOverviewStatsDto | null>('/admin/overview', null),
    serverFetchSafe<DuplicateAlertDto[]>('/admin/duplicate-alerts', [], { params: { perPage: 5, includeResolved: 'false' } }),
    serverFetchSafe<AuditLogDto[]>('/admin/audit-logs', [], { params: { perPage: 6 } }),
  ]);

  if (!stats) {
    return (
      <ErrorState
        title="Statistics could not be loaded"
        message="Every figure on this page is computed from the database at request time, so nothing is shown when that query fails."
        retry={<ButtonLink href="/admin" variant="secondary">Retry</ButtonLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operations"
        title="Marketplace overview"
        description="Live counts from PostgreSQL — no hardcoded figures. Review the queue, watch for duplicate-identifier attempts, and track open reports and disputes."
        actions={
          <>
            <ButtonLink href="/admin/listings" variant="primary" size="sm" icon="shield">
              Open review queue
            </ButtonLink>
            <ButtonLink href="/admin/audit" variant="secondary" size="sm" icon="list">
              Audit log
            </ButtonLink>
          </>
        }
      />

      {stats.verification.duplicateAlertsOpen > 0 ? (
        <Alert
          tone="warning"
          title={`${stats.verification.duplicateAlertsOpen} unresolved duplicate-identifier alert${stats.verification.duplicateAlertsOpen === 1 ? '' : 's'}`}
          action={
            <Link href="/admin/duplicates" className="text-sm font-medium underline">
              Investigate
            </Link>
          }
        >
          A member attempted to claim an identifier that an active listing already holds. PostgreSQL refused the write; the
          attempt is recorded here for review.
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pending review"
          value={formatNumber(stats.listings.pendingReview)}
          hint="Submitted or flagged"
          href="/admin/listings"
          tone={stats.listings.pendingReview > 0 ? 'warning' : 'neutral'}
          icon="shield"
        />
        <StatCard
          label="Published"
          value={formatNumber(stats.listings.published)}
          hint="Visible in the catalogue"
          href="/admin/listings?status=approved"
          tone="success"
          icon="check-circle"
        />
        <StatCard
          label="Flagged"
          value={formatNumber(stats.listings.flagged)}
          hint="Needs closer inspection"
          href="/admin/listings?status=flagged"
          tone={stats.listings.flagged > 0 ? 'danger' : 'neutral'}
          icon="alert"
        />
        <StatCard label="Approved last 7 days" value={formatNumber(stats.listings.approvedLast7Days)} icon="check" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Members"
          value={formatNumber(stats.users.total)}
          hint={`${formatNumber(stats.users.newLast7Days)} joined this week`}
          href="/admin/users"
          icon="users"
        />
        <StatCard label="Active in 30 days" value={formatNumber(stats.users.activeLast30Days)} href="/admin/users" icon="eye" />
        <StatCard
          label="Restricted"
          value={formatNumber(stats.users.restricted)}
          href="/admin/users?status=restricted"
          tone={stats.users.restricted > 0 ? 'warning' : 'neutral'}
          icon="lock"
        />
        <StatCard label="Administrators" value={formatNumber(stats.users.administrators)} hint="Provisioned by an operator" icon="shield-check" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open reports" value={formatNumber(stats.trust.reportsOpen)} href="/admin/reports" tone={stats.trust.reportsOpen > 0 ? 'warning' : 'neutral'} icon="flag" />
        <StatCard label="Open disputes" value={formatNumber(stats.trust.disputesOpen)} href="/admin/disputes" tone={stats.trust.disputesOpen > 0 ? 'warning' : 'neutral'} icon="scale" />
        <StatCard
          label="Past moderation SLA"
          value={formatNumber(stats.trust.overdueModeration)}
          hint="Over 72 hours in the queue"
          tone={stats.trust.overdueModeration > 0 ? 'danger' : 'success'}
          icon="clock"
        />
        <StatCard label="Evidence awaited" value={formatNumber(stats.verification.evidenceAwaiting)} href="/admin/listings?status=evidence_required" icon="file" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Verification activity"
          actions={
            <Link href="/admin/listings" className="text-sm font-medium text-brand-700 hover:underline">
              Review queue
            </Link>
          }
        >
          <DataList
            items={[
              { label: 'Automated checks (7 days)', value: formatNumber(stats.verification.automatedChecksLast7Days) },
              {
                label: 'Stolen-device provider',
                value: stats.verification.externalCheckAvailable ? (
                  <Badge tone="success">
                    {stats.verification.externalProvider} · {humanize(stats.verification.externalCheckStatus)}
                  </Badge>
                ) : (
                  <Badge tone="neutral">Not configured — lookups recorded as “not performed”</Badge>
                ),
              },
              { label: 'Open duplicate alerts', value: formatNumber(stats.verification.duplicateAlertsOpen) },
              { label: 'Evidence awaited', value: formatNumber(stats.verification.evidenceAwaiting) },
            ]}
          />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Object.entries(stats.listings.byStatus ?? {})
              .filter(([, count]) => count > 0)
              .map(([status, count]) => (
                <div key={status} className="rounded-control border border-line px-3 py-2">
                  <p className="text-xs text-ink-500">{humanize(status)}</p>
                  <p className="text-base font-semibold tabular-nums text-ink-900">{count}</p>
                </div>
              ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel
            title="Unresolved duplicate alerts"
            actions={
              <Link href="/admin/duplicates" className="text-sm font-medium text-brand-700 hover:underline">
                All alerts
              </Link>
            }
          >
            {alerts.length === 0 ? (
              <p className="text-sm text-ink-600">No unresolved duplicate-identifier alerts.</p>
            ) : (
              <ul className="divide-y divide-line">
                {alerts.slice(0, 4).map((alert) => (
                  <li key={alert.id} className="py-2.5 first:pt-0 last:pb-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={alert.severity === 'critical' ? 'danger' : 'warning'} size="sm">
                        {alert.severity}
                      </Badge>
                      <span className="text-ink-700">{humanize(alert.kind)}</span>
                      <span className="text-xs text-ink-500">{formatRelative(alert.createdAt)}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-600">{alert.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Recent moderation activity"
            actions={
              <Link href="/admin/audit" className="text-sm font-medium text-brand-700 hover:underline">
                Full audit log
              </Link>
            }
          >
            {audit.length === 0 ? (
              <p className="text-sm text-ink-600">No audited actions yet.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Action</Th>
                    <Th>Entity</Th>
                    <Th>Actor</Th>
                    <Th>When</Th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((entry) => (
                    <tr key={entry.id}>
                      <Td className="text-xs">{humanize(entry.action)}</Td>
                      <Td className="text-xs text-ink-500">{entry.entityType}</Td>
                      <Td className="text-xs">{entry.actor.name}</Td>
                      <Td className="whitespace-nowrap text-xs text-ink-500" title={formatDateTime(entry.createdAt)}>
                        {formatRelative(entry.createdAt)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Transactions and media">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Transactions" value={formatNumber(stats.transactions.total)} href="/admin/transactions" />
          <StatCard label="Completed (30 days)" value={formatNumber(stats.transactions.completedLast30Days)} tone="success" />
          <StatCard label="Public media assets" value={formatNumber(stats.media.publicAssets)} />
          <StatCard label="Private media assets" value={formatNumber(stats.media.privateAssets)} hint="Evidence and dispute attachments" />
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Generated at {formatDateTime(stats.generatedAt)}. Figures are counted from the database on every request.
        </p>
      </Panel>
    </div>
  );
}

import type { AdminOverviewStatsDto, SystemConfigDto } from '@swapmart/shared';
import { Badge } from '@/components/ui/badge';
import { Alert, DataList, PageHeader, Panel, StatCard, UnavailableState } from '@/components/ui/feedback';
import { serverFetchSafe } from '@/lib/server-api';
import { formatDateTime, formatNumber } from '@/lib/format';

export default async function AdminSystemPage() {
  const [configuration, stats] = await Promise.all([
    serverFetchSafe<SystemConfigDto | null>('/system/status', null),
    serverFetchSafe<AdminOverviewStatsDto | null>('/admin/overview', null, { params: { range: 'all' } }),
  ]);

  if (!configuration) {
    return (
      <UnavailableState
        title="System status is unavailable"
        description="The API did not return its configuration summary. Check that the API process is running and can reach PostgreSQL."
      />
    );
  }

  const emailConfigured = configuration.email.configured;
  const stolenCheckConfigured = configuration.stolenCheck.configured;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Operations"
        title="System status and configuration"
        description="What this deployment can and cannot do. Unconfigured capabilities are reported honestly rather than simulated."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Environment" value={configuration.environment} hint={`Version ${configuration.version}`} />
        <StatCard label="Email transport" value={configuration.email.transport} tone={emailConfigured ? 'success' : 'warning'} icon="mail" />
        <StatCard label="Media driver" value={configuration.media.driver} tone={configuration.media.configured ? 'success' : 'warning'} icon="image" />
        <StatCard label="Stolen-device check" value={configuration.stolenCheck.provider} tone={stolenCheckConfigured ? 'success' : 'warning'} icon="shield" />
      </div>

      <Panel title="Email delivery">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={emailConfigured ? 'success' : 'warning'}>
            {emailConfigured ? 'SMTP configured' : 'No SMTP configured — messages are recorded, not delivered'}
          </Badge>
          <Badge tone={configuration.email.verificationRequired ? 'info' : 'neutral'}>
            Email verification {configuration.email.verificationRequired ? 'required before submitting listings' : 'not enforced'}
          </Badge>
        </div>
        <DataList
          className="mt-3"
          items={[
            { label: 'Transport', value: configuration.email.transport },
            { label: 'Verification enforced', value: configuration.email.verificationRequired ? 'Yes' : 'No' },
          ]}
        />
        {configuration.email.notices.length > 0 ? (
          <Alert tone="info" className="mt-3">
            <ul className="space-y-1">
              {configuration.email.notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </Panel>

      <Panel title="Media storage">
        <p className="text-sm text-ink-600">
          Device photographs and avatars are public assets; evidence, dispute attachments and identifier screenshots are private
          and only served to authorised callers. Every private read is recorded.
        </p>
        <DataList
          className="mt-3"
          items={[
            { label: 'Driver', value: configuration.media.driver },
            { label: 'Configured', value: configuration.media.configured ? 'Yes' : 'No' },
            ...(stats
              ? [
                  { label: 'Public assets', value: formatNumber(stats.media.publicAssets) },
                  { label: 'Private assets', value: formatNumber(stats.media.privateAssets) },
                ]
              : []),
          ]}
        />
        {configuration.media.notices.length > 0 ? (
          <Alert tone="info" className="mt-3">
            <ul className="space-y-1">
              {configuration.media.notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </Panel>

      <Panel title="External stolen-device provider">
        {stolenCheckConfigured ? (
          <Badge tone="success">Connected: {configuration.stolenCheck.provider}</Badge>
        ) : (
          <UnavailableState
            title="No provider is connected"
            description="Lookups are recorded as “not performed (provider not configured)” on every submission. The platform never reports a device as clear when no lookup happened."
            setupHint="Set STOLEN_CHECK_PROVIDER and its credentials to enable real lookups; the provider interface is defined in apps/api/src/services/verification/providers.ts."
          />
        )}
      </Panel>

      <Panel title="Platform health">
        {stats ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Listings" value={formatNumber(stats.listings.total)} />
              <StatCard label="Members" value={formatNumber(stats.users.total)} />
              <StatCard label="Transactions" value={formatNumber(stats.transactions.total)} />
              <StatCard label="Open reports" value={formatNumber(stats.trust.reportsOpen)} />
            </div>
            <p className="mt-3 text-xs text-ink-500">Counted at {formatDateTime(stats.generatedAt)}.</p>
          </>
        ) : (
          <p className="text-sm text-ink-600">Statistics are unavailable.</p>
        )}
      </Panel>

      <Panel title="Operational reminders">
        <ul className="space-y-2.5 text-sm text-ink-600">
          <li>Administrator accounts are created by an operator with <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-xs">npm run admin:create</code> — never through public registration.</li>
          <li>Secrets live only in environment variables. No credential is committed to the repository or exposed to the browser.</li>
          <li>Watch this page before a demonstration: an unconfigured email transport means verification links must be read from the development outbox.</li>
        </ul>
      </Panel>
    </div>
  );
}

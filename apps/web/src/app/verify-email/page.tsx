import Link from 'next/link';
import type { SystemConfigDto } from '@swapmart/shared';
import { Alert, PageHeader, Panel } from '@/components/ui/feedback';
import { getCurrentUser, serverFetchSafe } from '@/lib/server-api';
import { VerifyEmailPanel } from './verify-email-panel';

export const metadata = { title: 'Verify your email address' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const params = await searchParams;
  const [user, configuration] = await Promise.all([
    getCurrentUser(),
    serverFetchSafe<SystemConfigDto | null>('/system/status', null),
  ]);

  const devOutboxAvailable = configuration?.email.transport === 'log';
  const email = params.email ?? user?.email ?? '';

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="Account security"
        title="Verify your email address"
        description="Verification confirms that the address belongs to you. Until it is verified you can browse, save and message, but you cannot submit a listing for review."
      />

      {user?.emailVerified ? (
        <Alert tone="success" className="mt-6" title="Your email address is already verified">
          Nothing further is needed. You can submit listings for review.
        </Alert>
      ) : null}

      <div className="mt-6">
        <VerifyEmailPanel
          initialEmail={email}
          token={params.token ?? ''}
          devOutboxAvailable={devOutboxAvailable}
          emailTransport={configuration?.email.transport ?? 'unknown'}
        />
      </div>

      <Panel title="Why a deployment may not deliver email" className="mt-6">
        <p className="text-sm text-ink-600">
          This deployment reports its email transport as <span className="font-medium text-ink-900">{configuration?.email.transport ?? 'unknown'}</span>.
          A production deployment sends through an SMTP account configured entirely by environment variables. Where no SMTP
          account is configured — as in this development environment — the API records the message instead of pretending to
          deliver it, and exposes the newest recorded message to the developer through a development-only endpoint.
        </p>
        {configuration?.email.notices?.length ? (
          <ul className="mt-3 space-y-1.5 text-sm text-ink-600">
            {configuration.email.notices.map((notice) => (
              <li key={notice} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-400" />
                {notice}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-4 text-sm">
          <Link href="/dashboard" className="font-medium text-brand-700 hover:underline">
            Back to the dashboard
          </Link>
        </p>
      </Panel>
    </div>
  );
}

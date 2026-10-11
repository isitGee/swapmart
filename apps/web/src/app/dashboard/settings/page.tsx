import type { SessionDto, SystemConfigDto } from '@swapmart/shared';
import { Alert, DataList, PageHeader, Panel } from '@/components/ui/feedback';
import { Badge } from '@/components/ui/badge';
import { getCurrentUser, serverFetchSafe } from '@/lib/server-api';
import { formatDateTime } from '@/lib/format';
import { ProfileForm } from './profile-form';
import { SecurityPanel } from './security-panel';

export const metadata = { title: 'Profile and security' };

export default async function SettingsPage() {
  const [user, sessions, configuration] = await Promise.all([
    getCurrentUser(),
    serverFetchSafe<SessionDto[]>('/auth/sessions', []),
    serverFetchSafe<SystemConfigDto | null>('/system/status', null),
  ]);

  if (!user) {
    return (
      <Alert tone="danger" title="Session expired">
        Sign in again to manage your profile.
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Account"
        title="Profile and security"
        description="Your public seller profile, password, active sessions and account status."
        actions={
          <>
            {user.emailVerified ? <Badge tone="success">Email verified</Badge> : <Badge tone="warning">Email unverified</Badge>}
            <Badge tone={user.accountStatus === 'active' ? 'success' : 'warning'}>{user.accountStatus}</Badge>
            {user.role === 'admin' ? <Badge tone="brand">Administrator</Badge> : null}
          </>
        }
      />

      {user.restrictionReason ? (
        <Alert tone="warning" title="Your account is restricted">
          {user.restrictionReason}
          {user.restrictedUntil ? ` Until ${formatDateTime(user.restrictedUntil)}.` : ''}
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <ProfileForm user={user} />

        <div className="flex flex-col gap-5">
          <Panel title="Account facts">
            <DataList
              items={[
                { label: 'Email', value: user.email },
                { label: 'Member since', value: formatDateTime(user.createdAt) },
                {
                  label: 'Identity review',
                  value: user.profile.identityReviewedAt ? 'Reviewed' : 'Not reviewed',
                  hint: user.profile.identityReviewedAt
                    ? `Reviewed ${formatDateTime(user.profile.identityReviewedAt)}`
                    : 'Identity documents are checked by an administrator when a dispute requires it.',
                },
                { label: 'Email transport', value: configuration?.email.transport ?? 'unknown' },
                { label: 'Media storage', value: configuration?.media.driver ?? 'unknown' },
                { label: 'Version', value: configuration?.version ?? '—' },
              ]}
            />
          </Panel>

          <SecurityPanel sessions={sessions} />
        </div>
      </div>
    </div>
  );
}

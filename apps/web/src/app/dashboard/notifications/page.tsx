import Link from 'next/link';
import type { NotificationDto } from '@swapmart/shared';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Panel } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { serverFetchPage } from '@/lib/server-api';
import { formatRelative, humanize } from '@/lib/format';
import { NotificationControls } from './notification-controls';

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ unreadOnly?: string; page?: string }> }) {
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? '1', 10) || 1;
  const unreadOnly = params.unreadOnly === 'true';

  let result;
  try {
    result = await serverFetchPage<NotificationDto>('/notifications', {
      params: { page, perPage: 30, unreadOnly: unreadOnly ? 'true' : undefined },
    });
  } catch (error) {
    return (
      <ErrorState
        title="Notifications could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/dashboard/notifications" variant="secondary">Try again</ButtonLink>}
      />
    );
  }

  const unreadIds = result.data.filter((notification) => !notification.readAt).map((notification) => notification.id);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Notifications"
        description="Decisions on your listings, new messages, exchange activity, report updates and account changes. Notifications are stored in the database, not held in the browser."
        actions={<NotificationControls unreadIds={unreadIds} />}
      />

      <nav className="flex gap-1.5" aria-label="Filter notifications">
        {[
          { value: false, label: 'All' },
          { value: true, label: 'Unread only' },
        ].map((option) => {
          const active = unreadOnly === option.value;
          return (
            <Link
              key={String(option.value)}
              href={option.value ? '/dashboard/notifications?unreadOnly=true' : '/dashboard/notifications'}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'rounded-full border border-brand-600 bg-brand-600 px-3 py-1.5 text-sm font-medium text-white'
                  : 'rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-surface-muted'
              }
            >
              {option.label}
            </Link>
          );
        })}
      </nav>

      {result.data.length === 0 ? (
        <div className="sm-card">
          <EmptyState icon="bell" title="Nothing to show" description={unreadOnly ? 'You have read everything.' : 'Activity on your account will appear here.'} />
        </div>
      ) : (
        <Panel bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {result.data.map((notification) => (
              <li key={notification.id} className={notification.readAt ? '' : 'bg-brand-50/40'}>
                <div className="flex items-start gap-3 px-4 py-3.5">
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.readAt ? 'bg-line-strong' : 'bg-brand-600'}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-ink-900">{notification.title}</p>
                      <Badge size="sm" tone="neutral">
                        {humanize(notification.type)}
                      </Badge>
                      {!notification.readAt ? (
                        <Badge size="sm" tone="brand">
                          New
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-ink-600">{notification.body}</p>
                    <p className="mt-1 flex items-center gap-3 text-xs text-ink-500">
                      <span>{formatRelative(notification.createdAt)}</span>
                      {notification.linkUrl ? (
                        <Link href={notification.linkUrl} className="font-medium text-brand-700 hover:underline">
                          Open
                        </Link>
                      ) : null}
                    </p>
                  </div>
                  <NotificationControls unreadIds={notification.readAt ? [] : [notification.id]} compact />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <p className="flex items-center gap-1.5 text-xs text-ink-500">
        <Icon name="mail" size={13} />
        Email copies are sent only when an SMTP transport is configured; otherwise everything stays in this list.
      </p>
    </div>
  );
}

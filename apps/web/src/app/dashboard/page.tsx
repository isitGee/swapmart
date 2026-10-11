import Link from 'next/link';
import type { DashboardSummaryDto, NotificationDto, TransactionDto, ConversationSummaryDto } from '@swapmart/shared';
import { Panel, PageHeader, StatCard, EmptyState, Alert } from '@/components/ui/feedback';
import { ButtonLink } from '@/components/ui/button';
import { TransactionStatusBadge } from '@/components/ui/badge';
import { getCurrentUser, serverFetchSafe } from '@/lib/server-api';
import { formatRelative, formatTzs } from '@/lib/format';
import { Icon } from '@/components/ui/icon';

export default async function DashboardOverviewPage() {
  const user = await getCurrentUser();
  const [summary, notifications, transactions, conversations] = await Promise.all([
    serverFetchSafe<DashboardSummaryDto | null>('/me/dashboard', null),
    serverFetchSafe<NotificationDto[]>('/notifications', [], { params: { perPage: 5 } }),
    serverFetchSafe<TransactionDto[]>('/transactions', [], { params: { perPage: 4, role: 'all' } }),
    serverFetchSafe<ConversationSummaryDto[]>('/conversations', [], { params: { perPage: 4 } }),
  ]);

  const listings = summary?.listings;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`Welcome back, ${user?.profile.displayName ?? 'seller'}`}
        title="Your selling overview"
        description="Everything that needs your attention: listings awaiting evidence, unread messages, active negotiations and open reports."
        actions={<ButtonLink href="/dashboard/listings/new" variant="primary" icon="plus">Create a listing</ButtonLink>}
      />

      {summary && summary.actionsRequired.length > 0 ? (
        <Panel title="Action required" description="These listings cannot progress until you do something.">
          <ul className="divide-y divide-line">
            {summary.actionsRequired.map((action) => (
              <li key={action.listingId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{action.listingTitle}</p>
                  <p className="mt-0.5 text-sm text-ink-600">{action.reason}</p>
                </div>
                <Link
                  href={action.href}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-ink-800 hover:bg-surface-muted"
                >
                  Resolve
                  <Icon name="arrow-right" size={14} />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Drafts" value={listings?.draft ?? 0} hint="Not yet submitted" href="/dashboard/listings?status=draft" icon="file" />
        <StatCard label="In review" value={listings?.inReview ?? 0} hint="Awaiting an administrator" href="/dashboard/listings?status=under_review" icon="clock" />
        <StatCard label="Approved" value={listings?.approved ?? 0} hint="Visible in the catalogue" href="/dashboard/listings?status=approved" icon="check-circle" tone="success" />
        <StatCard label="Needs attention" value={(listings?.rejected ?? 0) + (listings?.suspended ?? 0)} hint="Rejected or suspended" href="/dashboard/listings?status=rejected" icon="alert" tone={((listings?.rejected ?? 0) + (listings?.suspended ?? 0)) > 0 ? 'danger' : 'neutral'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Unread messages" value={summary?.unreadMessages ?? 0} href="/dashboard/messages" icon="message" />
        <StatCard label="Notifications" value={summary?.unreadNotifications ?? 0} href="/dashboard/notifications" icon="bell" />
        <StatCard label="Open exchanges" value={summary?.openExchanges ?? 0} href="/dashboard/exchanges" icon="arrow-swap" />
        <StatCard label="Active transactions" value={summary?.activeTransactions ?? 0} href="/dashboard/transactions" icon="handshake" />
      </div>

      {user?.accountStatus === 'suspended' ? (
        <Alert tone="danger" title="Your account is suspended">
          You cannot create listings, message members or propose exchanges. Sign out and contact an administrator if you
          believe this is wrong.
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Recent activity"
          actions={
            <Link href="/dashboard/notifications" className="text-sm font-medium text-brand-700 hover:underline">
              All notifications
            </Link>
          }
        >
          {notifications.length === 0 ? (
            <EmptyState icon="bell" title="Nothing yet" description="Activity on your listings, messages and transactions appears here." />
          ) : (
            <ul className="space-y-3">
              {notifications.map((notification) => (
                <li key={notification.id} className="flex gap-3">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.readAt ? 'bg-line-strong' : 'bg-brand-600'}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">{notification.title}</p>
                    <p className="mt-0.5 text-sm text-ink-600">{notification.body}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {formatRelative(notification.createdAt)}
                      {notification.linkUrl ? (
                        <>
                          {' · '}
                          <Link href={notification.linkUrl} className="font-medium text-brand-700 hover:underline">
                            Open
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Latest transactions"
          actions={
            <Link href="/dashboard/transactions" className="text-sm font-medium text-brand-700 hover:underline">
              All transactions
            </Link>
          }
        >
          {transactions.length === 0 ? (
            <EmptyState icon="handshake" title="No transactions yet" description="Transaction records appear when you record an offer or accept an exchange." />
          ) : (
            <ul className="space-y-3">
              {transactions.map((transaction) => (
                <li key={transaction.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/dashboard/transactions/${transaction.id}`} className="truncate text-sm font-medium text-ink-900 hover:text-brand-700">
                      {transaction.listing.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {transaction.reference} · {formatTzs(transaction.agreedAmountTzs)} · {formatRelative(transaction.createdAt)}
                    </p>
                  </div>
                  <TransactionStatusBadge status={transaction.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Conversations"
        actions={
          <Link href="/dashboard/messages" className="text-sm font-medium text-brand-700 hover:underline">
            Open inbox
          </Link>
        }
      >
        {conversations.length === 0 ? (
          <EmptyState icon="message" title="No conversations" description="Message a seller from any listing to start a conversation." />
        ) : (
          <ul className="divide-y divide-line">
            {conversations.map((conversation) => (
              <li key={conversation.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">
                    {conversation.counterpart?.displayName ?? 'Conversation'}
                  </p>
                  <p className="truncate text-xs text-ink-500">
                    {conversation.listingTitle ? `${conversation.listingTitle} · ` : ''}
                    {conversation.lastMessage?.body ?? 'No messages yet'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {conversation.unreadCount > 0 ? (
                    <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[0.6875rem] font-semibold text-white">
                      {conversation.unreadCount}
                    </span>
                  ) : null}
                  <Link href={`/dashboard/messages/${conversation.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

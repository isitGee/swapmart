import Link from 'next/link';
import type { ConversationSummaryDto } from '@swapmart/shared';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Panel } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { serverFetchPage } from '@/lib/server-api';
import { formatRelative } from '@/lib/format';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'buying', label: 'As buyer' },
  { value: 'selling', label: 'As seller' },
];

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const params = await searchParams;
  const filter = params.filter ?? 'all';
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  let result;
  try {
    result = await serverFetchPage<ConversationSummaryDto>('/conversations', { params: { filter, page, perPage: 20 } });
  } catch (error) {
    return (
      <ErrorState
        title="Your conversations could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/dashboard/messages" variant="secondary">Try again</ButtonLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Messages"
        description="Private conversations about listings. Public questions stay on the listing page — these threads are only visible to the two participants."
      />

      <nav className="flex flex-wrap gap-1.5" aria-label="Filter conversations">
        {FILTERS.map((option) => {
          const active = filter === option.value;
          return (
            <Link
              key={option.value}
              href={`/dashboard/messages?filter=${option.value}`}
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
          <EmptyState
            icon="message"
            title={filter === 'unread' ? 'No unread conversations' : 'No conversations yet'}
            description="Start a conversation from any listing page. Sellers receive your message immediately."
            action={<ButtonLink href="/search" variant="primary" icon="search">Browse listings</ButtonLink>}
          />
        </div>
      ) : (
        <Panel bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {result.data.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={`/dashboard/messages/${conversation.id}`}
                  className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted"
                >
                  <span className="h-11 w-11 shrink-0 overflow-hidden rounded-control bg-surface-sunken">
                    {conversation.listingThumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={conversation.listingThumbnailUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-ink-400">
                        <Icon name="message" size={16} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink-900">
                        {conversation.counterpart?.displayName ?? 'Conversation'}
                      </span>
                      {conversation.counterpart?.role === 'seller' ? <Badge size="sm" tone="info">Seller</Badge> : null}
                      {conversation.status !== 'open' ? <Badge size="sm" tone="neutral">{conversation.status}</Badge> : null}
                      {conversation.unreadCount > 0 ? (
                        <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[0.625rem] font-semibold text-white">
                          {conversation.unreadCount} new
                        </span>
                      ) : null}
                    </span>
                    {conversation.listingTitle ? (
                      <span className="mt-0.5 block truncate text-xs text-ink-500">About: {conversation.listingTitle}</span>
                    ) : null}
                    <span className="mt-1 block truncate text-sm text-ink-600">
                      {conversation.lastMessage
                        ? `${conversation.lastMessage.senderId === conversation.counterpart?.userId ? '' : 'You: '}${conversation.lastMessage.body}`
                        : 'No messages yet'}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-500">
                    {formatRelative(conversation.lastMessage?.createdAt ?? conversation.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ConversationSummaryDto, MessageDto } from '@swapmart/shared';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert, ErrorState, PageHeader, Panel } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { getCurrentUser, serverFetchPage, serverFetchSafe } from '@/lib/server-api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { MessageComposer } from './message-composer';

export const metadata = { title: 'Conversation' };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const conversation = await serverFetchSafe<ConversationSummaryDto | null>(`/conversations/${id}`, null);
  if (!conversation) {
    return (
      <ErrorState
        title="Conversation not available"
        message="Either this conversation does not exist, or you are not a participant in it. Conversations are only visible to the members involved."
        retry={<ButtonLink href="/dashboard/messages" variant="secondary">Back to messages</ButtonLink>}
      />
    );
  }

  const [user, messages] = await Promise.all([
    getCurrentUser(),
    serverFetchPage<MessageDto>(`/conversations/${id}/messages`, { params: { perPage: 100 } }).catch(() => ({
      data: [] as MessageDto[],
      meta: { page: 1, perPage: 100, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
    })),
  ]);

  const counterpart = conversation.counterpart;

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-ink-500">
        <Link href="/dashboard/messages" className="hover:text-brand-700">
          Messages
        </Link>
        <Icon name="chevron" size={12} />
        <span className="text-ink-700">{counterpart?.displayName ?? 'Conversation'}</span>
      </nav>

      <PageHeader
        title={counterpart?.displayName ?? 'Conversation'}
        description={
          conversation.listingTitle
            ? `About ${conversation.listingTitle}`
            : 'General conversation between members.'
        }
        actions={
          conversation.listingSlug ? (
            <ButtonLink href={`/listings/${conversation.listingSlug}`} variant="secondary" size="sm" icon="external-link">
              View listing
            </ButtonLink>
          ) : null
        }
      />

      {counterpart?.role === 'seller' ? (
        <Alert tone="info">
          You are messaging the seller of this listing. Keep negotiations inside SWAPMART — messages are retained and can be
          reviewed by an administrator if a report or dispute is opened.
        </Alert>
      ) : null}

      <Panel title="Conversation" bodyClassName="p-0">
        <ul className="flex max-h-[32rem] flex-col gap-3 overflow-y-auto p-4">
          {messages.data.length === 0 ? (
            <li className="py-8 text-center text-sm text-ink-500">No messages yet — say hello.</li>
          ) : (
            messages.data.map((message) => (
              <li key={message.id} className={message.isMine ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    message.isMine
                      ? 'max-w-[80%] rounded-card rounded-br-sm border border-brand-600/20 bg-brand-50 px-3.5 py-2.5'
                      : 'max-w-[80%] rounded-card rounded-bl-sm border border-line bg-surface px-3.5 py-2.5'
                  }
                >
                  <p className="text-xs font-medium text-ink-600">
                    {message.isMine ? 'You' : message.senderName}
                    {message.state !== 'visible' ? (
                      <Badge size="sm" tone="danger" className="ml-2">
                        {message.state}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-ink-800">{message.body}</p>
                  <p className="mt-1 text-[0.6875rem] text-ink-500" title={formatDateTime(message.createdAt)}>
                    {formatRelative(message.createdAt)}
                    {message.isMine ? (message.readByRecipient ? ' · read' : ' · delivered') : ''}
                  </p>
                </div>
              </li>
            ))
          )}
        </ul>
        <div className="border-t border-line p-4">
          <MessageComposer conversationId={conversation.id} disabled={conversation.status !== 'open'} />
        </div>
      </Panel>

      <Panel title="Participants">
        <ul className="divide-y divide-line">
          {conversation.participants.map((participant) => (
            <li key={participant.userId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-ink-900">
                  {participant.displayName}
                  {participant.userId === user?.id ? <span className="ml-2 text-xs text-ink-500">(you)</span> : null}
                </p>
                <p className="text-xs text-ink-500">{participant.role === 'seller' ? 'Seller' : 'Buyer'}</p>
              </div>
              {participant.identityReviewed ? <Badge tone="success" size="sm">Identity reviewed</Badge> : null}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

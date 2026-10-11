'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ListingCommentDto } from '@swapmart/shared';
import { apiPost, errorMessage, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, Panel } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { formatRelative } from '@/lib/format';

/**
 * Public listing questions. These are visible to everybody who can see the
 * listing and are deliberately separate from private buyer/seller messaging.
 */
export function CommentThread({
  listingId,
  comments,
  signedIn,
  currentUserId,
}: {
  listingId: string;
  comments: ListingCommentDto[];
  signedIn: boolean;
  currentUserId: string | null;
}) {
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function submit() {
    if (body.trim().length < 2) {
      setError('Enter your question before posting.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiPost('/listings/' + listingId + '/comments', {
        listingId,
        body: body.trim(),
        parentId: replyTo,
      });
      setBody('');
      setReplyTo(null);
      toast.success('Your question has been posted.');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.isAuthError) {
        router.push(`/signin?next=${encodeURIComponent(`/listings/${listingId}`)}`);
        return;
      }
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel
      title="Questions and answers"
      description="Public questions about this device. Do not share personal contact details — use private messages instead."
      id="questions"
    >
      {signedIn ? (
        <div className="flex flex-col gap-2">
          {replyTo ? (
            <p className="flex items-center gap-2 text-xs text-ink-500">
              Replying to a question
              <button type="button" className="font-medium text-brand-700 underline" onClick={() => setReplyTo(null)}>
                cancel
              </button>
            </p>
          ) : null}
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Ask about the condition, accessories, battery health, or the verification record…"
            maxLength={1200}
            invalid={Boolean(error)}
            aria-label="Your question"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-500">{body.length}/1200</span>
            <Button variant="primary" icon="message" onClick={submit} loading={pending}>
              Post question
            </Button>
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      ) : (
        <Alert
          tone="info"
          action={
            <Link href="/signin" className="text-sm font-medium text-brand-700 underline">
              Sign in
            </Link>
          }
        >
          Sign in to ask the seller a question about this device.
        </Alert>
      )}

      <div className="mt-5 border-t border-line pt-4">
        {comments.length === 0 ? (
          <EmptyState icon="message" title="No questions yet" description="Be the first to ask about this device." />
        ) : (
          <ul className="space-y-4">
            {comments.map((comment) => (
              <li key={comment.id}>
                <CommentItem comment={comment} onReply={setReplyTo} signedIn={signedIn} currentUserId={currentUserId} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function CommentItem({
  comment,
  onReply,
  signedIn,
  currentUserId,
  depth = 0,
}: {
  comment: ListingCommentDto;
  onReply: (id: string) => void;
  signedIn: boolean;
  currentUserId: string | null;
  depth?: number;
}) {
  return (
    <div className={depth > 0 ? 'border-l-2 border-line pl-3.5' : undefined}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[0.6875rem] font-semibold text-ink-600">
          {comment.author.displayName.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <span className="font-medium text-ink-800">{comment.author.displayName}</span>
            {comment.author.identityReviewed ? (
              <span className="inline-flex items-center gap-1 text-success-600">
                <Icon name="shield-check" size={12} /> Identity reviewed
              </span>
            ) : null}
            <span>{formatRelative(comment.createdAt)}</span>
            {comment.state === 'hidden' ? <span className="text-danger-600">Hidden by a moderator</span> : null}
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-ink-700">{comment.body}</p>
          <div className="mt-1.5 flex items-center gap-3 text-xs">
            {signedIn && comment.state === 'visible' && comment.author.id !== currentUserId ? (
              <button type="button" onClick={() => onReply(comment.id)} className="font-medium text-brand-700 hover:underline">
                Reply
              </button>
            ) : null}
            {comment.replyCount > 0 ? <span className="text-ink-400">{comment.replyCount} replies</span> : null}
          </div>
        </div>
      </div>

      {comment.replies.length > 0 ? (
        <ul className="mt-3 space-y-3 pl-9">
          {comment.replies.map((reply) => (
            <li key={reply.id}>
              <CommentItem comment={reply} onReply={onReply} signedIn={signedIn} currentUserId={currentUserId} depth={depth + 1} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

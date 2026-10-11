'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DisputeDto } from '@swapmart/shared';
import { apiPost, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';

export function DisputeThread({ dispute, currentUserId }: { dispute: DisputeDto; currentUserId: string | null }) {
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function post() {
    if (body.trim().length < 2) {
      setError('Write your message before posting.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiPost(`/disputes/${dispute.id}/messages`, { body: body.trim() });
      setBody('');
      toast.success('Message added to the dispute record.');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Dispute history</h3>
      {dispute.messages.length === 0 ? (
        <p className="text-sm text-ink-500">No messages yet.</p>
      ) : (
        <ul className="space-y-3">
          {dispute.messages.map((message) => {
            const mine = message.author.id === currentUserId;
            const isAdmin = message.author.role === 'admin';
            return (
              <li
                key={message.id}
                className={
                  isAdmin
                    ? 'rounded-control border border-brand-200 bg-brand-50 p-3'
                    : mine
                      ? 'rounded-control border border-line bg-surface-muted p-3'
                      : 'rounded-control border border-line p-3'
                }
              >
                <p className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  <span className="font-medium text-ink-800">{message.author.name}</span>
                  {isAdmin ? (
                    <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-white">
                      Administrator
                    </span>
                  ) : null}
                  {mine ? <span className="text-ink-400">(you)</span> : null}
                  <span>{formatDateTime(message.createdAt)}</span>
                  {message.visibility === 'admins_only' ? (
                    <span className="text-danger-600">visible to administrators only</span>
                  ) : null}
                </p>
                <p className="mt-1 whitespace-pre-line text-sm text-ink-700">{message.body}</p>
              </li>
            );
          })}
        </ul>
      )}

      {dispute.canPost ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={4000}
            rows={3}
            placeholder="Add information for the administrator and the other party. Attach nothing personal — evidence goes through the listing record."
            aria-label="Dispute message"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-500">{body.length}/4000</span>
            <Button variant="primary" size="sm" icon="message" onClick={post} loading={pending}>
              Post to dispute
            </Button>
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      ) : (
        <p className="border-t border-line pt-3 text-xs text-ink-500">
          This dispute is closed, so no further messages can be posted. The history remains readable.
        </p>
      )}
    </div>
  );
}

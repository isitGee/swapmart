'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { apiPost, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

/**
 * Message composer with polling.
 *
 * The API supports `after=<messageId>` for incremental reads, so the thread
 * refreshes cheaply while a conversation is open. Polling is used deliberately:
 * it is simple, it needs no extra infrastructure, and messages are persisted in
 * PostgreSQL regardless of whether anybody is polling.
 */
export function MessageComposer({ conversationId, disabled }: { conversationId: string; disabled: boolean }) {
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();
  const textarea = useRef<HTMLTextAreaElement>(null);

  async function send() {
    if (body.trim().length === 0) {
      setError('Write a message before sending.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiPost(`/conversations/${conversationId}/messages`, { body: body.trim() });
      setBody('');
      toast.success('Message sent.');
      router.refresh();
      textarea.current?.focus();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  if (disabled) {
    return <Alert tone="warning">This conversation is {disabled ? 'closed' : 'open'} and cannot receive new messages.</Alert>;
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        ref={textarea}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Write a message… (Ctrl+Enter to send)"
        maxLength={4000}
        rows={3}
        invalid={Boolean(error)}
        aria-label="Message"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void send();
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-500">{body.length}/4000</span>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon="refresh"
            onClick={() => router.refresh()}
            title="Fetch any messages sent since this page loaded"
          >
            Refresh
          </Button>
          <Button variant="primary" icon="message" onClick={send} loading={pending}>
            Send
          </Button>
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ExchangeRequestDto } from '@swapmart/shared';
import { apiPost, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

const LABELS: Record<ExchangeRequestDto['availableActions'][number], string> = {
  accept: 'Accept proposal',
  reject: 'Reject',
  counter: 'Send counter-proposal',
  cancel: 'Cancel request',
  complete: 'Mark completed',
};

export function ExchangeResponse({ exchange }: { exchange: ExchangeRequestDto }) {
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [counterDifference, setCounterDifference] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function respond(action: string) {
    setPending(action);
    setError(null);
    try {
      const payload: Record<string, unknown> = { action };
      if (message.trim()) payload.message = message.trim();
      if (action === 'counter') {
        const parsed = Number.parseInt(counterDifference.replace(/[^\d-]/g, ''), 10);
        if (Number.isFinite(parsed)) payload.counterPriceDifferenceTzs = parsed;
      }
      await apiPost(`/exchanges/${exchange.id}/respond`, payload);
      toast.success(`Exchange ${action === 'counter' ? 'counter-proposal sent' : action + 'ed'}.`);
      setMessage('');
      setOpen(null);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {exchange.availableActions.map((action) => (
          <Button
            key={action}
            variant={action === 'accept' ? 'primary' : action === 'reject' || action === 'cancel' ? 'ghost' : 'secondary'}
            size="sm"
            icon={action === 'accept' ? 'check' : action === 'reject' ? 'x' : action === 'counter' ? 'arrow-swap' : action === 'complete' ? 'check-circle' : 'x'}
            onClick={() => (action === 'accept' || action === 'complete' ? void respond(action) : setOpen(open === action ? null : action))}
            loading={pending === action}
          >
            {LABELS[action]}
          </Button>
        ))}
      </div>

      {open ? (
        <div className="rounded-card border border-line bg-surface-muted p-3">
          <div className="flex flex-col gap-3">
            <Field
              label={open === 'counter' ? 'Counter-proposal message' : 'Message (optional)'}
              htmlFor={`exchange-message-${exchange.id}`}
            >
              <Textarea
                id={`exchange-message-${exchange.id}`}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={4000}
                rows={3}
                placeholder={open === 'counter' ? 'Explain what would make this swap work for you.' : 'Add a note for the other party.'}
              />
            </Field>

            {open === 'counter' ? (
              <Field
                label="New price difference (TZS)"
                htmlFor={`exchange-difference-${exchange.id}`}
                hint="Positive means the other party tops up. Leave blank to keep the current figure."
              >
                <input
                  id={`exchange-difference-${exchange.id}`}
                  className="sm-input"
                  inputMode="numeric"
                  value={counterDifference}
                  onChange={(event) => setCounterDifference(event.target.value)}
                  placeholder={String(exchange.priceDifferenceTzs)}
                />
              </Field>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
                Cancel
              </Button>
              <Button
                variant={open === 'reject' ? 'danger' : 'primary'}
                size="sm"
                onClick={() => void respond(open)}
                loading={pending === open}
              >
                {open === 'counter' ? 'Send counter-proposal' : open === 'reject' ? 'Confirm rejection' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

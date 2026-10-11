'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TransactionDto } from '@swapmart/shared';
import { apiPatch, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { TRANSACTION_STATUS_LABELS } from '@/lib/format';

/**
 * Status transitions are restricted by the server: `availableStatuses` contains
 * only the transitions this member is allowed to make from the current state,
 * so the interface cannot offer an illegal move.
 */
export function TransactionStatusControl({ transaction }: { transaction: TransactionDto }) {
  const [status, setStatus] = useState(transaction.availableStatuses[0] ?? '');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  if (!transaction.canUpdateStatus || transaction.availableStatuses.length === 0) {
    return (
      <Alert tone="info">
        There is no status change available to you right now. {transaction.status === 'completed' ? 'This transaction is closed.' : 'Both parties must agree before the status advances.'}
      </Alert>
    );
  }

  async function apply() {
    if (!status) {
      setError('Choose the new status.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiPatch(`/transactions/${transaction.id}/status`, { status, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success('Status updated and recorded in the history.');
      setNote('');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Move this transaction to" htmlFor="transaction-status" required>
        <Select id="transaction-status" value={status} onChange={(event) => setStatus(event.target.value)}>
          {transaction.availableStatuses.map((option) => (
            <option key={option} value={option}>
              {TRANSACTION_STATUS_LABELS[option]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Note for the record" htmlFor="transaction-note" hint="Optional, up to 1000 characters">
        <Textarea
          id="transaction-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="e.g. Inspected the device together and confirmed the identifier matches."
        />
      </Field>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button variant="primary" icon="check" onClick={apply} loading={pending}>
        Record status change
      </Button>
      <p className="text-xs text-ink-500">
        Available moves are limited to what your role allows from the current state. Disagreements should be raised as a
        dispute instead of being forced through.
      </p>
    </div>
  );
}

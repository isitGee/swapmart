'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

export function AlertResolve({ alertId }: { alertId: string }) {
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function resolve() {
    if (note.trim().length < 5) {
      setError('Record what you found and what you did (at least 5 characters).');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiPost(`/admin/duplicate-alerts/${alertId}/resolve`, { note: note.trim() });
      toast.success('Alert resolved.');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Resolution note" htmlFor={`resolve-${alertId}`} required>
        <Textarea
          id={`resolve-${alertId}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          rows={2}
          placeholder="e.g. Same seller resubmitted after withdrawing; identifier claim released correctly. No further action."
        />
      </Field>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex justify-end">
        <Button variant="primary" size="sm" icon="check" onClick={resolve} loading={pending}>
          Mark resolved
        </Button>
      </div>
    </div>
  );
}

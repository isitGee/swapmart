'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DisputeDto } from '@swapmart/shared';
import { apiPatch, apiPost, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { DISPUTE_STATUS_LABELS } from '@/lib/format';

export function DisputeAdminControls({ dispute }: { dispute: DisputeDto }) {
  const [status, setStatus] = useState(dispute.status);
  const [resolution, setResolution] = useState(dispute.resolution ?? '');
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function updateStatus() {
    if ((status === 'resolved' || status === 'closed') && resolution.trim().length < 10) {
      setError('A resolution of at least 10 characters is required to resolve or close a dispute.');
      return;
    }
    setPending('status');
    setError(null);
    try {
      await apiPatch(`/disputes/${dispute.id}`, {
        status,
        ...(resolution.trim() ? { resolution: resolution.trim() } : {}),
      });
      toast.success('Dispute updated and both parties notified.');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  async function postMessage() {
    if (message.trim().length < 2) {
      setError('Write the message before posting.');
      return;
    }
    setPending('message');
    setError(null);
    try {
      await apiPost(`/disputes/${dispute.id}/messages`, {
        body: message.trim(),
        visibility: internal ? 'admins_only' : 'participants',
      });
      setMessage('');
      setInternal(false);
      toast.success('Message added to the dispute record.');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr] sm:items-start">
        <Field label="Status" htmlFor={`dispute-status-${dispute.id}`}>
          <Select id={`dispute-status-${dispute.id}`} value={status} onChange={(event) => setStatus(event.target.value as DisputeDto['status'])}>
            {(Object.keys(DISPUTE_STATUS_LABELS) as DisputeDto['status'][]).map((value) => (
              <option key={value} value={value}>
                {DISPUTE_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Resolution" htmlFor={`dispute-resolution-${dispute.id}`} hint="Shown to both parties when resolved">
          <Textarea
            id={`dispute-resolution-${dispute.id}`}
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="What was decided and what each party must do next."
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" size="sm" icon="check" onClick={updateStatus} loading={pending === 'status'}>
          Save status
        </Button>
      </div>

      <div className="border-t border-line pt-4">
        <Field label="Post a message to the dispute" htmlFor={`dispute-message-${dispute.id}`}>
          <Textarea
            id={`dispute-message-${dispute.id}`}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={4000}
            rows={3}
            placeholder="Ask for information, or explain the next step."
          />
        </Field>
        <Checkbox
          id={`dispute-internal-${dispute.id}`}
          className="mt-3"
          checked={internal}
          onChange={(event) => setInternal(event.target.checked)}
          label="Keep this message internal to administrators"
        />
        {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" size="sm" icon="message" onClick={postMessage} loading={pending === 'message'}>
            Post message
          </Button>
        </div>
      </div>
    </div>
  );
}

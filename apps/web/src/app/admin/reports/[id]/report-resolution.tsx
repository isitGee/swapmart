'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { REPORT_PRIORITIES, REPORT_STATUSES } from '@swapmart/shared';
import { apiPost, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert, Panel } from '@/components/ui/feedback';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { humanize, REPORT_STATUS_LABELS } from '@/lib/format';

const LISTING_ACTIONS = [
  { value: 'none', label: 'No listing action' },
  { value: 'suspend', label: 'Suspend the reported listing' },
  { value: 'reinstate', label: 'Reinstate the reported listing' },
];

export function ReportResolution({ reportId }: { reportId: string }) {
  const [status, setStatus] = useState('under_review');
  const [priority, setPriority] = useState('normal');
  const [resolution, setResolution] = useState('');
  const [listingAction, setListingAction] = useState('none');
  const [noteVisibility, setNoteVisibility] = useState<'moderator_note' | 'reporter_visible'>('reporter_visible');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function submit() {
    if (resolution.trim().length < 10) {
      setError('Write the resolution in at least 10 characters — this becomes the permanent record.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiPost(`/admin/reports/${reportId}/resolve`, {
        status,
        priority,
        resolution: resolution.trim(),
        listingAction,
        noteVisibility,
      });
      toast.success('Report updated.');
      setResolution('');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel title="Investigate and resolve" description="Changing the status notifies the reporter. Resolving requires a written resolution.">
      <div className="flex flex-col gap-4">
        <Field label="New status" htmlFor="report-status" required>
          <Select id="report-status" value={status} onChange={(event) => setStatus(event.target.value)}>
            {REPORT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {REPORT_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Priority" htmlFor="report-priority">
          <Select id="report-priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
            {REPORT_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Resolution or progress note" htmlFor="report-resolution" required>
          <Textarea
            id="report-resolution"
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="What you checked, what you found, and what you decided."
          />
        </Field>

        <Field label="Listing action" htmlFor="report-listing-action">
          <Select id="report-listing-action" value={listingAction} onChange={(event) => setListingAction(event.target.value)}>
            {LISTING_ACTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Checkbox
          id="note-visible"
          checked={noteVisibility === 'reporter_visible'}
          onChange={(event) => setNoteVisibility(event.target.checked ? 'reporter_visible' : 'moderator_note')}
          label="Show this note to the person who filed the report"
        />

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Button variant="primary" icon="check" onClick={submit} loading={pending}>
          Save report update
        </Button>
      </div>
    </Panel>
  );
}

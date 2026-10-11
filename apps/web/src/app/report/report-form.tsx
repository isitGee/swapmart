'use client';

import { useState } from 'react';
import Link from 'next/link';
import { REPORT_CATEGORIES } from '@swapmart/shared';
import { apiPost, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert, Panel } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { humanize } from '@/lib/format';

export function ReportForm() {
  const [category, setCategory] = useState<string>('suspected_stolen_device');
  const [listingRef, setListingRef] = useState('');
  const [description, setDescription] = useState('');
  const [contactConsent, setContactConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const toast = useToast();

  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function submit() {
    if (!uuidLike.test(listingRef.trim())) {
      setError('Paste the listing reference (a UUID from the listing page URL) or report the listing from its own page.');
      return;
    }
    if (description.trim().length < 20) {
      setError('Describe what you observed in at least 20 characters.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await apiPost<{ reference: string }>('/reports', {
        category,
        description: description.trim(),
        listingId: listingRef.trim(),
        contactConsent,
      });
      setReference(result.reference);
      toast.success('Report submitted.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  if (reference) {
    return (
      <Alert tone="success" title={`Report ${reference} received`}>
        An administrator will review it. Follow progress from{' '}
        <Link href="/dashboard/reports" className="font-medium underline">
          your reports
        </Link>
        .
      </Alert>
    );
  }

  return (
    <Panel title="File a report">
      <div className="flex flex-col gap-4">
        <Field label="Category" htmlFor="category" required>
          <Select id="category" value={category} onChange={(event) => setCategory(event.target.value)}>
            {REPORT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Listing reference"
          htmlFor="listing-ref"
          hint="Shown at the end of the listing URL, or use the report button on the listing itself"
          required
        >
          <Input
            id="listing-ref"
            value={listingRef}
            onChange={(event) => setListingRef(event.target.value)}
            placeholder="8f14e45f-ceea-467a-9f70-0d2e7e3d3d3d"
            className="font-mono text-xs"
          />
        </Field>

        <Field label="What did you observe?" htmlFor="description" hint={`${description.length}/3000`} required>
          <Textarea
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={3000}
            placeholder="Include dates, what was said or shown, and any identifier you have already verified yourself. Mask identifiers in this box where you can."
          />
        </Field>

        <label className="flex items-start gap-2.5 text-sm text-ink-600">
          <input
            type="checkbox"
            checked={contactConsent}
            onChange={(event) => setContactConsent(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line-strong accent-brand-600"
          />
          An administrator may contact me about this report.
        </label>

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex justify-end">
          <Button variant="danger" icon="flag" onClick={submit} loading={pending}>
            Submit report
          </Button>
        </div>
      </div>
    </Panel>
  );
}

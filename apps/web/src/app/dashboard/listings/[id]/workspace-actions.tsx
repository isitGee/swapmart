'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEVICE_CONDITIONS,
  TANZANIA_REGIONS,
  UPLOAD_LIMITS,
  type OwnerListingDto,
} from '@swapmart/shared';
import { apiPatch, apiPost, apiUpload, errorMessage, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Panel } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { CONDITION_LABELS, formatTzs } from '@/lib/format';

const EVIDENCE_KINDS = [
  { value: 'proof_of_purchase', label: 'Proof of purchase' },
  { value: 'imei_screenshot', label: 'Identifier screenshot' },
  { value: 'serial_label', label: 'Serial number label' },
  { value: 'box_label', label: 'Box or packaging label' },
  { value: 'device_front', label: 'Device photograph (front)' },
  { value: 'device_back', label: 'Device photograph (back)' },
  { value: 'warranty_document', label: 'Warranty document' },
  { value: 'other', label: 'Other supporting document' },
];

/**
 * Seller-side controls for one listing: edit, submit, withdraw, change
 * availability and answer an evidence request. Every button performs a real
 * request; where the workflow forbids an action the control is not rendered.
 */
export function ListingWorkspace({ listing }: { listing: OwnerListingDto }) {
  const router = useRouter();
  const toast = useToast();

  const [editing, setEditing] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editableStatuses = ['draft', 'rejected', 'evidence_required', 'withdrawn'];
  const canEdit = editableStatuses.includes(listing.status);
  const canSubmit = editableStatuses.includes(listing.status) || listing.status === 'approved';
  const canWithdraw = ['draft', 'submitted', 'checks_pending', 'flagged', 'under_review', 'evidence_required', 'approved'].includes(
    listing.status,
  );
  const canChangeAvailability = listing.status === 'approved';

  async function run(key: string, action: () => Promise<unknown>, successMessage: string) {
    setBusy(key);
    setError(null);
    try {
      await action();
      toast.success(successMessage);
      router.refresh();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submitForReview() {
    await run(
      'submit',
      () => apiPost(`/me/listings/${listing.id}/submit`, { confirmAccuracy: true, confirmLawful: true }),
      'Listing submitted. Automated checks are running.',
    );
  }

  async function withdraw(reason: string) {
    const success = await run(
      'withdraw',
      () => apiPost(`/me/listings/${listing.id}/withdraw`, reason.trim() ? { reason: reason.trim() } : {}),
      'Listing withdrawn and its identifier claim released.',
    );
    if (success) setWithdrawOpen(false);
  }

  async function changeAvailability(availability: string) {
    await run(
      'availability',
      () => apiPatch(`/me/listings/${listing.id}/availability`, { availability }),
      `Marked as ${availability}.`,
    );
  }

  const nextAvailability = listing.availability === 'available' ? 'reserved' : listing.availability === 'reserved' ? 'sold' : null;

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {listing.evidenceRequests.length > 0 ? (
        <Alert
          tone="warning"
          title={`An administrator has requested ${listing.evidenceRequests.length} more item${listing.evidenceRequests.length === 1 ? '' : 's'}`}
          action={
            <Button variant="primary" size="sm" icon="upload" onClick={() => setEvidenceOpen(true)}>
              Add evidence
            </Button>
          }
        >
          <ul className="mt-1 space-y-1">
            {listing.evidenceRequests.map((request) => (
              <li key={`${request.kind}-${request.requestedAt}`}>
                <span className="font-medium">{request.kind.replace(/_/g, ' ')}</span>
                {request.note ? ` — ${request.note}` : ''}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Panel title="Actions">
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>
              Edit details
            </Button>
          ) : null}

          {canSubmit ? (
            <Button
              variant="primary"
              icon="upload"
              onClick={submitForReview}
              loading={busy === 'submit'}
              title={
                listing.status === 'approved'
                  ? 'Re-submitting an approved listing is not required; edit and withdraw instead'
                  : undefined
              }
            >
              {listing.status === 'approved' ? 'Re-run verification' : 'Submit for verification'}
            </Button>
          ) : null}

          {canChangeAvailability && nextAvailability ? (
            <Button variant="secondary" icon="check" onClick={() => void changeAvailability(nextAvailability)} loading={busy === 'availability'}>
              Mark as {nextAvailability}
            </Button>
          ) : null}

          {canChangeAvailability && listing.availability === 'sold' ? (
            <Button variant="ghost" icon="refresh" onClick={() => void changeAvailability('available')} loading={busy === 'availability'}>
              Relist as available
            </Button>
          ) : null}

          {canWithdraw ? (
            <Button variant="ghost" icon="x" onClick={() => setWithdrawOpen(true)}>
              Withdraw listing
            </Button>
          ) : null}
        </div>

        {listing.status === 'suspended' || listing.status === 'rejected' || listing.status === 'flagged' ? (
          <p className="mt-3 text-xs text-ink-500">
            A listing in this state cannot be edited in place where the change would alter the evidence record. Contact the
            moderation team through a report if you believe the decision was wrong — the review history below shows the
            reason recorded for each decision.
          </p>
        ) : null}
      </Panel>

      <EditDialog
        open={editing}
        onClose={() => setEditing(false)}
        listing={listing}
        onSaved={() => {
          setEditing(false);
          router.refresh();
        }}
      />

      <EvidenceDialog
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        listing={listing}
        onUploaded={() => {
          setEvidenceOpen(false);
          router.refresh();
        }}
      />

      <Dialog
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title="Withdraw this listing"
        description="Withdrawing releases the identifier claim so you can reuse it in a future submission. The listing and its review history are retained."
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawOpen(false)}>
              Keep listing
            </Button>
            <WithdrawConfirm onConfirm={withdraw} busy={busy === 'withdraw'} />
          </>
        }
      >
        <p className="text-sm text-ink-600">
          Buyers will no longer see the listing. If it is already published, it disappears from the catalogue immediately.
        </p>
      </Dialog>
    </div>
  );
}

function WithdrawConfirm({ onConfirm, busy }: { onConfirm: (reason: string) => Promise<void>; busy: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <div className="flex flex-col gap-3">
      <Field label="Reason (optional)" htmlFor="withdraw-reason" hint="Recorded against the listing">
        <Input id="withdraw-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} />
      </Field>
      <Button variant="danger" icon="x" onClick={() => void onConfirm(reason)} loading={busy}>
        Withdraw listing
      </Button>
    </div>
  );
}

function EditDialog({
  open,
  onClose,
  listing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  listing: OwnerListingDto;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [price, setPrice] = useState(String(listing.askingPriceTzs));
  const [condition, setCondition] = useState<string>(listing.condition);
  const [region, setRegion] = useState(listing.region);
  const [city, setCity] = useState(listing.city ?? '');
  const [negotiable, setNegotiable] = useState(listing.negotiable);
  const [exchangeAllowed, setExchangeAllowed] = useState(listing.exchangeAllowed);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const toast = useToast();

  async function save() {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiPatch(`/me/listings/${listing.id}`, {
        title: title.trim(),
        description: description.trim(),
        askingPriceTzs: Number.parseInt(price.replace(/[^\d]/g, ''), 10),
        condition,
        region,
        city: city.trim(),
        negotiable,
        exchangeAllowed,
      });
      toast.success('Listing updated.');
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors);
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Edit listing details"
      description="Changing details after approval returns the listing to automated checks for re-verification."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" onClick={save} loading={pending}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Title" htmlFor="edit-title" error={fieldErrors.title} required>
          <Input id="edit-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
        </Field>
        <Field label="Description" htmlFor="edit-description" error={fieldErrors.description} required>
          <Textarea id="edit-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={6} maxLength={4000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Asking price (TZS)" htmlFor="edit-price" error={fieldErrors.askingPriceTzs} required>
            <Input id="edit-price" inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value.replace(/[^\d]/g, ''))} />
          </Field>
          <Field label="Condition" htmlFor="edit-condition">
            <Select id="edit-condition" value={condition} onChange={(event) => setCondition(event.target.value)}>
              {DEVICE_CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {CONDITION_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Region" htmlFor="edit-region">
            <Select id="edit-region" value={region} onChange={(event) => setRegion(event.target.value)}>
              {TANZANIA_REGIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City or district" htmlFor="edit-city">
            <Input id="edit-city" value={city} onChange={(event) => setCity(event.target.value)} maxLength={80} />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <Checkbox id="edit-negotiable" checked={negotiable} onChange={(event) => setNegotiable(event.target.checked)} label="Price is negotiable" />
          <Checkbox
            id="edit-exchange"
            checked={exchangeAllowed}
            onChange={(event) => setExchangeAllowed(event.target.checked)}
            label="Open to exchange proposals"
          />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Dialog>
  );
}

function EvidenceDialog({
  open,
  onClose,
  listing,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  listing: OwnerListingDto;
  onUploaded: () => void;
}) {
  const [kind, setKind] = useState(listing.evidenceRequests[0]?.kind ?? 'proof_of_purchase');
  const [note, setNote] = useState('');
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('files', file);
      const stored = await apiUpload<{ id: string }[]>('/uploads/evidence', formData);
      const asset = stored[0];
      if (asset) {
        setMediaId(asset.id);
        setFileName(file.name);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setUploading(false);
    }
  }

  async function attach() {
    if (!mediaId) {
      setError('Upload a file first.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiPost(`/me/listings/${listing.id}/evidence`, {
        evidence: [{ mediaId, kind, ...(note.trim() ? { note: note.trim() } : {}) }],
      });
      toast.success('Evidence attached and sent to the review queue.');
      onUploaded();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add supporting evidence"
      description="Evidence files are stored privately and are only visible to you and to SWAPMART moderators."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="upload" onClick={attach} loading={pending} disabled={!mediaId}>
            Attach evidence
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What does this evidence show?" htmlFor="evidence-kind" required>
          <Select id="evidence-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
            {EVIDENCE_KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,application/pdf"
            className="hidden"
            onChange={(event) => void upload(event.target.files)}
          />
          <Button variant="secondary" icon="upload" onClick={() => inputRef.current?.click()} loading={uploading}>
            Choose a file
          </Button>
          {fileName ? <p className="mt-2 text-xs text-ink-600">Selected: {fileName}</p> : null}
          <p className="mt-1.5 text-xs text-ink-500">
            Images up to {Math.round(UPLOAD_LIMITS.maxEvidenceBytes / 1024 / 1024)}MB, or a PDF document.
          </p>
        </div>

        <Field label="Note for the reviewer" htmlFor="evidence-note" hint="Optional, up to 300 characters">
          <Textarea
            id="evidence-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={300}
            rows={3}
            placeholder="Explain what the file shows and where the device identifier appears."
          />
        </Field>

        {listing.evidenceRequests.length > 0 ? (
          <Alert tone="info" title="Outstanding requests">
            <ul className="space-y-1">
              {listing.evidenceRequests.map((request) => (
                <li key={`${request.kind}-${request.requestedAt}`}>
                  {request.kind.replace(/_/g, ' ')}
                  {request.note ? ` — ${request.note}` : ''}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {error ? <Alert tone="danger">{error}</Alert> : null}
        <p className="text-xs text-ink-500">
          Current listing price reference: {formatTzs(listing.askingPriceTzs)}. Evidence cannot be edited after upload —
          request a correction through a report if something is wrong.
        </p>
      </div>
    </Dialog>
  );
}

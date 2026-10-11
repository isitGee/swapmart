'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DECISION_REASON_CODES, type AdminListingDto } from '@swapmart/shared';
import { apiPost, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert, Panel } from '@/components/ui/feedback';
import { Checkbox, Field, RadioGroup, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { humanize } from '@/lib/format';

const DECISIONS = [
  { value: 'approve', label: 'Approve', description: 'Publishes the listing to the catalogue with a verification badge.' },
  { value: 'request_evidence', label: 'Request more evidence', description: 'Returns the listing to the seller with specific items to supply.' },
  { value: 'reject', label: 'Reject', description: 'Refuses the submission. The identifier claim is released unless you keep it reserved.' },
  { value: 'suspend', label: 'Suspend', description: 'Removes an already published listing from the catalogue.' },
  { value: 'reinstate', label: 'Reinstate', description: 'Reverses a previous rejection or suspension.' },
  { value: 'claim', label: 'Claim for review', description: 'Marks you as the reviewer without changing the state.' },
] as const;

const EVIDENCE_OPTIONS = [
  { value: 'proof_of_purchase', label: 'Proof of purchase' },
  { value: 'imei_screenshot', label: 'Identifier screenshot' },
  { value: 'serial_label', label: 'Serial label photograph' },
  { value: 'box_label', label: 'Box or packaging label' },
  { value: 'device_front', label: 'Device photograph (front)' },
  { value: 'device_back', label: 'Device photograph (back)' },
  { value: 'warranty_document', label: 'Warranty document' },
];

export function DecisionPanel({ listing }: { listing: AdminListingDto }) {
  const [decision, setDecision] = useState<string>('approve');
  const [reasonCode, setReasonCode] = useState<string>('completeness_confirmed');
  const [reasonNote, setReasonNote] = useState('');
  const [evidenceItems, setEvidenceItems] = useState<string[]>([]);
  const [releaseIdentifier, setReleaseIdentifier] = useState(true);
  const [acknowledge, setAcknowledge] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function submit() {
    if (reasonNote.trim().length < 10) {
      setError('Record a note of at least 10 characters explaining the decision — it is shown to the seller.');
      return;
    }
    if (decision === 'request_evidence' && evidenceItems.length === 0) {
      setError('Select at least one item the seller must supply.');
      return;
    }
    if (!acknowledge) {
      setError('Acknowledge the platform statement before recording a decision.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await apiPost<{ status: string; notice: string }>(`/admin/listings/${listing.id}/decision`, {
        decision,
        reasonCode,
        reasonNote: reasonNote.trim(),
        ...(decision === 'request_evidence'
          ? { requiredEvidence: evidenceItems.map((kind) => ({ kind })) }
          : {}),
        releaseIdentifier: decision === 'approve' ? false : releaseIdentifier,
        acknowledgeLimits: true,
      });
      setResult(response.notice);
      toast.success('Decision recorded.');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel
      title="Record a decision"
      description="The decision, its reason code, your note and your account are written to the moderation history and the audit log."
    >
      {result ? (
        <Alert tone="success" title="Decision recorded" className="mb-4">
          {result}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4">
        <RadioGroup
          name="decision"
          legend="Decision"
          value={decision}
          onChange={(value) => {
            setDecision(value);
            setResult(null);
            if (value === 'approve') setReasonCode('completeness_confirmed');
            else if (value === 'reject') setReasonCode('insufficient_evidence');
            else if (value === 'request_evidence') setReasonCode('insufficient_evidence');
            else if (value === 'suspend') setReasonCode('suspected_stolen_device');
            else setReasonCode('appeal_upheld');
          }}
          options={DECISIONS.map((item) => ({ value: item.value, label: item.label, description: item.description }))}
          columns={1}
        />

        <Field label="Reason code" htmlFor="reason-code" required>
          <Select id="reason-code" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
            {DECISION_REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {humanize(code)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Note to the seller"
          htmlFor="reason-note"
          hint={`${reasonNote.length}/2000 · at least 10 characters`}
          required
        >
          <Textarea
            id="reason-note"
            value={reasonNote}
            onChange={(event) => setReasonNote(event.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Explain what you checked and why this is the outcome. The seller reads this."
          />
        </Field>

        {decision === 'request_evidence' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[0.8125rem] font-medium text-ink-700">Required evidence</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {EVIDENCE_OPTIONS.map((option) => {
                const selected = evidenceItems.includes(option.value);
                return (
                  <Checkbox
                    key={option.value}
                    id={`required-${option.value}`}
                    checked={selected}
                    onChange={() =>
                      setEvidenceItems((current) =>
                        selected ? current.filter((item) => item !== option.value) : [...current, option.value],
                      )
                    }
                    label={option.label}
                  />
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {decision !== 'approve' ? (
          <Checkbox
            id="release-identifier"
            checked={releaseIdentifier}
            onChange={(event) => setReleaseIdentifier(event.target.checked)}
            label="Release the identifier claim"
            description="Releasing lets the seller correct the mistake and resubmit, but means the identifier is no longer reserved against this device."
          />
        ) : null}

        <Checkbox
          id="acknowledge"
          checked={acknowledge}
          onChange={(event) => setAcknowledge(event.target.checked)}
          label="I understand approval confirms the automated checks and my review of the evidence — it is not a statement of legal ownership, title, or stolen-device status."
        />

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Button variant="primary" icon="check" onClick={submit} loading={pending} disabled={!acknowledge}>
          Record decision
        </Button>
      </div>
    </Panel>
  );
}

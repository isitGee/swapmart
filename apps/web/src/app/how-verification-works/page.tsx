import Link from 'next/link';
import type { SystemConfigDto } from '@swapmart/shared';
import { Badge, NotConfiguredBadge } from '@/components/ui/badge';
import { Alert, DisclaimerNote, Panel, PageHeader } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { serverFetchSafe } from '@/lib/server-api';

export const metadata = { title: 'How verification works' };

const CHECKS: { title: string; body: string; severity: 'critical' | 'warning' | 'info' }[] = [
  {
    title: 'Identifier format and checksum',
    body: 'An IMEI must be 15 digits with a valid Luhn check digit; MEIDs, serials, MAC addresses and model numbers must match their documented formats.',
    severity: 'critical',
  },
  {
    title: 'Duplicate identifier detection',
    body: 'The identifier is normalised and hashed with a keyed HMAC. If an active listing already holds that fingerprint, the database refuses the write and the attempt is logged for administrators.',
    severity: 'critical',
  },
  {
    title: 'Evidence completeness',
    body: 'At least one proof-of-purchase or identifier photograph, plus device photographs. Missing evidence moves the listing to “awaiting additional evidence”.',
    severity: 'warning',
  },
  {
    title: 'Price sanity',
    body: 'A price far below the category median for the stated model is treated as suspicious — a common signal of a stolen or counterfeit device.',
    severity: 'warning',
  },
  {
    title: 'Image reuse',
    body: 'Image content hashes are compared so a photograph copied from another listing, or from the internet, raises a flag.',
    severity: 'warning',
  },
  {
    title: 'Resubmission velocity',
    body: 'Repeated submissions of the same device after a rejection are tracked, because repeat attempts often accompany an identifier that an administrator already refused.',
    severity: 'info',
  },
];

export default async function HowVerificationWorksPage() {
  const configuration = await serverFetchSafe<SystemConfigDto | null>('/system/status', null);
  const providerConfigured = configuration?.stolenCheck.configured ?? false;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="Trust & safety"
        title="How device verification works on SWAPMART"
        description="Verification is a structured evidence and review process. It reduces specific risks — duplicated identifiers, malformed data and re-listed rejected devices — and it has hard limits, which are stated plainly below."
      />

      <Panel title="The workflow a listing passes through" className="mt-8">
        <ol className="space-y-4">
          {[
            { status: 'Draft', body: 'Only the seller can see it. Photographs and evidence can be attached privately.' },
            { status: 'Submitted', body: 'The seller confirms the information is accurate and that they may lawfully sell the device. Identifiers become active claims at this point.' },
            { status: 'Automated checks pending', body: 'The verification engine runs eleven checks and produces a score with structured flags.' },
            { status: 'Flagged / under review / awaiting evidence', body: 'A critical flag goes straight to the review queue. Warnings either go to review or ask the seller for more evidence.' },
            { status: 'Approved', body: 'The listing becomes visible in the public catalogue with a verification badge.' },
            { status: 'Rejected / suspended', body: 'Never visible publicly. Both states carry a recorded reason code and note the seller can read.' },
            { status: 'Withdrawn', body: 'The seller removed the listing; its identifier claim is released.' },
          ].map((step, index) => (
            <li key={step.status} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">{step.status}</p>
                <p className="mt-0.5 text-sm text-ink-600">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="What the automated checks look for" className="mt-6">
        <ul className="space-y-3.5">
          {CHECKS.map((check) => (
            <li key={check.title} className="flex gap-3">
              <Icon
                name={check.severity === 'critical' ? 'alert' : 'gauge'}
                size={17}
                className={check.severity === 'critical' ? 'mt-0.5 shrink-0 text-danger-600' : 'mt-0.5 shrink-0 text-warning-600'}
              />
              <div>
                <p className="text-sm font-medium text-ink-900">
                  {check.title}{' '}
                  <Badge size="sm" tone={check.severity === 'critical' ? 'danger' : check.severity === 'warning' ? 'warning' : 'neutral'}>
                    {check.severity}
                  </Badge>
                </p>
                <p className="mt-0.5 text-sm text-ink-600">{check.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Stolen-device database lookups" className="mt-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink-800">Provider status</span>
          {providerConfigured ? (
            <Badge tone="success">Connected: {configuration?.stolenCheck.provider}</Badge>
          ) : (
            <NotConfiguredBadge />
          )}
        </div>
        <p className="mt-3 text-sm text-ink-600">
          SWAPMART defines a provider interface for authoritative stolen-device and blacklist lookups, but this deployment
          has no provider connected. In that state the platform records “not performed (provider not configured)” against
          every submission. It never reports a device as clear when no check was actually made, and it never invents a
          result.
        </p>
        {configuration?.stolenCheck.notices?.length ? (
          <Alert tone="info" className="mt-3">
            <ul className="space-y-1">
              {configuration.stolenCheck.notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </Panel>

      <Panel title="What approval does not mean" className="mt-6">
        <ul className="space-y-2.5 text-sm text-ink-600">
          <li className="flex gap-2"><Icon name="x" size={15} className="mt-0.5 shrink-0 text-danger-600" />It is not a legal guarantee of ownership or title.</li>
          <li className="flex gap-2"><Icon name="x" size={15} className="mt-0.5 shrink-0 text-danger-600" />It does not prove a device has never been reported stolen.</li>
          <li className="flex gap-2"><Icon name="x" size={15} className="mt-0.5 shrink-0 text-danger-600" />It does not authenticate internal components or repair history.</li>
          <li className="flex gap-2"><Icon name="x" size={15} className="mt-0.5 shrink-0 text-danger-600" />It does not insure a transaction, hold funds, or refund a buyer.</li>
        </ul>
        <DisclaimerNote className="mt-4">
          An administrator manually reviews the evidence, the identifier record and the automated flags. Where evidence is
          contradictory the listing is rejected or suspended rather than published.
        </DisclaimerNote>
      </Panel>

      <Panel title="Data protection" className="mt-6">
        <p className="text-sm text-ink-600">
          Full identifiers are encrypted at rest with an authenticated cipher and never rendered in the public catalogue,
          in list responses, or in another member’s dashboard. Evidence photographs and documents are stored as private
          assets and are only served to the owner, the assigned administrator, or a party to a dispute over that device.
          Every private-evidence view is written to the audit log.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/rules" className="text-sm font-medium text-brand-700 hover:underline">Marketplace rules</Link>
          <span className="text-ink-300">·</span>
          <Link href="/privacy" className="text-sm font-medium text-brand-700 hover:underline">Data and privacy notice</Link>
        </div>
      </Panel>
    </div>
  );
}

import Link from 'next/link';
import { DisclaimerNote, PageHeader, Panel } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';

export const metadata = { title: 'Marketplace rules' };

export default function RulesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="Policy"
        title="Marketplace rules"
        description="These rules are enforced by the platform where it can, and by administrators where judgement is required. Breaching them can restrict your account or remove your listings."
      />

      <Panel title="Listings" className="mt-8">
        <ul className="space-y-3 text-sm text-ink-600">
          {[
            'Describe the device accurately: model, condition, accessories, and any faults. Grading is yours to declare and an administrator’s to question.',
            'Attach at least one photograph of the actual device, not a manufacturer image or a photograph taken from elsewhere on the internet.',
            'Declare any borrowed, financed or contract-locked device honestly before submission.',
            'Only list devices you own or are authorised to sell. Do not list a device you have already agreed to sell to somebody else.',
            'Do not list devices with an identifier that an administrator has already rejected on SWAPMART.',
            'One listing per physical device. Duplicated or near-identical listings are removed.',
          ].map((rule) => (
            <li key={rule} className="flex gap-2.5">
              <Icon name="check" size={15} className="mt-0.5 shrink-0 text-success-600" />
              {rule}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Conduct" className="mt-6">
        <ul className="space-y-3 text-sm text-ink-600">
          {[
            'Keep negotiation and arrangements inside SWAPMART messaging so there is a record both parties can point to.',
            'Do not share another person’s identity documents, phone number or device identifiers publicly.',
            'Do not post a full IMEI, serial number or MAC address in a public question — masks only.',
            'Harassment, threats and discriminatory language lead to immediate suspension.',
            'Reports must be made in good faith. Repeatedly filing unfounded reports is itself a breach.',
          ].map((rule) => (
            <li key={rule} className="flex gap-2.5">
              <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-warning-600" />
              {rule}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Transactions and exchanges" className="mt-6">
        <ul className="space-y-3 text-sm text-ink-600">
          <li>SWAPMART is a marketplace and a record-keeping surface. It does not process payments, hold funds, deliver devices or guarantee performance.</li>
          <li>Exchange proposals are binding only in the sense that both parties recorded agreement. They create a transaction record, not a contract enforceable by SWAPMART.</li>
          <li>Inspect the device and compare the identifier with the listing record before you hand over money or a device.</li>
          <li>Status changes on a transaction are limited to the buyer and seller in that transaction, and every change is written to the history.</li>
        </ul>
      </Panel>

      <Panel title="Enforcement" className="mt-6">
        <p className="text-sm text-ink-600">
          Enforcement actions available to administrators are: hide a comment or message, request additional evidence,
          reject a submission, suspend a published listing, restrict an account, and suspend an account. Every action records
          the administrator, the reason code and the note, and appears in the audit log. Reports and their resolution
          history are never deleted.
        </p>
        <DisclaimerNote className="mt-4">
          This is a final-year project demonstration. Accounts, listings, evidence and identifiers shown in the seeded
          environment are fictional.
        </DisclaimerNote>
        <p className="mt-4 text-sm">
          <Link href="/report" className="font-medium text-brand-700 hover:underline">Report a listing or a member</Link>
        </p>
      </Panel>
    </div>
  );
}

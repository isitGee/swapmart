import { PageHeader, Panel } from '@/components/ui/feedback';

export const metadata = { title: 'Data and privacy notice' };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="Privacy"
        title="Data and privacy notice"
        description="What SWAPMART stores about you, what it stores about devices, who can see it, and how long it is kept."
      />

      <Panel title="About you" className="mt-8">
        <dl className="space-y-4 text-sm text-ink-600">
          <div>
            <dt className="font-medium text-ink-900">Account</dt>
            <dd>Name, email address, an Argon2id password hash, and optionally a phone number, region and city. Your password is never stored or logged in recoverable form.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink-900">Sessions</dt>
            <dd>One row per signed-in device, holding a SHA-256 hash of the session token, the device’s user-agent, an approximate IP address and expiry. You can revoke any session or all others from your dashboard.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink-900">Activity</dt>
            <dd>Listings, messages, questions, exchange proposals, transactions, reports and disputes you create, together with status history. These records are the dispute-resolution surface and are retained rather than silently deleted.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink-900">Audit log</dt>
            <dd>Administrative and security-relevant actions are recorded with the actor, the entity, the reason and the IP address. Members cannot edit or delete audit entries.</dd>
          </div>
        </dl>
      </Panel>

      <Panel title="About devices" className="mt-6">
        <dl className="space-y-4 text-sm text-ink-600">
          <div>
            <dt className="font-medium text-ink-900">Identifiers</dt>
            <dd>
              A device identifier is stored twice: as ciphertext under a symmetric key, and as an HMAC fingerprint used only
              for duplicate detection. The last four characters are kept separately so the owner and reviewers can recognise
              the record. Public pages show a masked form such as <span className="font-mono">•••• •••• 1234</span>.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink-900">Evidence</dt>
            <dd>Proof of purchase, device photographs and identifier photographs are stored as private assets. They are visible to the seller who uploaded them, to administrators reviewing the device, and to a party to a dispute when the dispute concerns that device — the view is logged each time.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink-900">Duplicates</dt>
            <dd>When two members claim the same identifier, the platform records that a conflict occurred and which submission lost. The second member is told the identifier is unavailable; they are never told who holds it or what the other listing is.</dd>
          </div>
        </dl>
      </Panel>

      <Panel title="Your controls" className="mt-6">
        <ul className="space-y-2.5 text-sm text-ink-600">
          <li>Edit your display name, biography, region, city and phone visibility from your profile.</li>
          <li>Hide your phone number from the public seller profile entirely.</li>
          <li>Revoke other sessions, or deactivate your account (which revokes all sessions immediately).</li>
          <li>Export requests: because this is a demonstration deployment, contact the administrators directly rather than through a self-service tool.</li>
        </ul>
      </Panel>

      <Panel title="Demonstration deployment" className="mt-6">
        <p className="text-sm text-ink-600">
          This instance runs on seeded, entirely fictional data. No real Tanzanian identity documents, no real
          stolen-device records and no real private identifiers are present. Uploaded files are stored on the local disk of
          the development server unless Cloudinary credentials are configured.
        </p>
      </Panel>
    </div>
  );
}

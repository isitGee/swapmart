import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AdminListingDto } from '@swapmart/shared';
import { AccountStatusBadge, AvailabilityBadge, Badge, ListingStatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert, DataList, DisclaimerNote, ErrorState, PageHeader, Panel, Table, Td, Th } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { serverFetchSafe } from '@/lib/server-api';
import { CONDITION_LABELS, formatDateTime, formatRelative, formatTzs, humanize } from '@/lib/format';
import { DecisionPanel } from './decision-panel';
import { InternalNotes } from './internal-notes';

export const metadata = { title: 'Review submission' };

export default async function AdminListingReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const listing = await serverFetchSafe<AdminListingDto | null>(`/admin/listings/${id}`, null);

  if (!listing) {
    return (
      <ErrorState
        title="Submission not available"
        message="This listing does not exist or has been permanently removed."
        retry={<ButtonLink href="/admin/listings" variant="secondary">Back to the queue</ButtonLink>}
      />
    );
  }

  const latestAttempt = listing.verificationAttempts[0];

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-ink-500">
        <Link href="/admin/listings" className="hover:text-brand-700">
          Review queue
        </Link>
        <Icon name="chevron" size={12} />
        <span className="truncate text-ink-700">{listing.title}</span>
      </nav>

      <PageHeader
        eyebrow="Submission review"
        title={listing.title}
        description={`Submitted ${listing.publishedAt ? formatDateTime(listing.publishedAt) : '— not yet published'} · ${listing.verificationAttempts.length} automated check run${listing.verificationAttempts.length === 1 ? '' : 's'}`}
        actions={
          <>
            <ListingStatusBadge status={listing.status} />
            <AvailabilityBadge availability={listing.availability} />
            <Badge tone={listing.reviewPriority === 'urgent' ? 'danger' : listing.reviewPriority === 'high' ? 'warning' : 'neutral'}>
              {listing.reviewPriority} priority
            </Badge>
          </>
        }
      />

      {listing.duplicateAlerts.length > 0 ? (
        <Alert tone="danger" title={`${listing.duplicateAlerts.length} duplicate or suspicious flag${listing.duplicateAlerts.length === 1 ? '' : 's'}`}>
          <ul className="mt-1 space-y-1">
            {listing.duplicateAlerts.map((alert) => (
              <li key={alert.id}>
                <span className="font-medium">{humanize(alert.kind)}</span> · {alert.detail}
                {alert.relatedListingTitle ? ` (related listing: ${alert.relatedListingTitle})` : ''}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-5">
          <Panel title="Seller">
            <DataList
              items={[
                { label: 'Name', value: listing.seller.displayName },
                { label: 'Email', value: listing.seller.email },
                { label: 'Account status', value: <AccountStatusBadge status={listing.seller.accountStatus} /> },
                { label: 'Region', value: listing.seller.region ?? '—' },
                { label: 'Identity review', value: listing.seller.identityReviewed ? 'Reviewed' : 'Not reviewed' },
                { label: 'Member since', value: formatDateTime(listing.seller.memberSince) },
                {
                  label: "Seller's previous submissions",
                  value: (
                    <Link href={`/admin/listings?q=${encodeURIComponent(listing.seller.email)}`} className="font-medium text-brand-700 hover:underline">
                      Search this seller’s submissions
                    </Link>
                  ),
                },
              ]}
            />
          </Panel>

          <Panel title="Submitted content">
            {listing.images.length > 0 ? (
              <ul className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {listing.images.map((image) => (
                  <li key={image.id} className="overflow-hidden rounded-control border border-line">
                    <a href={image.url} target="_blank" rel="noreferrer noopener">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.url} alt="" className="aspect-[4/3] w-full object-cover" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Alert tone="warning">No photographs were supplied with this submission.</Alert>
            )}

            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700">{listing.description}</p>

            <DataList
              items={[
                { label: 'Asking price', value: formatTzs(listing.askingPriceTzs) },
                { label: 'Condition declared', value: CONDITION_LABELS[listing.condition] },
                { label: 'Category', value: listing.category.name },
                { label: 'Brand / model', value: `${listing.brand} ${listing.model}` },
                { label: 'Location', value: `${listing.city ? `${listing.city}, ` : ''}${listing.region}` },
                { label: 'Exchange proposals', value: listing.exchangeAllowed ? 'Accepted' : 'Not accepted' },
              ]}
            />

            {Object.keys(listing.specs ?? {}).length > 0 ? (
              <div className="mt-4 border-t border-line pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Declared specifications</h3>
                <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {Object.entries(listing.specs)
                    .filter(([, value]) => value !== null && value !== '')
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-xs text-ink-500">{humanize(key)}</dt>
                        <dd className="text-sm text-ink-800">{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Identifiers and duplicate history"
            description="Fingerprints are shown to administrators so a repeated claim can be recognised across accounts."
          >
            {listing.identifiers.length === 0 ? (
              <Alert tone="info">
                This device type has no applicable identifier, so duplicate detection cannot run. Review the evidence instead.
              </Alert>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Kind</Th>
                    <Th>Masked value</Th>
                    <Th>Fingerprint (truncated)</Th>
                    <Th>State</Th>
                    <Th>Conflicts</Th>
                  </tr>
                </thead>
                <tbody>
                  {listing.identifiers.map((identifier) => (
                    <tr key={identifier.id}>
                      <Td>{humanize(identifier.kind)}</Td>
                      <Td className="font-mono text-xs">{identifier.masked}</Td>
                      <Td className="font-mono text-[0.6875rem] text-ink-500">{identifier.fingerprint.slice(0, 24)}…</Td>
                      <Td className="text-xs">
                        {identifier.verifiedAt ? `Verified ${formatRelative(identifier.verifiedAt)}` : 'Active claim, unverified'}
                      </Td>
                      <Td className="tabular-nums">{identifier.conflictCount}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel title="Evidence supplied privately">
            {listing.evidence.length === 0 ? (
              <Alert tone="warning">No evidence has been attached to this submission.</Alert>
            ) : (
              <ul className="divide-y divide-line">
                {listing.evidence.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-800">{humanize(String(item.kind))}</p>
                      {item.note ? <p className="text-xs text-ink-600">{item.note}</p> : null}
                      <p className="mt-0.5 text-xs text-ink-500">
                        {item.asset.mimeType} · uploaded {formatRelative(item.uploadedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.requested ? <Badge tone="warning" size="sm">Requested by a moderator</Badge> : null}
                      <a
                        href={item.asset.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex h-8 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink-800 hover:bg-surface-muted"
                      >
                        <Icon name="eye" size={13} />
                        Inspect
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <DisclaimerNote className="mt-3">
              Opening an evidence file is recorded in the audit log against your account.
            </DisclaimerNote>
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <DecisionPanel listing={listing} />

          <Panel title="Automated checks">
            {latestAttempt ? (
              <>
                <DataList
                  items={[
                    { label: 'Outcome', value: humanize(latestAttempt.outcome) },
                    { label: 'Score', value: `${latestAttempt.score}/100` },
                    { label: 'External lookup', value: humanize(latestAttempt.externalCheckStatus) },
                    { label: 'Provider', value: latestAttempt.externalProvider ?? 'Not configured' },
                    { label: 'Ran at', value: formatDateTime(latestAttempt.createdAt) },
                  ]}
                />
                {latestAttempt.flags.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {latestAttempt.flags.map((flag) => (
                      <li key={`${flag.reason}-${flag.detail}`} className="flex gap-2 text-sm">
                        <Icon
                          name={flag.severity === 'critical' ? 'alert' : 'info'}
                          size={15}
                          className={flag.severity === 'critical' ? 'mt-0.5 shrink-0 text-danger-600' : 'mt-0.5 shrink-0 text-warning-600'}
                        />
                        <span>
                          <span className="font-medium text-ink-800">{humanize(flag.reason)}</span>
                          <span className="text-ink-600"> — {flag.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-ink-600">No flags were raised by the latest run.</p>
                )}
                {latestAttempt.externalCheckStatus === 'not_configured' ? (
                  <Alert tone="info" className="mt-3">
                    No stolen-device provider is configured, so no external lookup was made. The record says “not performed”
                    — treat the identifier evidence as unverified against any external database.
                  </Alert>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-ink-600">The automated engine has not run on this submission.</p>
            )}
          </Panel>

          <InternalNotes listingId={listing.id} notes={listing.internalNotes} />

          <Panel title="Review history">
            {listing.events.length === 0 ? (
              <p className="text-sm text-ink-600">No events recorded.</p>
            ) : (
              <ol className="space-y-3">
                {listing.events.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-ink-400" />
                    <div>
                      <p className="text-sm text-ink-800">
                        <span className="font-medium">{humanize(event.action)}</span>
                        {event.toStatus ? <span className="text-ink-500"> → {humanize(event.toStatus)}</span> : null}
                      </p>
                      {event.reasonCode ? (
                        <p className="text-xs text-ink-600">
                          {humanize(event.reasonCode)}
                          {event.reasonNote ? ` — ${event.reasonNote}` : ''}
                        </p>
                      ) : null}
                      <p className="text-xs text-ink-500">
                        {event.actor.name} · {formatDateTime(event.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

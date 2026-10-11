import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { OwnerListingDto } from '@swapmart/shared';
import { AvailabilityBadge, Badge, ListingStatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert, DataList, DisclaimerNote, ErrorState, PageHeader, Panel, Table, Td, Th } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { serverFetchSafe } from '@/lib/server-api';
import { CONDITION_LABELS, formatDateTime, formatRelative, formatTzs, humanize, LISTING_STATUS_LABELS } from '@/lib/format';
import { ListingWorkspace } from './workspace-actions';

export const metadata = { title: 'Listing workspace' };

export default async function ListingWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await serverFetchSafe<OwnerListingDto | null>(`/me/listings/${id}`, null);

  if (!listing) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    return (
      <ErrorState
        title="This listing is not available"
        message="It may have been removed, or it belongs to another member. You can only open listings that you own."
        retry={<ButtonLink href="/dashboard/listings" variant="secondary">Back to my listings</ButtonLink>}
      />
    );
  }

  const latestAttempt = listing.verificationAttempts[0];
  const flags = latestAttempt?.flags ?? [];

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-ink-500">
        <Link href="/dashboard/listings" className="hover:text-brand-700">
          My listings
        </Link>
        <Icon name="chevron" size={12} />
        <span className="truncate text-ink-700">{listing.title}</span>
      </nav>

      <PageHeader
        eyebrow="Listing workspace"
        title={listing.title}
        description={`${LISTING_STATUS_LABELS[listing.status]} · last updated ${formatRelative(listing.updatedAt)}`}
        actions={
          <>
            <ListingStatusBadge status={listing.status} />
            <AvailabilityBadge availability={listing.availability} />
            {listing.status === 'approved' ? (
              <ButtonLink href={`/listings/${listing.slug}`} variant="secondary" size="sm" icon="external-link">
                Public page
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {listing.nextAction ? (
        <Alert tone="warning" title="Next step">
          {listing.nextAction.description}
        </Alert>
      ) : null}

      <ListingWorkspace listing={listing} />

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <Panel title="Listing content">
          {listing.images.length > 0 ? (
            <ul className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {listing.images.map((image) => (
                <li key={image.id} className="overflow-hidden rounded-control border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt="" className="aspect-[4/3] w-full object-cover" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 rounded-control border border-dashed border-line-strong bg-surface-muted px-3 py-4 text-center text-sm text-ink-500">
              No photographs attached.
            </p>
          )}

          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700">{listing.description}</p>

          <DataList
            items={[
              { label: 'Asking price', value: formatTzs(listing.askingPriceTzs) },
              { label: 'Condition', value: CONDITION_LABELS[listing.condition] },
              { label: 'Category', value: listing.category.name },
              { label: 'Brand and model', value: `${listing.brand} ${listing.model}` },
              { label: 'Location', value: `${listing.city ? `${listing.city}, ` : ''}${listing.region}` },
              { label: 'Negotiable', value: listing.negotiable ? 'Yes' : 'No' },
              { label: 'Exchange proposals', value: listing.exchangeAllowed ? 'Accepted' : 'Not accepted' },
              { label: 'Published', value: listing.publishedAt ? formatDateTime(listing.publishedAt) : 'Not published' },
            ]}
          />

          {Object.keys(listing.specs ?? {}).length > 0 ? (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Specifications</h3>
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

        <div className="flex flex-col gap-5">
          <Panel title="Device identifiers" description="Encrypted at rest. Only the masked form is ever displayed.">
            {listing.identifiers.length === 0 ? (
              <p className="text-sm text-ink-600">
                No identifier is attached. Devices without an applicable identifier are reviewed on evidence alone.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-control border border-line">
                {listing.identifiers.map((identifier) => (
                  <li key={identifier.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div>
                      <p className="text-sm text-ink-700">{humanize(identifier.kind)}</p>
                      <p className="text-xs text-ink-500">
                        {identifier.verifiedAt ? `Verified ${formatDateTime(identifier.verifiedAt)}` : 'Not yet verified'}
                      </p>
                    </div>
                    <span className="font-mono text-sm text-ink-900">{identifier.masked}</span>
                  </li>
                ))}
              </ul>
            )}
            <DisclaimerNote className="mt-3">
              The full identifier value is held encrypted and is never shown to you again after submission. Contact an
              administrator through a report if you need to correct it.
            </DisclaimerNote>
          </Panel>

          <Panel title="Evidence on file">
            {listing.evidence.length === 0 ? (
              <p className="text-sm text-ink-600">No evidence attached yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {listing.evidence.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-800">{humanize(String(item.kind))}</p>
                      {item.note ? <p className="text-xs text-ink-500">{item.note}</p> : null}
                      <p className="mt-0.5 text-xs text-ink-500">Uploaded {formatRelative(item.uploadedAt)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {item.requested ? <Badge tone="warning" size="sm">Requested</Badge> : null}
                      <a
                        href={item.asset.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex h-8 items-center rounded-control border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink-800 hover:bg-surface-muted"
                      >
                        Open privately
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Automated verification runs" description="Each run records exactly what the engine checked.">
        {listing.verificationAttempts.length === 0 ? (
          <p className="text-sm text-ink-600">
            No automated check has run yet. Checks run when you submit the listing for review.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <Table>
              <thead>
                <tr>
                  <Th>Run</Th>
                  <Th>Outcome</Th>
                  <Th>Score</Th>
                  <Th>Stolen-device lookup</Th>
                  <Th>Flags</Th>
                </tr>
              </thead>
              <tbody>
                {listing.verificationAttempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <Td className="whitespace-nowrap text-xs text-ink-500">{formatDateTime(attempt.createdAt)}</Td>
                    <Td>
                      <Badge tone={attempt.outcome === 'clean' ? 'success' : attempt.outcome === 'flagged' ? 'danger' : 'warning'}>
                        {humanize(attempt.outcome)}
                      </Badge>
                    </Td>
                    <Td className="tabular-nums">{attempt.score}/100</Td>
                    <Td className="text-xs text-ink-600">{humanize(attempt.externalCheckStatus)}</Td>
                    <Td className="text-xs text-ink-600">
                      {attempt.flags.length === 0 ? 'None' : attempt.flags.map((flag) => humanize(flag.reason)).join(', ')}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {flags.length > 0 ? (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Details from the latest run</h3>
                <ul className="mt-2 space-y-2">
                  {flags.map((flag) => (
                    <li key={`${flag.reason}-${flag.detail}`} className="flex gap-2.5 text-sm">
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
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel title="Review history" description="Every state change with the reason recorded by whoever made it.">
        {listing.events.length === 0 ? (
          <p className="text-sm text-ink-600">Nothing has happened yet beyond the draft being created.</p>
        ) : (
          <ol className="space-y-3.5">
            {listing.events.map((event) => (
              <li key={event.id} className="flex gap-3">
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    event.toStatus === 'approved'
                      ? 'bg-success-600'
                      : event.toStatus === 'rejected' || event.toStatus === 'suspended'
                        ? 'bg-danger-600'
                        : 'bg-brand-500'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-sm text-ink-800">
                    <span className="font-medium">{humanize(event.action)}</span>
                    {event.fromStatus || event.toStatus ? (
                      <span className="text-ink-500">
                        {' '}
                        {event.fromStatus ? humanize(event.fromStatus) : '—'} → {event.toStatus ? humanize(event.toStatus) : '—'}
                      </span>
                    ) : null}
                  </p>
                  {event.reasonCode ? (
                    <p className="text-xs text-ink-600">
                      Reason: {humanize(event.reasonCode)}
                      {event.reasonNote ? ` — ${event.reasonNote}` : ''}
                    </p>
                  ) : null}
                  <p className="text-xs text-ink-500">
                    {event.actor.role === 'system' ? 'Automated check' : `by ${event.actor.name}`} · {formatDateTime(event.createdAt)}
                    {!event.visibleToSeller ? ' · some internal notes are withheld from sellers' : ''}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

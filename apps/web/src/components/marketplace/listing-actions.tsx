'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  REPORT_CATEGORIES,
  type ListingSummaryDto,
  type TransactionDto,
} from '@swapmart/shared';
import { apiPost, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { Field, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { formatTzs } from '@/lib/format';

type ActionKind = 'message' | 'exchange' | 'offer' | 'report' | null;

/**
 * Buyer actions on a listing page. Every control performs a real, authorised
 * API call: private messaging, an exchange proposal, a purchase transaction
 * record, or a report to the moderation queue. Nothing here is decorative.
 */
export function ListingActions({
  listing,
  signedIn,
  isOwner,
  myListings,
  alreadySaved,
  canExchange,
  canMessage,
  canReport,
  canTransact,
}: {
  listing: ListingSummaryDto;
  signedIn: boolean;
  isOwner: boolean;
  myListings: ListingSummaryDto[];
  alreadySaved: boolean;
  canExchange: boolean;
  canMessage: boolean;
  canReport: boolean;
  canTransact: boolean;
}) {
  const [action, setAction] = useState<ActionKind>(null);
  const router = useRouter();

  if (isOwner) {
    return (
      <div className="rounded-card border border-line bg-surface-muted p-4">
        <p className="text-sm font-medium text-ink-900">This is your listing</p>
        <p className="mt-1 text-sm text-ink-600">
          Manage photographs, evidence and the verification workflow from your dashboard.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/dashboard/listings/${listing.id}`}
            className="inline-flex h-9 items-center rounded-control border border-line-strong bg-surface px-3.5 text-sm font-medium text-ink-800 hover:bg-surface-muted"
          >
            Open listing workspace
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          size="lg"
          icon="message"
          block
          onClick={() => (signedIn ? setAction('message') : router.push(`/signin?next=/listings/${listing.slug}`))}
        >
          Message the seller
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            icon="arrow-swap"
            disabled={!listing.exchangeAllowed}
            title={listing.exchangeAllowed ? undefined : 'This seller does not accept exchange proposals for this listing'}
            onClick={() => (signedIn ? setAction('exchange') : router.push(`/signin?next=/listings/${listing.slug}`))}
          >
            Propose exchange
          </Button>
          <Button
            variant="secondary"
            icon="handshake"
            onClick={() => (signedIn ? setAction('offer') : router.push(`/signin?next=/listings/${listing.slug}`))}
          >
            Record an offer
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon="flag"
          onClick={() => (signedIn ? setAction('report') : router.push(`/signin?next=/listings/${listing.slug}`))}
        >
          Report this listing
        </Button>
        {!signedIn ? (
          <p className="text-center text-xs text-ink-500">
            <Link href="/signin" className="font-medium text-brand-700 underline">
              Sign in
            </Link>{' '}
            or{' '}
            <Link href="/register" className="font-medium text-brand-700 underline">
              create an account
            </Link>{' '}
            to contact the seller.
          </p>
        ) : null}
        {signedIn && !canMessage ? (
          <Alert tone="warning">
            Your account is currently restricted, so you cannot start new conversations. Contact support if you believe this
            is a mistake.
          </Alert>
        ) : null}
      </div>

      <MessageDialog
        open={action === 'message'}
        onClose={() => setAction(null)}
        listing={listing}
        disabled={!canMessage}
      />
      <ExchangeDialog
        open={action === 'exchange'}
        onClose={() => setAction(null)}
        listing={listing}
        myListings={myListings}
        disabled={!canExchange}
      />
      <OfferDialog open={action === 'offer'} onClose={() => setAction(null)} listing={listing} disabled={!canTransact} />
      <ReportDialog open={action === 'report'} onClose={() => setAction(null)} listing={listing} disabled={!canReport} />
      <div className="hidden">{alreadySaved ? '' : ''}</div>
    </>
  );
}

function MessageDialog({
  open,
  onClose,
  listing,
  disabled,
}: {
  open: boolean;
  onClose: () => void;
  listing: ListingSummaryDto;
  disabled: boolean;
}) {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function submit() {
    if (message.trim().length < 1) {
      setError('Write a message before sending.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiPost(`/listings/${listing.id}/inquiries`, { message: message.trim() });
      toast.success('Message sent. Continue the conversation in your dashboard.');
      setMessage('');
      onClose();
      router.push('/dashboard/messages');
      router.refresh();
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
      title="Message the seller"
      description="Private messages stay inside SWAPMART. Never send money before inspecting the device."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="message" onClick={submit} loading={pending} disabled={disabled}>
            Send message
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="rounded-control bg-surface-muted px-3 py-2 text-sm text-ink-700">
          About: <span className="font-medium text-ink-900">{listing.title}</span>
        </p>
        <Field label="Your message" htmlFor="inquiry-message" required>
          <Textarea
            id="inquiry-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={4000}
            placeholder="Hello, is this still available? Can we meet in Dar es Salaam to inspect it?"
          />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Dialog>
  );
}

function ExchangeDialog({
  open,
  onClose,
  listing,
  myListings,
  disabled,
}: {
  open: boolean;
  onClose: () => void;
  listing: ListingSummaryDto;
  myListings: ListingSummaryDto[];
  disabled: boolean;
}) {
  const [offeredListingId, setOfferedListingId] = useState('');
  const [message, setMessage] = useState('');
  const [difference, setDifference] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  const offered = myListings.find((item) => item.id === offeredListingId);

  async function submit() {
    if (!offeredListingId) {
      setError('Choose which of your listings you are offering.');
      return;
    }
    if (message.trim().length < 10) {
      setError('Describe your proposal in at least 10 characters.');
      return;
    }
    const raw = difference.replace(/[^\d-]/g, '');
    const differenceValue = raw === '' || raw === '-' ? 0 : Number.parseInt(raw, 10);
    const differenceTzs = offered ? Math.abs(listing.askingPriceTzs - offered.askingPriceTzs) : 0;

    setPending(true);
    setError(null);
    try {
      await apiPost('/exchanges', {
        listingId: listing.id,
        offeredListingId,
        message: message.trim(),
        priceDifferenceTzs: Number.isFinite(differenceValue) ? differenceValue : differenceTzs,
      });
      toast.success('Exchange proposal sent. You will be notified when the seller responds.');
      onClose();
      router.push('/dashboard/exchanges');
      router.refresh();
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
      title="Propose a device exchange"
      description="Offer one of your approved listings in exchange. The seller may accept, reject or send a counter-proposal."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="arrow-swap" onClick={submit} loading={pending} disabled={disabled || myListings.length === 0}>
            Send proposal
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-control bg-surface-muted p-3 text-sm">
          <p className="text-ink-500">You want</p>
          <p className="font-medium text-ink-900">{listing.title}</p>
          <p className="mt-0.5 text-ink-600">{formatTzs(listing.askingPriceTzs)}</p>
        </div>

        {myListings.length === 0 ? (
          <Alert tone="warning" title="You have no eligible listings">
            Exchange proposals require one of your own approved, available listings.{' '}
            <Link href="/dashboard/listings/new" className="font-medium underline">
              Create a listing
            </Link>{' '}
            and wait for it to be approved.
          </Alert>
        ) : (
          <>
            <Field label="You offer" htmlFor="exchange-offered" required>
              <Select id="exchange-offered" value={offeredListingId} onChange={(event) => setOfferedListingId(event.target.value)}>
                <option value="">Select one of your listings…</option>
                {myListings.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} — {formatTzs(item.askingPriceTzs)}
                  </option>
                ))}
              </Select>
            </Field>

            {offered ? (
              <p className="rounded-control border border-line bg-surface px-3 py-2 text-xs text-ink-600">
                Indicative difference:{' '}
                <span className="font-medium text-ink-900">
                  {formatTzs(Math.abs(listing.askingPriceTzs - offered.askingPriceTzs))}
                </span>{' '}
                {listing.askingPriceTzs > offered.askingPriceTzs ? 'in the seller’s favour' : 'in your favour'}. Adjust the
                figure below if you have agreed otherwise.
              </p>
            ) : null}

            <Field
              label="Price difference offered (TZS)"
              htmlFor="exchange-difference"
              hint="Positive means you top up"
              required
            >
              <input
                id="exchange-difference"
                className="sm-input"
                inputMode="numeric"
                value={difference}
                onChange={(event) => setDifference(event.target.value)}
                placeholder={offered ? String(Math.abs(listing.askingPriceTzs - offered.askingPriceTzs)) : '0'}
              />
            </Field>

            <Field label="Proposal message" htmlFor="exchange-message" required>
              <Textarea
                id="exchange-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={4000}
                placeholder="Describe the condition of your device, what is included, and how you propose to swap."
              />
            </Field>
          </>
        )}

        <Alert tone="info" title="No payments are processed here">
          Accepting an exchange creates a transaction record both parties can track. Meeting, inspection and hand-over are
          arranged directly between you.
        </Alert>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Dialog>
  );
}

function OfferDialog({
  open,
  onClose,
  listing,
  disabled,
}: {
  open: boolean;
  onClose: () => void;
  listing: ListingSummaryDto;
  disabled: boolean;
}) {
  const [amount, setAmount] = useState(String(listing.askingPriceTzs));
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<TransactionDto | null>(null);
  const toast = useToast();

  async function submit() {
    const parsed = Number.parseInt(amount.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(parsed) || parsed < 1000) {
      setError('Enter an agreed amount of at least TZS 1,000.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const transaction = await apiPost<TransactionDto>('/transactions', {
        listingId: listing.id,
        type: 'purchase',
        agreedAmountTzs: parsed,
        note: note.trim() || undefined,
      });
      setCreated(transaction);
      toast.success('Transaction record created.');
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
      title="Record an offer"
      description="SWAPMART keeps a shared record of what was agreed. It does not move money, hold funds or guarantee anything."
      footer={
        created ? (
          <Link
            href={`/dashboard/transactions/${created.id}`}
            className="inline-flex h-10 items-center rounded-control bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
          >
            Open transaction record
          </Link>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon="handshake" onClick={submit} loading={pending} disabled={disabled}>
              Create transaction record
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-3">
          <Alert tone="success" title="Transaction record created">
            Reference <span className="font-mono">{created.reference}</span>. Both parties can now track the status history.
          </Alert>
          <p className="text-sm text-ink-600">{created.paymentDisclaimer}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="rounded-control bg-surface-muted px-3 py-2 text-sm text-ink-700">
            {listing.title} — asking <span className="font-medium text-ink-900">{formatTzs(listing.askingPriceTzs)}</span>
          </p>
          <Field label="Amount you are offering (TZS)" htmlFor="offer-amount" required>
            <input
              id="offer-amount"
              className="sm-input"
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Field label="Note for the record" htmlFor="offer-note" hint="Optional">
            <Textarea
              id="offer-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1000}
              placeholder="Agreed to meet at Kariakoo on Saturday to inspect the device."
            />
          </Field>
          <Alert tone="warning" title="Inspect before you pay">
            Never transfer money before seeing the device. SWAPMART cannot recover funds and does not verify payments.
          </Alert>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      )}
    </Dialog>
  );
}

function ReportDialog({
  open,
  onClose,
  listing,
  disabled,
}: {
  open: boolean;
  onClose: () => void;
  listing: ListingSummaryDto;
  disabled: boolean;
}) {
  const [category, setCategory] = useState<string>('suspected_stolen_device');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const toast = useToast();

  async function submit() {
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
        listingId: listing.id,
      });
      setReference(result.reference);
      toast.success('Report submitted to the moderation queue.');
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
      title="Report this listing"
      description="Reports go to the administrator review queue with your account attached. False reports may lead to restrictions."
      footer={
        reference ? (
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" icon="flag" onClick={submit} loading={pending} disabled={disabled}>
              Submit report
            </Button>
          </>
        )
      }
    >
      {reference ? (
        <Alert tone="success" title={`Report ${reference} received`}>
          An administrator will review it. You will be notified when the status changes, and you can follow it from{' '}
          <Link href="/dashboard/reports" className="font-medium underline">
            your reports
          </Link>
          .
        </Alert>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="What are you reporting?" htmlFor="report-category" required>
            <Select id="report-category" value={category} onChange={(event) => setCategory(event.target.value)}>
              {REPORT_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="What did you observe?"
            htmlFor="report-description"
            hint={`${description.length}/3000`}
            required
          >
            <Textarea
              id="report-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={3000}
              placeholder="Describe the listing, the identifier you believe is duplicated, or the conversation that concerned you."
            />
          </Field>
          <Alert tone="info">
            Reports about stolen devices should include the identifier if you have it. Never post a full IMEI publicly.
          </Alert>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      )}
    </Dialog>
  );
}

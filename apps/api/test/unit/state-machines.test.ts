/**
 * Unit tests — lifecycle state machines.
 *
 * These maps are the contract the API enforces on every status change and that
 * the integration suite asserts against the database CHECK constraints, so the
 * application and the schema cannot drift apart silently.
 */
import { describe, expect, it } from 'vitest';
import {
  LISTING_PRIVATE_STATUSES,
  LISTING_PUBLIC_STATUS,
  LISTING_STATUSES,
  canTransitionAvailability,
  canTransitionDispute,
  canTransitionExchange,
  canTransitionListing,
  canTransitionReport,
  canTransitionTransaction,
} from '@swapmart/shared';

describe('listing state machine', () => {
  it('lets a draft be submitted and withdrawn by its owner', () => {
    expect(canTransitionListing('draft', 'submitted')).toBe(true);
    expect(canTransitionListing('draft', 'withdrawn')).toBe(true);
  });

  it('never reaches the public catalogue straight from a draft', () => {
    expect(canTransitionListing('draft', 'approved')).toBe(false);
    expect(canTransitionListing('draft', 'checks_pending')).toBe(false);
    expect(canTransitionListing('draft', 'under_review')).toBe(false);
  });

  it('routes a submission through the automated checks before a decision', () => {
    expect(canTransitionListing('submitted', 'checks_pending')).toBe(true);
    expect(canTransitionListing('submitted', 'approved')).toBe(false);
    expect(canTransitionListing('checks_pending', 'under_review')).toBe(true);
    expect(canTransitionListing('checks_pending', 'approved')).toBe(false);
  });

  it('sends flagged and needing-evidence submissions back for human review, never to publication', () => {
    expect(canTransitionListing('flagged', 'under_review')).toBe(true);
    expect(canTransitionListing('flagged', 'approved')).toBe(false);
    expect(canTransitionListing('evidence_required', 'submitted')).toBe(true);
    expect(canTransitionListing('evidence_required', 'approved')).toBe(false);
  });

  it('lets an administrator approve, reject or suspend a reviewed listing', () => {
    expect(canTransitionListing('under_review', 'approved')).toBe(true);
    expect(canTransitionListing('under_review', 'rejected')).toBe(true);
    expect(canTransitionListing('under_review', 'suspended')).toBe(true);
    expect(canTransitionListing('suspended', 'approved')).toBe(true);
  });

  it('allows a rejected or withdrawn listing to be corrected and resubmitted', () => {
    expect(canTransitionListing('rejected', 'submitted')).toBe(true);
    expect(canTransitionListing('withdrawn', 'submitted')).toBe(true);
  });

  it('exposes exactly one publicly visible status', () => {
    expect(LISTING_PUBLIC_STATUS).toBe('approved');
    expect(LISTING_PRIVATE_STATUSES).not.toContain('approved');
    expect([...LISTING_PRIVATE_STATUSES, LISTING_PUBLIC_STATUS].sort()).toEqual([...LISTING_STATUSES].sort());
  });
});

describe('exchange state machine', () => {
  it('lets the recipient accept, reject or counter a pending proposal', () => {
    expect(canTransitionExchange('pending', 'accepted')).toBe(true);
    expect(canTransitionExchange('pending', 'rejected')).toBe(true);
    expect(canTransitionExchange('pending', 'countered')).toBe(true);
  });

  it('lets the requester cancel a pending proposal', () => {
    expect(canTransitionExchange('pending', 'cancelled')).toBe(true);
  });

  it('treats rejected, cancelled, completed and expired proposals as terminal', () => {
    for (const status of ['rejected', 'cancelled', 'completed', 'expired'] as const) {
      expect(canTransitionExchange(status, 'accepted')).toBe(false);
      expect(canTransitionExchange(status, 'completed')).toBe(false);
    }
  });

  it('requires an accepted proposal before it can be completed', () => {
    expect(canTransitionExchange('pending', 'completed')).toBe(false);
    expect(canTransitionExchange('accepted', 'completed')).toBe(true);
  });
});

describe('transaction state machine', () => {
  it('follows initiated → negotiating → agreed → completed', () => {
    expect(canTransitionTransaction('initiated', 'negotiating')).toBe(true);
    expect(canTransitionTransaction('negotiating', 'agreed')).toBe(true);
    expect(canTransitionTransaction('agreed', 'completed')).toBe(true);
  });

  it('lets a deal be cancelled or disputed before it is completed', () => {
    expect(canTransitionTransaction('initiated', 'cancelled')).toBe(true);
    expect(canTransitionTransaction('negotiating', 'disputed')).toBe(true);
    expect(canTransitionTransaction('agreed', 'cancelled')).toBe(true);
  });

  it('only allows a dispute to be raised from a live or completed deal', () => {
    expect(canTransitionTransaction('completed', 'disputed')).toBe(true);
    expect(canTransitionTransaction('cancelled', 'disputed')).toBe(false);
    expect(canTransitionTransaction('cancelled', 'agreed')).toBe(false);
  });

  it('allows a disputed deal to be resolved back to completed or cancelled', () => {
    expect(canTransitionTransaction('disputed', 'completed')).toBe(true);
    expect(canTransitionTransaction('disputed', 'cancelled')).toBe(true);
  });
});

describe('report and dispute state machines', () => {
  it('moves a report from open through investigation to a resolution', () => {
    expect(canTransitionReport('open', 'under_review')).toBe(true);
    expect(canTransitionReport('under_review', 'escalated')).toBe(true);
    expect(canTransitionReport('escalated', 'resolved')).toBe(true);
  });

  it('never lets a closed report silently return to the open queue without review', () => {
    expect(canTransitionReport('resolved', 'open')).toBe(false);
    expect(canTransitionReport('dismissed', 'open')).toBe(false);
    // Reopening for further investigation is explicit, and therefore auditable.
    expect(canTransitionReport('resolved', 'under_review')).toBe(true);
  });

  it('moves a dispute through investigation to resolution', () => {
    expect(canTransitionDispute('open', 'investigating')).toBe(true);
    expect(canTransitionDispute('investigating', 'awaiting_parties')).toBe(true);
    expect(canTransitionDispute('awaiting_parties', 'resolved')).toBe(true);
    expect(canTransitionDispute('resolved', 'open')).toBe(false);
  });
});

describe('availability state machine', () => {
  it('reserves and sells a listing from available', () => {
    expect(canTransitionAvailability('available', 'reserved')).toBe(true);
    expect(canTransitionAvailability('reserved', 'sold')).toBe(true);
  });

  it('never returns a sold listing to available', () => {
    expect(canTransitionAvailability('sold', 'available')).toBe(false);
    expect(canTransitionAvailability('sold', 'reserved')).toBe(false);
  });
});

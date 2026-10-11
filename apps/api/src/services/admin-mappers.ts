import type { AccountStatus, AdminListingDto } from '@swapmart/shared';
import { toAdminListing } from './serializers.ts';
import type { getListingForAdmin } from './listing-service.ts';

/**
 * Maps the raw administrator detail payload (row + separately-loaded parts)
 * onto the `AdminListingDto` contract. Kept apart from the listing service so the
 * service stays free of response shaping, and apart from the route so the tests
 * can use the same mapping.
 */
export function adminListingDtoFromDetail(detail: Awaited<ReturnType<typeof getListingForAdmin>>): AdminListingDto {
  const sellerFallback = {
    id: String(detail.row.seller_id),
    displayName: String(detail.row.seller_display_name ?? 'Member'),
    memberSince: new Date(detail.row.seller_created_at as string).toISOString(),
    region: detail.row.seller_region ? String(detail.row.seller_region) : null,
    city: null,
    bio: null,
    avatarUrl: detail.row.seller_avatar_url ? String(detail.row.seller_avatar_url) : null,
    identityReviewed: detail.row.seller_identity_reviewed_at !== null,
    emailVerified: detail.row.seller_email_verified_at !== null,
    phone: null,
    accountStatus: String(detail.row.seller_account_status ?? 'active') as AccountStatus,
    email: String(detail.row.seller_email ?? ''),
  };

  return toAdminListing(detail.row, {
    ...detail.parts,
    identifiers: detail.identifiers.map((identifier) => ({
      id: identifier.id,
      kind: identifier.kind,
      masked: identifier.masked,
      last4: identifier.last4,
      isPrimary: identifier.isPrimary,
      createdAt: identifier.createdAt,
      verifiedAt: identifier.verifiedAt,
      fingerprint: identifier.fingerprint,
      conflictCount: identifier.conflictCount,
    })),
    seller: (detail.seller ?? sellerFallback) as AdminListingDto['seller'],
    duplicateAlerts: detail.duplicateAlerts,
    internalNotes: detail.internalNotes,
    reviewPriority: detail.reviewPriority,
  });
}

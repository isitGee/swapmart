import type {
  AccountStatus,
  AdminListingDto,
  ListingStatus,
  AuditLogDto,
  CategoryDto,
  ConversationSummaryDto,
  CurrentUserDto,
  DisputeDto,
  DisputeMessageDto,
  ExchangeRequestDto,
  ListingCommentDto,
  ListingDetailDto,
  ListingSummaryDto,
  MediaAssetDto,
  MessageDto,
  NotificationDto,
  OwnerListingDto,
  ReportDto,
  SessionDto,
  SellerPublicDto,
  TransactionDto,
  TransactionStatusHistoryDto,
  VerificationAttemptDto,
  VerificationEventDto,
} from '@swapmart/shared';
import { capabilitiesFor } from '../middleware/auth.ts';
import type { AuthenticatedUser } from '../types/express.d.ts';
import { toIso, toIsoRequired } from '../lib/http.ts';

/**
 * Row → DTO mappers.
 *
 * Every field that leaves the API passes through one of these functions, which
 * is what makes it possible to state with confidence that password hashes,
 * identifier ciphertext, fingerprints and internal moderation notes are never
 * serialised: the DTO types do not contain them and the mappers never copy them.
 * Rows are accepted as loose records because the SELECT lists are written to
 * match the mapper's expectations.
 */
type Row = Record<string, unknown>;

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}
function strOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function bool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true';
}

export function toMediaAsset(row: Row): MediaAssetDto {
  return {
    id: str(row.media_id ?? row.id),
    url: str(row.url ?? ''),
    width: numOrNull(row.width),
    height: numOrNull(row.height),
    mimeType: str(row.mime_type),
    purpose: str(row.purpose),
    visibility: str(row.visibility) === 'private' ? 'private' : 'public',
  };
}

export function toListingSummary(row: Row, options: { savedByMe?: boolean; isOwner?: boolean } = {}): ListingSummaryDto {
  return {
    id: str(row.id),
    slug: str(row.slug),
    title: str(row.title),
    status: str(row.status) as ListingSummaryDto['status'],
    availability: str(row.availability) as ListingSummaryDto['availability'],
    condition: str(row.condition) as ListingSummaryDto['condition'],
    askingPriceTzs: num(row.asking_price_tzs),
    negotiable: bool(row.negotiable),
    exchangeAllowed: bool(row.exchange_allowed),
    region: str(row.region),
    city: strOrNull(row.city),
    publishedAt: toIso(row.published_at as string | null),
    createdAt: toIsoRequired(row.created_at as string),
    updatedAt: toIsoRequired(row.updated_at as string),
    primaryImage: row.primary_image_id
      ? {
          id: str(row.primary_image_id),
          url: str(row.primary_image_url ?? ''),
          width: numOrNull(row.primary_image_width),
          height: numOrNull(row.primary_image_height),
          mimeType: str(row.primary_image_mime ?? 'image/jpeg'),
          purpose: 'listing_image',
          visibility: 'public',
        }
      : null,
    imageCount: num(row.image_count),
    category: {
      slug: str(row.category_slug),
      name: str(row.category_name),
      description: str(row.category_description),
      icon: str(row.category_icon),
    },
    brand: str(row.brand_name),
    model: str(row.model),
    seller: {
      id: str(row.seller_id),
      displayName: str(row.seller_display_name ?? 'SWAPMART member'),
      region: strOrNull(row.seller_region),
      identityReviewed: bool(row.seller_identity_reviewed),
      avatarUrl: strOrNull(row.seller_avatar_url),
    },
    savedByMe: options.savedByMe ?? false,
    isOwner: options.isOwner ?? false,
  };
}

export function toSellerPublic(row: Row): SellerPublicDto {
  return {
    id: str(row.id),
    displayName: str(row.display_name ?? 'SWAPMART member'),
    memberSince: toIsoRequired(row.created_at as string),
    region: strOrNull(row.region),
    city: strOrNull(row.city),
    bio: strOrNull(row.bio),
    avatarUrl: strOrNull(row.avatar_url),
    identityReviewed: bool(row.identity_reviewed_at !== null && row.identity_reviewed_at !== undefined),
    emailVerified: bool(row.email_verified_at !== null && row.email_verified_at !== undefined),
    phone: bool(row.phone_visible) ? strOrNull(row.phone) : null,
    activeListingCount: numOrNull(row.active_listing_count) ?? undefined,
    soldListingCount: numOrNull(row.sold_listing_count) ?? undefined,
    completedTransactionCount: numOrNull(row.completed_transaction_count) ?? undefined,
  };
}

export function toCurrentUser(user: AuthenticatedUser, profile: Row, unread: { notifications: number; messages: number }): CurrentUserDto {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.role,
    accountStatus: user.accountStatus,
    restrictedUntil: toIso(user.restrictedUntil),
    restrictionReason: user.statusReason,
    fullName: user.fullName,
    createdAt: toIsoRequired(profile.created_at as string),
    profile: {
      displayName: user.displayName,
      bio: strOrNull(profile.bio),
      region: strOrNull(profile.region),
      city: strOrNull(profile.city),
      phone: strOrNull(profile.phone),
      phoneVisible: bool(profile.phone_visible),
      publicProfile: bool(profile.public_profile),
      avatarUrl: user.avatarUrl,
      identityReviewedAt: toIso(user.identityReviewedAt),
    },
    capabilities: capabilitiesFor(user),
    unreadNotifications: unread.notifications,
    unreadMessages: unread.messages,
  };
}

export function toListingDetail(row: Row, parts: {
  description: string;
  specs: Record<string, string | number | boolean | null>;
  images: MediaAssetDto[];
  moderationNotes: VerificationEventDto[];
  evidenceRequests: { kind: string; note: string | null; requestedAt: string }[];
  identifierSummary: { kind: string; masked: string; last4: string; isPrimary: boolean; createdAt: string }[];
  externalCheckStatus: string;
  verificationAttemptCount: number;
  savedByMe?: boolean;
}): ListingDetailDto {
  const summary = toListingSummary(row, { savedByMe: parts.savedByMe });
  return {
    ...summary,
    description: parts.description,
    specs: parts.specs,
    images: parts.images,
    deviceId: str(row.device_id),
    moderationNotes: parts.moderationNotes,
    evidenceRequests: parts.evidenceRequests,
    identifierSummary: parts.identifierSummary.map((item) => ({
      kind: item.kind as ListingDetailDto['identifierSummary'][number]['kind'],
      masked: item.masked,
      last4: item.last4,
    })),
    externalCheckStatus: parts.externalCheckStatus as ListingDetailDto['externalCheckStatus'],
    verificationAttemptCount: parts.verificationAttemptCount,
    viewCount: num(row.view_count),
  };
}

export interface OwnerListingParts {
  description: string;
  specs: Record<string, string | number | boolean | null>;
  images: MediaAssetDto[];
  moderationNotes: VerificationEventDto[];
  evidenceRequests: { kind: string; note: string | null; requestedAt: string }[];
  externalCheckStatus: string;
  verificationAttemptCount: number;
  savedByMe?: boolean;
  identifiers: OwnerListingDto['identifiers'];
  evidence: OwnerListingDto['evidence'];
  verificationAttempts: VerificationAttemptDto[];
  events: VerificationEventDto[];
  nextAction: OwnerListingDto['nextAction'];
}

export function toOwnerListing(row: Row, parts: OwnerListingParts): OwnerListingDto {
  const detail = toListingDetail(row, {
    ...parts,
    identifierSummary: parts.identifiers.map((identifier) => ({
      kind: identifier.kind,
      masked: identifier.masked,
      last4: identifier.last4,
      isPrimary: identifier.isPrimary,
      createdAt: identifier.createdAt,
    })),
  });
  return {
    ...detail,
    identifiers: parts.identifiers,
    evidence: parts.evidence,
    verificationAttempts: parts.verificationAttempts,
    events: parts.events,
    nextAction: parts.nextAction,
  };
}

export interface AdminListingParts extends Omit<OwnerListingParts, 'identifiers'> {
  identifiers: AdminListingDto['identifiers'];
  seller: AdminListingDto['seller'];
  duplicateAlerts: AdminListingDto['duplicateAlerts'];
  internalNotes: AdminListingDto['internalNotes'];
  reviewPriority: AdminListingDto['reviewPriority'];
}

export function toAdminListing(row: Row, parts: AdminListingParts): AdminListingDto {
  const owner = toOwnerListing(row, { ...parts, identifierSummary: undefined } as unknown as OwnerListingParts);
  const { identifiers: _ownerIdentifiers, ...rest } = owner;
  return {
    ...rest,
    // Administrators additionally see the fingerprint and how many times the
    // identifier was claimed: this is never exposed on any other endpoint.
    identifiers: parts.identifiers,
    seller: parts.seller,
    duplicateAlerts: parts.duplicateAlerts,
    internalNotes: parts.internalNotes,
    reviewPriority: parts.reviewPriority,
  };
}

export function toVerificationEvent(row: Row): VerificationEventDto {
  return {
    id: str(row.id),
    action: str(row.action),
    fromStatus: (row.from_status as VerificationEventDto['fromStatus']) ?? null,
    toStatus: (row.to_status as VerificationEventDto['toStatus']) ?? null,
    reasonCode: strOrNull(row.reason_code),
    reasonNote: strOrNull(row.reason_note),
    actor: {
      id: strOrNull(row.actor_id),
      name: str(row.actor_name ?? (str(row.actor_role) === 'system' ? 'SWAPMART system' : 'Moderator')),
      role: (str(row.actor_role) || 'system') as VerificationEventDto['actor']['role'],
    },
    visibleToSeller: bool(row.visible_to_seller),
    createdAt: toIsoRequired(row.created_at as string),
  };
}

export function toConversation(row: Row, participants: ConversationSummaryDto['participants'], viewerId: string): ConversationSummaryDto {
  const counterpart = participants.find((participant) => participant.userId !== viewerId) ?? null;
  return {
    id: str(row.id),
    listingId: strOrNull(row.listing_id),
    listingTitle: strOrNull(row.listing_title),
    listingSlug: strOrNull(row.listing_slug),
    listingThumbnailUrl: strOrNull(row.listing_thumbnail_url),
    status: str(row.status) as ConversationSummaryDto['status'],
    participants,
    counterpart,
    lastMessage: row.last_message_body
      ? {
          body: str(row.last_message_body),
          createdAt: toIsoRequired(row.last_message_at as string),
          senderId: str(row.last_message_sender_id),
        }
      : null,
    unreadCount: num(row.unread_count),
    createdAt: toIsoRequired(row.created_at as string),
    updatedAt: toIsoRequired(row.updated_at as string),
  };
}

export function toMessage(row: Row, viewerId: string): MessageDto {
  return {
    id: str(row.id),
    conversationId: str(row.conversation_id),
    senderId: str(row.sender_id),
    senderName: str(row.sender_name ?? 'SWAPMART'),
    body: strOrNull(row.body) ?? '',
    state: str(row.state) as MessageDto['state'],
    createdAt: toIsoRequired(row.created_at as string),
    readByRecipient: row.read_at !== null && row.read_at !== undefined,
    isMine: str(row.sender_id) === viewerId,
  };
}

export function toComment(row: Row, viewerId: string): ListingCommentDto {
  return {
    id: str(row.id),
    listingId: str(row.listing_id),
    author: {
      id: str(row.author_id),
      displayName: str(row.author_name ?? 'SWAPMART member'),
      identityReviewed: bool(row.author_identity_reviewed),
    },
    body: str(row.body),
    state: str(row.state) as ListingCommentDto['state'],
    isMine: str(row.author_id) === viewerId,
    createdAt: toIsoRequired(row.created_at as string),
    replies: [],
    replyCount: num(row.reply_count),
  };
}

export function toExchange(row: Row, viewerId: string, availableActions: ExchangeRequestDto['availableActions'] = []): ExchangeRequestDto {
  const direction = str(row.requester_id) === viewerId ? 'outgoing' : 'incoming';
  return {
    id: str(row.id),
    status: str(row.status) as ExchangeRequestDto['status'],
    message: str(row.message),
    priceDifferenceTzs: num(row.price_difference_tzs),
    createdAt: toIsoRequired(row.created_at as string),
    updatedAt: toIsoRequired(row.updated_at as string),
    respondedAt: toIso(row.responded_at as string | null),
    expiresAt: toIso(row.expires_at as string | null),
    direction,
    requester: { id: str(row.requester_id), displayName: str(row.requester_name ?? 'Member') },
    recipient: { id: str(row.recipient_id), displayName: str(row.recipient_name ?? 'Member') },
    targetListing: {
      id: str(row.listing_id),
      title: str(row.listing_title),
      slug: str(row.listing_slug),
      askingPriceTzs: num(row.listing_price),
      primaryImageUrl: strOrNull(row.listing_image_url),
      availability: str(row.listing_availability) as ExchangeRequestDto['targetListing']['availability'],
    },
    offeredListing: row.offered_listing_id
      ? {
          id: str(row.offered_listing_id),
          title: str(row.offered_listing_title ?? 'Removed listing'),
          slug: str(row.offered_listing_slug ?? ''),
          askingPriceTzs: num(row.offered_listing_price),
          primaryImageUrl: strOrNull(row.offered_listing_image_url),
          availability: str(row.offered_listing_availability ?? 'inactive') as NonNullable<
            ExchangeRequestDto['offeredListing']
          >['availability'],
        }
      : null,
    parentRequestId: strOrNull(row.parent_request_id),
    childRequestId: strOrNull(row.child_request_id),
    transactionId: strOrNull(row.transaction_id),
    canRespond: direction === 'incoming' && str(row.status) === 'pending',
    availableActions,
  };
}

export function toTransaction(row: Row, viewerId: string, history: TransactionStatusHistoryDto[], availableStatuses: TransactionDto['availableStatuses']): TransactionDto {
  const buyerId = str(row.buyer_id);
  const sellerId = str(row.seller_id);
  const isParty = viewerId === buyerId || viewerId === sellerId;
  return {
    id: str(row.id),
    reference: str(row.reference),
    type: str(row.type) as TransactionDto['type'],
    status: str(row.status) as TransactionDto['status'],
    agreedAmountTzs: numOrNull(row.agreed_amount_tzs),
    createdAt: toIsoRequired(row.created_at as string),
    updatedAt: toIsoRequired(row.updated_at as string),
    completedAt: toIso(row.completed_at as string | null),
    cancelledAt: toIso(row.cancelled_at as string | null),
    buyer: { id: buyerId, displayName: str(row.buyer_name ?? 'Buyer') },
    seller: { id: sellerId, displayName: str(row.seller_name ?? 'Seller') },
    listing: {
      id: str(row.listing_id),
      title: str(row.listing_title),
      slug: str(row.listing_slug),
      primaryImageUrl: strOrNull(row.listing_image_url),
    },
    exchangeRequestId: strOrNull(row.exchange_request_id),
    history,
    openDisputeId: strOrNull(row.open_dispute_id),
    canUpdateStatus: isParty && !['completed', 'cancelled'].includes(str(row.status)),
    availableStatuses,
    paymentDisclaimer:
      'SWAPMART does not process, hold or verify payments in this version. This record coordinates an arrangement between the two parties and is not proof that money changed hands.',
  };
}

export function toHistoryEntry(row: Row): TransactionStatusHistoryDto {
  return {
    id: str(row.id),
    fromStatus: (row.from_status as TransactionStatusHistoryDto['fromStatus']) ?? null,
    toStatus: str(row.to_status) as TransactionStatusHistoryDto['toStatus'],
    actor: {
      id: strOrNull(row.actor_id),
      name: str(row.actor_name ?? (str(row.actor_role) === 'system' ? 'SWAPMART system' : 'Member')),
    },
    note: strOrNull(row.note),
    createdAt: toIsoRequired(row.created_at as string),
  };
}

export function toReport(row: Row, notes: ReportDto['notes']): ReportDto {
  return {
    id: str(row.id),
    reference: str(row.reference),
    category: str(row.category) as ReportDto['category'],
    description: str(row.description),
    status: str(row.status) as ReportDto['status'],
    priority: str(row.priority) as ReportDto['priority'],
    createdAt: toIsoRequired(row.created_at as string),
    updatedAt: toIsoRequired(row.updated_at as string),
    resolvedAt: toIso(row.resolved_at as string | null),
    reporter: row.reporter_id
      ? { id: str(row.reporter_id), displayName: str(row.reporter_name ?? 'Member') }
      : null,
    listing: row.listing_id
      ? {
          id: str(row.listing_id),
          title: str(row.listing_title ?? 'Listing removed'),
          slug: str(row.listing_slug ?? ''),
          status: str(row.listing_status) as ListingStatus,
        }
      : null,
    reportedUser: row.reported_user_id
      ? {
          id: str(row.reported_user_id),
          displayName: str(row.reported_user_name ?? 'Member'),
          accountStatus: str(row.reported_user_status) as AccountStatus,
        }
      : null,
    message: row.message_id
      ? { id: str(row.message_id), excerpt: str(row.message_excerpt ?? ''), createdAt: toIsoRequired(row.message_created_at as string) }
      : null,
    transaction: row.transaction_id ? { id: str(row.transaction_id), reference: str(row.transaction_reference) } : null,
    assignedTo: row.assigned_admin_id ? { id: str(row.assigned_admin_id), name: str(row.assigned_admin_name ?? 'Moderator') } : null,
    resolution: strOrNull(row.resolution),
    notes,
    availableStatuses: (row.available_statuses as ReportDto['availableStatuses']) ?? [],
  };
}

export function toDisputeMessage(row: Row): DisputeMessageDto {
  return {
    id: str(row.id),
    body: str(row.body),
    visibility: str(row.visibility) as DisputeMessageDto['visibility'],
    author: {
      id: strOrNull(row.author_id),
      name: str(row.author_name ?? (str(row.author_role) === 'system' ? 'SWAPMART system' : 'Moderator')),
      role: (str(row.author_role) === 'admin' ? 'admin' : 'user') as DisputeMessageDto['author']['role'],
    },
    attachment: row.attachment_media_id
      ? {
          id: str(row.attachment_media_id),
          url: `/api/v1/media/private/${str(row.attachment_media_id)}`,
          width: null,
          height: null,
          mimeType: str(row.attachment_mime ?? 'application/octet-stream'),
          purpose: 'dispute_attachment',
          visibility: 'private',
        }
      : null,
    createdAt: toIsoRequired(row.created_at as string),
  };
}

export function toDispute(row: Row, messages: DisputeMessageDto[], viewer: { id: string; isAdmin: boolean }): DisputeDto {
  const isParty = viewer.id === str(row.opened_by) || viewer.id === str(row.counterparty_id);
  return {
    id: str(row.id),
    reference: str(row.reference),
    category: str(row.category) as DisputeDto['category'],
    description: str(row.description),
    status: str(row.status) as DisputeDto['status'],
    createdAt: toIsoRequired(row.created_at as string),
    updatedAt: toIsoRequired(row.updated_at as string),
    resolvedAt: toIso(row.resolved_at as string | null),
    transaction: {
      id: str(row.transaction_id),
      reference: str(row.transaction_reference),
      status: str(row.transaction_status) as DisputeDto['transaction']['status'],
      listingTitle: str(row.listing_title ?? 'Listing'),
    },
    openedBy: { id: str(row.opened_by), displayName: str(row.opened_by_name ?? 'Member') },
    counterparty: { id: str(row.counterparty_id), displayName: str(row.counterparty_name ?? 'Member') },
    assignedTo: row.assigned_admin_id ? { id: str(row.assigned_admin_id), name: str(row.assigned_admin_name ?? 'Moderator') } : null,
    resolution: strOrNull(row.resolution),
    messages,
    availableStatuses: (row.available_statuses as DisputeDto['availableStatuses']) ?? [],
    canPost: (isParty || viewer.isAdmin) && !['closed', 'resolved'].includes(str(row.status)),
  };
}

export function toNotification(row: Row): NotificationDto {
  return {
    id: str(row.id),
    type: str(row.type) as NotificationDto['type'],
    title: str(row.title),
    body: str(row.body),
    linkUrl: strOrNull(row.link_url),
    readAt: toIso(row.read_at as string | null),
    createdAt: toIsoRequired(row.created_at as string),
    entityType: strOrNull(row.entity_type),
    entityId: strOrNull(row.entity_id),
  };
}

export function toSession(row: Row, currentSessionId: string): SessionDto {
  return {
    id: str(row.id),
    createdAt: toIsoRequired(row.created_at as string),
    lastSeenAt: toIsoRequired(row.last_seen_at as string),
    expiresAt: toIsoRequired(row.expires_at as string),
    userAgent: strOrNull(row.user_agent),
    ipAddress: strOrNull(row.ip_address),
    current: str(row.id) === currentSessionId,
  };
}

export function toAuditLog(row: Row): AuditLogDto {
  return {
    id: str(row.id),
    action: str(row.action),
    entityType: str(row.entity_type),
    entityId: strOrNull(row.entity_id),
    actor: {
      id: strOrNull(row.actor_id),
      name: str(row.actor_name ?? 'System'),
      role: (str(row.actor_role) || 'system') as AuditLogDto['actor']['role'],
    },
    ipAddress: strOrNull(row.ip_address),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: toIsoRequired(row.created_at as string),
  };
}

export function toCategory(row: Row): CategoryDto {
  return {
    slug: str(row.slug),
    name: str(row.name),
    description: str(row.description),
    icon: str(row.icon),
    listingCount: numOrNull(row.listing_count) ?? undefined,
  };
}

export { str, strOrNull, num, numOrNull, bool };

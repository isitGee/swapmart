import type {
  AccountStatus,
  AutomatedCheckOutcome,
  CommentState,
  DeviceCondition,
  DisputeCategory,
  DisputeStatus,
  EvidenceKind,
  ExchangeStatus,
  ExternalCheckStatus,
  FlagReason,
  IdentifierKind,
  ListingAvailability,
  ListingStatus,
  MessageState,
  NoteVisibility,
  NotificationType,
  ReportCategory,
  ReportPriority,
  ReportStatus,
  TransactionStatus,
  TransactionType,
  UserRole,
} from './enums.js';

/**
 * API response contracts shared by the Express API and the Next.js client.
 * These types are the contract boundary: anything not listed here (password
 * hashes, identifier ciphertext, evidence keys, moderation notes) must never be
 * serialised into a response.
 */

export interface MediaAssetDto {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  purpose: string;
  /** Evidence and other private assets are only returned to authorised callers. */
  visibility: 'public' | 'private';
}

export interface CategoryDto {
  slug: string;
  name: string;
  description: string;
  icon: string;
  listingCount?: number;
}

export interface BrandDto {
  id: string;
  slug: string;
  name: string;
  listingCount?: number;
}

export interface SellerPublicDto {
  id: string;
  displayName: string;
  memberSince: string;
  region: string | null;
  city: string | null;
  bio: string | null;
  avatarUrl: string | null;
  identityReviewed: boolean;
  emailVerified: boolean;
  phone: string | null;
  activeListingCount?: number;
  soldListingCount?: number;
  completedTransactionCount?: number;
}

export interface ListingSummaryDto {
  id: string;
  slug: string;
  title: string;
  status: ListingStatus;
  availability: ListingAvailability;
  condition: DeviceCondition;
  askingPriceTzs: number;
  negotiable: boolean;
  exchangeAllowed: boolean;
  region: string;
  city: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  primaryImage: MediaAssetDto | null;
  imageCount: number;
  category: CategoryDto;
  brand: string;
  model: string;
  seller: Pick<SellerPublicDto, 'id' | 'displayName' | 'region' | 'identityReviewed' | 'avatarUrl'>;
  savedByMe?: boolean;
  isOwner?: boolean;
}

export interface ListingIdentifierDto {
  id: string;
  kind: IdentifierKind;
  /** Masked representation, e.g. "•••• •••• 1234". Never the full value. */
  masked: string;
  last4: string;
  isPrimary: boolean;
  createdAt: string;
  /** Only returned to the owner and to administrators. */
  verifiedAt?: string | null;
}

export interface VerificationAttemptDto {
  id: string;
  outcome: AutomatedCheckOutcome;
  externalCheckStatus: ExternalCheckStatus;
  externalProvider: string | null;
  externalCheckedAt: string | null;
  flags: { reason: FlagReason; detail: string; severity: 'info' | 'warning' | 'critical' }[];
  score: number;
  checkSummary: Record<string, unknown>;
  createdAt: string;
}

export interface VerificationEventDto {
  id: string;
  action: string;
  fromStatus: ListingStatus | null;
  toStatus: ListingStatus | null;
  reasonCode: string | null;
  reasonNote: string | null;
  actor: { id: string | null; name: string; role: UserRole | 'system' };
  /** Seller-visible notes are shown; internal notes are redacted for sellers. */
  visibleToSeller: boolean;
  createdAt: string;
}

export interface EvidenceDto {
  id: string;
  kind: EvidenceKind | string;
  note: string | null;
  asset: MediaAssetDto;
  uploadedAt: string;
  requested: boolean;
}

export interface ListingDetailDto extends ListingSummaryDto {
  description: string;
  specs: Record<string, string | number | boolean | null>;
  images: MediaAssetDto[];
  deviceId: string;
  moderationNotes: VerificationEventDto[];
  evidenceRequests: { kind: string; note: string | null; requestedAt: string }[];
  identifierSummary: { kind: IdentifierKind; masked: string; last4: string }[];
  externalCheckStatus: ExternalCheckStatus;
  verificationAttemptCount: number;
  viewCount: number;
}

export interface OwnerListingDto extends ListingSummaryDto {
  description: string;
  specs: Record<string, string | number | boolean | null>;
  images: MediaAssetDto[];
  deviceId: string;
  identifiers: ListingIdentifierDto[];
  evidence: EvidenceDto[];
  evidenceRequests: { kind: string; note: string | null; requestedAt: string }[];
  verificationAttempts: VerificationAttemptDto[];
  events: VerificationEventDto[];
  nextAction: { label: string; description: string; href: string } | null;
}

export interface AdminListingDto extends OwnerListingDto {
  seller: SellerPublicDto & { accountStatus: AccountStatus; email: string };
  identifiers: (ListingIdentifierDto & { fingerprint: string; conflictCount: number })[];
  duplicateAlerts: DuplicateAlertDto[];
  internalNotes: { id: string; body: string; author: string; createdAt: string }[];
  reviewPriority: 'normal' | 'high' | 'urgent';
}

export interface DuplicateAlertDto {
  id: string;
  kind: 'identifier_conflict' | 'image_duplicate' | 'title_similarity' | 'rapid_resubmission';
  detail: string;
  severity: 'info' | 'warning' | 'critical';
  relatedListingId: string | null;
  relatedListingTitle: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ConversationParticipantDto {
  userId: string;
  displayName: string;
  role: 'buyer' | 'seller';
  avatarUrl: string | null;
  lastReadAt: string | null;
  identityReviewed?: boolean;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  body: string;
  state: MessageState;
  createdAt: string;
  readByRecipient: boolean;
  isMine: boolean;
}

export interface ConversationSummaryDto {
  id: string;
  listingId: string | null;
  listingTitle: string | null;
  listingSlug: string | null;
  listingThumbnailUrl: string | null;
  status: 'open' | 'archived' | 'locked';
  participants: ConversationParticipantDto[];
  counterpart: ConversationParticipantDto | null;
  lastMessage: { body: string; createdAt: string; senderId: string } | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListingCommentDto {
  id: string;
  listingId: string;
  author: { id: string; displayName: string; identityReviewed: boolean };
  body: string;
  state: CommentState;
  isMine: boolean;
  createdAt: string;
  replies: ListingCommentDto[];
  replyCount: number;
}

export interface ExchangeRequestDto {
  id: string;
  status: ExchangeStatus;
  message: string;
  priceDifferenceTzs: number;
  createdAt: string;
  updatedAt: string;
  respondedAt: string | null;
  expiresAt: string | null;
  direction: 'incoming' | 'outgoing';
  requester: { id: string; displayName: string };
  recipient: { id: string; displayName: string };
  targetListing: {
    id: string;
    title: string;
    slug: string;
    askingPriceTzs: number;
    primaryImageUrl: string | null;
    availability: ListingAvailability;
  };
  offeredListing: {
    id: string;
    title: string;
    slug: string;
    askingPriceTzs: number;
    primaryImageUrl: string | null;
    availability: ListingAvailability;
  } | null;
  parentRequestId: string | null;
  childRequestId: string | null;
  transactionId: string | null;
  canRespond: boolean;
  availableActions: ('accept' | 'reject' | 'counter' | 'cancel' | 'complete')[];
}

export interface TransactionStatusHistoryDto {
  id: string;
  fromStatus: TransactionStatus | null;
  toStatus: TransactionStatus;
  actor: { id: string | null; name: string };
  note: string | null;
  createdAt: string;
}

export interface TransactionDto {
  id: string;
  reference: string;
  type: TransactionType;
  status: TransactionStatus;
  agreedAmountTzs: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  buyer: { id: string; displayName: string };
  seller: { id: string; displayName: string };
  listing: { id: string; title: string; slug: string; primaryImageUrl: string | null };
  exchangeRequestId: string | null;
  history: TransactionStatusHistoryDto[];
  openDisputeId: string | null;
  canUpdateStatus: boolean;
  availableStatuses: TransactionStatus[];
  /** Reminder shown in the UI: SWAPMART does not process or verify payments. */
  paymentDisclaimer: string;
}

export interface ReportNoteDto {
  id: string;
  body: string;
  /** Internal moderator notes are withheld from the person who filed the report. */
  visibility: 'moderator_note' | 'reporter_visible';
  author: { id: string; name: string };
  createdAt: string;
}

export interface ReportDto {
  id: string;
  reference: string;
  category: ReportCategory;
  description: string;
  status: ReportStatus;
  priority: ReportPriority;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  reporter: { id: string; displayName: string } | null;
  isAnonymousToModerators?: boolean;
  listing: { id: string; title: string; slug: string; status: ListingStatus } | null;
  reportedUser: { id: string; displayName: string; accountStatus: AccountStatus } | null;
  message: { id: string; excerpt: string; createdAt: string } | null;
  transaction: { id: string; reference: string } | null;
  assignedTo: { id: string; name: string } | null;
  resolution: string | null;
  notes: ReportNoteDto[];
  availableStatuses: ReportStatus[];
}

export interface DisputeMessageDto {
  id: string;
  body: string;
  visibility: NoteVisibility;
  /** `null` for system messages (no human author). */
  author: { id: string | null; name: string; role: UserRole };
  attachment: MediaAssetDto | null;
  createdAt: string;
}

export interface DisputeDto {
  id: string;
  reference: string;
  category: DisputeCategory;
  description: string;
  status: DisputeStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  transaction: {
    id: string;
    reference: string;
    status: TransactionStatus;
    listingTitle: string;
  };
  openedBy: { id: string; displayName: string };
  counterparty: { id: string; displayName: string };
  assignedTo: { id: string; name: string } | null;
  resolution: string | null;
  messages: DisputeMessageDto[];
  availableStatuses: DisputeStatus[];
  canPost: boolean;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
  entityType: string | null;
  entityId: string | null;
}

export interface SavedListingDto {
  id: string;
  listing: ListingSummaryDto;
  createdAt: string;
  /** Notifies the user when a saved listing is no longer available. */
  availabilityNote: string | null;
}

export interface SessionDto {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  current: boolean;
}

export interface CurrentUserDto {
  id: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  accountStatus: AccountStatus;
  restrictedUntil: string | null;
  restrictionReason: string | null;
  fullName: string;
  createdAt: string;
  profile: {
    displayName: string;
    bio: string | null;
    region: string | null;
    city: string | null;
    phone: string | null;
    phoneVisible: boolean;
    publicProfile: boolean;
    avatarUrl: string | null;
    identityReviewedAt: string | null;
  };
  capabilities: {
    canCreateListing: boolean;
    canMessage: boolean;
    canExchange: boolean;
    canReport: boolean;
    isAdmin: boolean;
  };
  unreadNotifications: number;
  unreadMessages: number;
}

export interface AdminOverviewStatsDto {
  listings: {
    total: number;
    byStatus: Record<ListingStatus, number>;
    pendingReview: number;
    approvedLast7Days: number;
    published: number;
    flagged: number;
  };
  users: {
    total: number;
    newLast7Days: number;
    activeLast30Days: number;
    restricted: number;
    suspended: number;
    administrators: number;
  };
  verification: {
    automatedChecksLast7Days: number;
    duplicateAlertsOpen: number;
    externalCheckAvailable: boolean;
    externalCheckStatus: ExternalCheckStatus;
    externalProvider: string | null;
    evidenceAwaiting: number;
  };
  transactions: {
    total: number;
    byStatus: Record<TransactionStatus, number>;
    completedLast30Days: number;
  };
  trust: {
    reportsOpen: number;
    reportsByStatus: Record<ReportStatus, number>;
    disputesOpen: number;
    disputesByStatus: Record<DisputeStatus, number>;
    overdueModeration: number;
  };
  media: { publicAssets: number; privateAssets: number };
  generatedAt: string;
  range: '7d' | '30d' | '90d' | 'all';
}

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { id: string | null; name: string; role: UserRole | 'system' };
  ipAddress: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ModerationActionDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  fromStatus: string | null;
  toStatus: string | null;
  reasonCode: string | null;
  reasonNote: string | null;
  actor: { id: string | null; name: string };
  createdAt: string;
}

export interface AdminUserDto {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  accountStatus: AccountStatus;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  region: string | null;
  listingCount: number;
  reportCountAgainst: number;
  disputeCount: number;
  transactionCount: number;
  identityReviewedAt: string | null;
  restrictionReason: string | null;
  restrictedUntil: string | null;
}

export interface DashboardSummaryDto {
  listings: { draft: number; inReview: number; approved: number; rejected: number; suspended: number; withdrawn: number };
  actionsRequired: { listingId: string; listingTitle: string; reason: string; href: string }[];
  unreadMessages: number;
  unreadNotifications: number;
  openExchanges: number;
  activeTransactions: number;
  savedListings: number;
  openReports: number;
  openDisputes: number;
}

export interface SystemConfigDto {
  email: { transport: string; verificationRequired: boolean; configured: boolean; notices: string[] };
  media: { driver: string; configured: boolean; notices: string[] };
  stolenCheck: { provider: string; configured: boolean; notices: string[]; status: ExternalCheckStatus };
  environment: string;
  version: string;
}

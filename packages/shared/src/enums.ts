/**
 * Domain enumerations shared by the API, the web application, the database
 * layer and the test suites. PostgreSQL uses matching CHECK constraints /
 * enum-like text columns so that the database and the application agree.
 */

/** Account roles. `admin` is never assignable through a public endpoint. */
export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Account standing. Enforcement is server-side: `suspended` accounts cannot
 * authenticate, `restricted` accounts may sign in but cannot create listings,
 * start conversations, or initiate exchanges.
 */
export const ACCOUNT_STATUSES = ['active', 'restricted', 'suspended', 'deactivated'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * Listing lifecycle ("verification state machine").
 * Draft → Submitted → Automated checks pending → Flagged / Under review →
 * Approved | Rejected | Awaiting evidence | Suspended | Withdrawn.
 */
export const LISTING_STATUSES = [
  'draft',
  'submitted',
  'checks_pending',
  'flagged',
  'under_review',
  'evidence_required',
  'approved',
  'rejected',
  'suspended',
  'withdrawn',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Listing availability, independent from the moderation workflow. */
export const LISTING_AVAILABILITY = ['available', 'reserved', 'sold', 'inactive'] as const;
export type ListingAvailability = (typeof LISTING_AVAILABILITY)[number];

/** Device condition grades used across the catalogue and filters. */
export const DEVICE_CONDITIONS = [
  'new_sealed',
  'like_new',
  'excellent',
  'good',
  'fair',
  'for_parts',
] as const;
export type DeviceCondition = (typeof DEVICE_CONDITIONS)[number];

/** Identifier kinds accepted by the verification engine. */
export const IDENTIFIER_KINDS = ['imei', 'serial', 'meid', 'mac_address', 'model_number'] as const;
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

/**
 * Result of the automated preliminary check run for a submission.
 * `unavailable` means: no authoritative external provider is configured, so no
 * claim about stolen/blacklist status is made.
 */
export const AUTOMATED_CHECK_OUTCOMES = ['clean', 'flagged', 'needs_evidence', 'unavailable'] as const;
export type AutomatedCheckOutcome = (typeof AUTOMATED_CHECK_OUTCOMES)[number];

/** Result of the external provider lookup (never fabricated). */
export const EXTERNAL_CHECK_STATUSES = [
  'not_configured',
  'not_performed',
  'clear',
  'match',
  'error',
  'timeout',
] as const;
export type ExternalCheckStatus = (typeof EXTERNAL_CHECK_STATUSES)[number];

/** Reasons a submission can be flagged automatically; shown to moderators. */
export const FLAG_REASONS = [
  'identifier_duplicate',
  'identifier_invalid_format',
  'identifier_reuse_attempt',
  'suspicious_price',
  'duplicate_listing_similarity',
  'incomplete_evidence',
  'missing_required_fields',
  'duplicate_image_hash',
  'rapid_resubmission',
  'reporter_history',
  'description_quality',
] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

/** Evidence kinds attached to a device verification. */
export const EVIDENCE_KINDS = [
  'proof_of_purchase',
  'device_front',
  'device_back',
  'imei_screenshot',
  'serial_label',
  'box_label',
  'warranty_document',
  'other',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Media asset purpose + visibility, used for storage access control. */
export const MEDIA_PURPOSES = ['listing_image', 'evidence', 'dispute_attachment', 'avatar'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];
export const MEDIA_VISIBILITIES = ['public', 'private'] as const;
export type MediaVisibility = (typeof MEDIA_VISIBILITIES)[number];

export const CONVERSATION_STATUSES = ['open', 'archived', 'locked'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_STATES = ['visible', 'hidden', 'redacted'] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

export const COMMENT_STATES = ['visible', 'hidden', 'removed'] as const;
export type CommentState = (typeof COMMENT_STATES)[number];

/** Exchange proposal lifecycle (state machine, enforced server-side). */
export const EXCHANGE_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'countered',
  'cancelled',
  'completed',
  'expired',
] as const;
export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

/** Transaction lifecycle. `agreed` never means "paid". */
export const TRANSACTION_STATUSES = [
  'initiated',
  'negotiating',
  'agreed',
  'completed',
  'cancelled',
  'disputed',
] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_TYPES = ['purchase', 'exchange'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const REPORT_CATEGORIES = [
  'suspected_stolen_device',
  'fraudulent_seller',
  'fraudulent_buyer',
  'misleading_description',
  'counterfeit_device',
  'inappropriate_message',
  'spam_or_duplicate_listing',
  'harassment',
  'other',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_STATUSES = ['open', 'under_review', 'escalated', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type ReportPriority = (typeof REPORT_PRIORITIES)[number];

export const NOTE_VISIBILITIES = ['participants', 'admins_only'] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const DISPUTE_STATUSES = [
  'open',
  'investigating',
  'awaiting_parties',
  'escalated',
  'resolved',
  'closed',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const DISPUTE_CATEGORIES = [
  'item_not_as_described',
  'device_not_delivered',
  'exchange_not_completed',
  'unresponsive_party',
  'suspected_fraud',
  'payment_disagreement',
  'other',
] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

/** Moderation actions recorded in `moderation_actions`. */
export const MODERATION_ACTIONS = [
  'submitted',
  'automated_check_run',
  'flagged',
  'claimed_for_review',
  'requested_evidence',
  'approved',
  'rejected',
  'suspended',
  'reinstated',
  'withdrawn',
  'restored',
  'comment_hidden',
  'message_hidden',
  'account_restricted',
  'account_unrestricted',
  'report_status_changed',
  'dispute_status_changed',
  'identity_verified',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/** Reason codes recorded with moderation decisions (structured + free note). */
export const DECISION_REASON_CODES = [
  'verified_documents',
  'completeness_confirmed',
  'identifier_unverifiable',
  'identifier_duplicate_of_active_listing',
  'suspected_stolen_device',
  'counterfeit_or_refurbished_claim',
  'insufficient_evidence',
  'misleading_description',
  'prohibited_item',
  'policy_violation',
  'duplicate_submission',
  'seller_requested_withdrawal',
  'appeal_upheld',
  'other',
] as const;
export type DecisionReasonCode = (typeof DECISION_REASON_CODES)[number];

export const NOTIFICATION_TYPES = [
  'listing_status_changed',
  'listing_approved',
  'listing_rejected',
  'evidence_requested',
  'new_message',
  'listing_question',
  'question_answered',
  'exchange_proposed',
  'exchange_accepted',
  'exchange_rejected',
  'exchange_countered',
  'exchange_cancelled',
  'transaction_status_changed',
  'report_status_changed',
  'dispute_status_changed',
  'account_restricted',
  'account_unrestricted',
  'identity_verified',
  'security_alert',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const SORT_OPTIONS = [
  'newest',
  'oldest',
  'price_asc',
  'price_desc',
  'relevance',
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const AVAILABILITY_FILTERS = ['available', 'reserved', 'sold', 'any'] as const;
export type AvailabilityFilter = (typeof AVAILABILITY_FILTERS)[number];

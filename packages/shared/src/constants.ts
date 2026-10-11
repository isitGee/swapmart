import type {
  AccountStatus,
  AvailabilityFilter,
  DeviceCondition,
  DisputeStatus,
  ExchangeStatus,
  ExternalCheckStatus,
  ListingStatus,
  NotificationType,
  ReportCategory,
  ReportPriority,
  ReportStatus,
  TransactionStatus,
} from './enums.js';

/* -------------------------------------------------------------------------- */
/* Identifier formats                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Identifier validation rules used by the verification engine.
 * IMEI/MEID: 15 digits (14 + Luhn check digit) — validated with the Luhn
 * algorithm in `validateIdentifier`. Serial/model numbers are vendor specific,
 * so only a conservative character-set and length rule is applied.
 */
export const IDENTIFIER_RULES = {
  imei: { pattern: /^\d{15}$/, digits: 15, luhn: true, label: 'IMEI' },
  meid: { pattern: /^[0-9A-F]{14}$/, label: 'MEID' },
  serial: { pattern: /^[A-Z0-9][A-Z0-9./-]{4,31}$/, label: 'Serial number' },
  mac_address: { pattern: /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/, label: 'MAC address' },
  model_number: { pattern: /^[A-Z0-9][A-Z0-9._/-]{1,31}$/, label: 'Model number' },
} as const;

/** Identifier kinds required / relevant per category slug. */
export const CATEGORY_IDENTIFIER_KINDS: Record<string, readonly string[]> = {
  smartphones: ['imei', 'serial'],
  tablets: ['serial', 'imei'],
  laptops: ['serial', 'model_number'],
  'gaming-consoles': ['serial', 'model_number'],
  smartwatches: ['serial', 'model_number'],
  cameras: ['serial', 'model_number'],
  audio: ['serial', 'model_number'],
  accessories: ['model_number'],
  other: ['serial', 'model_number'],
};

/** Luhn checksum used for IMEI validation. */
export function luhnValid(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  let sum = 0;
  let double = false;
  for (let i = value.length - 1; i >= 0; i -= 1) {
    let digit = Number(value[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Superficial plausibility checks that catch obviously fake IMEIs such as
 * 123456789012345. These are heuristics for the automated check, never a
 * statement about ownership or stolen status.
 */
export function identifierLooksPlausible(kind: string, normalized: string): { plausible: boolean; reason?: string } {
  if (kind === 'imei') {
    if (!luhnValid(normalized)) return { plausible: false, reason: 'IMEI check digit (Luhn) failed' };
    if (/^(\d)\1{14}$/.test(normalized)) return { plausible: false, reason: 'IMEI consists of a single repeated digit' };
    if (normalized.startsWith('0000') || normalized.startsWith('123456')) {
      return { plausible: false, reason: 'IMEI uses a well-known placeholder prefix' };
    }
    const tac = normalized.slice(0, 8);
    if (!/^[0-9]{8}$/.test(tac) || tac === '00000000') return { plausible: false, reason: 'IMEI type allocation code looks invalid' };
  }
  if (kind === 'serial' && /^(0+|1+|12345|abc123|xxxx|test|none|n\/a)$/i.test(normalized)) {
    return { plausible: false, reason: 'Serial number looks like a placeholder value' };
  }
  return { plausible: true };
}

/* -------------------------------------------------------------------------- */
/* Pricing                                                                     */
/* -------------------------------------------------------------------------- */

/** Prices are whole Tanzanian shillings stored as BIGINT (never floats). */
export const PRICE_LIMITS = {
  min: 1000,
  max: 500_000_000,
  /** A price below this share of the category median is treated as suspicious. */
  suspiciousLowRatio: 0.25,
  /** A price above this multiple of the category median is treated as suspicious. */
  suspiciousHighRatio: 6,
} as const;

/* -------------------------------------------------------------------------- */
/* Uploads                                                                     */
/* -------------------------------------------------------------------------- */

export const UPLOAD_LIMITS = {
  maxImageBytes: 5 * 1024 * 1024,
  maxImagesPerListing: 8,
  maxEvidenceBytes: 10 * 1024 * 1024,
  maxEvidenceFiles: 5,
  maxAvatarBytes: 2 * 1024 * 1024,
} as const;

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export const ALLOWED_EVIDENCE_MIME_TYPES = [...ALLOWED_IMAGE_MIME_TYPES, 'application/pdf'] as const;

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

export const PAGINATION = {
  defaultPage: 1,
  defaultPerPage: 12,
  maxPerPage: 60,
  adminPerPage: 20,
  messagesPerPage: 50,
} as const;

/* -------------------------------------------------------------------------- */
/* Tanzania administrative regions (used for listing location + filters)        */
/* -------------------------------------------------------------------------- */

export const TANZANIA_REGIONS = [
  'Arusha',
  'Dar es Salaam',
  'Dodoma',
  'Geita',
  'Iringa',
  'Kagera',
  'Katavi',
  'Kigoma',
  'Kilimanjaro',
  'Lindi',
  'Manyara',
  'Mara',
  'Mbeya',
  'Morogoro',
  'Mtwara',
  'Mwanza',
  'Njombe',
  'Pemba North',
  'Pemba South',
  'Pwani',
  'Rukwa',
  'Ruvuma',
  'Shinyanga',
  'Simiyu',
  'Singida',
  'Songwe',
  'Tabora',
  'Tanga',
  'Unguja North',
  'Unguja South',
  'Unguja Urban/West',
] as const;
export type TanzaniaRegion = (typeof TANZANIA_REGIONS)[number];

/* -------------------------------------------------------------------------- */
/* Catalogue metadata                                                          */
/* -------------------------------------------------------------------------- */

export interface CategorySeed {
  slug: string;
  name: string;
  description: string;
  /** Tailwind icon key resolved by the web app to an inline SVG component. */
  icon: string;
  sortOrder: number;
}

export const CATEGORY_SEED: readonly CategorySeed[] = [
  {
    slug: 'smartphones',
    name: 'Smartphones',
    description: 'Android and iOS handsets, new and pre-owned.',
    icon: 'smartphone',
    sortOrder: 10,
  },
  {
    slug: 'laptops',
    name: 'Laptops',
    description: 'Business, student and gaming laptops, chargers included.',
    icon: 'laptop',
    sortOrder: 20,
  },
  {
    slug: 'tablets',
    name: 'Tablets',
    description: 'Tablets and detachable 2-in-1 devices.',
    icon: 'tablet',
    sortOrder: 30,
  },
  {
    slug: 'gaming-consoles',
    name: 'Gaming consoles',
    description: 'Home and handheld consoles with accessories.',
    icon: 'gamepad',
    sortOrder: 40,
  },
  {
    slug: 'smartwatches',
    name: 'Smartwatches',
    description: 'Wearables, fitness bands and accessories.',
    icon: 'watch',
    sortOrder: 50,
  },
  {
    slug: 'cameras',
    name: 'Cameras',
    description: 'DSLR, mirrorless and action cameras plus lenses.',
    icon: 'camera',
    sortOrder: 60,
  },
  {
    slug: 'audio',
    name: 'Audio equipment',
    description: 'Headphones, speakers, mixers and studio gear.',
    icon: 'speaker',
    sortOrder: 70,
  },
  {
    slug: 'accessories',
    name: 'Accessories',
    description: 'Chargers, keyboards, monitors, docks and cables.',
    icon: 'plug',
    sortOrder: 80,
  },
  {
    slug: 'other',
    name: 'Other electronics',
    description: 'Consumer electronics that do not fit the categories above.',
    icon: 'box',
    sortOrder: 90,
  },
] as const;

export const BRAND_SEED: readonly { name: string; slug: string }[] = [
  { name: 'Apple', slug: 'apple' },
  { name: 'Samsung', slug: 'samsung' },
  { name: 'Tecno', slug: 'tecno' },
  { name: 'Infinix', slug: 'infinix' },
  { name: 'itel', slug: 'itel' },
  { name: 'Huawei', slug: 'huawei' },
  { name: 'Xiaomi', slug: 'xiaomi' },
  { name: 'Redmi', slug: 'redmi' },
  { name: 'Oppo', slug: 'oppo' },
  { name: 'Vivo', slug: 'vivo' },
  { name: 'Nokia', slug: 'nokia' },
  { name: 'OnePlus', slug: 'oneplus' },
  { name: 'Google', slug: 'google' },
  { name: 'HP', slug: 'hp' },
  { name: 'Dell', slug: 'dell' },
  { name: 'Lenovo', slug: 'lenovo' },
  { name: 'Asus', slug: 'asus' },
  { name: 'Acer', slug: 'acer' },
  { name: 'Toshiba', slug: 'toshiba' },
  { name: 'Microsoft', slug: 'microsoft' },
  { name: 'Sony', slug: 'sony' },
  { name: 'LG', slug: 'lg' },
  { name: 'JBL', slug: 'jbl' },
  { name: 'Anker', slug: 'anker' },
  { name: 'Canon', slug: 'canon' },
  { name: 'Nikon', slug: 'nikon' },
  { name: 'Nintendo', slug: 'nintendo' },
  { name: 'Realme', slug: 'realme' },
  { name: 'Amazon', slug: 'amazon' },
  { name: 'Garmin', slug: 'garmin' },
];

/**
 * Technical specification fields offered per category. Values are validated in
 * the API and stored in `devices.specs` (jsonb).
 */
export interface SpecFieldDefinition {
  key: string;
  label: string;
  type: 'number' | 'text' | 'select' | 'boolean';
  unit?: string;
  options?: readonly string[];
  min?: number;
  max?: number;
  required?: boolean;
  placeholder?: string;
}

const STORAGE_OPTIONS = ['8', '16', '32', '64', '128', '256', '512', '1024', '2048'] as const;
const RAM_OPTIONS = ['1', '2', '3', '4', '6', '8', '12', '16', '24', '32', '64'] as const;
export const BATTERY_HEALTH_OPTIONS = ['95-100', '90-94', '85-89', '80-84', '70-79', 'below-70', 'unknown'] as const;
export const NETWORK_OPTIONS = ['2G', '3G', '4G', '5G', 'Wi-Fi only'] as const;

export const SPEC_FIELDS: Record<string, readonly SpecFieldDefinition[]> = {
  smartphones: [
    { key: 'storageGb', label: 'Storage', type: 'select', options: STORAGE_OPTIONS, unit: 'GB', required: true },
    { key: 'ramGb', label: 'RAM', type: 'select', options: RAM_OPTIONS, unit: 'GB', required: true },
    { key: 'batteryHealth', label: 'Battery health', type: 'select', options: BATTERY_HEALTH_OPTIONS, required: true },
    { key: 'network', label: 'Network', type: 'select', options: NETWORK_OPTIONS, required: true },
    { key: 'screenSizeIn', label: 'Screen size', type: 'number', unit: 'in', min: 2, max: 12 },
    { key: 'colour', label: 'Colour', type: 'text', placeholder: 'e.g. Midnight black' },
    { key: 'boxAndAccessories', label: 'Box and accessories included', type: 'boolean' },
  ],
  tablets: [
    { key: 'storageGb', label: 'Storage', type: 'select', options: STORAGE_OPTIONS, unit: 'GB', required: true },
    { key: 'ramGb', label: 'RAM', type: 'select', options: RAM_OPTIONS, unit: 'GB' },
    { key: 'network', label: 'Connectivity', type: 'select', options: [...NETWORK_OPTIONS, 'Wi-Fi + Cellular'], required: true },
    { key: 'screenSizeIn', label: 'Screen size', type: 'number', unit: 'in', min: 5, max: 16 },
    { key: 'stylusIncluded', label: 'Stylus included', type: 'boolean' },
  ],
  laptops: [
    { key: 'processor', label: 'Processor', type: 'text', required: true, placeholder: 'e.g. Intel Core i5-1135G7' },
    { key: 'ramGb', label: 'RAM', type: 'select', options: RAM_OPTIONS, unit: 'GB', required: true },
    { key: 'storageGb', label: 'Storage', type: 'select', options: STORAGE_OPTIONS, unit: 'GB', required: true },
    { key: 'storageType', label: 'Storage type', type: 'select', options: ['SSD', 'HDD', 'SSD + HDD', 'eMMC'] },
    { key: 'screenSizeIn', label: 'Screen size', type: 'number', unit: 'in', min: 10, max: 19 },
    { key: 'batteryHealth', label: 'Battery condition', type: 'select', options: BATTERY_HEALTH_OPTIONS },
    { key: 'chargerIncluded', label: 'Charger included', type: 'boolean', required: true },
  ],
  'gaming-consoles': [
    { key: 'storageGb', label: 'Storage', type: 'select', options: STORAGE_OPTIONS, unit: 'GB', required: true },
    { key: 'edition', label: 'Edition / model', type: 'text', required: true, placeholder: 'e.g. PS5 Slim Disc Edition' },
    { key: 'controllersIncluded', label: 'Controllers included', type: 'number', min: 0, max: 8 },
    { key: 'modded', label: 'Modified / jailbroken', type: 'boolean' },
  ],
  smartwatches: [
    { key: 'caseSizeMm', label: 'Case size', type: 'number', unit: 'mm', min: 30, max: 60 },
    { key: 'connectivity', label: 'Connectivity', type: 'select', options: ['Bluetooth', 'Bluetooth + GPS', 'Cellular + GPS'] },
    { key: 'strapMaterial', label: 'Strap', type: 'text', placeholder: 'e.g. Silicone 22 mm' },
    { key: 'batteryHealth', label: 'Battery health', type: 'select', options: BATTERY_HEALTH_OPTIONS },
  ],
  cameras: [
    { key: 'cameraType', label: 'Camera type', type: 'select', options: ['DSLR', 'Mirrorless', 'Compact', 'Action', 'Drone'] },
    { key: 'megapixels', label: 'Sensor megapixels', type: 'number', min: 1, max: 200 },
    { key: 'shutterCount', label: 'Shutter count', type: 'number', min: 0, max: 5_000_000 },
    { key: 'lensesIncluded', label: 'Lenses included', type: 'text' },
  ],
  audio: [
    { key: 'audioType', label: 'Type', type: 'select', options: ['Headphones', 'Earbuds', 'Speaker', 'Microphone', 'Mixer', 'Amplifier'] },
    { key: 'connectivity', label: 'Connectivity', type: 'select', options: ['Wired', 'Bluetooth', 'Wireless 2.4 GHz', 'Wired + Bluetooth'] },
    { key: 'power', label: 'Power rating', type: 'text', placeholder: 'e.g. 40 W' },
  ],
  accessories: [
    { key: 'accessoryType', label: 'Accessory type', type: 'text', required: true, placeholder: 'e.g. 65 W USB-C charger' },
    { key: 'compatibleWith', label: 'Compatible with', type: 'text' },
  ],
  other: [
    { key: 'deviceType', label: 'Device type', type: 'text', required: true },
    { key: 'notes', label: 'Technical notes', type: 'text' },
  ],
};

/* -------------------------------------------------------------------------- */
/* Presentation metadata shared by web + docs (keeps labels consistent)        */
/* -------------------------------------------------------------------------- */

export interface StatusPresentation {
  label: string;
  tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'muted';
  description: string;
}

export const LISTING_STATUS_PRESENTATION: Record<ListingStatus, StatusPresentation> = {
  draft: { label: 'Draft', tone: 'muted', description: 'Only visible to you. Not yet submitted for review.' },
  submitted: { label: 'Submitted', tone: 'info', description: 'Received and queued for automated checks.' },
  checks_pending: { label: 'Automated checks pending', tone: 'info', description: 'Automated checks are running.' },
  flagged: { label: 'Flagged for review', tone: 'warning', description: 'The automated checks raised items that a moderator must assess.' },
  under_review: { label: 'Under administrator review', tone: 'info', description: 'A moderator is reviewing this submission.' },
  evidence_required: { label: 'Awaiting additional evidence', tone: 'warning', description: 'A moderator requested corrections or more evidence.' },
  approved: { label: 'Approved', tone: 'success', description: 'Reviewed and approved. Approval does not certify ownership or stolen-status.' },
  rejected: { label: 'Rejected', tone: 'danger', description: 'Not published. Correct the issues and resubmit.' },
  suspended: { label: 'Suspended', tone: 'danger', description: 'Hidden from the catalogue pending moderation.' },
  withdrawn: { label: 'Withdrawn', tone: 'muted', description: 'Withdrawn by the seller. It can be resubmitted.' },
};

export const AVAILABILITY_PRESENTATION: Record<string, StatusPresentation> = {
  available: { label: 'Available', tone: 'success', description: 'Open to inquiries and exchange proposals.' },
  reserved: { label: 'Reserved', tone: 'warning', description: 'Reserved as part of an agreed arrangement.' },
  sold: { label: 'Sold', tone: 'neutral', description: 'No longer available.' },
  inactive: { label: 'Inactive', tone: 'muted', description: 'Temporarily hidden by the seller.' },
};

export const TRANSACTION_STATUS_PRESENTATION: Record<TransactionStatus, StatusPresentation> = {
  initiated: { label: 'Initiated', tone: 'info', description: 'An arrangement record was created; nothing is agreed yet.' },
  negotiating: { label: 'Negotiating', tone: 'info', description: 'The parties are discussing terms on the platform.' },
  agreed: { label: 'Agreed', tone: 'warning', description: 'Both parties recorded agreement. No payment is processed or verified by SWAPMART.' },
  completed: { label: 'Completed', tone: 'success', description: 'Both parties marked the handover as completed.' },
  cancelled: { label: 'Cancelled', tone: 'muted', description: 'Cancelled before completion.' },
  disputed: { label: 'Disputed', tone: 'danger', description: 'A problem was reported and is under review.' },
};

export const EXCHANGE_STATUS_PRESENTATION: Record<ExchangeStatus, StatusPresentation> = {
  pending: { label: 'Pending', tone: 'info', description: 'Waiting for the other party to respond.' },
  accepted: { label: 'Accepted', tone: 'success', description: 'Accepted. Coordinate the handover and mark it complete when done.' },
  rejected: { label: 'Rejected', tone: 'muted', description: 'Declined by the recipient.' },
  countered: { label: 'Countered', tone: 'warning', description: 'Replaced by a counter-proposal.' },
  cancelled: { label: 'Cancelled', tone: 'muted', description: 'Cancelled by one of the parties.' },
  completed: { label: 'Completed', tone: 'success', description: 'The exchange was completed.' },
  expired: { label: 'Expired', tone: 'muted', description: 'No response before the expiry window.' },
};

export const REPORT_STATUS_PRESENTATION: Record<ReportStatus, StatusPresentation> = {
  open: { label: 'Open', tone: 'info', description: 'Received and queued for triage.' },
  under_review: { label: 'Under review', tone: 'warning', description: 'A moderator is investigating.' },
  escalated: { label: 'Escalated', tone: 'danger', description: 'Escalated for senior moderation.' },
  resolved: { label: 'Resolved', tone: 'success', description: 'Investigated and action recorded.' },
  dismissed: { label: 'Dismissed', tone: 'muted', description: 'Reviewed and closed without action. History retained.' },
};

export const DISPUTE_STATUS_PRESENTATION: Record<DisputeStatus, StatusPresentation> = {
  open: { label: 'Open', tone: 'info', description: 'Opened by one of the parties.' },
  investigating: { label: 'Investigating', tone: 'warning', description: 'A moderator is reviewing the transaction.' },
  awaiting_parties: { label: 'Awaiting parties', tone: 'warning', description: 'Additional information was requested from the parties.' },
  escalated: { label: 'Escalated', tone: 'danger', description: 'Escalated for senior moderation.' },
  resolved: { label: 'Resolved', tone: 'success', description: 'Outcome recorded.' },
  closed: { label: 'Closed', tone: 'muted', description: 'Closed. The record is retained.' },
};

export const ACCOUNT_STATUS_PRESENTATION: Record<AccountStatus, StatusPresentation> = {
  active: { label: 'Active', tone: 'success', description: 'Full access to marketplace features.' },
  restricted: { label: 'Restricted', tone: 'warning', description: 'Can sign in and browse, but cannot create listings, message sellers, or open transactions.' },
  suspended: { label: 'Suspended', tone: 'danger', description: 'Sign-in is blocked and listings are hidden pending moderation.' },
  deactivated: { label: 'Deactivated', tone: 'muted', description: 'Closed by the account owner.' },
};

export const EXTERNAL_CHECK_PRESENTATION: Record<ExternalCheckStatus, StatusPresentation> = {
  not_configured: {
    label: 'Not performed — no provider configured',
    tone: 'neutral',
    description:
      'SWAPMART has no authorised stolen/blacklist verification provider configured, so no automatic stolen-status check was made. The submission goes to manual review.',
  },
  not_performed: { label: 'Not performed', tone: 'neutral', description: 'The check was skipped (no applicable identifier).' },
  clear: { label: 'No match returned by provider', tone: 'success', description: 'The configured provider returned no match. This is not a guarantee of ownership.' },
  match: { label: 'Provider reported a match', tone: 'danger', description: 'The provider returned a match. The device is withheld from the catalogue.' },
  error: { label: 'Provider error', tone: 'warning', description: 'The provider could not be reached or returned an error; manual review applies.' },
  timeout: { label: 'Provider timed out', tone: 'warning', description: 'The provider did not respond in time; manual review applies.' },
};

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  suspected_stolen_device: 'Suspected stolen device',
  fraudulent_seller: 'Fraudulent seller conduct',
  fraudulent_buyer: 'Fraudulent buyer conduct',
  misleading_description: 'Misleading listing description',
  counterfeit_device: 'Counterfeit or misrepresented device',
  inappropriate_message: 'Inappropriate message',
  spam_or_duplicate_listing: 'Spam or duplicate listing',
  harassment: 'Harassment or threats',
  other: 'Other policy violation',
};

export const REPORT_PRIORITY_PRESENTATION: Record<ReportPriority, StatusPresentation> = {
  low: { label: 'Low', tone: 'muted', description: '' },
  normal: { label: 'Normal', tone: 'info', description: '' },
  high: { label: 'High', tone: 'warning', description: '' },
  urgent: { label: 'Urgent', tone: 'danger', description: '' },
};

export const CONDITION_LABELS: Record<DeviceCondition, string> = {
  new_sealed: 'New (sealed)',
  like_new: 'Like new',
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  for_parts: 'For parts / faulty',
};

export const CONDITION_DESCRIPTIONS: Record<DeviceCondition, string> = {
  new_sealed: 'Unopened, factory sealed, with warranty documents where available.',
  like_new: 'Used briefly, no visible wear, all functions working.',
  excellent: 'Minimal signs of use, no dents or cracks, all functions working.',
  good: 'Light scratches or scuffs, fully functional.',
  fair: 'Clear signs of use or minor defects, fully functional unless stated.',
  for_parts: 'Faulty or incomplete; sold for parts or repair only.',
};

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  listing_status_changed: 'Listing status changed',
  listing_approved: 'Listing approved',
  listing_rejected: 'Listing rejected',
  evidence_requested: 'Additional evidence requested',
  new_message: 'New message',
  listing_question: 'New listing question',
  question_answered: 'Question answered',
  exchange_proposed: 'Exchange proposed',
  exchange_accepted: 'Exchange accepted',
  exchange_rejected: 'Exchange rejected',
  exchange_countered: 'Exchange countered',
  exchange_cancelled: 'Exchange cancelled',
  transaction_status_changed: 'Transaction updated',
  report_status_changed: 'Report updated',
  dispute_status_changed: 'Dispute updated',
  account_restricted: 'Account restricted',
  account_unrestricted: 'Account restored',
  identity_verified: 'Identity reviewed',
  security_alert: 'Security alert',
};

export const AVAILABILITY_FILTER_LABELS: Record<AvailabilityFilter, string> = {
  available: 'Available only',
  reserved: 'Available + reserved',
  sold: 'Include sold',
  any: 'All',
};

/** Human-readable platform rules surfaced in the UI and user manual. */
export const PLATFORM_LIMITS = {
  maxActiveListingsPerUser: 25,
  maxExchangeProposalsPerDay: 20,
  maxReportsPerDay: 15,
  exchangeExpiryDays: 14,
  moderationSlaHours: 72,
  maxCommentLength: 1200,
  maxMessageLength: 4000,
  maxDescriptionLength: 4000,
  minDescriptionLength: 40,
  maxTitleLength: 120,
  maxReportDescriptionLength: 3000,
  maxDisputeDescriptionLength: 3000,
} as const;

export const CURRENCY = {
  code: 'TZS',
  symbol: 'TSh',
  label: 'Tanzanian shilling',
} as const;

/**
 * Wording used wherever approval could be mistaken for a legal or ownership
 * guarantee. The platform performs format, completeness and duplicate checks
 * plus human moderation — it cannot establish title to a device.
 */
export const CERTIFICATION_NOTE =
  'I understand that approval means the submission passed SWAPMART’s automated checks and human moderation. It does not certify legal ownership, device authenticity, or that the device has not been reported stolen, and it is not a police clearance.';

export const DISCLAIMER_SHORT =
  'Moderated listing — not a legal ownership certificate.';

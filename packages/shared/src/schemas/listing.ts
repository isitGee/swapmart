import { z } from 'zod';
import {
  IDENTIFIER_RULES,
  PLATFORM_LIMITS,
  PRICE_LIMITS,
  SPEC_FIELDS,
  TANZANIA_REGIONS,
  UPLOAD_LIMITS,
} from '../constants.js';
import {
  AVAILABILITY_FILTERS,
  DEVICE_CONDITIONS,
  IDENTIFIER_KINDS,
  LISTING_AVAILABILITY,
  LISTING_STATUSES,
  SORT_OPTIONS,
} from '../enums.js';
import { csvOrArray, moneySchema, paginationQuerySchema, safeText, sortQuerySchema, uuidSchema } from './common.js';

export const identifierInputSchema = z.object({
  kind: z.enum(IDENTIFIER_KINDS),
  /**
   * Raw identifier. Normalised (uppercase, separators removed) before it is
   * hashed for duplicate detection and encrypted for storage. Validated
   * against the format rules for its kind and, for IMEIs, the Luhn checksum.
   */
  value: z
    .string()
    .trim()
    .min(4, 'Identifier is too short')
    .max(64, 'Identifier is too long')
    .refine((value) => !/[<>{}$`]/.test(value), 'Identifier contains unsupported characters'),
});
export type IdentifierInput = z.infer<typeof identifierInputSchema>;

export const specValueSchema = z.union([z.string().max(120), z.number().finite(), z.boolean(), z.null()]);

/**
 * Device specifications. Keys are restricted to the documented field list for
 * the selected category, unknown keys are dropped by the API, and values are
 * range-checked so moderators always receive comparable data.
 */
export const specsSchema = z.record(z.string().max(40), specValueSchema);

export function validateSpecsForCategory(
  categorySlug: string,
  specs: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const definitions = SPEC_FIELDS[categorySlug] ?? SPEC_FIELDS.other ?? [];
  const allowed = new Set(definitions.map((field) => field.key));
  for (const key of Object.keys(specs)) {
    if (!allowed.has(key)) return { ok: false, message: `"${key}" is not a recognised specification for this category` };
  }
  for (const field of definitions) {
    const value = specs[field.key];
    if (value === undefined || value === null || value === '') {
      if (field.required) return { ok: false, message: `${field.label} is required for this category` };
      continue;
    }
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') return { ok: false, message: `${field.label} must be yes or no` };
      continue;
    }
    if (field.type === 'number') {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) return { ok: false, message: `${field.label} must be a number` };
      if (field.min !== undefined && numeric < field.min) return { ok: false, message: `${field.label} must be at least ${field.min}` };
      if (field.max !== undefined && numeric > field.max) return { ok: false, message: `${field.label} must be at most ${field.max}` };
      continue;
    }
    if (field.type === 'select' && field.options && !field.options.includes(String(value))) {
      return { ok: false, message: `${field.label} has an unsupported value` };
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      return { ok: false, message: `${field.label} has an unsupported value` };
    }
  }
  return { ok: true };
}

export const listingBaseSchema = z.object({
  title: safeText(PLATFORM_LIMITS.maxTitleLength, 8, 'title'),
  categorySlug: z.string().min(2).max(60),
  /** Either a seeded brand id or a free-text brand name for unlisted brands. */
  brandId: uuidSchema.optional(),
  brandName: safeText(60, 1, 'brand').optional(),
  model: safeText(80, 1, 'model'),
  condition: z.enum(DEVICE_CONDITIONS),
  description: safeText(PLATFORM_LIMITS.maxDescriptionLength, PLATFORM_LIMITS.minDescriptionLength, 'description'),
  askingPriceTzs: moneySchema.int().min(PRICE_LIMITS.min, `Minimum price is ${PRICE_LIMITS.min.toLocaleString()} TZS`).max(PRICE_LIMITS.max),
  negotiable: z.boolean().default(true),
  region: z.enum(TANZANIA_REGIONS as unknown as [string, ...string[]]),
  city: safeText(80, 0, 'city').optional(),
  /** Optional: sellers may allow exchange proposals against this listing. */
  exchangeAllowed: z.boolean().default(true),
  specs: specsSchema.default({}),
  identifiers: z.array(identifierInputSchema).max(4).default([]),
  /** Ordered media asset ids previously uploaded to the seller's account. */
  imageMediaIds: z.array(uuidSchema).max(UPLOAD_LIMITS.maxImagesPerListing).default([]),
  /** Evidence media ids; stored privately and visible to moderators only. */
  evidence: z
    .array(
      z.object({
        mediaId: uuidSchema,
        kind: z.string().min(2).max(40),
        note: safeText(300, 0, 'note').optional(),
      }),
    )
    .max(UPLOAD_LIMITS.maxEvidenceFiles)
    .default([]),
});
export type ListingBaseInput = z.infer<typeof listingBaseSchema>;

export const createListingSchema = listingBaseSchema;
export const updateListingSchema = listingBaseSchema.partial().extend({
  /** Sellers edit an existing draft/rejected listing by id. */
  id: uuidSchema.optional(),
});

export const submitListingSchema = z.object({
  /** Confirms the seller read the listing-accuracy statement. */
  confirmAccuracy: z.literal(true, {
    errorMap: () => ({ message: 'Confirm that the information provided is accurate' }),
  }),
  confirmLawful: z.literal(true, {
    errorMap: () => ({ message: 'Confirm that you lawfully own or are authorised to sell this device' }),
  }),
});
export type SubmitListingInput = z.infer<typeof submitListingSchema>;

export const listingIdParamSchema = z.object({ id: uuidSchema });

export const evidenceRequestSchema = z.object({
  kind: z.string().min(2).max(40),
  note: safeText(300, 0, 'note').optional(),
});

/* -------------------------------------------------------------------------- */
/* Search / filtering                                                          */
/* -------------------------------------------------------------------------- */

export const listingSearchQuerySchema = paginationQuerySchema
  .merge(sortQuerySchema)
  .extend({
    q: safeText(120, 0, 'search term').optional(),
    category: csvOrArray(z.string().min(2).max(60)),
    brand: csvOrArray(z.string().min(1).max(60)),
    condition: csvOrArray(z.enum(DEVICE_CONDITIONS)),
    region: csvOrArray(z.enum(TANZANIA_REGIONS as unknown as [string, ...string[]])),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    availability: z.enum(AVAILABILITY_FILTERS).default('available'),
    sellerId: uuidSchema.optional(),
    exchangeAllowed: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .refine((value) => value.minPrice == null || value.maxPrice == null || value.minPrice <= value.maxPrice, {
    message: 'Minimum price cannot be greater than maximum price',
    path: ['minPrice'],
  });
export type ListingSearchQuery = z.infer<typeof listingSearchQuerySchema>;

export const sellerListingQuerySchema = paginationQuerySchema.merge(sortQuerySchema).extend({
  status: csvOrArray(z.enum(LISTING_STATUSES)),
  q: safeText(120, 0, 'search term').optional(),
});

export const savedListingQuerySchema = paginationQuerySchema;

export const availabilityUpdateSchema = z.object({
  availability: z.enum(LISTING_AVAILABILITY).refine((value) => value !== 'inactive' || true),
});

export const identifierAvailabilityQuerySchema = z.object({
  kind: z.enum(IDENTIFIER_KINDS),
  value: z.string().trim().min(4).max(64),
});

export const SORT_LABELS: Record<(typeof SORT_OPTIONS)[number], string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  relevance: 'Most relevant',
};

export const IDENTIFIER_KIND_LABELS: Record<(typeof IDENTIFIER_KINDS)[number], string> = {
  imei: 'IMEI (15 digits)',
  serial: 'Serial number',
  meid: 'MEID (14 hex characters)',
  mac_address: 'MAC address',
  model_number: 'Model number',
};

export function describeIdentifierRule(kind: keyof typeof IDENTIFIER_RULES): string {
  const rule = IDENTIFIER_RULES[kind];
  return `${rule.label} format: ${rule.pattern.source}`;
}

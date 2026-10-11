import { z } from 'zod';
import { PAGINATION, TANZANIA_REGIONS } from '../constants.js';
import {
  ACCOUNT_STATUSES,
  AVAILABILITY_FILTERS,
  DEVICE_CONDITIONS,
  IDENTIFIER_KINDS,
  LISTING_STATUSES,
  REPORT_STATUSES,
  SORT_OPTIONS,
} from '../enums.js';

/** Standard error envelope returned by every API endpoint. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level validation details, safe to display. */
    details?: { path: string; message: string }[];
    requestId?: string;
  };
}

/** Standard paginated response envelope. */
export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export const uuidSchema = z.string().uuid('A valid identifier is required');
export const idParamSchema = z.object({ id: z.string().uuid('A valid identifier is required') });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.defaultPage),
  perPage: z.coerce.number().int().min(1).max(PAGINATION.maxPerPage).default(PAGINATION.defaultPerPage),
});

export const sortQuerySchema = z.object({
  sort: z.enum(SORT_OPTIONS).default('newest'),
});

/**
 * Monetary amounts are whole Tanzanian shillings (no decimals, no floats) and
 * are transported and stored as integers.
 */
export const moneySchema = z
  .number({ invalid_type_error: 'Enter an amount in Tanzanian shillings' })
  .int('Amounts must be whole shillings')
  .nonnegative('Amount cannot be negative');

export const regionSchema = z.enum(TANZANIA_REGIONS as unknown as [string, ...string[]]);

export const listingAvailabilityParamSchema = z.enum(AVAILABILITY_FILTERS).default('available');
export const listingStatusParamSchema = z.enum(LISTING_STATUSES);
export const accountStatusParamSchema = z.enum(ACCOUNT_STATUSES);
export const reportStatusParamSchema = z.enum(REPORT_STATUSES);
export const identifierKindSchema = z.enum(IDENTIFIER_KINDS);
export const conditionParamSchema = z.enum(DEVICE_CONDITIONS);

/** Accepts either a JSON body or a comma separated list of values. */
export function csvOrArray<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return value;
  }, z.array(inner).optional());
}

/** Sanitised, length-limited free text: rejects control characters. */
export function safeText(max: number, min = 0, label = 'text') {
  return z
    .string()
    .trim()
    .min(min, min > 0 ? `Please provide at least ${min} characters` : undefined)
    .max(max, `Please keep this ${label} under ${max} characters`)
    .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), {
      message: 'Remove unsupported control characters',
    });
}

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Password is too long')
  .refine((value) => /[a-z]/.test(value), 'Include at least one lowercase letter')
  .refine((value) => /[A-Z]/.test(value), 'Include at least one uppercase letter')
  .refine((value) => /[0-9]/.test(value), 'Include at least one number')
  .refine(
    (value) => !/^(password|swapmart|qwerty|12345678)/i.test(value),
    'This password is too common or too close to the product name',
  );

export const tanzaniaPhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^(?:\+?255|0)[267]\d{7,8}$/.test(value), 'Enter a valid Tanzanian phone number, e.g. 0755 000 000');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254, 'Email address is too long');

export function buildMeta(page: number, perPage: number, total: number): Paginated<unknown>['meta'] {
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);
  return {
    page,
    perPage,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
  };
}

import { z } from 'zod';
import { PLATFORM_LIMITS, TANZANIA_REGIONS } from '../constants.js';
import { emailSchema, passwordSchema, safeText, tanzaniaPhoneSchema } from './common.js';

/**
 * Registration. Note that `role`, `status`, `emailVerified` and similar
 * privileged fields are deliberately absent: they can never be supplied by a
 * client. Account privileges are assigned exclusively by administrator
 * provisioning or migration.
 */
export const registerSchema = z.object({
  fullName: safeText(120, 3, 'name'),
  email: emailSchema,
  password: passwordSchema,
  phone: tanzaniaPhoneSchema.optional(),
  region: z.enum(TANZANIA_REGIONS as unknown as [string, ...string[]]).optional(),
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the marketplace rules and privacy notice to register' }),
  }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const emailVerificationRequestSchema = z.object({ email: emailSchema });

export const emailVerificationConfirmSchema = z.object({
  token: z.string().min(20).max(256),
});

export const passwordForgotSchema = z.object({ email: emailSchema });

export const passwordResetSchema = z.object({
  token: z.string().min(20).max(256),
  password: passwordSchema,
  /** Optional session revocation: resetting always revokes existing sessions. */
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(128),
  newPassword: passwordSchema,
});

export const profileUpdateSchema = z.object({
  displayName: safeText(80, 2, 'display name').optional(),
  bio: safeText(600, 0, 'bio').optional(),
  phone: tanzaniaPhoneSchema.optional(),
  region: z.enum(TANZANIA_REGIONS as unknown as [string, ...string[]]).optional(),
  city: safeText(80, 0, 'city').optional(),
  /** Controls whether the phone number is shown on the public seller profile. */
  phoneVisible: z.boolean().optional(),
  publicProfile: z.boolean().optional(),
  avatarMediaId: z.string().uuid().nullable().optional(),
});
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export const accountDeactivateSchema = z.object({
  password: z.string().min(1, 'Confirm with your password').max(128),
  reason: safeText(300, 0, 'reason').optional(),
});

export const sessionListQuerySchema = z.object({
  includeRevoked: z.coerce.boolean().default(false),
});

export const MAX_BIO_LENGTH = PLATFORM_LIMITS.maxDescriptionLength;

import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Everything that varies between environments is read here, validated once at
 * boot, and never read from `process.env` again. Missing production secrets
 * cause a hard startup failure — the server never silently falls back to an
 * insecure default in production.
 */

// Load .env from the monorepo root, then from the API workspace if present.
const rootDir = path.resolve(import.meta.dirname, '../../../..');
loadDotenv({ path: path.join(rootDir, '.env') });
loadDotenv({ path: path.join(rootDir, 'apps/api/.env'), override: false });

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())));

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

/** A 32-byte secret supplied as base64url/base64/hex. */
const secretSchema = z
  .string()
  .trim()
  .min(32, 'Secret must encode at least 32 bytes')
  .refine(
    (value) => {
      try {
        return Buffer.from(value, 'base64url').length >= 32 || Buffer.from(value, 'hex').length >= 32;
      } catch {
        return false;
      }
    },
    { message: 'Secret must be base64url, base64 or hex encoded with at least 32 bytes of entropy' },
  );

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),
  WEB_ORIGIN: optionalString,
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(10, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: optionalString,
  DATABASE_SSL: booleanish.default(false),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(15000),
  RUN_MIGRATIONS_ON_START: booleanish.default(false),

  IDENTIFIER_ENCRYPTION_KEY: optionalString,
  IDENTIFIER_HASH_SECRET: optionalString,
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(3).default(10),
  SENSITIVE_RATE_LIMIT_MAX: z.coerce.number().int().min(5).default(30),

  EMAIL_TRANSPORT: z.enum(['auto', 'smtp', 'log']).default('auto'),
  SMTP_URL: optionalString,
  MAIL_FROM: z.string().default('SWAPMART <no-reply@swapmart.co.tz>'),
  EMAIL_VERIFICATION_REQUIRED: booleanish.default(true),

  MEDIA_STORAGE: z.enum(['auto', 'cloudinary', 'local']).default('auto'),
  CLOUDINARY_CLOUD_NAME: optionalString,
  CLOUDINARY_API_KEY: optionalString,
  CLOUDINARY_API_SECRET: optionalString,
  CLOUDINARY_FOLDER: z.string().default('swapmart'),
  CLOUDINARY_UPLOAD_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20000),
  LOCAL_MEDIA_DIR: optionalString,
  MAX_IMAGE_BYTES: z.coerce.number().int().default(5 * 1024 * 1024),
  MAX_IMAGES_PER_LISTING: z.coerce.number().int().default(8),
  MAX_EVIDENCE_BYTES: z.coerce.number().int().default(10 * 1024 * 1024),
  MAX_EVIDENCE_FILES: z.coerce.number().int().default(5),

  STOLEN_CHECK_PROVIDER: z.enum(['none', 'http']).default('none'),
  STOLEN_CHECK_URL: optionalString,
  STOLEN_CHECK_API_KEY: optionalString,
  STOLEN_CHECK_TIMEOUT_MS: z.coerce.number().int().min(500).default(6000),

  ADMIN_EMAIL: optionalString,
  ADMIN_PASSWORD: optionalString,
  ADMIN_FULL_NAME: z.string().default('SWAPMART Administrator'),
});

export type RawEnv = z.infer<typeof rawSchema>;

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  appUrl: string;
  apiUrl: string;
  corsOrigins: string[];
  trustProxy: boolean | number | string | string[];
  logLevel: string;
  database: {
    url: string;
    testUrl: string | undefined;
    ssl: boolean;
    poolMax: number;
    statementTimeoutMs: number;
    runMigrationsOnStart: boolean;
  };
  security: {
    identifierEncryptionKey: Buffer;
    identifierHashSecret: Buffer;
    /** True when development-only fallback secrets are in use. */
    usingDevelopmentSecrets: boolean;
    sessionTtlDays: number;
    rateLimit: { windowMs: number; max: number; authMax: number; sensitiveMax: number };
  };
  email: {
    transport: 'smtp' | 'log';
    requestedTransport: 'auto' | 'smtp' | 'log';
    smtpUrl: string | undefined;
    mailFrom: string;
    verificationRequired: boolean;
  };
  media: {
    driver: 'cloudinary' | 'local';
    requestedDriver: 'auto' | 'cloudinary' | 'local';
    cloudinary: { cloudName?: string; apiKey?: string; apiSecret?: string; folder: string; timeoutMs: number };
    localStorageDir: string;
    limits: { imageBytes: number; imagesPerListing: number; evidenceBytes: number; evidenceFiles: number };
  };
  stolenCheck: {
    provider: 'none' | 'http';
    url?: string;
    apiKey?: string;
    timeoutMs: number;
  };
  adminBootstrap: { email?: string; password?: string; fullName: string };
}

/** Deterministic development-only key derivation, never used in production. */
function developmentSecret(purpose: string): Buffer {
  return createHash('sha256').update(`swapmart-development-only:${purpose}`).digest();
}

function parseSecret(value: string | undefined, purpose: string, env: string): { key: Buffer; fallback: boolean } {
  if (value) {
    const parsed = secretSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `${purpose} is invalid: ${parsed.error.issues[0]?.message ?? 'unusable value'}. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`,
      );
    }
    // Accept base64url/base64 first, then hex (some hosts only allow hex fields).
    const base64Buffer = Buffer.from(value, 'base64url');
    const key = base64Buffer.length >= 32 ? base64Buffer : Buffer.from(value, 'hex');
    return { key: createHash('sha256').update(key).digest(), fallback: false };
  }
  if (env === 'production') {
    throw new Error(
      `${purpose} must be set in production. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`,
    );
  }
  return { key: developmentSecret(purpose), fallback: true };
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = rawSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';

  const encryption = parseSecret(env.IDENTIFIER_ENCRYPTION_KEY, 'IDENTIFIER_ENCRYPTION_KEY', env.NODE_ENV);
  const hashing = parseSecret(env.IDENTIFIER_HASH_SECRET, 'IDENTIFIER_HASH_SECRET', env.NODE_ENV);

  const cloudinaryConfigured = Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
  let mediaDriver: 'cloudinary' | 'local';
  if (env.MEDIA_STORAGE === 'cloudinary') {
    if (!cloudinaryConfigured) {
      throw new Error('MEDIA_STORAGE=cloudinary requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET');
    }
    mediaDriver = 'cloudinary';
  } else if (env.MEDIA_STORAGE === 'local') {
    mediaDriver = 'local';
  } else {
    mediaDriver = cloudinaryConfigured ? 'cloudinary' : 'local';
  }

  const emailTransport: 'smtp' | 'log' =
    env.EMAIL_TRANSPORT === 'smtp' || (env.EMAIL_TRANSPORT === 'auto' && Boolean(env.SMTP_URL)) ? 'smtp' : 'log';
  if (isProduction && emailTransport === 'log' && env.EMAIL_VERIFICATION_REQUIRED) {
    // Not fatal: the platform still functions, but verification emails cannot be
    // delivered. Surfaced in the admin system-status panel and startup log.
    process.emitWarning('EMAIL_TRANSPORT resolves to "log" in production: verification and recovery emails cannot be delivered.');
  }

  const corsOrigins = [env.WEB_ORIGIN, ...env.CORS_ORIGINS.split(',')]
    .map((origin) => origin?.trim())
    .filter((origin): origin is string => Boolean(origin && origin.length > 0));

  const resolved: AppConfig = {
    env: env.NODE_ENV,
    isProduction,
    port: env.PORT,
    appUrl: env.APP_URL.replace(/\/$/, ''),
    apiUrl: env.API_URL.replace(/\/$/, ''),
    corsOrigins,
    trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY.split(',').map((entry) => entry.trim()) : isProduction ? 1 : false,
    logLevel: env.LOG_LEVEL,
    database: {
      url: env.DATABASE_URL,
      testUrl: env.TEST_DATABASE_URL,
      ssl: env.DATABASE_SSL,
      poolMax: env.DATABASE_POOL_MAX,
      statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
      runMigrationsOnStart: env.RUN_MIGRATIONS_ON_START,
    },
    security: {
      identifierEncryptionKey: encryption.key,
      identifierHashSecret: hashing.key,
      usingDevelopmentSecrets: encryption.fallback || hashing.fallback,
      sessionTtlDays: env.SESSION_TTL_DAYS,
      rateLimit: {
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        max: env.RATE_LIMIT_MAX,
        authMax: env.AUTH_RATE_LIMIT_MAX,
        sensitiveMax: env.SENSITIVE_RATE_LIMIT_MAX,
      },
    },
    email: {
      transport: emailTransport,
      requestedTransport: env.EMAIL_TRANSPORT,
      smtpUrl: env.SMTP_URL,
      mailFrom: env.MAIL_FROM,
      verificationRequired: env.EMAIL_VERIFICATION_REQUIRED,
    },
    media: {
      driver: mediaDriver,
      requestedDriver: env.MEDIA_STORAGE,
      cloudinary: {
        cloudName: env.CLOUDINARY_CLOUD_NAME,
        apiKey: env.CLOUDINARY_API_KEY,
        apiSecret: env.CLOUDINARY_API_SECRET,
        folder: env.CLOUDINARY_FOLDER,
        timeoutMs: env.CLOUDINARY_UPLOAD_TIMEOUT_MS,
      },
      localStorageDir: path.resolve(env.LOCAL_MEDIA_DIR ?? path.join(rootDir, '.var/media')),
      limits: {
        imageBytes: env.MAX_IMAGE_BYTES,
        imagesPerListing: env.MAX_IMAGES_PER_LISTING,
        evidenceBytes: env.MAX_EVIDENCE_BYTES,
        evidenceFiles: env.MAX_EVIDENCE_FILES,
      },
    },
    stolenCheck: {
      provider: env.STOLEN_CHECK_PROVIDER,
      url: env.STOLEN_CHECK_URL,
      apiKey: env.STOLEN_CHECK_API_KEY,
      timeoutMs: env.STOLEN_CHECK_TIMEOUT_MS,
    },
    adminBootstrap: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, fullName: env.ADMIN_FULL_NAME },
  };

  if (env.STOLEN_CHECK_PROVIDER === 'http' && !env.STOLEN_CHECK_URL) {
    throw new Error('STOLEN_CHECK_PROVIDER=http requires STOLEN_CHECK_URL');
  }
  cached = resolved;
  return resolved;
}

/** Test helper: forget the cached configuration (used when swapping databases). */
export function resetConfigCache(): void {
  cached = null;
}

export const APP_VERSION = '1.0.0';
export { randomBytes };

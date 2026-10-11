/**
 * Test environment.
 *
 * Runs before any application module is imported (vitest `setupFiles` run
 * before the test file, and `process.env` is read once by `config/env.ts`).
 * The test database is always a separate one from development: the suites
 * truncate and re-seed it freely.
 */
import process from 'node:process';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';

if (!process.env.TEST_DATABASE_URL) {
  process.env.TEST_DATABASE_URL = 'postgres://swapmart:swapmart@127.0.0.1:5432/swapmart_test';
}

// Every suite runs against the test database, never the development one.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

process.env.EMAIL_TRANSPORT = 'log';
process.env.MEDIA_STORAGE = process.env.MEDIA_STORAGE ?? 'local';
process.env.LOCAL_MEDIA_DIR = process.env.LOCAL_MEDIA_DIR ?? '.var/test-media';
process.env.STOLEN_CHECK_PROVIDER = 'none';
process.env.EMAIL_VERIFICATION_REQUIRED = process.env.EMAIL_VERIFICATION_REQUIRED ?? 'false';

// Rate limits must not make a suite flaky: the dedicated rate-limit test
// temporarily narrows them instead of relying on the defaults.
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.SENSITIVE_RATE_LIMIT_MAX = '100000';

process.env.IDENTIFIER_ENCRYPTION_KEY ??= 'dGVzdC1pZGVudGlmaWVyLWVuY3J5cHRpb24ta2V5LTMyLWJ5dGVz';
process.env.IDENTIFIER_HASH_SECRET ??= 'dGVzdC1pZGVudGlmaWVyLWhhc2gtc2VjcmV0LTMyLWJ5dGVz';
process.env.ADMIN_EMAIL ??= 'admin@swapmart.co.tz';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Simamia#Salama2026';
process.env.ADMIN_FULL_NAME ??= 'SWAPMART Administrator';

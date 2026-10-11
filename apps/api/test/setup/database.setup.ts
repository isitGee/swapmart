/**
 * Global setup for database-backed suites.
 *
 * Creates a clean schema by running the real migrations and then the real seed
 * script against `swapmart_test`. Using the production code paths here means a
 * broken migration or seed fails the test run — the same guarantee as a fresh
 * deployment.
 */
import process from 'node:process';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

if (!process.env.TEST_DATABASE_URL) {
  process.env.TEST_DATABASE_URL = 'postgres://swapmart:swapmart@127.0.0.1:5432/swapmart_test';
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.RATE_LIMIT_MAX = '100000';
process.env.SENSITIVE_RATE_LIMIT_MAX = '100000';
process.env.MEDIA_STORAGE ??= 'local';
process.env.LOCAL_MEDIA_DIR ??= '.var/test-media';

export async function setup(): Promise<void> {
  const { pool } = await import('../../src/db/pool.ts');

  try {
    // Confirm the test database is reachable before the suites start so the
    // failure message points at the real problem (database down) rather than at
    // an unrelated assertion.
    await pool.query('SELECT 1');
  } catch (error) {
    throw new Error(
      `The test database is not reachable at ${process.env.DATABASE_URL}. ` +
        'Start it with `npm run db:start` (embedded PostgreSQL) or point TEST_DATABASE_URL at a managed database. ' +
        `Original error: ${(error as Error).message}`,
    );
  }

  // Drop and recreate `public`, then apply the real migrations and seed the
  // real demonstration dataset. A broken migration or seed fails this hook.
  const { resetDatabase, runMigrations } = await import('../../src/db/migrate.ts');
  await resetDatabase();
  await runMigrations({ quiet: true });

  const { seedDatabase } = await import('../../src/db/seed.ts');
  await seedDatabase();

  const { closePool } = await import('../../src/db/pool.ts');
  await closePool();
}

export async function teardown(): Promise<void> {
  // Nothing to clean up: the test database is disposable.
}

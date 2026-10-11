import process from 'node:process';
import { loadConfig } from '../config/env.ts';
import { logger } from '../config/logger.ts';
import { closePool, pool } from './pool.ts';
import { migrationStatus, resetDatabase, runMigrations } from './migrate.ts';
import { ADMIN_PASSWORD, DEMO_PASSWORD, seedDatabase } from './seed.ts';
import { provisionAdmin } from '../services/auth-service.ts';

/**
 * Database and provisioning CLI.
 *
 *   npm run db:migrate     apply pending migrations
 *   npm run db:status      list applied and pending migrations
 *   npm run db:seed        replace demonstration data (refuses in production)
 *   npm run db:reset       drop and recreate the schema, then migrate (dev/test)
 *   npm run admin:create   securely provision the first administrator account
 *
 * Administrator provisioning is deliberately a separate, explicit command that
 * requires database access. There is no public endpoint or request field that
 * can grant administrator privileges.
 */
const command = process.argv[2] ?? 'status';
const flags = new Set(process.argv.slice(3));

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ command, database: config.database.url.replace(/:[^:@/]*@/, ':***@'), env: config.env }, 'database cli');

  switch (command) {
    case 'migrate': {
      const result = await runMigrations();
      process.stdout.write(
        `Applied ${result.applied.length} migration(s); ${result.skipped.length} already applied of ${result.total} total.\n` +
          (result.applied.length ? `  + ${result.applied.join('\n  + ')}\n` : ''),
      );
      break;
    }
    case 'status': {
      const status = await migrationStatus();
      process.stdout.write(`Migrations: ${status.applied.length} applied, ${status.pending.length} pending, ${status.total} total.\n`);
      for (const row of status.applied) {
        process.stdout.write(`  ✓ ${row.filename} (${row.applied_at.toISOString()})\n`);
      }
      for (const pending of status.pending) {
        process.stdout.write(`  • ${pending} (pending)\n`);
      }
      break;
    }
    case 'seed': {
      const summary = await seedDatabase();
      process.stdout.write(
        [
          'Demonstration data created (all fictional):',
          `  users:            ${summary.users}`,
          `  listings:         ${summary.listings} (${summary.approvedListings} approved and public)`,
          `  conversations:    ${summary.conversations} with ${summary.messages} messages`,
          `  exchanges:        ${summary.exchanges}`,
          `  transactions:     ${summary.transactions}`,
          `  reports:          ${summary.reports}`,
          `  disputes:         ${summary.disputes}`,
          '',
          'Sign in with:',
          `  administrator:    admin@swapmart.co.tz / ${ADMIN_PASSWORD}`,
          `  demo member:      baraka.juma@example.co.tz / ${DEMO_PASSWORD}`,
          'Change these credentials before demonstrating to anyone outside your team.',
          '',
        ].join('\n'),
      );
      break;
    }
    case 'reset': {
      if (!flags.has('--force')) {
        throw new Error('Refusing to reset without --force (this destroys all data).');
      }
      await resetDatabase();
      const result = await runMigrations();
      process.stdout.write(`Schema recreated and ${result.applied.length} migration(s) applied.\n`);
      break;
    }
    case 'admin:create': {
      const email = config.adminBootstrap.email;
      const password = config.adminBootstrap.password;
      if (!email || !password) {
        throw new Error(
          'Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment (see .env.example) before running admin:create. ' +
            'Choose a unique, strong password of at least 10 characters.',
        );
      }
      if (password.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters long');
      const result = await provisionAdmin(email, password, config.adminBootstrap.fullName);
      process.stdout.write(
        result.created
          ? `Administrator ${email} created.\n`
          : `Existing account ${email} was promoted to administrator and its password reset.\n`,
      );
      break;
    }
    default:
      throw new Error(`Unknown command "${command}". Use migrate | status | seed | reset | admin:create.`);
  }
}

try {
  await main();
} catch (error) {
  logger.error({ err: error }, 'database cli failed');
  process.stderr.write(`\n${(error as Error).message}\n\n`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
  await closePool().catch(() => undefined);
}

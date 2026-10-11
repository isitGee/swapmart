import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config/env.ts';
import { logger } from '../config/logger.ts';
import { closePool, pool, withTransaction } from './pool.ts';

/**
 * Minimal, reproducible migration runner.
 *
 * * Migrations are plain SQL files in `src/db/migrations`, applied in filename
 *   order inside a transaction each (so a failing migration leaves the database
 *   untouched).
 * * Applied migrations are recorded with a SHA-256 checksum; editing an already
 *   applied migration is reported as an error instead of being silently ignored.
 * * No external migration tool is required, which keeps the deployment surface
 *   small; production deploys run the same command as development.
 */

const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations');

export interface MigrationFile {
  filename: string;
  sql: string;
  checksum: string;
}

export interface MigrationStatusRow {
  filename: string;
  checksum: string;
  applied_at: Date;
  execution_ms: number | null;
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename     text PRIMARY KEY,
      checksum     text NOT NULL,
      applied_at   timestamptz NOT NULL DEFAULT now(),
      execution_ms integer
    )`);
}

export async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  const filenames = entries.filter((name) => name.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
  const files: MigrationFile[] = [];
  for (const filename of filenames) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
    files.push({ filename, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  return files;
}

export async function appliedMigrations(): Promise<MigrationStatusRow[]> {
  await ensureMigrationsTable();
  const result = await pool.query<MigrationStatusRow>(
    'SELECT filename, checksum, applied_at, execution_ms FROM schema_migrations ORDER BY filename ASC',
  );
  return result.rows;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
  total: number;
}

export async function runMigrations(options: { quiet?: boolean } = {}): Promise<MigrateResult> {
  await ensureMigrationsTable();
  const files = await loadMigrationFiles();
  const applied = new Map((await appliedMigrations()).map((row) => [row.filename, row]));
  const appliedNow: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const existing = applied.get(file.filename);
    if (existing) {
      if (existing.checksum !== file.checksum) {
        throw new Error(
          `Migration ${file.filename} was modified after it was applied (checksum mismatch). ` +
            'Create a new migration instead of editing an applied one.',
        );
      }
      skipped.push(file.filename);
      continue;
    }
    const startedAt = performance.now();
    // Each migration runs in its own transaction: a failure rolls back cleanly.
    await pool.query('BEGIN');
    try {
      await pool.query(file.sql);
      const durationMs = Math.round(performance.now() - startedAt);
      await pool.query('INSERT INTO schema_migrations (filename, checksum, execution_ms) VALUES ($1, $2, $3)', [
        file.filename,
        file.checksum,
        durationMs,
      ]);
      await pool.query('COMMIT');
      appliedNow.push(file.filename);
      if (!options.quiet) logger.info({ migration: file.filename, durationMs }, 'migration applied');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw new Error(`Migration ${file.filename} failed: ${(error as Error).message}`);
    }
  }

  return { applied: appliedNow, skipped, total: files.length };
}

/**
 * Drops and recreates the `public` schema. Refused in production and used by
 * the test harness and `npm run db:reset` so that migrations can be verified on
 * a genuinely clean database.
 */
export async function resetDatabase(): Promise<void> {
  const config = loadConfig();
  if (config.isProduction) throw new Error('Refusing to reset a production database');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
  await pool.query('GRANT ALL ON SCHEMA public TO public');
}

export async function migrationStatus(): Promise<{ pending: string[]; applied: MigrationStatusRow[]; total: number }> {
  const files = await loadMigrationFiles();
  const applied = await appliedMigrations();
  const appliedNames = new Set(applied.map((row) => row.filename));
  return {
    pending: files.filter((file) => !appliedNames.has(file.filename)).map((file) => file.filename),
    applied,
    total: files.length,
  };
}

/** Used by the API bootstrap when RUN_MIGRATIONS_ON_START=true. */
export async function migrateOnStart(): Promise<void> {
  const result = await runMigrations({ quiet: true });
  if (result.applied.length > 0) logger.info({ migrations: result.applied }, 'database migrations applied at startup');
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  try {
    const result = await runMigrations();
    logger.info({ ...result }, 'migration run complete');
  } catch (error) {
    logger.error({ err: error }, 'migration run failed');
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

export { withTransaction };

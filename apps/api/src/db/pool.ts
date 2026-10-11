import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { loadConfig } from '../config/env.ts';
import { logger } from '../config/logger.ts';

/**
 * PostgreSQL access layer.
 *
 * Every query in the application goes through `query()` or `withTransaction()`
 * so that (a) parameters are always bound (never string-interpolated, which
 * removes the SQL-injection surface) and (b) multi-step writes either all
 * succeed or all roll back.
 */
const { Pool, types } = pg;

// BIGINT (int8, oid 20) is used for monetary amounts in whole shillings.
// Parse as Number: values are bounded well below Number.MAX_SAFE_INTEGER by the
// validation layer, and returning strings would break DTO typing.
types.setTypeParser(20, (value: string) => Number.parseInt(value, 10));
// NUMERIC (1700) -> Number as well; used only for aggregate ratios/scores.
types.setTypeParser(1700, (value: string) => Number.parseFloat(value));
// DATE (1082) -> keep as 'YYYY-MM-DD' string to avoid timezone shifts.
types.setTypeParser(1082, (value: string) => value);

const config = loadConfig();

export const pool = new Pool({
  connectionString: config.database.url,
  max: config.database.poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: config.database.statementTimeoutMs || undefined,
  application_name: 'swapmart-api',
  ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (error) => {
  logger.error({ err: error }, 'idle PostgreSQL client error');
});

export type QueryParams = readonly unknown[];
export interface Queryable {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: QueryParams): Promise<pg.QueryResult<T>>;
}

export function toPgPlaceholders(params: QueryParams): string {
  return params.map((_, index) => `$${index + 1}`).join(', ');
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: QueryParams = [],
): Promise<pg.QueryResult<T>> {
  const startedAt = performance.now();
  const result = await pool.query<T>(sql, params as unknown[]);
  const durationMs = performance.now() - startedAt;
  if (durationMs > 250) {
    logger.warn({ durationMs: Math.round(durationMs), rowCount: result.rowCount, sql: sql.slice(0, 120) }, 'slow query');
  }
  return result;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: QueryParams = [],
): Promise<T | null> {
  const result = await query<T>(sql, params);
  return result.rows[0] ?? null;
}

export async function queryMany<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: QueryParams = [],
): Promise<T[]> {
  const result = await query<T>(sql, params);
  return result.rows;
}

export interface Tx {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: QueryParams): Promise<pg.QueryResult<T>>;
  queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: QueryParams): Promise<T | null>;
  queryMany<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: QueryParams): Promise<T[]>;
}

/**
 * Runs `fn` inside a transaction. Nested calls reuse the *same* transaction
 * through AsyncLocalStorage, so a service can call another service without
 * opening a second connection or deadlocking against itself, while concurrent
 * requests always get their own connection.
 */
const txStorage = new AsyncLocalStorage<{ client: pg.PoolClient }>();

export async function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options: { isolation?: 'read committed' | 'repeatable read' | 'serializable' } = {},
): Promise<T> {
  const existing = txStorage.getStore();
  if (existing) return fn(makeTx(existing.client));

  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${options.isolation ?? 'read committed'}`);
    const result = await txStorage.run({ client }, () => fn(makeTx(client)));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error({ err: rollbackError }, 'transaction rollback failed');
    }
    throw error;
  } finally {
    client.release();
  }
}

/** True when the caller is already inside a transaction. */
export function inTransaction(): boolean {
  return txStorage.getStore() !== undefined;
}

function makeTx(client: pg.PoolClient): Tx {
  return {
    async query(sql, params = []) {
      return client.query(sql, params as unknown[]);
    },
    async queryOne(sql, params = []) {
      const result = await client.query(sql, params as unknown[]);
      return result.rows[0] ?? null;
    },
    async queryMany(sql, params = []) {
      const result = await client.query(sql, params as unknown[]);
      return result.rows;
    },
  };
}

/** Runs `fn` on a dedicated connection with a session-scoped advisory lock. */
export async function withAdvisoryLock<T>(lockKey: number | string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [typeof lockKey === 'string' ? hashLockKey(lockKey) : lockKey]);
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [typeof lockKey === 'string' ? hashLockKey(lockKey) : lockKey]);
    client.release();
  }
}

function hashLockKey(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pgError = error as { code?: string; constraint?: string } | null;
  if (pgError?.code !== '23505') return false;
  return constraint ? pgError.constraint === constraint : true;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23503';
}

export function isCheckViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23514';
}

export async function healthCheck(): Promise<{ ok: boolean; latencyMs: number; version?: string }> {
  const startedAt = performance.now();
  try {
    const result = await query<{ version: string }>('SELECT version() AS version');
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - startedAt),
      version: result.rows[0]?.version.split(' ').slice(0, 2).join(' '),
    };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - startedAt) };
  }
}

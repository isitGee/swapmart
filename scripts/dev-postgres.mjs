#!/usr/bin/env node
/**
 * Local / sandbox development PostgreSQL helper.
 *
 * Production deployments use a managed PostgreSQL service (Railway, Neon, RDS,
 * Supabase...) and never this script. It exists so that a developer (or a CI
 * sandbox without a system PostgreSQL) can start a *real* PostgreSQL 17 server
 * from npm-distributed binaries and run the same migrations, seeds and tests
 * that production runs.
 *
 * Usage:
 *   node scripts/dev-postgres.mjs start|stop|status|reset
 *
 * Environment overrides:
 *   PGDATA  (default: .var/pgdata)      PGPORT (default: 5432)
 *   PGDATABASE_ROLE / PGDATABASE_PASSWORD / PGDATABASE / PGDATABASE_TEST
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(import.meta.dirname, '..');
const dataDir = path.resolve(rootDir, process.env.PGDATA ?? '.var/pgdata');
const port = Number(process.env.PGPORT ?? 5432);
const roleName = process.env.PGDATABASE_ROLE ?? 'swapmart';
const password = process.env.PGDATABASE_PASSWORD ?? 'swapmart';
const databases = [process.env.PGDATABASE ?? 'swapmart', process.env.PGDATABASE_TEST ?? 'swapmart_test'];
const logFile = path.join(dataDir, 'postgres.log');
const pidFile = path.join(dataDir, 'postmaster.pid');

const platformPackages = {
  'linux-x64': '@embedded-postgres/linux-x64',
  'linux-arm64': '@embedded-postgres/linux-arm64',
  'darwin-x64': '@embedded-postgres/darwin-x64',
  'darwin-arm64': '@embedded-postgres/darwin-arm64',
  'win32-x64': '@embedded-postgres/windows-x64',
};

function resolveBinDir() {
  const key = `${process.platform}-${process.arch}`;
  const pkg = platformPackages[key];
  if (!pkg) {
    fail(`No embedded PostgreSQL build is published for ${key}. Install PostgreSQL manually and set DATABASE_URL.`);
  }
  const direct = path.join(rootDir, 'node_modules', ...pkg.split('/'));
  if (existsSync(path.join(direct, 'native', 'bin'))) {
    return path.join(direct, 'native', 'bin');
  }
  try {
    const entry = require.resolve(pkg, { paths: [rootDir] });
    const marker = path.join('node_modules', ...pkg.split('/'));
    const index = entry.lastIndexOf(marker);
    if (index >= 0) {
      const candidate = path.join(entry.slice(0, index + marker.length), 'native', 'bin');
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* handled below */
  }
  fail(
    `Package ${pkg} is not installed.\n` +
      `Run: npm install  (it is listed in the root devDependencies), or install PostgreSQL manually and set DATABASE_URL.`,
  );
}

function fail(message) {
  console.error(`\n[dev-postgres] ${message}\n`);
  process.exit(1);
}

function envForBin(binDir) {
  const libDir = path.join(path.dirname(binDir), 'lib');
  return {
    ...process.env,
    LD_LIBRARY_PATH: [libDir, path.join(libDir, 'postgresql'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter),
    DYLD_LIBRARY_PATH: [libDir, path.join(libDir, 'postgresql'), process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(path.delimiter),
  };
}

function run(cmd, args, binDir, { allowFailure = false, quiet = false } = {}) {
  const result = spawnSync(cmd, args, { env: envForBin(binDir), encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    if (!quiet) console.error(result.stdout || '', result.stderr || '');
    fail(`Command failed: ${path.basename(cmd)} ${args.join(' ')}`);
  }
  return result;
}

function isRunning() {
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, 'utf8').split('\n')[0]);
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function initCluster(binDir) {
  if (existsSync(path.join(dataDir, 'PG_VERSION'))) return;
  mkdirSync(dataDir, { recursive: true });
  console.log(`[dev-postgres] initialising cluster in ${path.relative(rootDir, dataDir)}`);
  run(path.join(binDir, 'initdb'), ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8'], binDir);
  // Allow connections from the sandbox host (0.0.0.0) with password auth.
  const hba = readFileSync(path.join(dataDir, 'pg_hba.conf'), 'utf8')
    .replace(/^host\s+all\s+all\s+127\.0\.0\.1\/32\s+trust$/m, 'host all all 127.0.0.1/32 scram-sha-256')
    .replace(/^host\s+all\s+all\s+::1\/128\s+trust$/m, 'host all all ::1/128 scram-sha-256');
  writeFileSync(
    path.join(dataDir, 'pg_hba.conf'),
    `host all all 0.0.0.0/0 scram-sha-256\n${hba}`,
  );
}

async function start() {
  const binDir = resolveBinDir();
  initCluster(binDir);
  if (isRunning()) {
    console.log(`[dev-postgres] already running on port ${port}`);
    await ensureDatabases();
    return;
  }
  console.log(`[dev-postgres] starting PostgreSQL on 0.0.0.0:${port}`);
  run(
    path.join(binDir, 'pg_ctl'),
    ['-D', dataDir, '-l', logFile, '-o', `-p ${port} -c listen_addresses=0.0.0.0 -c unix_socket_directories=/tmp`, '-w', 'start'],
    binDir,
  );
  await ensureDatabases();
}

/**
 * Creates the development role and databases.
 *
 * The npm-distributed PostgreSQL build ships only the server binaries (no psql
 * or createdb), so administration goes through the `pg` driver over a trusted
 * local Unix socket connection as the bootstrap superuser.
 */
async function ensureDatabases() {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ host: '/tmp', port, user: 'postgres', database: 'postgres' });
  await client.connect();
  try {
    const role = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [process.env.PGDATABASE_ROLE ?? 'swapmart']);
    if (role.rowCount === 0) {
      await client.query(`CREATE ROLE ${quoteIdent(roleName)} LOGIN PASSWORD ${quoteLiteral(password)}`);
      console.log(`[dev-postgres] created role ${roleName}`);
    } else {
      await client.query(`ALTER ROLE ${quoteIdent(roleName)} WITH LOGIN PASSWORD ${quoteLiteral(password)}`);
    }
    for (const db of databases) {
      const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
      if (exists.rowCount === 0) {
        await client.query(`CREATE DATABASE ${quoteIdent(db)} OWNER ${quoteIdent(roleName)}`);
        console.log(`[dev-postgres] created database ${db}`);
      }
    }
  } finally {
    await client.end();
  }
  console.log(`[dev-postgres] ready -> postgres://${roleName}:***@127.0.0.1:${port}/${databases[0]}`);
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function stop() {
  const binDir = resolveBinDir();
  if (!isRunning()) {
    console.log('[dev-postgres] not running');
    return;
  }
  run(path.join(binDir, 'pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', 'stop'], binDir);
  console.log('[dev-postgres] stopped');
}

function reset() {
  stop();
  if (existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
    console.log('[dev-postgres] data directory removed; run `npm run db:start` to recreate');
  }
}

function status() {
  console.log(isRunning() ? `[dev-postgres] running (port ${port})` : '[dev-postgres] stopped');
}

const command = process.argv[2] ?? 'start';
switch (command) {
  case 'start':
    await start();
    break;
  case 'stop':
    stop();
    break;
  case 'status':
    status();
    break;
  case 'reset':
    reset();
    break;
  default:
    fail(`Unknown command "${command}". Use start|stop|status|reset.`);
}

import process from 'node:process';
import { createApp } from './app.ts';
import { loadConfig } from './config/env.ts';
import { logger } from './config/logger.ts';
import { closePool, healthCheck } from './db/pool.ts';
import { migrateOnStart } from './db/migrate.ts';
import { emailConfigurationStatus } from './services/email.ts';
import { mediaConfigurationStatus } from './services/media/storage.ts';
import { externalProviderStatus } from './services/verification/providers.ts';

/**
 * API entry point: validates configuration, optionally applies migrations,
 * starts the HTTP listener on 0.0.0.0 (required by container hosts and by the
 * sandbox preview proxy), and shuts down gracefully on SIGTERM/SIGINT.
 */
const config = loadConfig();

async function main(): Promise<void> {
  if (config.database.runMigrationsOnStart) {
    await migrateOnStart();
  }

  if (config.security.usingDevelopmentSecrets) {
    logger.warn(
      'IDENTIFIER_ENCRYPTION_KEY / IDENTIFIER_HASH_SECRET are not set: development-only derived keys are in use. Never run this configuration in production.',
    );
  }

  const health = await healthCheck();
  if (!health.ok) {
    logger.error('database is not reachable at startup; check DATABASE_URL');
  }

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info(
      {
        port: config.port,
        env: config.env,
        database: { ok: health.ok, latencyMs: health.latencyMs },
        email: emailConfigurationStatus().transport,
        media: mediaConfigurationStatus().driver,
        stolenCheck: externalProviderStatus().provider,
      },
      `SWAPMART API listening on 0.0.0.0:${config.port}`,
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled promise rejection'));
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    shutdown('uncaughtException');
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'API failed to start');
  process.exit(1);
});

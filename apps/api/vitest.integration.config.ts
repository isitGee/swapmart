import { defineConfig } from 'vitest/config';

/**
 * Integration tests: the real Express application against a real PostgreSQL
 * database (services, SQL, constraints, transactions). The API is exercised
 * in-process through supertest, so no HTTP server has to be started.
 */
export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/setup/database.setup.ts'],
    setupFiles: ['test/setup/env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: ['default'],
  },
});

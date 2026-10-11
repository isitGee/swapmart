import { defineConfig } from 'vitest/config';

/**
 * End-to-end acceptance tests: complete user journeys driven through the public
 * HTTP API against a real database, exactly as the frontend drives them
 * (cookies, CSRF tokens, pagination, error shapes). This is where the twenty
 * named acceptance criteria in docs/TEST-PLAN.md are executed.
 *
 * There are no browser binaries in this environment, so the browser layer is
 * verified by `apps/web/scripts/run-acceptance.mjs`, which drives the real
 * Next.js production server over HTTP (server-rendered HTML, rewrites, cookies).
 */
export default defineConfig({
  test: {
    name: 'e2e',
    environment: 'node',
    include: ['test/e2e/**/*.test.ts'],
    globalSetup: ['test/setup/database.setup.ts'],
    setupFiles: ['test/setup/env.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    reporters: ['default'],
  },
});

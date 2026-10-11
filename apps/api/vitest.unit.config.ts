import { defineConfig } from 'vitest/config';

/**
 * Unit tests: pure logic only (verification engine, identifier handling,
 * state machines, serialisers, validation schemas). No database, no network.
 */
export default defineConfig({
  test: {
    name: 'unit',
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    reporters: ['default'],
  },
});

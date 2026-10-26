import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Disable cross-file parallel worker execution so database integration tests
    // run in sequential isolation without truncating tables under each other.
    fileParallelism: false,
    testTimeout: 10000,
  },
});

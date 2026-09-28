import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/m1/**/*.e2e.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 300_000,
    hookTimeout: 30_000,
    reporters: ['default'],
  },
});

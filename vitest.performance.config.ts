import { defineConfig } from 'vitest/config';
// Growth and cost measurements run one file at a time after the functional suite, on an otherwise idle worker.
export default defineConfig({ test: { include: ['packages/**/performance.test.ts'], exclude: ['**/node_modules/**'], testTimeout: 120000, fileParallelism: false, maxWorkers: 1 } });

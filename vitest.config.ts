import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/**/*.test.ts', 'tests/**/*.test.ts', 'apps/**/*.test.ts'], exclude: ['**/node_modules/**', 'tests/e2e/**'], testTimeout: 15000, maxWorkers: 4 } });

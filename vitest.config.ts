import { defineConfig } from 'vitest/config';
// Timing-sensitive performance suites run separately (vitest.performance.config.ts) so they neither starve nor
// are disturbed by parallel functional tests. Process startup is expensive on Windows, so fewer workers run there.
export default defineConfig({ test: { include: ['packages/**/*.test.ts', 'tests/**/*.test.ts', 'apps/**/*.test.ts'], exclude: ['**/node_modules/**', 'tests/e2e/**', '**/performance.test.ts'], testTimeout: 15000, maxWorkers: process.platform === 'win32' ? 2 : 4 } });

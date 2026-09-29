import { expect, it } from 'vitest';
import { configSchema } from './config.js';

it('upgrades old context defaults and validates explicit offline tokenization and bounded imports', () => {
  expect(configSchema.parse({ schemaVersion: 1 })).toMatchObject({ contextDependencies: { maxDepth: 2, maxFiles: 64 }, contextTokenizer: { encoding: 'estimated', model: null } });
  expect(configSchema.parse({ contextDependencies: { maxDepth: 0 }, contextTokenizer: { encoding: 'cl100k_base', model: 'gpt-4' } })).toMatchObject({ contextDependencies: { maxDepth: 0, maxFiles: 64 }, contextTokenizer: { encoding: 'cl100k_base', model: 'gpt-4' } });
  for (const invalid of [{ contextDependencies: { maxDepth: 9 } }, { contextDependencies: { maxFiles: -1 } }, { contextTokenizer: { encoding: 'unverified' } }, { contextTokenizer: { encoding: 'o200k_base', url: 'https://example.com/ranks' } }]) expect(configSchema.safeParse(invalid).success).toBe(false);
});

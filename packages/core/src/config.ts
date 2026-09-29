import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicWrite, safePath } from './security.js';

export const configSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  mode: z.enum(['observe', 'balanced', 'experimental']).default('observe'),
  dataDir: z.string().min(1).default('.codebudget'),
  contextBudget: z.number().int().min(128).max(1000000).default(8000),
  contextWeights: z.object({ name: z.number().nonnegative().default(12), text: z.number().nonnegative().default(4), location: z.number().nonnegative().default(30), dependency: z.number().nonnegative().default(6), test: z.number().nonnegative().default(5) }).strict().default({ name: 12, text: 4, location: 30, dependency: 6, test: 5 }),
  contextDependencies: z.object({ maxDepth: z.number().int().min(0).max(8).default(2), maxFiles: z.number().int().min(0).max(512).default(64) }).strict().default({ maxDepth: 2, maxFiles: 64 }),
  contextTokenizer: z.object({ encoding: z.enum(['estimated', 'o200k_base', 'cl100k_base']).default('estimated'), model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).nullable().default(null) }).strict().default({ encoding: 'estimated', model: null }),
  outputMaxBytes: z.number().int().min(1024).max(64 * 1024 * 1024).default(4 * 1024 * 1024),
  outputPreviewBytes: z.number().int().min(1024).max(1024 * 1024).default(64 * 1024),
  diskBudgetBytes: z.number().int().min(4 * 1024 * 1024).max(1024 ** 3).default(128 * 1024 * 1024),
  artifactRetentionDays: z.number().int().min(1).max(3650).default(14),
  commandTimeoutMs: z.number().int().min(1).max(86400000).default(120000),
  rawArchive: z.boolean().default(false),
  experimental: z.object({ localSummary: z.boolean().default(false), apiRouting: z.boolean().default(false), localEndpoint: z.string().url().optional() }).strict().default({ localSummary: false, apiRouting: false }),
}).strict();
export type Config = z.infer<typeof configSchema>;
export const defaults = (): Config => configSchema.parse({});

export function loadConfig(root: string, overrides: Partial<Config> = {}, env: NodeJS.ProcessEnv = process.env): Config {
  const file = safePath(root, '.codebudget.json');
  const supplied: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const project = configSchema.parse(supplied);
  const environment: Record<string, unknown> = {};
  if (env.CODEBUDGET_MODE !== undefined) environment.mode = env.CODEBUDGET_MODE;
  if (env.CODEBUDGET_CONTEXT_BUDGET !== undefined) environment.contextBudget = Number(env.CODEBUDGET_CONTEXT_BUDGET);
  const config = configSchema.parse({ ...project, ...environment, ...overrides });
  const dir = safePath(root, config.dataDir);
  if (dir === realpathSync(root) || !/^\.codebudget(?:[-_.][A-Za-z0-9_-]+)*$/.test(config.dataDir)) throw new Error('dataDir must be a dedicated top-level .codebudget-prefixed directory, with no path separators');
  return config;
}

export function initialize(root: string): { config: Config; created: boolean } {
  root = realpathSync(root);
  const file = safePath(root, '.codebudget.json');
  const created = !existsSync(file);
  if (created) atomicWrite(file, JSON.stringify(defaults(), null, 2) + '\n');
  const config = loadConfig(root);
  mkdirSync(safePath(root, config.dataDir), { recursive: true, mode: 0o700 });
  const ignoreFile = safePath(root, '.gitignore');
  const previous = existsSync(ignoreFile) ? readFileSync(ignoreFile, 'utf8') : '';
  const rule = `${config.dataDir}/`;
  if (!previous.split(/\r?\n/).includes(rule)) atomicWrite(ignoreFile, previous + (previous.endsWith('\n') || !previous ? '' : '\n') + rule + '\n');
  return { config, created };
}

export function setMode(root: string, mode: Config['mode']): Config {
  const config = loadConfig(root, { mode }, {});
  atomicWrite(join(root, '.codebudget.json'), JSON.stringify(config, null, 2) + '\n');
  return config;
}

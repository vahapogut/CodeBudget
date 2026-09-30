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
  mcpTimeoutMs: z.number().int().min(1000).max(600000).default(30000),
  rawArchive: z.boolean().default(false),
  experimental: z.object({ localSummary: z.boolean().default(false), apiRouting: z.boolean().default(false), localEndpoint: z.string().url().optional() }).strict().default({ localSummary: false, apiRouting: false }),
}).strict();
export type Config = z.infer<typeof configSchema>;
export const defaults = (): Config => configSchema.parse({});

/**
 * Privacy-sensitive settings are honored only from local, uncommitted sources: the ignored
 * `<dataDir>/local.json`, CODEBUDGET_RAW_ARCHIVE or explicit overrides. A cloned repository's
 * committed `.codebudget.json` cannot switch on unmasked raw archiving or model routing.
 */
export const LOCAL_ONLY_KEYS = ['rawArchive', 'experimental'] as const;
export const LOCAL_CONFIG_FILE = 'local.json';
const localSchema = configSchema.pick({ rawArchive: true, experimental: true }).partial().strict();

/** Readable validation errors that name their source instead of dumping schema internals. */
function parseWith<T>(schema: z.ZodType<T>, value: unknown, source: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(`Invalid ${source}: ${result.error.issues.map(issue => `${issue.path.join('.') || 'value'}: ${issue.message}`).join('; ')}`);
}
function readJsonObject(file: string, source: string): Record<string, unknown> {
  let value: unknown;
  // Parser messages can quote file content, so they are not forwarded.
  try { value = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { throw new Error(`Invalid ${source}: not valid JSON`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${source}: expected a JSON object`);
  return value as Record<string, unknown>;
}
function environmentSettings(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  const mode = env.CODEBUDGET_MODE?.trim();
  if (mode) {
    if (!['observe', 'balanced', 'experimental'].includes(mode)) throw new Error('CODEBUDGET_MODE must be observe, balanced or experimental');
    settings.mode = mode;
  }
  const budget = env.CODEBUDGET_CONTEXT_BUDGET?.trim();
  if (budget) {
    if (!/^\d{1,7}$/.test(budget) || Number(budget) < 128 || Number(budget) > 1000000) throw new Error('CODEBUDGET_CONTEXT_BUDGET must be a whole number of tokens from 128 to 1000000');
    settings.contextBudget = Number(budget);
  }
  const raw = env.CODEBUDGET_RAW_ARCHIVE?.trim();
  if (raw) {
    if (!/^(?:0|1|true|false)$/i.test(raw)) throw new Error('CODEBUDGET_RAW_ARCHIVE must be 1, 0, true or false');
    settings.rawArchive = /^(?:1|true)$/i.test(raw);
  }
  return settings;
}
function projectSettings(root: string): Record<string, unknown> {
  const file = safePath(root, '.codebudget.json');
  return existsSync(file) ? readJsonObject(file, '.codebudget.json') : {};
}

export function loadConfig(root: string, overrides: Partial<Config> = {}, env: NodeJS.ProcessEnv = process.env): Config {
  const project = parseWith(configSchema, projectSettings(root), '.codebudget.json');
  const dir = safePath(root, project.dataDir);
  if (dir === realpathSync(root) || !/^\.codebudget(?:[-_.][A-Za-z0-9_-]+)*$/.test(project.dataDir)) throw new Error('dataDir must be a dedicated top-level .codebudget-prefixed directory, with no path separators');
  const localFile = join(dir, LOCAL_CONFIG_FILE);
  const local = existsSync(localFile) ? parseWith(localSchema, readJsonObject(localFile, `${project.dataDir}/${LOCAL_CONFIG_FILE}`), `${project.dataDir}/${LOCAL_CONFIG_FILE}`) : {};
  const shared: Record<string, unknown> = { ...project };
  for (const key of LOCAL_ONLY_KEYS) delete shared[key];
  return parseWith(configSchema, { ...shared, ...local, ...environmentSettings(env), ...overrides }, 'CodeBudget configuration');
}

/** Committed settings that were ignored because they may only be enabled locally. */
export function configWarnings(root: string): string[] {
  const project = projectSettings(root); const warnings: string[] = [];
  if (project.rawArchive === true) warnings.push(`.codebudget.json sets rawArchive, which is ignored there. Enable unmasked raw archiving only in the ignored ${String(project.dataDir ?? '.codebudget')}/${LOCAL_CONFIG_FILE} or with CODEBUDGET_RAW_ARCHIVE=1.`);
  const experimental = project.experimental;
  if (experimental && typeof experimental === 'object' && Object.values(experimental).some(value => value !== false && value !== undefined)) warnings.push(`.codebudget.json enables experimental features, which are ignored there. Use the ignored ${String(project.dataDir ?? '.codebudget')}/${LOCAL_CONFIG_FILE}.`);
  return warnings;
}

/** Project defaults written by init; local-only settings are not part of the shared file. */
function projectDefaults(): Record<string, unknown> {
  const values: Record<string, unknown> = { ...defaults() };
  for (const key of LOCAL_ONLY_KEYS) delete values[key];
  return values;
}

export function initialize(root: string): { config: Config; created: boolean } {
  root = realpathSync(root);
  const file = safePath(root, '.codebudget.json');
  const created = !existsSync(file);
  if (created) atomicWrite(file, JSON.stringify(projectDefaults(), null, 2) + '\n');
  const config = loadConfig(root);
  mkdirSync(safePath(root, config.dataDir), { recursive: true, mode: 0o700 });
  const ignoreFile = safePath(root, '.gitignore');
  const previous = existsSync(ignoreFile) ? readFileSync(ignoreFile, 'utf8') : '';
  const rule = `${config.dataDir}/`;
  if (!previous.split(/\r?\n/).includes(rule)) atomicWrite(ignoreFile, previous + (previous.endsWith('\n') || !previous ? '' : '\n') + rule + '\n');
  return { config, created };
}

/** Change only the mode, keeping every other field of the project file as written. */
export function setMode(root: string, mode: Config['mode']): Config {
  const file = safePath(root, '.codebudget.json');
  const next = { ...projectSettings(root), mode };
  parseWith(configSchema, next, '.codebudget.json');
  atomicWrite(file, JSON.stringify(next, null, 2) + '\n');
  return loadConfig(root, {}, {});
}

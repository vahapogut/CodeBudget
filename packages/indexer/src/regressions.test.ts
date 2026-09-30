import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createIndexer, createLocalTokenizer, estimatedTokenizer, indexDatabaseFileName, type ContextPackage, type RepositoryIndexer } from './index.js';
import { hash } from './security.js';

const temporary: string[] = [];
const open: RepositoryIndexer[] = [];
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'codebudget-regression-'));
  temporary.push(root);
  return root;
}
function file(root: string, path: string, content: string | Buffer): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
async function indexer(root: string, options: Parameters<typeof createIndexer>[2] = {}): Promise<RepositoryIndexer> {
  const result = await createIndexer(root, join(root, '.codebudget'), options);
  open.push(result);
  return result;
}
const database = (root: string): string => join(root, '.codebudget', indexDatabaseFileName(realpathSync(root)));
function query<T>(root: string, sql: string): T[] {
  const db = new DatabaseSync(database(root), { readOnly: true });
  try { return db.prepare(sql).all() as T[]; } finally { db.close(); }
}
const indexedPaths = (root: string): string[] => query<{ path: string }>(root, 'SELECT path FROM files ORDER BY path').map((row) => row.path);
/** Deterministic pseudo-random bytes (incompressible fixtures). */
function noise(size: number, seed = 1): Buffer {
  let state = seed;
  return Buffer.from(Array.from({ length: size }, () => { state = (state * 1103515245 + 12345) % 2147483648; return state >>> 16 & 0xff; }));
}
/** A realistic generated TypeScript repository (the 5,000-file benchmark generator at a chosen scale). */
function generateRepository(root: string, files: number, targetBytes: number): number {
  let seed = 0x9e3779b9;
  const random = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const nouns = ['user', 'account', 'token', 'session', 'order', 'invoice', 'payment', 'customer', 'product', 'cart', 'address', 'profile', 'report', 'metric', 'event', 'queue', 'job', 'cache', 'config', 'route', 'request', 'response', 'record', 'batch', 'stream', 'schema', 'model', 'field', 'value', 'filter', 'result', 'page', 'cursor', 'lease'];
  const verbs = ['get', 'set', 'load', 'save', 'create', 'update', 'delete', 'find', 'list', 'build', 'parse', 'format', 'validate', 'compute', 'resolve', 'apply', 'merge', 'sync', 'rotate', 'refresh', 'emit', 'handle', 'process', 'render', 'check', 'normalize'];
  const cap = (word: string): string => word[0]!.toUpperCase() + word.slice(1);
  const name = (): string => pick(verbs) + cap(pick(nouns)) + (random() < 0.3 ? cap(pick(nouns)) : '');
  const type = (): string => cap(pick(nouns)) + (random() < 0.5 ? cap(pick(nouns)) : '') + (random() < 0.3 ? String(Math.floor(random() * 50)) : '');
  let total = 0;
  for (let i = 0; i < files; i++) {
    const lines = [`import { ${type()} } from '../area${i % 40}/shared${i % 7}';`, `// Module ${i}: ${pick(verbs)} ${pick(nouns)} for the ${pick(nouns)} pipeline.`];
    for (let symbol = 0; lines.join('\n').length < targetBytes / files - 200; symbol++) {
      const kind = random();
      if (kind < 0.25) lines.push(`export interface ${type()}Shape${i}x${symbol} {\n${Array.from({ length: 3 + Math.floor(random() * 6) }, () => `  ${pick(nouns)}${cap(pick(nouns))}${symbol}: ${pick(['string', 'number', type()])};`).join('\n')}\n}`);
      else if (kind < 0.85) lines.push(`export function ${name()}${i}x${symbol}(${pick(nouns)}: ${type()}): ${type()} {\n${Array.from({ length: 3 + Math.floor(random() * 8) }, () => random() < 0.5 ? `  const ${pick(nouns)}${cap(pick(nouns))} = ${name()}(${pick(nouns)}, ${Math.floor(random() * 1000)});` : `  if (!${pick(nouns)}) throw new Error('${cap(pick(verbs))} ${pick(nouns)} failed: missing ${pick(nouns)}');`).join('\n')}\n}`);
      else lines.push(`export class ${type()}Service${i}x${symbol} {\n  private readonly items: ${type()}[] = [];\n  ${name()}(${pick(nouns)}: ${type()}): void { this.items.push(${pick(nouns)}); }\n}`);
    }
    const text = lines.join('\n') + '\n';
    file(root, `src/area${i % 40}/module${Math.floor(i / 40)}/${pick(nouns)}${cap(pick(verbs))}${i}.ts`, text);
    total += Buffer.byteLength(text);
  }
  file(root, 'package.json', '{"name":"generated","private":true}\n');
  return total;
}
afterEach(() => {
  for (const entry of open.splice(0)) if ((entry as unknown as { db: DatabaseSync }).db.isOpen) entry.close();
  for (const root of temporary.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('bounded derived storage', () => {
  it('prepares context repeatedly without per-call snapshots or stored source copies', async () => {
    const root = project();
    for (let i = 0; i < 400; i++) file(root, `src/module${i % 20}/component${i}.ts`, `export function component${i}() { return "UNIQUE_BODY_MARKER_${i}"; }\n`);
    const subject = await indexer(root, { diskBudgetBytes: 1024 * 1024 });
    for (let call = 0; call < 40; call++) {
      const context = await subject.prepareContext({ task: `component${call} crash`, budget: 100_000 });
      expect(context.status).toBe('ready');
      expect(context.sources.length).toBeGreaterThan(100);
    }
    expect(query(root, 'SELECT id FROM snapshots')).toHaveLength(0);
    expect(query(root, "SELECT id FROM packages WHERE value LIKE '%UNIQUE_BODY_MARKER%'")).toHaveLength(0);
    expect(query(root, "SELECT id FROM files WHERE value LIKE '%UNIQUE_BODY_MARKER%'")).toHaveLength(0);
    const [pages] = query<{ page_count: number }>(root, 'PRAGMA page_count');
    expect(Number(pages!.page_count) * 4096).toBeLessThanOrEqual(1024 * 1024);
  });

  it('deduplicates identical snapshots and evicts older snapshots by bytes', async () => {
    const root = project();
    for (let i = 0; i < 300; i++) file(root, `src/file${i}.ts`, `export const value${i} = ${i};\n`);
    const subject = await indexer(root, { diskBudgetBytes: 1024 * 1024 });
    const first = subject.getChanges(undefined, 's');
    const second = subject.getChanges(undefined, 's');
    expect(second.snapshotId).not.toBe(first.snapshotId);
    expect(query(root, 'SELECT key FROM snapshot_data')).toHaveLength(1);
    let latest = second;
    for (let round = 0; round < 60; round++) {
      file(root, 'src/file0.ts', `export const value0 = ${round + 1000};\n`);
      latest = subject.getChanges(latest.snapshotId, 's');
      expect(latest.changes).toEqual([{ type: 'modified', path: 'src/file0.ts', hash: expect.any(String) }]);
    }
    const [stored] = query<{ bytes: number; rows: number }>(root, 'SELECT sum(bytes) AS bytes, count(*) AS rows FROM snapshot_data');
    // An eighth of the 1 MiB budget: bytes, not the 1000-row count cap, bound retained snapshots.
    expect(Number(stored!.bytes)).toBeLessThanOrEqual(128 * 1024);
    expect(Number(stored!.rows)).toBeLessThan(62);
    expect(() => subject.getChanges(first.snapshotId, 's')).toThrow('Unknown snapshot');
  });

  it('recovers from a full database by pruning metadata and retrying once', async () => {
    const root = project();
    file(root, 'value.ts', 'export const value = "first";\n');
    const subject = await indexer(root, { diskBudgetBytes: 1024 * 1024 });
    await subject.index();
    const baseline = subject.getChanges(undefined, 's');
    const db = new DatabaseSync(database(root));
    try {
      // Another connection fills the page quota with incompressible, older snapshot metadata.
      const past = new Date(Date.now() - 3_600_000).toISOString();
      for (let i = 0; Number(db.prepare('PRAGMA page_count').get()!.page_count) < 256; i++) {
        db.prepare('INSERT INTO snapshot_data(key,value,bytes) VALUES(?,?,?)').run(`ballast${i}`, noise(32 * 1024, i + 1), 32 * 1024);
        db.prepare('INSERT INTO snapshots(id,session_id,created_at,data) VALUES(?,?,?,?)').run(`snapshot_ballast${i}`, 's', past, `ballast${i}`);
      }
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally { db.close(); }
    for (let i = 0; i < 50; i++) file(root, `more/fresh${i}.ts`, `export const fresh${i} = "${noise(300, i + 7).toString('hex')}";\n`);
    const result = await subject.index();
    expect(result.files).toBe(51);
    expect(query(root, "SELECT id FROM snapshots WHERE id LIKE 'snapshot_ballast%'").length).toBeLessThanOrEqual(1);
    expect(subject.getChanges(baseline.snapshotId, 's').changes.filter((change) => change.type === 'added')).toHaveLength(50);
  });

  it('rebuild() recreates the derived database and recovers an index that exceeds a smaller budget', async () => {
    const root = project();
    for (let part = 0; part < 3; part++) file(root, `big${part}.ts`, `export const words = "${Array.from({ length: 40_000 }, (_, i) => `w${part}q${(i * 7919).toString(36)}z${i.toString(36)}`).join(' ')}";\n`);
    file(root, 'small.ts', 'export const small = 1;\n');
    const roomy = await createIndexer(root, join(root, '.codebudget'), { diskBudgetBytes: 16 * 1024 * 1024 });
    const first = await roomy.index();
    const context = await roomy.prepareContext({ task: 'small.ts', budget: 8000, sessionId: 's' });
    roomy.close();
    const tight = await indexer(root, { diskBudgetBytes: 1024 * 1024 });
    await expect(tight.index()).rejects.toThrow(/exceeds diskBudgetBytes.*rebuild\(\)/s);
    for (let part = 0; part < 3; part++) rmSync(join(root, `big${part}.ts`));
    const rebuilt = await tight.rebuild();
    expect(rebuilt.files).toBe(1);
    expect(() => tight.readEvidence(context.sources[0]!.evidenceId, { sessionId: 's' })).toThrow('Unknown evidence');
    expect(() => tight.getChanges(first.snapshotId)).toThrow('Unknown snapshot');
    const [pages] = query<{ page_count: number }>(root, 'PRAGMA page_count');
    expect(Number(pages!.page_count) * 4096).toBeLessThanOrEqual(1024 * 1024);
    expect((await tight.prepareContext({ task: 'small.ts', budget: 8000 })).sources.map((source) => source.path)).toEqual(['small.ts']);
  });

  it('keeps a 1/10-scale copy of the 5,000-file/33.5 MB repository within the proportional default budget', async () => {
    const root = project();
    const sourceBytes = generateRepository(root, 500, 3_350_000);
    const budget = Math.floor(32 * 1024 * 1024 / 10);
    const subject = await indexer(root, { diskBudgetBytes: budget });
    const result = await subject.index();
    expect(result.files).toBe(501);
    const [pages] = query<{ page_count: number }>(root, 'PRAGMA page_count');
    const size = Number(pages!.page_count) * 4096;
    expect(size).toBeLessThanOrEqual(budget);
    // Source text is not stored: the index is smaller than the source it describes.
    expect(size).toBeLessThan(sourceBytes);
    const context = await subject.prepareContext({ task: 'rotate refresh token for the account session', budget: 8000 });
    expect(context.status).toBe('ready');
    expect(context.sources.length).toBeGreaterThan(0);
  }, 120_000);
});

describe('selection payload and dependency resolution', () => {
  it('attaches only referenced same-file types, once per package, and warns about omissions', async () => {
    const root = project();
    const models = Array.from({ length: 100 }, (_, i) => `export interface Model${i} {\n${Array.from({ length: 8 }, (_, j) => `  field${j}OfModel${i}: string;`).join('\n')}\n}`);
    file(root, 'models.ts', [...models, 'export interface Address { street: string }', 'export type Owner = { address: Address };',
      'export function ownerOf(model: Model7): Owner { return { address: { street: String(model.field0OfModel7) } }; }',
      'export function describeOwner(owner: Owner): string { return owner.address.street; }'].join('\n') + '\n');
    const subject = await indexer(root);
    const context = await subject.prepareContext({ task: 'Add a field to Model7 in models', budget: 8000 });
    expect(context.status).toBe('ready');
    const model7 = context.sources.find((source) => source.symbol === 'Model7');
    expect(model7?.types).toEqual([]);
    expect(context.omittedCount).toBeGreaterThan(0);
    expect(context.warnings.some((warning) => warning.includes('omitted to fit the budget'))).toBe(true);
    const owners = await subject.prepareContext({ task: 'ownerOf describeOwner', budget: 20000 });
    const names = (bodies: string[]): string[] => bodies.map((body) => /(?:interface|type)\s+(\w+)/.exec(body)![1]!);
    const attached = owners.sources.flatMap((source) => names(source.types));
    expect(attached.filter((name) => /^Model(?!7$)/.test(name))).toEqual([]);
    expect(new Set([...attached, ...owners.sources.map((source) => source.symbol)]).size).toBe(attached.length + owners.sources.length);
    const delivered = new Set([...attached, ...owners.sources.map((source) => source.symbol)]);
    for (const name of ['Owner', 'Address', 'Model7']) expect(delivered.has(name)).toBe(true);
    expect(owners.tokenMeasurement.tokens).toBe(estimatedTokenizer.count(JSON.stringify(owners)));
  });

  it('resolves dotted extensionless imports such as ./user.service and ./config.dev', async () => {
    const root = project();
    file(root, 'entry.ts', ['import { UserService } from "./user.service";', 'import { AppComponent } from "./app.component";', 'import { devConfig } from "./config.dev";', 'import { helper } from "./lib";',
      'export const wiring = [UserService, AppComponent, devConfig, helper];'].join('\n'));
    file(root, 'user.service.ts', 'export class UserService {}\n');
    file(root, 'app.component.ts', 'export class AppComponent {}\n');
    file(root, 'config.dev.ts', 'export const devConfig = {};\n');
    file(root, 'lib/index.ts', 'export const helper = 1;\n');
    const context = await (await indexer(root)).prepareContext({ task: 'entry.ts', budget: 20000 });
    expect(context.dependencyExpansion.issues).toEqual([]);
    expect(context.sources.filter((source) => source.dependency?.depth === 1).map((source) => source.path).sort()).toEqual(['app.component.ts', 'config.dev.ts', 'lib/index.ts', 'user.service.ts']);
  });
});

describe('source boundary and ignore semantics', () => {
  it('records every exclusion with a stable reason and keeps legitimate build/dist/secrets modules', async () => {
    const root = project();
    file(root, 'src/app.ts', 'import { compile } from "./build/compile";\nexport const run = () => compile();\n');
    file(root, 'src/build/compile.ts', 'export function compile() { return "compiled"; }\n');
    file(root, 'packages/coverage/src/report.ts', 'export function coverageReport() { return 1; }\n');
    file(root, 'src/Dist/index.ts', 'export const distIndex = 1;\n');
    file(root, 'src/secrets.ts', 'export function loadSecrets() { return null; }\n');
    file(root, 'src/credentials.ts', 'export function credentialsProvider() { return null; }\n');
    file(root, 'src/.cache/keep.ts', 'export const cached = 1;\n');
    file(root, 'build/out.js', 'export const out = 1;\n');
    file(root, 'packages/app/package.json', '{"name":"app"}\n');
    file(root, 'packages/app/dist/bundle.js', 'export const bundle = 1;\n');
    file(root, 'config/secrets.json', '{"token":"x"}\n');
    file(root, '.env', 'TOKEN=1\n');
    file(root, 'data/cache.sqlite', 'SQLite format 3');
    file(root, 'node_modules/pkg/index.js', 'export const dependency = 1;\n');
    file(root, '.gitignore', 'ignored.ts\n');
    file(root, 'ignored.ts', 'export const ignored = 1;\n');
    const posix = process.platform !== 'win32';
    if (posix) {
      symlinkSync(join(root, 'src/app.ts'), join(root, 'linked.ts'));
      file(root, 'we\\ird.ts', 'export const weird = 1;\n');
    }
    const subject = await indexer(root);
    const result = await subject.index();
    expect(indexedPaths(root)).toEqual(expect.arrayContaining(['packages/app/package.json', 'packages/coverage/src/report.ts', 'src/Dist/index.ts', 'src/app.ts', 'src/build/compile.ts', 'src/credentials.ts', 'src/secrets.ts', ...(posix ? ['we\\ird.ts'] : [])]));
    expect(result.skipped).toEqual(expect.arrayContaining([
      { path: '.codebudget', reason: 'local_state' }, { path: 'src/.cache', reason: 'dependency' }, { path: 'build', reason: 'generated_output' },
      { path: 'packages/app/dist', reason: 'generated_output' }, { path: 'config/secrets.json', reason: 'secret' }, { path: '.env', reason: 'secret' },
      { path: 'data/cache.sqlite', reason: 'data_file' }, { path: 'node_modules', reason: 'dependency' }, { path: 'ignored.ts', reason: 'ignored' },
      ...(posix ? [{ path: 'linked.ts', reason: 'symlink' }] : []),
    ]));
    for (const entry of result.skipped) expect(entry.reason).toMatch(/^[a-z_]+(?::[A-Z0-9]+)?$/);
    const context = await subject.prepareContext({ task: 'Fix compile in src/app.ts', budget: 20000 });
    expect(context.sources.map((source) => source.path)).toEqual(expect.arrayContaining(['src/app.ts', 'src/build/compile.ts']));
    expect(context.dependencyExpansion.issues).toEqual([]);
  });

  it('applies Git exclude sources and case-sensitive patterns like Git', async () => {
    const root = project();
    file(root, 'probe-case.txt', 'x');
    const caseInsensitive = existsSync(join(root, 'PROBE-CASE.TXT'));
    const globalIgnore = join(project(), 'global-ignore');
    writeFileSync(globalIgnore, 'excluded-by-global.ts\n');
    file(root, '.git/info/exclude', '# local excludes\nexcluded-by-info.ts\n');
    file(root, '.git/config', `[core]\n\trepositoryformatversion = 0\n\texcludesFile = "${globalIgnore.replaceAll('\\', '/')}"\n`);
    file(root, '.gitignore', 'Upper.ts\nCONFIG.yaml\n');
    for (const path of ['excluded-by-info.ts', 'excluded-by-global.ts', 'kept.ts', 'upper.ts', 'config.yaml']) file(root, path, 'export const value = 1;\n');
    if (!caseInsensitive) file(root, 'Upper.ts', 'export const upper = 1;\n');
    const result = await (await indexer(root)).index();
    expect(result.skipped).toEqual(expect.arrayContaining([{ path: 'excluded-by-info.ts', reason: 'ignored' }, { path: 'excluded-by-global.ts', reason: 'ignored' }]));
    expect(indexedPaths(root)).toContain('kept.ts');
    if (!caseInsensitive) {
      expect(indexedPaths(root)).toEqual(expect.arrayContaining(['config.yaml', 'upper.ts']));
      expect(result.skipped).toContainEqual({ path: 'Upper.ts', reason: 'ignored' });
    }
  });

  it('allocates file limits fairly across directories, warns, and reports task-named skipped sources', async () => {
    const root = project();
    for (let i = 0; i < 60; i++) file(root, `aaa-fixtures/case${String(i).padStart(2, '0')}.ts`, `export const fixture${i} = ${i};\n`);
    file(root, 'src/app.ts', 'export function rotateRefreshToken() { return 1; }\n');
    file(root, 'src/auth.ts', 'export function login() { return 2; }\n');
    const subject = await indexer(root, { maxFiles: 10 });
    const result = await subject.index();
    expect(result.files).toBe(10);
    expect(indexedPaths(root)).toEqual(expect.arrayContaining(['src/app.ts', 'src/auth.ts']));
    expect(result.skipped.filter((entry) => entry.reason === 'file_count_limit')).toHaveLength(52);
    const context = await subject.prepareContext({ task: 'Rotate the refresh token in src/app.ts; compare aaa-fixtures/case59.ts', budget: 8000 });
    expect(context.sources.map((source) => source.path)).toContain('src/app.ts');
    expect(context.missingRequired).toEqual(['aaa-fixtures/case59.ts']);
    expect(context.status).toBe('missing_required');
    expect(context.warnings.some((warning) => warning.includes('scan limits') && warning.includes('52'))).toBe(true);
  });

  it('keeps indexing when a source is rewritten mid-index and reads Latin-1 or symlinked ignore rules', async () => {
    const root = project();
    file(root, 'reports/status.json', '{"tick":0}');
    for (let i = 0; i < 20; i++) file(root, `src/c${i}.ts`, `export const c${i} = ${i};\n`);
    file(root, 'third_party/.gitignore', Buffer.from('# r\xe9sum\xe9 build output\nskip-me.ts\n', 'latin1'));
    file(root, 'third_party/skip-me.ts', 'export const skipped = 1;\n');
    file(root, 'third_party/lib.ts', 'export const lib = 1;\n');
    let tick = 0;
    // The redactor runs between reading and committing: rewrite a (possibly already read) file every time.
    const subject = await indexer(root, { securityPolicyId: 'test-rewriter', redact: (text) => { writeFileSync(join(root, 'reports/status.json'), JSON.stringify({ tick: ++tick, pad: 'x'.repeat(tick % 5) })); return text; } });
    for (let call = 0; call < 3; call++) {
      const context = await subject.prepareContext({ task: 'c3 crash', budget: 8000 });
      expect(context.status).toBe('ready');
    }
    expect(indexedPaths(root)).toEqual(expect.arrayContaining(['reports/status.json', 'third_party/lib.ts']));
    expect(indexedPaths(root)).not.toContain('third_party/skip-me.ts');
    if (process.platform !== 'win32') {
      const linked = project();
      file(linked, 'shared/gitignore.common', 'tmp/\n');
      symlinkSync('shared/gitignore.common', join(linked, '.gitignore'));
      file(linked, 'tmp/scratch.ts', 'export const scratch = 1;\n');
      file(linked, 'app.ts', 'export const app = 1;\n');
      const result = await (await indexer(linked)).index();
      expect(result.skipped).toContainEqual({ path: 'tmp', reason: 'ignored' });
      expect(indexedPaths(linked)).toEqual(['app.ts']);
    }
  });

  it('fails closed for a subtree whose ignore rules cannot be read and keeps its previous rows', async () => {
    const root = project();
    file(root, 'app.ts', 'export const app = 1;\n');
    file(root, 'legacy/keep.ts', 'export const legacyKeep = 1;\n');
    const subject = await indexer(root);
    await subject.index();
    mkdirSync(join(root, 'legacy/.gitignore'));
    file(root, 'legacy/new.ts', 'export const legacyNew = 1;\n');
    const result = await subject.index();
    expect(result.skipped).toContainEqual({ path: 'legacy/.gitignore', reason: 'ignore_rules_unreadable:ENOTFILE' });
    expect(indexedPaths(root)).toEqual(['app.ts', 'legacy/keep.ts']);
    expect(result.deleted).toBe(0);
  });
});

describe('task path matching and staleness', () => {
  it('makes only whole NFC paths named in the task mandatory and links tests by exact stem', async () => {
    const root = project();
    file(root, 'index.ts', 'export const rootIndex = "' + 'unrelated root entry '.repeat(400) + '";\n');
    file(root, 'a.ts', 'export const a = 1;\n');
    file(root, 'README.md', '# Project\n' + 'unrelated readme text\n'.repeat(300));
    file(root, 'src/index.ts', 'export function start() { return 1; }\n');
    file(root, 'src/data.ts', 'export function loadData() { return []; }\n');
    file(root, 'docs/README.md', '# docs\n');
    for (let i = 0; i < 5; i++) file(root, `src/feature${i}/widget.ts`, `export function widget${i}() { return ${i}; }\n`);
    file(root, 'test/data.test.ts', 'it("data", () => {});\n');
    file(root, 'test/database.test.ts', 'it("database", () => {});\n');
    file(root, 'dizin/şifre.ts'.normalize('NFD'), 'export function yenile() { return 1; }\n');
    const subject = await indexer(root);
    const context = await subject.prepareContext({ task: 'Fix the crash in src/index.ts when ./src/data.ts returns nothing; see docs/README.md.', budget: 3000 });
    expect(context.status).toBe('ready');
    expect(context.sources.filter((source) => source.mandatory).map((source) => source.path).sort()).toEqual(['docs/README.md', 'src/data.ts', 'src/index.ts']);
    expect(context.sources.some((source) => source.path.startsWith('src/feature'))).toBe(false);
    const all = [...context.sources, ...context.omitted.map((reference) => ({ ...reference, reason: [reference.reason] }))];
    expect(all.some((source) => source.path === 'test/database.test.ts')).toBe(false);
    expect(context.sources.find((source) => source.path === 'test/data.test.ts')?.reason).toContain('related test candidate for src/data.ts');
    const nfc = 'dizin/şifre.ts'.normalize('NFC');
    const unicode = await subject.prepareContext({ task: `şifre modülünü düzelt (${nfc})`, budget: 8000, requiredPaths: [nfc] });
    expect(unicode.missingRequired).toEqual([]);
    expect(unicode.sources.map((source) => source.path.normalize('NFC'))).toEqual([nfc]);
    expect(unicode.sources[0]?.mandatory).toBe(true);
  });

  it('treats FTS5 query syntax in tasks as literal words in both search columns', async () => {
    const root = project();
    file(root, 'near.ts', 'export function near() { return "NOT and OR"; }\n');
    file(root, 'other.ts', 'export const unrelated = 1;\n');
    const subject = await indexer(root);
    for (const task of ['NEAR(a b)', 'a AND b OR NOT c', '"quoted" * ^ - + : ( ) {content}', 'content : (x) OR symbols: y', 'a"b \\" OR "x', 'ǅemal ﬁle İstanbul straße ab́c 𞤀𞤁 𰀀𰀁', 'x'.repeat(5000)]) {
      const context = await subject.prepareContext({ task, budget: 4000 });
      expect(context.sources.some((source) => source.path === 'other.ts')).toBe(false);
    }
    expect((await subject.prepareContext({ task: 'near', budget: 4000 })).sources.map((source) => source.path)).toEqual(['near.ts']);
  });

  it('revokes evidence as soon as its source is ignored, before the next index', async () => {
    const root = project();
    file(root, 'src/notes.md', '# token rotation internals\nCUSTOMER_LIST_MARKER\n');
    file(root, 'src/token.ts', 'export function rotateToken() { return 1; }\n');
    const subject = await indexer(root);
    const context = await subject.prepareContext({ task: 'token rotation internals', budget: 20000, sessionId: 's' });
    const notes = context.sources.find((source) => source.path === 'src/notes.md')!;
    const token = context.sources.find((source) => source.path === 'src/token.ts')!;
    expect(subject.readEvidence(notes.evidenceId, { sessionId: 's' }).content).toContain('CUSTOMER_LIST_MARKER');
    file(root, '.codebudgetignore', 'src/notes.md\n');
    expect(() => subject.readEvidence(notes.evidenceId, { sessionId: 's' })).toThrow('no longer eligible (ignored)');
    expect(subject.readEvidence(token.evidenceId, { sessionId: 's' }).content).toContain('rotateToken');
    await subject.index();
    expect(() => subject.readEvidence(notes.evidenceId, { sessionId: 's' })).toThrow('no longer indexed');
  });

  it('reports a stale index after a parser or security-policy change', async () => {
    const root = project();
    file(root, 'value.ts', 'export const value = "formerly-public";\n');
    const first = await indexer(root);
    await first.index();
    expect(first.doctor().current).toBe(true);
    const stricter = await indexer(root, { securityPolicyId: 'stricter-v2', redact: (text) => text.replaceAll('formerly-public', '[HIDDEN]') });
    const report = stricter.doctor();
    expect(report).toMatchObject({ current: false, stalePaths: [] });
    expect(report.warnings.some((warning) => warning.includes('cache version'))).toBe(true);
    expect((await stricter.index()).indexed).toBe(1);
    expect(stricter.doctor().current).toBe(true);
  });
});

describe('estimates, local data and migrations', () => {
  it('labels the byte estimate as not an upper bound and keeps the data directory invisible to Git', async () => {
    const root = project();
    const blob = noise(3000).toString('base64');
    file(root, 'blob.ts', `export const icon = "${blob}";\n`);
    const context = await (await indexer(root)).prepareContext({ task: 'blob.ts', budget: 100_000 });
    expect(context.warnings.some((warning) => warning.includes('not an upper bound'))).toBe(true);
    expect(context.warnings.join(' ')).not.toContain('conservative');
    const exact = await createLocalTokenizer({ encoding: 'o200k_base' });
    expect(exact.count(blob)).toBeGreaterThan(estimatedTokenizer.count(blob));
    expect(readFileSync(join(root, '.codebudget', '.gitignore'), 'utf8')).toMatch(/^\*$/m);
    if (process.platform !== 'win32') expect(statSync(join(root, '.codebudget')).mode & 0o777).toBe(0o700);
  });

  it('names the database with a case-insensitive root hash on Windows only', () => {
    expect(indexDatabaseFileName('C:\\Work\\Repo', 'win32')).toBe(indexDatabaseFileName('c:\\work\\repo', 'win32'));
    expect(indexDatabaseFileName('/work/Repo', 'linux')).not.toBe(indexDatabaseFileName('/work/repo', 'linux'));
    expect(indexDatabaseFileName('/work/repo', 'linux')).toBe(`index-${hash('/work/repo').slice(0, 24)}.sqlite`);
  });

  it('migrates schema 2 without losing evidence, snapshots or expansion chains', async () => {
    const root = project();
    const content = 'export const value = "legacy";\n';
    file(root, 'value.ts', content);
    const fileHash = hash(content);
    mkdirSync(join(root, '.codebudget'), { recursive: true });
    const legacy = new DatabaseSync(database(root));
    legacy.exec(`PRAGMA journal_mode=WAL; CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, value TEXT NOT NULL);
      CREATE VIRTUAL TABLE file_search USING fts5(path UNINDEXED, content, symbols); CREATE TABLE snapshots (id TEXT PRIMARY KEY, session_id TEXT, created_at TEXT NOT NULL, hashes TEXT NOT NULL);
      CREATE TABLE evidence (id TEXT PRIMARY KEY, session_id TEXT, path TEXT NOT NULL, hash TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE packages (id TEXT PRIMARY KEY, session_id TEXT, epoch TEXT, value TEXT NOT NULL, created_at TEXT NOT NULL); PRAGMA user_version=2;`);
    const now = new Date().toISOString();
    legacy.prepare('INSERT INTO metadata VALUES(?,?)').run('repository', realpathSync(root));
    legacy.prepare('INSERT INTO files VALUES(?,?,?)').run('value.ts', fileHash, JSON.stringify({ path: 'value.ts', hash: fileHash, language: 'typescript', content, symbols: [], imports: [], parseErrors: false, test: false, redacted: false, lines: 2 }));
    legacy.prepare('INSERT INTO file_search VALUES(?,?,?)').run('value.ts', content, 'value');
    legacy.prepare('INSERT INTO snapshots VALUES(?,?,?,?)').run('snapshot_legacy', 's', now, JSON.stringify({ 'value.ts': fileHash }));
    legacy.prepare('INSERT INTO evidence VALUES(?,?,?,?,?,?,?)').run('source_legacy', 's', 'value.ts', fileHash, 1, 1, now);
    const stored: Partial<ContextPackage> = { id: 'context_legacy', sources: [{ evidenceId: 'source_legacy', path: 'value.ts', hash: fileHash, symbol: null, startLine: 1, endLine: 1, code: content, imports: [], types: [], reason: [], score: 1, mandatory: true, complete: true, redacted: false, parseErrors: false, support: 'syntax', dependency: null }],
      omitted: [], status: 'ready', expansion: { count: 0, cumulativeTokens: 50, previousPackageId: null },
      tokenMeasurement: { tokens: 50, method: estimatedTokenizer.method, tokenizerId: estimatedTokenizer.id, model: null, encoding: null, modelMapping: 'unspecified', fallbackReason: null, accuracy: 'estimated', scope: 'legacy', guaranteed: false } };
    legacy.prepare('INSERT INTO packages VALUES(?,?,?,?,?)').run('context_legacy', 's', 'e1', JSON.stringify(stored), now);
    legacy.close();
    const subject = await indexer(root);
    expect(query<{ user_version: number }>(root, 'PRAGMA user_version')[0]!.user_version).toBe(3);
    expect(subject.readEvidence('source_legacy', { sessionId: 's' }).content).toContain('legacy');
    expect(subject.getChanges('snapshot_legacy', 's').changes).toEqual([]);
    expect(query<{ value: string }>(root, "SELECT value FROM packages WHERE id='context_legacy'")[0]!.value).not.toContain('export const value');
    const expanded = await subject.prepareContext({ task: 'value.ts', budget: 8000, sessionId: 's', epoch: 'e1', previousPackageId: 'context_legacy' });
    expect(expanded.expansion).toMatchObject({ count: 1, previousPackageId: 'context_legacy', cumulativeTokens: 50 + expanded.tokenMeasurement.tokens });
  });

  it('migrates schema 1 retention columns and refuses future schemas', async () => {
    const root = project();
    const content = 'export const value = 1;\n';
    file(root, 'value.ts', content);
    mkdirSync(join(root, '.codebudget'), { recursive: true });
    const legacy = new DatabaseSync(database(root));
    legacy.exec(`CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, value TEXT NOT NULL);
      CREATE VIRTUAL TABLE file_search USING fts5(path UNINDEXED, content, symbols); CREATE TABLE snapshots (id TEXT PRIMARY KEY, session_id TEXT, created_at TEXT NOT NULL, hashes TEXT NOT NULL);
      CREATE TABLE evidence (id TEXT PRIMARY KEY, session_id TEXT, path TEXT NOT NULL, hash TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL);
      CREATE TABLE packages (id TEXT PRIMARY KEY, session_id TEXT, epoch TEXT, value TEXT NOT NULL); PRAGMA user_version=1;`);
    legacy.prepare('INSERT INTO files VALUES(?,?,?)').run('value.ts', hash(content), '{}');
    legacy.prepare('INSERT INTO evidence VALUES(?,?,?,?,?,?)').run('source_v1', null, 'value.ts', hash(content), 1, 1);
    legacy.close();
    const subject = await indexer(root);
    expect(subject.readEvidence('source_v1').content).toContain('value = 1');
    subject.close();
    open.pop();
    const future = new DatabaseSync(database(root));
    future.exec('PRAGMA user_version=4');
    future.close();
    await expect(createIndexer(root, join(root, '.codebudget'))).rejects.toThrow('newer than supported schema 3');
  });
});

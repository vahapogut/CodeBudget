import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createIndexer, createLocalTokenizer, estimatedTokenizer, type RepositoryIndexer, type Tokenizer } from './index.js';
import { hash, normalizePath } from './security.js';
import { Store } from '../../core/src/store.js';
import { defaults } from '../../core/src/config.js';

const temporary: string[] = [];
const open: RepositoryIndexer[] = [];
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'codebudget-indexer-'));
  temporary.push(root);
  return root;
}
function file(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
async function indexer(root: string, options: Parameters<typeof createIndexer>[2] = {}): Promise<RepositoryIndexer> {
  const result = await createIndexer(root, join(root, '.codebudget'), options);
  open.push(result);
  return result;
}
afterEach(() => {
  for (const entry of open.splice(0)) entry.close();
  for (const root of temporary.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('Tree-sitter + SQLite FTS5 index', () => {
  it('uses the same public repository identity as core while reopening the legacy cache filename', async () => {
    const root = project();
    file(root, 'identity.ts', 'export const identity = true;');
    const store = new Store(root, defaults());
    try {
      const subject = await indexer(root);
      expect(subject.repositoryId).toBe(store.repositoryId);
      expect(subject.repositoryId).toMatch(/^[a-f0-9]{64}$/);
      const initial = await subject.index();
      expect(initial.repositoryId).toBe(store.repositoryId);
      expect(existsSync(join(root, '.codebudget', `index-${hash(realpathSync(root)).slice(0, 24)}.sqlite`))).toBe(true);
      const reopened = await indexer(root);
      expect((await reopened.index()).unchanged).toBe(1);
      expect((await reopened.prepareContext({ task: 'identity.ts', budget: 8000 })).repositoryId).toBe(store.repositoryId);
      expect(reopened.getChanges().repositoryId).toBe(store.repositoryId);
    } finally { store.close(); }
  });
  it('parses actual TS/JS/JSX/TSX bodies and keeps recovered syntax and text fallback honest', async () => {
    const root = project();
    file(root, 'auth.ts', 'import { hash } from "./hash";\nexport function rotateRefreshToken(value: string): string {\n return hash(value);\n}\n');
    file(root, 'hash.js', 'export const hash = (input) => input + "x";');
    file(root, 'view.tsx', 'export function TokenView() { return <span>token</span>; }');
    file(root, 'view.jsx', 'export function TokenLabel() { return <span>token</span>; }');
    file(root, 'broken.ts', 'export function brokenToken(value: string) { return value +');
    file(root, 'notes.py', 'def token_notes():\n    return "plain text fallback"');
    const subject = await indexer(root);
    const result = await subject.index();
    expect(result.files).toBe(6);
    expect(result.symbols).toBeGreaterThanOrEqual(4);
    const context = await subject.prepareContext({ task: 'rotate refresh token', budget: 20000 });
    expect(context.sources.some((source) => source.code.includes('return hash(value);'))).toBe(true);
    expect(context.sources.some((source) => source.path === 'hash.js' && source.reason.some((reason) => reason.includes('direct import')))).toBe(true);
    const fallback = await subject.prepareContext({ task: 'notes.py', budget: 10000 });
    expect(fallback.sources.find((source) => source.path === 'notes.py')?.support).toBe('text_fallback');
    const broken = await subject.prepareContext({ task: 'broken.ts', budget: 10000 });
    expect(broken.sources.find((source) => source.path === 'broken.ts')?.parseErrors).toBe(true);
    expect(subject.doctor().current).toBe(true);
  });

  it('honors nested gitignore/codebudgetignore and never re-includes sensitive files', async () => {
    const root = project();
    file(root, '.gitignore', 'ignored/\n*.generated.ts\n');
    file(root, '.codebudgetignore', 'notes.md\n!.env\n!private.key\n');
    file(root, 'src/.gitignore', 'local.ts\n');
    for (const path of ['keep.ts', 'ignored/inside.ts', 'x.generated.ts', 'notes.md', '.env', 'private.key', 'node_modules/x.ts', 'src/local.ts', 'src/keep.ts']) file(root, path, 'export const unique = 1;');
    const subject = await indexer(root);
    expect((await subject.index()).files).toBe(2);
    const missing = await subject.prepareContext({ task: 'unique', budget: 10000, requiredPaths: ['.env'] });
    expect(missing.missingRequired).toEqual(['.env']);
    expect(JSON.stringify(missing)).not.toContain('private.key');
  });

  it('incrementally updates saved untracked changes, deletions and identical-content renames', async () => {
    const root = project();
    file(root, 'a.ts', 'export function alpha() { return 1; }');
    file(root, 'gone.ts', 'export const gone = 2;');
    const subject = await indexer(root);
    expect((await subject.index()).indexed).toBe(2);
    expect((await subject.index()).unchanged).toBe(2);
    const before = subject.getChanges(undefined, 'session-a');
    renameSync(join(root, 'a.ts'), join(root, 'renamed.ts'));
    rmSync(join(root, 'gone.ts'));
    file(root, 'new.ts', 'export const created = true;');
    expect(subject.doctor().current).toBe(false);
    const changes = subject.getChanges(before.snapshotId, 'session-a');
    expect(changes.changes).toEqual(expect.arrayContaining([
      { type: 'renamed', path: 'renamed.ts', previousPath: 'a.ts', hash: expect.any(String) },
      { type: 'deleted', path: 'gone.ts', hash: null },
      { type: 'added', path: 'new.ts', hash: expect.any(String) },
    ]));
    expect(() => subject.getChanges(before.snapshotId, 'session-b')).toThrow('scope mismatch');
    const update = await subject.index();
    expect(update.deleted).toBe(2);
    expect(update.files).toBe(2);
  });

  it('handles Unicode paths and concurrent indexers without duplicate FTS records', async () => {
    const root = project();
    file(root, 'dizin/şifre.ts', 'export function yenile() { return "güncel"; }');
    const first = await indexer(root);
    const second = await indexer(root);
    const results = await Promise.all([first.index(), second.index(), first.index()]);
    expect(results.map((entry) => entry.files)).toEqual([1, 1, 1]);
    const context = await first.prepareContext({ task: 'yenile', budget: 8000 });
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.path).toBe('dizin/şifre.ts');
  });

  it('rejects traversal, Windows absolute paths and symlink directories', async () => {
    for (const path of ['../outside.ts', '..\\outside.ts', 'C:\\secret.ts', '/secret.ts', '\\\\server\\share', 'src/../secret.ts', 'src\0bad.ts']) {
      expect(() => normalizePath(path)).toThrow();
    }
    const root = project();
    const outside = project();
    file(outside, 'secret.ts', 'export const OUTSIDE_MARKER = "never read";');
    symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    file(root, 'safe.ts', 'export const safe = true;');
    const subject = await indexer(root);
    const result = await subject.index();
    expect(result.files).toBe(1);
    expect(result.skipped.some((entry) => entry.path === 'linked' && entry.reason === 'symlink')).toBe(true);
    const context = await subject.prepareContext({ task: 'OUTSIDE_MARKER', budget: 8000 });
    expect(JSON.stringify(context)).not.toContain('never read');
    expect(() => subject.readEvidence('../outside.ts')).toThrow('Unknown evidence');
  });
});

describe('context package budget and evidence integrity', () => {
  it('measures the final serialized package, including metadata, deterministically', async () => {
    const root = project();
    for (let i = 0; i < 12; i++) file(root, `token${i}.ts`, `export function token${i}() { return "${'value '.repeat(80)}"; }`);
    const subject = await indexer(root);
    const first = await subject.prepareContext({ task: 'token', budget: 2200 });
    const second = await subject.prepareContext({ task: 'token', budget: 2200 });
    expect(second).toEqual(first);
    expect(first.tokenMeasurement.tokens).toBe(estimatedTokenizer.count(JSON.stringify(first)));
    expect(first.tokenMeasurement.tokens).toBeLessThanOrEqual(2200);
    expect(first.tokenMeasurement.accuracy).toBe('estimated');
    expect(first.tokenMeasurement.guaranteed).toBe(false);
    expect(first.omittedCount).toBeGreaterThan(0);
  });

  it('preserves mandatory bodies and reports honest overflow even for a tiny envelope budget', async () => {
    const root = project();
    file(root, 'required.ts', 'export function required() {\n' + ' return "full-body";\n'.repeat(100) + '}');
    const subject = await indexer(root);
    const context = await subject.prepareContext({ task: 'required.ts', budget: 100 });
    expect(context.status).toBe('budget_exceeded');
    expect(context.minimumRequiredTokens).toBeGreaterThan(context.budget);
    expect(context.sources[0]?.code).toBe(readFileSync(join(root, 'required.ts'), 'utf8'));
    expect(context.sources[0]?.complete).toBe(true);
    expect(context.tokenMeasurement.tokens).toBe(estimatedTokenizer.count(JSON.stringify(context)));
  });

  it('counts the controlled MCP text-result envelope including JSON escaping', async () => {
    const root = project();
    file(root, 'quoted.ts', 'export function quoted() { return "a quote"; }');
    const subject = await indexer(root);
    const context = await subject.prepareContext({ task: 'quoted.ts', budget: 8000, protocol: 'mcp_text' });
    const envelope = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(context) }] });
    expect(context.tokenMeasurement.tokens).toBe(estimatedTokenizer.count(envelope));
    expect(context.tokenMeasurement.tokens).toBeGreaterThan(estimatedTokenizer.count(JSON.stringify(context)));
  });

  it('invalidates redacted caches on security policy changes', async () => {
    const root = project();
    file(root, 'value.ts', 'export const value = "formerly-public";');
    const first = await indexer(root);
    await first.index();
    const stricter = await indexer(root, { securityPolicyId: 'fixture-strict', redact: (text) => text.replaceAll('formerly-public', '[HIDDEN]') });
    const context = await stricter.prepareContext({ task: 'value.ts', budget: 8000 });
    expect(JSON.stringify(context)).not.toContain('formerly-public');
    expect(JSON.stringify(context)).toContain('[HIDDEN]');
  });

  it('allows an identified exact-local tokenizer and counts expansion metadata', async () => {
    const root = project();
    file(root, 'x.ts', 'export const x = 1;');
    const tokenizer: Tokenizer = { id: 'test:utf8-byte-tokenizer', model: 'test-byte-model', method: 'one token per UTF-8 byte', accuracy: 'exact_local', count: (text) => Buffer.byteLength(text) };
    const subject = await indexer(root, { tokenizer });
    const initial = await subject.prepareContext({ task: 'x.ts', budget: 20000, sessionId: 's', epoch: '1' });
    const expanded = await subject.prepareContext({ task: 'x.ts', budget: 30000, sessionId: 's', epoch: '1', previousPackageId: initial.id });
    expect(expanded.expansion.count).toBe(1);
    expect(expanded.expansion.cumulativeTokens).toBe(initial.tokenMeasurement.tokens + expanded.tokenMeasurement.tokens);
    expect(expanded.tokenMeasurement.tokens).toBe(Buffer.byteLength(JSON.stringify(expanded)));
    await expect(subject.prepareContext({ task: 'x.ts', budget: 30000, sessionId: 's', epoch: 'after-compaction', previousPackageId: initial.id })).rejects.toThrow('epoch');
    const reset = await subject.prepareContext({ task: 'x.ts', budget: 30000, sessionId: 's', epoch: 'after-compaction' });
    expect(reset.expansion.count).toBe(0);
    expect(reset.sources).toHaveLength(1);
  });

  it('rejects stale evidence after source mutation and binds references to repository/session', async () => {
    const root = project();
    file(root, 'source.ts', 'export function token() {\n return "original";\n}');
    const subject = await indexer(root);
    const context = await subject.prepareContext({ task: 'source.ts', budget: 8000, sessionId: 'session-a' });
    const evidence = context.sources[0]!.evidenceId;
    expect(subject.readEvidence(evidence, { sessionId: 'session-a', offset: 1, limit: 1 }).content).toContain('original');
    expect(() => subject.readEvidence(evidence, { sessionId: 'session-b' })).toThrow('scope mismatch');
    file(root, 'source.ts', 'export const replacement = 2;');
    expect(() => subject.readEvidence(evidence, { sessionId: 'session-a' })).toThrow('Stale evidence');
    const other = await indexer(project());
    expect(() => other.readEvidence(evidence, { sessionId: 'session-a' })).toThrow('Unknown evidence');
  });

  it('redacts indexed source and task metadata; redactor failure prevents delivery', async () => {
    const root = project();
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    file(root, 'token.ts', `export const token = "${secret}";`);
    const subject = await indexer(root);
    const context = await subject.prepareContext({ task: `token.ts ${secret}`, budget: 8000 });
    expect(JSON.stringify(context)).not.toContain(secret);
    expect(JSON.stringify(context)).toContain('[REDACTED]');
    const evidence = subject.readEvidence(context.sources[0]!.evidenceId);
    expect(evidence.content).not.toContain(secret);
    const broken = await indexer(project(), { redact: () => { throw new Error('detector failed'); } });
    await expect(broken.prepareContext({ task: 'redaction', budget: 8000 })).rejects.toThrow('detector failed');
  });

  it('reports excluded binary/oversized files and caps total source bytes', async () => {
    const root = project();
    file(root, 'large.ts', 'x'.repeat(1000));
    file(root, 'binary.ts', 'abc\0def');
    file(root, 'one.ts', 'export const a = 1;');
    file(root, 'two.ts', 'export const b = 2;');
    const subject = await indexer(root, { maxFileBytes: 100, maxTotalBytes: 25 });
    const result = await subject.index();
    expect(result.files).toBe(1);
    expect(result.skipped).toHaveLength(3);
  });

  it('bounds metadata admission and preserves evidence referenced by retained packages', async () => {
    const root = project();
    file(root, 'value.ts', 'export const value = "first";');
    const subject = await indexer(root, { maxSnapshots: 2, maxPackages: 1, maxEvidence: 2 });
    const before = subject.getChanges(undefined, 's');
    subject.getChanges(undefined, 's');
    const latest = subject.getChanges(undefined, 's');
    expect(() => subject.getChanges(before.snapshotId, 's')).toThrow('Unknown snapshot');
    expect(subject.getChanges(latest.snapshotId, 's').changes).toEqual([]);
    const first = await subject.prepareContext({ task: 'value.ts', budget: 8000 });
    file(root, 'value.ts', 'export const value = "second";');
    const second = await subject.prepareContext({ task: 'value.ts', budget: 8000 });
    expect(() => subject.readEvidence(first.sources[0]!.evidenceId)).toThrow('Unknown evidence');
    expect(subject.readEvidence(second.sources[0]!.evidenceId).content).toContain('second');
    const db = new DatabaseSync(join(root, '.codebudget', `index-${hash(realpathSync(root)).slice(0, 24)}.sqlite`));
    expect(Number(db.prepare('SELECT count(*) AS n FROM snapshots').get()?.n)).toBeLessThanOrEqual(2);
    expect(Number(db.prepare('SELECT count(*) AS n FROM packages').get()?.n)).toBe(1);
    expect(Number(db.prepare('SELECT count(*) AS n FROM evidence').get()?.n)).toBe(1);
    db.prepare('UPDATE packages SET created_at=?').run('2000-01-01T00:00:00.000Z');
    db.close();
    const preview = subject.prune();
    expect(preview.packages).toEqual([second.id]);
    expect(subject.readEvidence(second.sources[0]!.evidenceId).content).toContain('second');
    expect(subject.prune(false).sourceFilesAffected).toBe(0);
    expect(() => subject.readEvidence(second.sources[0]!.evidenceId)).toThrow('Unknown evidence');
    expect(readFileSync(join(root, 'value.ts'), 'utf8')).toContain('second');
    expect(subject.doctor().files).toBe(1);
  });

  it('enforces SQLite page quota with transaction rollback and denies linked data directories', async () => {
    const root = project();
    const original = 'export const value = "' + 'large text '.repeat(80_000) + '";';
    file(root, 'large.ts', original);
    const subject = await indexer(root, { diskBudgetBytes: 1024 * 1024 });
    await expect(subject.index()).rejects.toThrow(/full/i);
    expect(subject.doctor().files).toBe(0);
    expect(readFileSync(join(root, 'large.ts'), 'utf8')).toBe(original);
    const linkedRoot = project();
    const outside = project();
    symlinkSync(outside, join(linkedRoot, '.codebudget'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(createIndexer(linkedRoot)).rejects.toThrow('Symlink index data directory');
    await expect(createIndexer(linkedRoot, outside)).rejects.toThrow('inside the repository');
  });

  it('expands transitive relative imports with shortest path provenance, cycles and depth limits', async () => {
    const root = project();
    file(root, 'entry.ts', 'import { middle } from "./middle.js"; export const start = middle;');
    file(root, 'middle.ts', 'export { leaf as middle } from "./leaf";');
    file(root, 'leaf.ts', 'import "./entry"; import { end } from "./end"; export const leaf = end;');
    file(root, 'end.ts', 'export const end = 3;');
    const subject = await indexer(root);
    const first = await subject.prepareContext({ task: 'entry.ts', budget: 20000 });
    const second = await subject.prepareContext({ task: 'entry.ts', budget: 20000 });
    expect(second).toEqual(first);
    expect(first.dependencyExpansion).toMatchObject({ roots: 1, maxDepth: 2, expandedFiles: 2 });
    expect(first.sources.find(source => source.path === 'leaf.ts')?.dependency).toEqual({ root: 'entry.ts', path: ['entry.ts', 'middle.ts', 'leaf.ts'], depth: 2, resolution: 'relative_static_heuristic' });
    expect(first.sources.find(source => source.path === 'leaf.ts')?.reason.join(' ')).toContain('transitive import');
    expect(first.sources.some(source => source.path === 'end.ts')).toBe(false);
    expect(first.dependencyExpansion.issues).toContainEqual({ importer: 'leaf.ts', specifier: './end', reason: 'depth_limit' });
    const deeper = await indexer(root, { dependencies: { maxDepth: 3 } });
    const expanded = await deeper.prepareContext({ task: 'entry.ts', budget: 20000 });
    expect(expanded.sources.find(source => source.path === 'end.ts')?.dependency?.depth).toBe(3);
    expect(expanded.id).not.toBe(first.id);
  });

  it('does not guess ambiguous, dynamic, missing, malformed or outside-root dependencies', async () => {
    const root = project();
    file(root, 'entry.ts', 'import "./mixed"; import "../outside"; import "./missing"; import("./dynamic"); import "./broken";');
    file(root, 'mixed.ts', 'export const one = 1;');
    file(root, 'mixed.js', 'export const two = 2;');
    file(root, 'dynamic.ts', 'export const three = 3;');
    file(root, 'broken.ts', 'import "./downstream"; export function broken( {');
    file(root, 'downstream.ts', 'export const four = 4;');
    const subject = await indexer(root);
    const context = await subject.prepareContext({ task: 'entry.ts', budget: 20000 });
    expect(context.sources.map(source => source.path).sort()).toEqual(['broken.ts', 'entry.ts']);
    expect(context.dependencyExpansion.issues).toEqual(expect.arrayContaining([
      { importer: 'entry.ts', specifier: './mixed', reason: 'ambiguous', candidates: ['mixed.js', 'mixed.ts'] },
      { importer: 'entry.ts', specifier: '../outside', reason: 'outside_repository' },
      { importer: 'entry.ts', specifier: './missing', reason: 'unresolved' },
      { importer: 'entry.ts', specifier: './dynamic', reason: 'dynamic' },
      { importer: 'broken.ts', specifier: '', reason: 'parse_error' },
    ]));
  });

  it('bounds deterministic expansion, honors explicit extensions, and disables traversal at depth zero', async () => {
    const root = project();
    file(root, 'entry.ts', 'import "./b"; import "./a.js";');
    file(root, 'a.js', 'export const a = 1;');
    file(root, 'a.ts', 'export const a = 2;');
    file(root, 'b.ts', 'export const b = 1;');
    const limited = await indexer(root, { dependencies: { maxFiles: 1 } });
    const context = await limited.prepareContext({ task: 'entry.ts', budget: 20000 });
    expect(context.dependencyExpansion.expandedFiles).toBe(1);
    expect(context.sources.map(source => source.path).sort()).toEqual(['a.js', 'entry.ts']);
    expect(context.dependencyExpansion.issues).toContainEqual({ importer: 'entry.ts', specifier: './b', reason: 'file_limit' });
    const disabled = await indexer(root, { dependencies: { maxDepth: 0 } });
    expect((await disabled.prepareContext({ task: 'entry.ts', budget: 20000 })).sources.map(source => source.path)).toEqual(['entry.ts']);
    await expect(indexer(root, { dependencies: { maxDepth: 9 } })).rejects.toThrow('Dependency limits');
  });

  it('counts exact local serialized JSON and escaped MCP envelopes including Unicode and overflow metadata', async () => {
    const root = project();
    file(root, 'unicode.ts', 'export const greeting = "お誕生日おめでとう <|endoftext|>";\n');
    const subject = await indexer(root, { tokenizerConfig: { encoding: 'o200k_base', model: 'gpt-4o' } });
    const tokenizer = await createLocalTokenizer({ encoding: 'o200k_base', model: 'gpt-4o' });
    for (const protocol of ['json', 'mcp_text'] as const) {
      const context = await subject.prepareContext({ task: 'unicode.ts', budget: 4000, protocol });
      const serialized = protocol === 'json' ? JSON.stringify(context) : JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(context) }] });
      expect(context.tokenMeasurement.tokens).toBe(tokenizer.count(serialized));
      expect(context.tokenMeasurement).toMatchObject({ accuracy: 'exact_local', encoding: 'o200k_base', model: 'gpt-4o', modelMapping: 'verified', guaranteed: true });
      expect(context.status).toBe('ready');
      expect(context.tokenMeasurement.tokens).toBeLessThanOrEqual(context.budget);
    }
    const overflow = await subject.prepareContext({ task: 'unicode.ts', budget: 1 });
    expect(overflow.status).toBe('budget_exceeded');
    expect(overflow.sources[0]?.code).toContain('お誕生日');
    expect(overflow.tokenMeasurement.tokens).toBe(tokenizer.count(JSON.stringify(overflow)));
    expect(overflow.minimumRequiredTokens).toBe(overflow.tokenMeasurement.tokens);
  });

  it('separates tokenizer and ranking identities and rejects mixed-unit expansion totals', async () => {
    const root = project();
    file(root, 'entry.ts', 'export const value = 1;');
    const estimated = await indexer(root);
    const exact = await indexer(root, { tokenizerConfig: { encoding: 'cl100k_base', model: 'gpt-4' } });
    const weighted = await indexer(root, { weights: { name: 100 } });
    const request = { task: 'entry.ts', budget: 8000, sessionId: 'same', epoch: 'one' };
    const first = await estimated.prepareContext(request);
    const second = await exact.prepareContext(request);
    const third = await weighted.prepareContext(request);
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    await expect(exact.prepareContext({ ...request, previousPackageId: first.id })).rejects.toThrow('Tokenizer identity changed');
    const next = await exact.prepareContext({ ...request, previousPackageId: second.id });
    expect(next.expansion.cumulativeTokens).toBe(second.tokenMeasurement.tokens + next.tokenMeasurement.tokens);
  });

  it('withholds an otherwise current leaf when an omitted intermediate import changes during selection', async () => {
    const root = project();
    file(root, 'entry.ts', 'import "./middle";');
    file(root, 'middle.ts', 'import "./leaf"; export const middle = "' + 'large value '.repeat(5000) + '";');
    file(root, 'leaf.ts', 'export const leaf = true;');
    let changed = false;
    const tokenizer: Tokenizer = { ...estimatedTokenizer, count(text) {
      if (!changed && text.includes('"dependencyExpansion"')) { changed = true; file(root, 'middle.ts', 'export const middle = false;'); }
      return estimatedTokenizer.count(text);
    } };
    const subject = await indexer(root, { tokenizer });
    const context = await subject.prepareContext({ task: 'entry.ts', budget: 8000 });
    expect(context.omitted.some(source => source.path === 'middle.ts')).toBe(true);
    expect(context.status).toBe('snapshot_inconsistent');
    expect(context.missingRequired).toContain('middle.ts');
    expect(context.sources).toEqual([]);
  });
});

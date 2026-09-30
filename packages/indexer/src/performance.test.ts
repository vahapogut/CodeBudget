import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createIndexer, createLocalTokenizer, indexDatabaseFileName, type RepositoryIndexer } from './index.js';

// Complexity-ratio assertions with generous absolute caps: robust on a loaded machine, yet a quadratic
// implementation exceeds the ratio (and usually the cap) at these sizes.
const temporary: string[] = [];
const open: RepositoryIndexer[] = [];
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'codebudget-performance-'));
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
/** Fastest of several runs: transient load only ever makes a run slower. */
async function fastest(runs: number, fn: () => Promise<unknown> | unknown): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    await fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}
afterEach(() => {
  for (const entry of open.splice(0)) entry.close();
  for (const root of temporary.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('index maintenance cost', () => {
  it('re-indexes a fixed set of changed files at a cost independent of repository size', async () => {
    const repositories = await Promise.all([500, 4000].map(async (total) => {
      const root = project();
      for (let i = 0; i < total; i++) file(root, `src/m${i % 40}/c${i}.ts`, `export function c${i}(x: number) {\n  return x + ${i};\n}\n`);
      const subject = await indexer(root);
      await subject.index();
      return { root, subject };
    }));
    // Files modified within the last 3 s are re-read by design (racy-clean rule); settle both repositories.
    await new Promise((resolve) => setTimeout(resolve, 3100));
    for (const { subject } of repositories) await subject.index();
    const timeFor = async ({ root, subject }: { root: string; subject: RepositoryIndexer }): Promise<number> => {
      let round = 0;
      return fastest(3, async () => {
        round++;
        for (let i = 0; i < 200; i++) file(root, `src/m${i % 40}/c${i}.ts`, `export function c${i}(x: number) {\n  return x + ${i * 1000 + round};\n}\n`);
        expect((await subject.index()).indexed).toBe(200);
      });
    };
    // Every call stats each file and snapshots the whole state: linear in repository size by design, and the larger
    // share on slow file systems such as Windows runners. Measured with nothing changed, it is subtracted below.
    const walkFor = ({ subject }: { subject: RepositoryIndexer }): Promise<number> => fastest(3, async () => { expect((await subject.index()).indexed).toBe(0); });
    const smallWalk = await walkFor(repositories[0]!);
    const small = await timeFor(repositories[0]!);
    const largeWalk = await walkFor(repositories[1]!);
    const large = await timeFor(repositories[1]!);
    // Rowid FTS deletes and stat-based skipping: 8x the files, same 200 changes. Per-change scans would be ~8x;
    // the 100 ms allowance absorbs noise left over from subtracting two separately measured walks.
    expect(large - largeWalk).toBeLessThan(4 * (small - smallWalk) + 100);
    expect(large).toBeLessThan(20_000);
  }, 180_000);

  it('releases the write lock between committed batches while a large index runs', async () => {
    const root = project();
    for (let i = 0; i < 700; i++) file(root, `src/c${i}.ts`, `export const c${i} = ${i};\n`);
    const subject = await indexer(root);
    const probe = new DatabaseSync(join(root, '.codebudget', indexDatabaseFileName(realpathSync(root))));
    probe.exec('PRAGMA busy_timeout=0');
    let acquired = 0;
    const timer = setInterval(() => { try { probe.exec('BEGIN IMMEDIATE'); probe.exec('ROLLBACK'); acquired++; } catch { /* the indexer holds the lock */ } }, 0);
    try { expect((await subject.index()).indexed).toBe(700); }
    finally { clearInterval(timer); probe.close(); }
    expect(acquired).toBeGreaterThan(0);
  });

  it('keeps committed batches when an index is aborted and resumes on the next call', async () => {
    const root = project();
    for (let i = 0; i < 600; i++) file(root, `src/c${String(i).padStart(3, '0')}.ts`, `export const c${i} = ${i};\n`);
    const controller = new AbortController();
    let redactions = 0;
    const options = { securityPolicyId: 'test-abort', redact: (text: string) => { if (++redactions === 300) controller.abort(new Error('cancelled by test')); return text; } };
    const first = await indexer(root, options);
    await expect(first.index({ signal: controller.signal })).rejects.toThrow('cancelled by test');
    const resumed = await (await indexer(root, options)).index();
    // The first batch of 256 files was committed before the abort and is not parsed again.
    expect(resumed.unchanged).toBeGreaterThanOrEqual(256);
    expect(resumed.indexed + resumed.unchanged).toBe(600);
    expect(resumed.files).toBe(600);
  });
});

describe('context selection cost', () => {
  it('selects with the exact o200k tokenizer in near-linear time', async () => {
    const tokenizer = await createLocalTokenizer({ encoding: 'o200k_base' });
    const timeFor = async (files: number): Promise<number> => {
      const root = project();
      for (let i = 0; i < files; i++) file(root, `lib/area${i % 50}/service${i}.ts`, Array.from({ length: 10 }, (_, j) => `export function handler${i}Step${j}(input: number) { return input + ${j}; }`).join('\n') + '\n');
      const subject = await indexer(root, { tokenizerConfig: { encoding: 'o200k_base' } });
      await subject.index();
      let context: Awaited<ReturnType<RepositoryIndexer['prepareContext']>> | undefined;
      const elapsed = await fastest(2, async () => { context = await subject.prepareContext({ task: 'Fix crash in handler42Step3', budget: 8000 }); });
      // Incremental accounting never weakens the exact final measurement.
      expect(context!.tokenMeasurement.tokens).toBe(tokenizer.count(JSON.stringify(context)));
      expect(context!.tokenMeasurement.tokens).toBeLessThanOrEqual(8000);
      expect(context!.omittedCount).toBeGreaterThan(0);
      return elapsed;
    };
    const small = await timeFor(60);
    const target = await timeFor(150);
    const large = await timeFor(240);
    expect(target).toBeLessThan(10_000);
    expect(large / small).toBeLessThan(8);
  }, 180_000);

  it('handles a long pasted task at about the cost of a short one', async () => {
    const root = project();
    for (let i = 0; i < 400; i++) file(root, `lib/area${i % 50}/service${i}.ts`, Array.from({ length: 20 }, (_, j) => `export function handler${i}Step${j}Value(input: number) { return input + ${j}; }`).join('\n') + '\n');
    const subject = await indexer(root);
    await subject.index();
    const longTask = Array.from({ length: 1900 }, (_, i) => `zq${i.toString(36)}x`).join(' ').slice(0, 19_999);
    const short = await fastest(2, () => subject.prepareContext({ task: 'zqunrelated crash', budget: 8000 }));
    const long = await fastest(2, () => subject.prepareContext({ task: longTask, budget: 8000 }));
    expect(long / Math.max(short, 25)).toBeLessThan(6);
    expect(long).toBeLessThan(10_000);
  }, 120_000);

  it('pairs identical-content moves deterministically with one hash map', async () => {
    const root = project();
    for (let i = 0; i < 1500; i++) file(root, `old/c${i}.ts`, `export const same = ${i % 3};\n`);
    const subject = await indexer(root);
    const base = subject.getChanges();
    renameSync(join(root, 'old'), join(root, 'new'));
    const start = performance.now();
    const changes = subject.getChanges(base.snapshotId);
    expect(performance.now() - start).toBeLessThan(10_000);
    expect(changes.changes).toHaveLength(1500);
    expect(changes.changes.every((change) => change.type === 'renamed')).toBe(true);
    // Among equal hashes the lexicographically first deleted path pairs with the first added path.
    const first = changes.changes.find((change) => change.path === 'new/c0.ts');
    expect(first).toMatchObject({ type: 'renamed', previousPath: 'old/c0.ts' });
    expect(new Set(changes.changes.map((change) => change.previousPath)).size).toBe(1500);
  }, 60_000);
});

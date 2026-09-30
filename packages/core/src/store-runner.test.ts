import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaults, type Config } from './config.js';
import { hash } from './security.js';
import { Store } from './store.js';
import { failureSignature, previewOutput, runCommand, sourceFingerprint } from './runner.js';

const dirs: string[] = []; const stores: Store[] = [];
function fixture(overrides: Partial<Config> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'codebudget-store-')); dirs.push(root);
  const store = new Store(root, { ...defaults(), ...overrides }); stores.push(store); return { root, store };
}
// Windows can briefly keep a just-closed database or child working directory locked.
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
const node = (script: string) => ({ executable: process.execPath, args: ['-e', script] });

describe('evidence storage', () => {
  it('migrates a schema v2 database in place and keeps line-addressed evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'codebudget-migrate-')); dirs.push(root);
    mkdirSync(join(root, '.codebudget'));
    const legacy = new DatabaseSync(join(root, '.codebudget/state.sqlite'));
    legacy.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY, repo TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE artifacts(id TEXT PRIMARY KEY, repo TEXT NOT NULL, session TEXT REFERENCES sessions(id), json TEXT NOT NULL);
      CREATE TABLE chunks(artifact TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, seq INTEGER NOT NULL, stream TEXT NOT NULL, time TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(artifact,seq));
      CREATE TABLE runs(id TEXT PRIMARY KEY, repo TEXT NOT NULL, session TEXT REFERENCES sessions(id), created TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE events(id TEXT PRIMARY KEY, repo TEXT NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL);
      PRAGMA user_version=2;`);
    const real = realpathSync(root); const repo = hash(process.platform === 'win32' ? real.toLowerCase() : real);
    const artifact = { id: 'legacy-artifact', repositoryId: repo, sessionId: null, kind: 'command', createdAt: new Date().toISOString(), redacted: true, truncated: false, complete: true, sizeBytes: 12, hash: null, metadata: {}, expiresAt: new Date(Date.now() + 86400000).toISOString() };
    legacy.prepare('INSERT INTO artifacts VALUES (?,?,?,?)').run(artifact.id, repo, null, JSON.stringify(artifact));
    ['one\n', 'two\n', 'three\n'].forEach((line, seq) => legacy.prepare('INSERT INTO chunks(artifact,seq,stream,time,text) VALUES (?,?,?,?,?)').run(artifact.id, seq, 'stdout', 't', line));
    legacy.prepare('INSERT INTO events(id,repo,kind,json) VALUES (?,?,?,?)').run('e1', repo, 'hook', JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z' }));
    legacy.close();
    const store = new Store(root, defaults()); stores.push(store);
    expect(Number(store.db.prepare('PRAGMA user_version').get()?.user_version)).toBe(3);
    const page = store.readEvidence(artifact.id, 1, 1);
    expect(page.chunks.map(chunk => chunk.text)).toEqual(['two\n']); expect(page.nextOffset).toBe(2);
    expect(store.db.prepare('SELECT created FROM events WHERE id=?').get('e1')?.created).toBe('2026-01-01T00:00:00.000Z');
    store.db.exec('PRAGMA user_version=4'); store.close(); stores.pop();
    expect(() => new Store(root, defaults())).toThrow('newer CodeBudget');
  });

  it('stores many small writes as compact blocks while paging by line', () => {
    const { store } = fixture();
    const artifact = store.createArtifact();
    for (let index = 0; index < 400; index++) store.append(artifact.id, 'stdout', `line ${index}\n`.repeat(25));
    store.finishArtifact(artifact.id);
    const rows = Number(store.db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE artifact=?').get(artifact.id)?.n);
    expect(rows).toBeLessThanOrEqual(400); expect(rows).toBeGreaterThan(0);
    const page = store.readEvidence(artifact.id, 30, 3);
    expect(page.chunks.map(chunk => [chunk.seq, chunk.text])).toEqual([[30, 'line 1\n'], [31, 'line 1\n'], [32, 'line 1\n']]);
    expect(page.nextOffset).toBe(33);
    expect(store.artifactText(artifact.id)).toBe(Array.from({ length: 400 }, (_, index) => `line ${index}\n`.repeat(25)).join(''));
  });

  it('bounds evidence pages and returns a slim header without chunk timing detail', async () => {
    const { store } = fixture();
    // Many separate writes without timers: a zero-delay interval runs at the OS timer resolution (about 16 ms on Windows).
    const result = await runCommand(store, node('let i=0;const step=()=>{process.stdout.write(`line ${i}\\n`);if(++i<3000)setImmediate(step)};step()'));
    const page = store.readEvidence(result.artifactId!, 0, 1000);
    const serialized = JSON.stringify(page);
    expect(serialized.length).toBeLessThan(70 * 1024); expect(serialized).not.toContain('chunkOrder'); expect(page.artifact.id).toBe(result.artifactId);
    expect(page.chunks.length).toBeGreaterThan(0);
  });

  it('reclaims old evidence automatically instead of failing permanently at the disk budget', async () => {
    const { store } = fixture({ diskBudgetBytes: 4 * 1024 * 1024 });
    const noisy = node('for (let i = 0; i < 3000; i++) console.log(`line ${i} ` + "x".repeat(60))');
    for (let run = 0; run < 25; run++) {
      const result = await runCommand(store, noisy);
      expect(result.childExitCode).toBe(0); expect(result.archiveError).toBeNull(); expect(result.wrapperError).toBeNull();
    }
    expect(store.physicalBytes()).toBeLessThanOrEqual(0.75 * 4 * 1024 * 1024);
    expect(store.prune(false).sourceFilesAffected).toBe(0);
    const final = await runCommand(store, node('console.log("still works")'));
    expect(final.output).toContain('still works');
  }, 60_000);

  it('keeps reports bounded: run summaries, full totals and details on demand', () => {
    const { store } = fixture();
    for (let index = 0; index < 230; index++) store.recordRun({ id: `run-${index}`, status: 'success', exitCode: 0, originalSize: 100, reducedSize: 40, output: 'x'.repeat(40000), chunkOrder: Array.from({ length: 2000 }, (_, seq) => ({ seq, stream: 'stdout', bytes: 1, elapsedMs: 1 })) });
    const report = store.report();
    expect(report.runs).toHaveLength(200); expect(report.runCount).toBe(230);
    expect(report.localOutput).toMatchObject({ originalBytes: 23000, reducedBytes: 9200 });
    expect(JSON.stringify(report.runs)).not.toContain('xxxxxxxx'); expect(JSON.stringify(report).length).toBeLessThan(200 * 1024);
    const detail = store.run('run-7');
    expect(detail.outputStoredTruncated).toBe(true); expect((detail.chunkOrder as unknown[]).length).toBe(512);
    store.recordEvent('context', { id: 'package-1', purpose: 'Fix auth', status: 'ready', sources: [{ path: 'a.ts', code: 'y'.repeat(50000) }], tokenMeasurement: { tokens: 10 } });
    expect(store.report().contextPackages[0]).toMatchObject({ id: 'package-1', purpose: 'Fix auth', sourceCount: 1, detail: 'summary' });
    expect(JSON.stringify(store.contextPackage('package-1'))).toContain('yyyy');
  });
});

describe('argv runner behaviour', () => {
  it('recognizes a repeated failure even when durations and clock times differ', async () => {
    const { root, store } = fixture(); writeFileSync(join(root, 'a.ts'), 'export const a = 1;');
    const failing = node('console.log("FAIL auth.test.ts > rejects reuse");console.log(`Duration ${(Math.random()*3).toFixed(2)}s at ${new Date().toISOString()}`);process.exitCode = 1');
    expect((await runCommand(store, failing)).repeatedFailure).toBe(false);
    expect((await runCommand(store, failing)).repeatedFailure).toBe(true);
    expect(failureSignature('Duration 1.20s')).toBe(failureSignature('Duration 2.75s'));
  });

  it('does not claim an unchanged source state when the walk is incomplete', () => {
    const root = mkdtempSync(join(tmpdir(), 'codebudget-fingerprint-')); dirs.push(root);
    for (let index = 0; index < 20; index++) writeFileSync(join(root, `f${index}.ts`), 'x');
    expect(sourceFingerprint(root, 10).complete).toBe(false); expect(sourceFingerprint(root).complete).toBe(true);
    mkdirSync(join(root, 'src/build'), { recursive: true }); const before = sourceFingerprint(root).value;
    writeFileSync(join(root, 'src/build/compile.ts'), 'export const compile = 1;');
    expect(sourceFingerprint(root).value).not.toBe(before);
  });

  it('shows failures and both ends of long output in balanced mode and leaves observe output unchanged', async () => {
    const script = 'for (let i = 0; i < 80; i++) { console.log(" FAIL tests/case" + i + ".test.ts > rejects case " + i); console.log("   " + "noise ".repeat(150)); } console.log(" Tests  80 failed (80)"); process.exitCode = 1';
    const balanced = fixture({ mode: 'balanced' }).store;
    const result = await runCommand(balanced, node(script));
    expect(result.output).toContain('rejects case 0'); expect(result.output).toContain('rejects case 40'); expect(result.output).toContain('Tests  80 failed');
    expect(result.displayedSize).toBe(Buffer.byteLength(result.output)); expect(result.reducedSize).toBe(result.displayedSize);
    expect(result.displayedSize).toBeLessThanOrEqual(balanced.config.outputPreviewBytes + 1024);
    const observe = fixture().store;
    const observed = await runCommand(observe, node(script));
    expect(observed.output).toBe(observe.artifactText(observed.artifactId!));
    expect(previewOutput('short', 1024, 'id')).toBe('short');
  });

  it('forwards piped input to the command', async () => {
    const { store } = fixture(); const input = new PassThrough(); input.end('piped input\n');
    const result = await runCommand(store, { ...node('let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("got:"+s.trim()))'), stdin: input });
    expect(result.output).toContain('got:piped input');
  });

  it.skipIf(process.platform === 'win32')('gives a timed-out command a graceful termination signal first', async () => {
    const { root, store } = fixture(); const marker = join(root, 'cleanup.marker');
    const result = await runCommand(store, { ...node(`process.on("SIGTERM",()=>{require("fs").writeFileSync(${JSON.stringify(marker)},"clean");process.exit(0)});setInterval(()=>{},1000)`), timeoutMs: 300 });
    expect(result.timedOut).toBe(true); expect(existsSync(marker)).toBe(true); expect(readFileSync(marker, 'utf8')).toBe('clean');
  });
});

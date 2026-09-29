import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults, initialize, loadConfig } from './config.js';
import { Store } from './store.js';
import { redact, redactArguments, safePath, StreamRedactor, sanitize, csvCell, splitUtf8 } from './security.js';
import { runCommand } from './runner.js';
import { parseUsageImport } from './usage.js';

const dirs: string[] = []; const stores: Store[] = [];
function fixture(overrides: Partial<ReturnType<typeof defaults>> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'codebudget-core-')); dirs.push(root);
  const store = new Store(root, { ...defaults(), ...overrides }); stores.push(store); return { root, store };
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('configuration and security', () => {
  it('initializes only local configuration and preserves ignore rules', () => {
    const { root } = fixture(); writeFileSync(join(root, '.gitignore'), 'mine/\n');
    expect(initialize(root).created).toBe(true); expect(initialize(root).created).toBe(false);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('mine/\n.codebudget/\n');
    expect(loadConfig(root).mode).toBe('observe');
    expect(loadConfig(root, { mode: 'balanced' }, { CODEBUDGET_MODE: 'experimental' }).mode).toBe('balanced');
    writeFileSync(join(root, '.codebudget.json'), '{"mdoe":"balanced"}'); expect(() => loadConfig(root)).toThrow();
  });
  it('redacts tokens across UTF8/chunk boundaries and private-key lines', () => {
    const filter = new StreamRedactor();
    expect(filter.feed(Buffer.from('authorization: Bearer sk-this-is-a-'))).toEqual([]);
    expect(filter.feed(Buffer.from('long-secret\n')).join('')).not.toContain('long-secret');
    expect(filter.feed(Buffer.from('-----BEGIN PRIVATE KEY-----\nsecret material\n-----END PRIVATE KEY-----\n')).join('')).not.toContain('material');
    const euro = Buffer.from('€\n'); expect(filter.feed(euro.subarray(0, 1))).toEqual([]);
    expect(filter.feed(euro.subarray(1)).join('')).toBe('€\n');
    expect(redact('src/token.ts:4 function accessTokenCount()')).toContain('accessTokenCount');
    expect(sanitize({ apiKey: 'very-secret', nested: ['password=secret'] })).toEqual({ apiKey: '[REDACTED]', nested: ['password=[REDACTED]'] });
    expect(redact('password="a secret with spaces"')).toBe('password="[REDACTED]"');
    expect(JSON.parse(redact('{"password":"secret value","ok":true}'))).toEqual({ password: '[REDACTED]', ok: true });
  });
  it('fails closed on redactor failure and bounds single-line buffering', () => {
    expect(() => new StreamRedactor(100, () => { throw new Error('injected filter failure'); }).feed(Buffer.from('secret\n'))).toThrow('injected');
    const filter = new StreamRedactor(20); expect(filter.feed(Buffer.from('a'.repeat(100))).join('')).toContain('WITHHELD'); expect(filter.withheld).toBe(true);
    expect(filter.feed(Buffer.from('tail\nok\n')).join('')).toBe('ok\n');
  });
  it('preserves final partial lines and CRLF instead of adding new bytes', () => {
    const filter = new StreamRedactor();
    expect(filter.feed(Buffer.from('first\r\nlast'))).toEqual(['first\r\n']);
    expect(filter.end()).toEqual(['last']);
    const split = splitUtf8('🙂€'.repeat(30000));
    expect(split.every(part => Buffer.byteLength(part) <= 65536)).toBe(true);
    expect(split.join('')).toBe('🙂€'.repeat(30000));
  });
  it('masks values of sensitive flags while preserving nonsensitive argv', () => {
    expect(redactArguments(['--token', 'arbitrary-value', '--api-key=another-value', '--cwd', 'src'])).toEqual(['--token', '[REDACTED ARGUMENT]', '--api-key=[REDACTED ARGUMENT]', '--cwd', 'src']);
  });
  it('rejects traversal, linked data dirs and formula injection', () => {
    const { root } = fixture(); const outside = mkdtempSync(join(tmpdir(), 'cb-outside-')); dirs.push(outside);
    expect(() => safePath(root, '../secret')).toThrow('escapes');
    symlinkSync(outside, join(root, 'linked'), 'junction'); expect(() => safePath(root, 'linked/a')).toThrow('Symlink');
    expect(csvCell('=HYPERLINK("evil")')).toMatch(/^"'/);
  });
});

describe('SQLite evidence and isolation', () => {
  it('keeps usage coverage scoped to the requested local session', () => {
    const { store } = fixture(); const first = store.startSession('first'); const second = store.startSession('second');
    for (const session of [first, second]) {
      const imported = parseUsageImport('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}', { format: 'codex-jsonl', repositoryId: store.repositoryId, clientVersion: '0.139.0', observedAt: '2026-09-29T12:00:00Z', importId: session.id, sessionId: session.id });
      store.addUsage(imported.events[0]!);
    }
    expect(store.report().observedUsage.coverage.analyzedRecords).toBe(2);
    expect(store.report(first.id).observedUsage.coverage).toMatchObject({ analyzedRecords: 1, missing: { localSession: 0 }, groups: [{ recordedDeltaTokens: 15 }] });
    expect(store.report(second.id).observedUsage.coverage.analyzedRecords).toBe(1);
  });
  it('excludes unknown usage sources and returns null when safe individual totals overflow together', () => {
    const { store } = fixture();
    const event = parseUsageImport('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}', { format: 'codex-jsonl', repositoryId: store.repositoryId, clientVersion: '0.139.0', observedAt: '2026-09-29T12:00:00Z', importId: 'known' }).events[0]!;
    store.addUsage(event);
    store.addUsage({ ...event, eventId: 'unknown', correlationId: 'unknown', source: 'future_source' as typeof event.source, total: 77 });
    expect(store.report().observedUsage.total).toBe(15);
    expect(store.report().observedUsage.coverage.counters.unknownSourceRecords).toBe(1);
    store.addUsage({ ...event, eventId: 'large', correlationId: 'large', total: Number.MAX_SAFE_INTEGER });
    expect(store.usage().every(item => Number.isSafeInteger(item.total))).toBe(true);
    expect(store.report().observedUsage.total).toBeNull();
  });
  it('scopes sessions/artifacts, preserves unknown usage and epochs', () => {
    const { store } = fixture(); const second = fixture().store;
    const session = store.startSession('fix auth'); const other = store.startSession('other');
    const artifact = store.putText('secret=hidden\nerror.ts:4\n', { sessionId: session.id });
    expect(artifact.complete).toBe(true); expect(store.artifactText(artifact.id)).not.toContain('hidden');
    expect(() => second.readEvidence(artifact.id)).toThrow('Unknown');
    expect(() => store.readEvidence(artifact.id, 0, 10, other.id)).toThrow('another session');
    expect(store.checkpoint(session.id).epoch).toBe(1);
    expect(store.closeSession(session.id).status).toBe('closed');
    expect(() => store.checkpoint(session.id)).toThrow('closed');
    expect(store.report().observedUsage.total).toBeNull();
    expect(store.report().observedUsage.coverage).toMatchObject({ suppliedRecords: 0, analyzedRecords: 0, coverageRatio: null });
  });
  it('pages evidence and marks quota loss, never touches source files during prune', () => {
    const { root, store } = fixture({ outputMaxBytes: 1024 });
    writeFileSync(join(root, 'keep.ts'), 'const keep = true;');
    const artifact = store.putText('line\n'.repeat(500)); expect(artifact.truncated).toBe(true);
    const first = store.readEvidence(artifact.id, 0, 2); expect(first.chunks).toHaveLength(2); expect(first.nextOffset).toBe(2);
    expect(store.prune(false).sourceFilesAffected).toBe(0); expect(readFileSync(join(root, 'keep.ts'), 'utf8')).toContain('keep');
    expect(() => store.readEvidence('../../keep.ts')).toThrow('Unknown');
  });
  it('opens concurrent connections with real committed evidence and foreign keys', () => {
    const { root, store } = fixture(); const second = new Store(root, defaults()); stores.push(second);
    const artifact = store.putText('one\n'); second.append(artifact.id, 'stderr', 'two\n');
    expect(store.artifactText(artifact.id)).toBe('one\ntwo\n');
    expect(store.getArtifact(artifact.id)).toMatchObject({ complete: false, hash: null });
    expect(store.finishArtifact(artifact.id).complete).toBe(true);
    expect(() => store.db.prepare('INSERT INTO chunks VALUES (?,?,?,?,?)').run('missing', 0, 'stdout', '', '')).toThrow();
    expect(store.db.prepare('PRAGMA quick_check').get()?.quick_check).toBe('ok');
  });
  it('preserves a corrupt database instead of destroying evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'cb-corrupt-')); dirs.push(root); initialize(root);
    writeFileSync(join(root, '.codebudget/state.sqlite'), 'broken-data');
    expect(() => new Store(root, defaults())).toThrow(); expect(readFileSync(join(root, '.codebudget/state.sqlite'), 'utf8')).toBe('broken-data');
  });
  it('pages very long redacted JSON records without stalling or breaking UTF8', () => {
    const { store } = fixture(); const text = JSON.stringify({ source: '🙂'.repeat(100000) });
    const artifact = store.putText(text); let offset: number | null = 0; let recovered = ''; let pages = 0;
    while (offset !== null) { const page = store.readEvidence(artifact.id, offset, 1); expect(page.chunks).toHaveLength(1); recovered += String(page.chunks[0]!.text); offset = page.nextOffset; expect(++pages).toBeLessThan(20); }
    expect(recovered).toBe(text); expect(artifact.complete).toBe(true);
  });
  it('retains raw opt-in privately with a combined quota and cascade prune', () => {
    const { store, root } = fixture({ rawArchive: true, outputMaxBytes: 1024 });
    const artifact = store.putText('password=[REDACTED]\n');
    expect(store.appendPrivateRaw(artifact.id, 'stdout', Buffer.from('password=unmasked\n'))).toBe(true);
    expect(store.appendPrivateRaw(artifact.id, 'stderr', Buffer.from('a'.repeat(2000)))).toBe(false);
    expect(Number(store.db.prepare('SELECT SUM(length(bytes)) AS n FROM private_raw').get()!.n)).toBe(1024);
    expect(JSON.stringify(store.readEvidence(artifact.id))).not.toContain('unmasked'); expect(JSON.stringify(store.report())).not.toContain('unmasked');
    expect(readdirSync(join(root, '.codebudget')).some(file => file.endsWith('.raw'))).toBe(false);
    const updated = store.getArtifact(artifact.id); updated.expiresAt = '2000-01-01T00:00:00.000Z';
    store.db.prepare('UPDATE artifacts SET json=? WHERE id=?').run(JSON.stringify(updated), artifact.id);
    expect(store.prune(true).artifacts[0]!.privateRawBytes).toBe(1024);
    store.prune(false); expect(store.db.prepare('SELECT COUNT(*) AS n FROM private_raw').get()!.n).toBe(0);
  });
  it('refuses raw storage by default and session-filters detail events', () => {
    const { store } = fixture(); const first = store.startSession('first'); const second = store.startSession('second');
    const artifact = store.putText('safe', { sessionId: first.id });
    expect(() => store.appendPrivateRaw(artifact.id, 'stdout', Buffer.from('private'))).toThrow('disabled');
    store.readEvidence(artifact.id); store.recordEvent('hook', { codebudgetSessionId: second.id, detail: 'second-only' });
    store.recordEvent('plugin-overhead', { sessionId: first.id, bytes: 123, estimatedTokens: 41 });
    expect(store.report(first.id).retrievals).toHaveLength(1); expect(store.report(second.id).retrievals).toHaveLength(0);
    expect(store.report(first.id).hookMetrics).toHaveLength(0);
    expect(store.report(first.id).pluginOverhead).toHaveLength(1); expect(store.report(second.id).pluginOverhead).toHaveLength(0);
    expect(store.report(first.id).sessions.map(item => item.id)).toEqual([first.id]);
  });
});

describe('argv runner', () => {
  it('executes only once, preserves code/streams and treats shell syntax as literal argv', async () => {
    const { root, store } = fixture({ mode: 'balanced' });
    const result = await runCommand(store, { executable: process.execPath, args: ['-e', 'process.stdout.write(process.argv[1]);process.stderr.write("failure\\n");process.exit(7)', 'x; echo injected'], cwd: root });
    expect(result.exitCode).toBe(7); expect(result.wrapperError).toBeNull();
    expect(store.artifactText(result.artifactId!)).toContain('x; echo injected');
    expect(new Set(result.chunkOrder.map(c => c.stream)).size).toBe(2);
    store.readEvidence(result.artifactId!); expect(store.runs()).toHaveLength(1);
  });
  it('handles huge stdout, partial line, malformed UTF8 and secret boundaries without unbounded output', async () => {
    const { store } = fixture({ outputMaxBytes: 4096 });
    const result = await runCommand(store, { executable: process.execPath, args: ['-e', 'process.stdout.write("hello\\n".repeat(100000));process.stderr.write(Buffer.from([255]));process.stderr.write("password=hidden")'] });
    expect(result.truncated).toBe(true); expect(store.getArtifact(result.artifactId!).sizeBytes).toBeLessThanOrEqual(4096);
    expect(store.artifactText(result.artifactId!)).not.toContain('hidden');
  });
  it('separates spawn failure, timeout and explicit cancellation', async () => {
    const { store } = fixture();
    const missing = await runCommand(store, { executable: 'codebudget-missing-executable-12345', args: [] });
    expect(missing.commandStarted).toBe(false); expect(missing.wrapperError).toBeTruthy(); expect(missing.childExitCode).not.toBe(0);
    const slow = await runCommand(store, { executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 150 });
    expect(slow.timedOut).toBe(true); expect(slow.status).toBe('failure');
    const controller = new AbortController(); const promise = runCommand(store, { executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], signal: controller.signal });
    setTimeout(() => controller.abort(), 150); expect((await promise).cancelled).toBe(true);
  });
  it('detects repeated unchanged failures but permits them and invalidates on source edit', async () => {
    const { root, store } = fixture(); writeFileSync(join(root, 'a.ts'), 'export const a=1;');
    const options = { executable: process.execPath, args: ['-e', 'console.error("failed");process.exit(1)'] };
    expect((await runCommand(store, options)).repeatedFailure).toBe(false);
    expect((await runCommand(store, options)).repeatedFailure).toBe(true);
    writeFileSync(join(root, 'a.ts'), 'export const a=2;'); expect((await runCommand(store, options)).repeatedFailure).toBe(false);
  });
  it('catches injected SQLite disk failure without exposing output', async () => {
    const { store } = fixture(); store.append = () => { throw new Error('SQLITE_FULL injected'); };
    const result = await runCommand(store, { executable: process.execPath, args: ['-e', 'console.log("api_key=supersecret");setTimeout(()=>{},5000)'] });
    expect(result.wrapperError).toContain('SQLITE_FULL'); expect(result.truncated).toBe(true); expect(result.output).not.toContain('supersecret');
  });
  it('stores exact unterminated output and keeps raw bytes separate from model evidence', async () => {
    const { store } = fixture({ rawArchive: true });
    const result = await runCommand(store, { executable: process.execPath, args: ['-e', 'process.stdout.write("password=private")'] });
    expect(store.artifactText(result.artifactId!)).toBe('password=[REDACTED]');
    const row = store.db.prepare('SELECT bytes FROM private_raw WHERE artifact=?').get(result.artifactId!);
    expect(Buffer.from(row!.bytes as Uint8Array).toString()).toBe('password=private'); expect(result.rawArchiveTruncated).toBe(false);
    expect(JSON.stringify(result)).not.toContain('password=private');
  });
  it('preserves child status when artifact finalization or report recording fails', async () => {
    const { store } = fixture(); store.finishArtifact = () => { throw new Error('SQLITE_FULL finalization'); }; store.recordRun = () => { throw new Error('SQLITE_FULL record'); };
    const result = await runCommand(store, { executable: process.execPath, args: ['-e', 'console.log("secret=private");process.exit(9)'] });
    expect(result.childExitCode).toBe(9); expect(result.status).toBe('failure'); expect(result.wrapperError).toContain('finalization'); expect(result.output).not.toContain('private');
  });
  it('times out even when a machine sink never releases backpressure', async () => {
    const { store } = fixture(); const sink = new Writable({ highWaterMark: 1, write(_chunk, _encoding, _callback) { /* Simulate a stuck downstream pipe. */ } });
    const result = await runCommand(store, { executable: process.execPath, args: ['-e', 'process.stdout.write("abc");setInterval(()=>{},1000)'], consumer: 'machine', stdout: sink, timeoutMs: 150 });
    expect(result.timedOut).toBe(true); sink.destroy();
  });
});

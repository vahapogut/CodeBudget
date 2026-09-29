import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { delimiter, join, relative } from 'node:path';
import { once } from 'node:events';
import { reduceOutput, type ReductionResult } from '../../reducers/src/index.js';
import { bytes, hash, isSensitivePath, redact, redactArguments, safePath, StreamRedactor } from './security.js';
import type { Store } from './store.js';

export interface RunOptions {
  executable: string; args: string[]; cwd?: string; sessionId?: string;
  timeoutMs?: number; signal?: AbortSignal; format?: Parameters<typeof reduceOutput>[0]['format'];
  consumer?: 'agent' | 'machine'; stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream;
  interactive?: boolean;
}
export interface RunResult extends ReductionResult {
  id: string; sessionId: string | null; executable: string; args: string[]; cwd: string;
  signal: NodeJS.Signals | null; timedOut: boolean; cancelled: boolean; durationMs: number;
  wrapperError: string | null; commandStarted: boolean; childExitCode: number | null;
  chunkOrder: { seq: number; stream: string; bytes: number; elapsedMs: number }[];
  chunkOrderTruncated: boolean; rawObservedBytes: number; repeatedFailure: boolean;
  sourceFingerprint: string; commandKey: string;
  rawArchiveTruncated: boolean;
}

/** Invoke package-manager JS directly on Windows, never concatenate a shell command. */
function resolveCommand(executable: string, args: string[]): [string, string[]] {
  if (process.platform !== 'win32' || !/^(?:pnpm|npm|npx)(?:\.cmd)?$/i.test(executable)) return [executable, args];
  const name = executable.replace(/\.cmd$/i, '').toLowerCase();
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const candidates = name === 'pnpm' ? [join(dir, 'node_modules/pnpm/bin/pnpm.cjs'), join(dir, 'pnpm.cjs')] : [join(dir, `node_modules/npm/bin/${name}-cli.js`)];
    for (const file of candidates) if (existsSync(file)) return [process.execPath, [file, ...args]];
  }
  throw new Error(`Cannot safely resolve ${name} on Windows. Pass node and its package-manager JS entry explicitly.`);
}

function sourceFingerprint(root: string): string {
  const hashes: string[] = [];
  let count = 0;
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(dir, item.name); const rel = relative(root, file);
      if (item.isSymbolicLink() || isSensitivePath(rel)) continue;
      if (++count > 10000) { hashes.push('[fingerprint-incomplete]'); return; }
      if (item.isDirectory()) walk(file);
      else if (/\.(?:[cm]?[jt]sx?|json|py|rs|go|java|cs|sh|yml|yaml)$/.test(file)) {
        const stat = statSync(file); if (stat.size < 1024 * 1024) hashes.push(`${rel}:${hash(readFileSync(file))}`);
      }
    }
  };
  walk(root); return hash(hashes.join('\n'));
}

export async function runCommand(store: Store, options: RunOptions): Promise<RunResult> {
  if (!options.executable || options.executable.includes('\0') || options.args.some(a => a.includes('\0'))) throw new Error('Invalid executable/argv');
  if (options.sessionId) store.assertSession(options.sessionId);
  if (options.interactive) throw new Error('TTY optimization is unsupported; run the original command directly.');
  const cwd = safePath(store.root, options.cwd ?? '.');
  const timeoutMs = options.timeoutMs ?? store.config.commandTimeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 86400000) throw new Error('timeout must be 1..86400000 ms');
  const id = randomUUID(); const start = performance.now();
  const safeArgs = redactArguments(options.args);
  const artifact = store.createArtifact({ sessionId: options.sessionId, kind: 'command', metadata: { executable: redact(options.executable), args: safeArgs, cwd } });
  const fingerprint = sourceFingerprint(store.root);
  let wrapperError: string | null = null; let code: number | null = null; let signal: NodeJS.Signals | null = null;
  let timedOut = false; let cancelled = false; let commandStarted = false; let rawObservedBytes = 0;
  let chunkOrderTruncated = false; let quotaHit = false; let rawArchiveTruncated = false;
  const chunkOrder: RunResult['chunkOrder'] = [];
  const filters = { stdout: new StreamRedactor(), stderr: new StreamRedactor() };
  try {
    const [command, args] = resolveCommand(options.executable, options.args);
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const completion = new Promise<void>(resolve => {
      child.once('spawn', () => { commandStarted = true; });
      child.once('error', error => { wrapperError = redact(error.message); });
      child.once('close', (exitCode, exitSignal) => { code = exitCode; signal = exitSignal; resolve(); });
    });
    const ioAbort = new AbortController();
    const terminate = (): void => {
      ioAbort.abort(new Error('Command output processing cancelled'));
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { child.kill('SIGKILL'); });
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const abort = (): void => { cancelled = true; terminate(); };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) child.once('spawn', abort);
    const pumps = (['stdout', 'stderr'] as const).map(async stream => {
      try {
        for await (const value of child[stream]) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          rawObservedBytes += chunk.length;
          if (chunkOrder.length < 4096) chunkOrder.push({ seq: chunkOrder.length, stream, bytes: chunk.length, elapsedMs: performance.now() - start }); else chunkOrderTruncated = true;
          if (options.consumer === 'machine') {
            const sink = options[stream]; if (sink && !sink.write(chunk)) await once(sink, 'drain', { signal: ioAbort.signal });
          }
          const masked = filters[stream].feed(chunk).join('');
          if (masked && !quotaHit && !store.append(artifact.id, stream, masked)) quotaHit = true;
          if (store.config.rawArchive && !rawArchiveTruncated && !store.appendPrivateRaw(artifact.id, stream, chunk)) rawArchiveTruncated = true;
        }
        const tail = filters[stream].end().join('');
        if (tail && !quotaHit && !store.append(artifact.id, stream, tail)) quotaHit = true;
      } catch (error) { if (!timedOut && !cancelled) wrapperError ??= redact(String(error)); terminate(); }
    });
    try { await Promise.all([completion, ...pumps]); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  } catch (error) { wrapperError = redact(String(error)); }
  let truncated = quotaHit || filters.stdout.withheld || filters.stderr.withheld || wrapperError !== null || timedOut || cancelled || signal !== null;
  try { store.finishArtifact(artifact.id, { truncated, metadata: { exitCode: code, signal, timedOut, cancelled, rawOptIn: store.config.rawArchive, rawArchiveTruncated, chunkOrder, chunkOrderTruncated } }); }
  catch (error) { wrapperError ??= redact(`Artifact finalization failed: ${String(error)}`); truncated = true; }
  let storedText = '';
  try { storedText = store.artifactText(artifact.id); } catch (error) { wrapperError ??= redact(`Artifact read failed: ${String(error)}`); truncated = true; }
  const reduction = reduceOutput({ text: storedText, exitCode: code, artifactId: artifact.id, mode: store.config.mode, truncated, format: options.format, consumer: options.consumer });
  // Reduced data is for agent display; machine consumers received their original byte streams already.
  if (bytes(reduction.output) > store.config.outputPreviewBytes) {
    reduction.output = `[Paged evidence ${artifact.id}; ${bytes(storedText)} redacted bytes; exit ${code ?? 'unknown'}; signal ${signal ?? 'none'}; truncated=${truncated}. Use codebudget artifact read ${artifact.id} --offset 0 --limit 200.]`;
    reduction.detailsAvailable = true;
    reduction.reason = 'Display limit; full retained evidence is paged. This is not a semantic savings measurement.';
  }
  const commandKey = hash(JSON.stringify({ executable: options.executable, args: options.args, cwd }));
  const signature = hash(storedText);
  const repeatedFailure = code !== 0 && store.runs(options.sessionId).some(run => run.commandKey === commandKey && run.sourceFingerprint === fingerprint && run.errorSignature === signature);
  const result: RunResult = { ...reduction, id, sessionId: options.sessionId ?? null, executable: redact(options.executable), args: safeArgs, cwd, signal, timedOut, cancelled,
    durationMs: performance.now() - start, wrapperError, commandStarted, childExitCode: code, chunkOrder, chunkOrderTruncated, rawObservedBytes, rawArchiveTruncated, repeatedFailure, sourceFingerprint: fingerprint, commandKey };
  if (wrapperError || timedOut || cancelled || signal) result.status = 'failure';
  try { store.recordRun({ ...result, errorSignature: signature }); }
  catch (error) { result.wrapperError ??= redact(`Run recording failed: ${String(error)}`); result.status = 'failure'; }
  return result;
}

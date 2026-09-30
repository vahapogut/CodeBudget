import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { once } from 'node:events';
import { reduceOutput, type ReductionResult } from '../../reducers/src/index.js';
import { bytes, classifyRepositoryPath, hash, PACKAGE_MANIFESTS, redact, redactArguments, safePath, StreamRedactor } from './security.js';
import type { Store } from './store.js';

export interface RunOptions {
  executable: string; args: string[]; cwd?: string; sessionId?: string;
  timeoutMs?: number; signal?: AbortSignal; format?: Parameters<typeof reduceOutput>[0]['format'];
  consumer?: 'agent' | 'machine'; stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream;
  /** Forwarded to the command's stdin (for example a piped, non-TTY CLI stdin). Omitted means no input. */
  stdin?: NodeJS.ReadableStream;
  interactive?: boolean;
}
export interface RunResult extends ReductionResult {
  id: string; sessionId: string | null; executable: string; args: string[]; cwd: string;
  signal: NodeJS.Signals | null; timedOut: boolean; cancelled: boolean; durationMs: number;
  wrapperError: string | null; commandStarted: boolean; childExitCode: number | null;
  /** Evidence storage failed; the command itself was allowed to finish. */
  archiveError: string | null;
  /** UTF-8 bytes of the text actually returned for display. */
  displayedSize: number;
  chunkOrder: { seq: number; stream: string; bytes: number; elapsedMs: number }[];
  chunkOrderTruncated: boolean; rawObservedBytes: number; repeatedFailure: boolean;
  sourceFingerprint: string; sourceFingerprintComplete: boolean; commandKey: string;
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

const FINGERPRINT_EXTENSIONS = /\.(?:[cm]?[jt]sx?|json|py|rs|go|java|kts?|cs|rb|php|swift|c|cc|cpp|h|hpp|sh|ya?ml|toml)$/i;
const FINGERPRINT_LIMIT = 50_000;
/**
 * Source-state identity from path, size and mtime (content hashes only for files modified in the
 * last two seconds, where coarse timestamps are ambiguous). An incomplete walk never supports an
 * "unchanged" claim.
 */
export function sourceFingerprint(root: string, limit = FINGERPRINT_LIMIT): { value: string; complete: boolean } {
  const parts: string[] = []; let count = 0; let complete = true; const recent = Date.now() - 2000;
  const walk = (directory: string, relativeDirectory: string): void => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { complete = false; return; }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const packageRoot = entries.some(entry => entry.isFile() && PACKAGE_MANIFESTS.includes(entry.name));
    for (const entry of entries) {
      if (!complete) return;
      const path = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (classifyRepositoryPath(path, { directory: true, isPackageRoot: parent => parent === relativeDirectory && packageRoot }) === null) walk(join(directory, entry.name), path);
      } else if (entry.isFile() && FINGERPRINT_EXTENSIONS.test(entry.name) && classifyRepositoryPath(path) === null) {
        if (++count > limit) { complete = false; return; }
        try {
          const file = join(directory, entry.name); const stat = statSync(file);
          parts.push(`${path}\0${stat.size}\0${Math.trunc(stat.mtimeMs)}${stat.mtimeMs >= recent && stat.size < 1024 * 1024 ? `\0${hash(readFileSync(file))}` : ''}`);
        } catch { complete = false; return; }
      }
    }
  };
  walk(root, '');
  return { value: hash(parts.join('\n')), complete };
}

/** Failure identity that ignores run-to-run noise: durations, clock times, addresses, pids, temp paths. */
export function failureSignature(text: string): string {
  return hash(text
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g, '<time>')
    .replace(/\b\d+(?:[.,]\d+)?\s?(?:ms|s|sec|secs|seconds|m|min|µs|us|ns)\b/gi, '<duration>')
    .replace(/\b0x[0-9a-f]{6,}\b/gi, '<address>')
    .replace(/\bpid[=: ]?\d+\b/gi, 'pid <n>')
    .replace(/(?:\/tmp|\/var\/folders|[A-Za-z]:\\Users\\[^\\\s]+\\AppData\\Local\\Temp)[^\s:'"]*/g, '<temp>')
    .replace(/[ \t]+$/gm, ''));
}

const DIAGNOSTIC_LINE = /\b(?:errors?|fail(?:ed|ure|ures|ing)?|exception|panic|fatal|assert(?:ion)?|expected|received|warning|traceback|denied|not found|timed? ?out)\b|^\s*(?:FAIL|ERROR|E\s|[✗×✕●❯]|at\s.+:\d+)/i;
/**
 * Bounded display for agent consumers: head, diagnostic lines from the omitted middle (with line
 * numbers) and tail. The complete masked output stays in the evidence archive.
 */
export function previewOutput(text: string, limit: number, artifactId: string | null): string {
  if (bytes(text) <= limit) return text;
  const lines = text.split('\n'); const headBudget = Math.floor(limit * 0.35); const tailBudget = Math.floor(limit * 0.35);
  const diagnosticBudget = Math.max(0, limit - headBudget - tailBudget - 512);
  let head = 0; let used = 0;
  while (head < lines.length && used + bytes(lines[head]!) + 1 <= headBudget) used += bytes(lines[head++]!) + 1;
  let tail = lines.length; used = 0;
  while (tail > head && used + bytes(lines[tail - 1]!) + 1 <= tailBudget) used += bytes(lines[--tail]!) + 1;
  const excerpt: string[] = []; used = 0;
  for (let index = head; index < tail; index++) {
    const line = lines[index]!;
    if (!DIAGNOSTIC_LINE.test(line)) continue;
    const entry = `${index + 1}: ${line}`; const size = bytes(entry) + 1;
    if (used + size > diagnosticBudget) break;
    excerpt.push(entry); used += size;
  }
  const retrieve = artifactId ? ` Full evidence: codebudget artifact read ${artifactId} --offset ${head} --limit 200 (or MCP read_evidence).` : '';
  return [...lines.slice(0, head), `[CodeBudget display limit: lines ${head + 1}-${tail} omitted; ${excerpt.length} diagnostic lines from that range follow with their line numbers.${retrieve}]`,
    ...excerpt, '[CodeBudget: end of diagnostic excerpt; output resumes]', ...lines.slice(tail)].join('\n');
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
  let wrapperError: string | null = null; let archiveError: string | null = null; let code: number | null = null; let signal: NodeJS.Signals | null = null;
  let timedOut = false; let cancelled = false; let commandStarted = false; let rawObservedBytes = 0;
  let chunkOrderTruncated = false; let quotaHit = false; let rawArchiveTruncated = false;
  const chunkOrder: RunResult['chunkOrder'] = [];
  const filters = { stdout: new StreamRedactor(), stderr: new StreamRedactor() };
  // Masked text is batched into blocks; stream switches flush first so arrival order is preserved.
  const pending: { stream: 'stdout' | 'stderr' | null; text: string; size: number } = { stream: null, text: '', size: 0 };
  // In-memory fallback view (masked) in case the evidence store fails mid-run.
  const fallback = { head: '', tail: '', limit: Math.floor(store.config.outputPreviewBytes / 2), omitted: false };
  const archive = (stream: 'stdout' | 'stderr', text: string): void => {
    if (archiveError || quotaHit) return;
    try { if (!store.append(artifact.id, stream, text)) quotaHit = true; }
    catch (error) { archiveError = redact(`Evidence archive unavailable: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const flush = (): void => { if (pending.stream && pending.text) archive(pending.stream, pending.text); pending.stream = null; pending.text = ''; pending.size = 0; };
  const enqueue = (stream: 'stdout' | 'stderr', text: string): void => {
    if (!text) return;
    const room = Math.max(0, fallback.limit - fallback.head.length);
    fallback.head += text.slice(0, room);
    const rest = text.slice(room);
    if (rest) { fallback.omitted ||= fallback.tail.length + rest.length > fallback.limit; fallback.tail = (fallback.tail + rest).slice(-fallback.limit); }
    if (pending.stream !== stream) flush();
    pending.stream = stream; pending.text += text; pending.size += bytes(text);
    if (pending.size >= 16 * 1024) flush();
  };
  try {
    const [command, args] = resolveCommand(options.executable, options.args);
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: [options.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    if (options.stdin && child.stdin) {
      // A command may exit without reading its input; that is not a wrapper failure.
      child.stdin.on('error', () => undefined);
      options.stdin.pipe(child.stdin);
    }
    const completion = new Promise<void>(resolve => {
      child.once('spawn', () => { commandStarted = true; });
      child.once('error', error => { wrapperError = redact(error.message); });
      child.once('close', (exitCode, exitSignal) => { code = exitCode; signal = exitSignal; resolve(); });
    });
    const ioAbort = new AbortController();
    let terminating = false; let forceTimer: NodeJS.Timeout | undefined;
    const terminate = (): void => {
      ioAbort.abort(new Error('Command output processing cancelled'));
      if (!child.pid || terminating) return;
      terminating = true;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { child.kill('SIGKILL'); });
        return;
      }
      // Give the process group a short grace period, then force the whole tree down.
      const pid = child.pid;
      try { process.kill(-pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      forceTimer = setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 2000);
      forceTimer.unref();
    };
    const abort = (): void => { cancelled = true; terminate(); };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) child.once('spawn', abort);
    const pumps = (['stdout', 'stderr'] as const).map(async stream => {
      try {
        for await (const value of child[stream]!) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          rawObservedBytes += chunk.length;
          if (chunkOrder.length < 4096) chunkOrder.push({ seq: chunkOrder.length, stream, bytes: chunk.length, elapsedMs: performance.now() - start }); else chunkOrderTruncated = true;
          if (options.consumer === 'machine') {
            const sink = options[stream]; if (sink && !sink.write(chunk)) await once(sink, 'drain', { signal: ioAbort.signal });
          }
          enqueue(stream, filters[stream].feed(chunk).join(''));
          if (store.config.rawArchive && !rawArchiveTruncated && !archiveError) {
            try { if (!store.appendPrivateRaw(artifact.id, stream, chunk)) rawArchiveTruncated = true; }
            catch (error) { rawArchiveTruncated = true; archiveError ??= redact(`Private raw archive unavailable: ${error instanceof Error ? error.message : String(error)}`); }
          }
        }
        enqueue(stream, filters[stream].end().join(''));
      } catch (error) {
        // Only a failing output sink (for example a closed machine pipe) stops the command.
        if (!timedOut && !cancelled) wrapperError ??= redact(String(error));
        terminate();
      }
    });
    try { await Promise.all([completion, ...pumps]); }
    finally {
      clearTimeout(timer); if (forceTimer && code !== null) clearTimeout(forceTimer);
      options.signal?.removeEventListener('abort', abort);
      if (options.stdin && child.stdin) options.stdin.unpipe(child.stdin);
    }
  } catch (error) { wrapperError = redact(String(error)); }
  flush();
  let truncated = quotaHit || archiveError !== null || filters.stdout.withheld || filters.stderr.withheld || wrapperError !== null || timedOut || cancelled || signal !== null;
  const chunkSummary = (['stdout', 'stderr'] as const).map(stream => ({ stream, chunks: chunkOrder.filter(item => item.stream === stream).length, bytes: chunkOrder.filter(item => item.stream === stream).reduce((sum, item) => sum + item.bytes, 0) }));
  try { store.finishArtifact(artifact.id, { truncated, metadata: { exitCode: code, signal, timedOut, cancelled, rawOptIn: store.config.rawArchive, rawArchiveTruncated, chunkSummary: { streams: chunkSummary, recorded: chunkOrder.length, truncated: chunkOrderTruncated } } }); }
  catch (error) { archiveError ??= redact(`Artifact finalization failed: ${String(error)}`); truncated = true; }
  let storedText = '';
  if (archiveError) storedText = fallback.head + (fallback.omitted ? `\n[CodeBudget: evidence archive failed; middle of the output was not retained]\n${fallback.tail}` : fallback.tail);
  else {
    try { storedText = store.artifactText(artifact.id); }
    catch (error) { archiveError = redact(`Artifact read failed: ${String(error)}`); truncated = true; storedText = fallback.head + fallback.tail; }
  }
  const reduction = reduceOutput({ text: storedText, exitCode: code, artifactId: archiveError ? undefined : artifact.id, mode: store.config.mode, truncated, format: options.format, consumer: options.consumer });
  // Observe mode returns the retained masked output unchanged; other modes get a bounded view.
  if (store.config.mode !== 'observe' && options.consumer !== 'machine' && bytes(reduction.output) > store.config.outputPreviewBytes) {
    reduction.output = previewOutput(reduction.output, store.config.outputPreviewBytes, archiveError ? null : artifact.id);
    reduction.detailsAvailable = !archiveError;
    reduction.reason = 'display_preview';
    reduction.summary = `Display preview of ${bytes(storedText)} retained bytes; diagnostics and both ends shown. Not a semantic savings measurement.`;
  }
  if (truncated) reduction.output += `${reduction.output.endsWith('\n') || !reduction.output ? '' : '\n'}[CodeBudget: evidence is incomplete (${archiveError ?? (quotaHit ? 'output or disk budget reached' : timedOut ? 'timed out' : cancelled ? 'cancelled' : signal ? `signal ${signal}` : 'truncated')}).]\n`;
  const displayedSize = bytes(reduction.output);
  reduction.reducedSize = displayedSize;
  reduction.estimatedTokens = { ...reduction.estimatedTokens, reduced: Math.ceil(displayedSize / 3) };
  const commandKey = hash(JSON.stringify({ executable: options.executable, args: options.args, cwd }));
  const signature = failureSignature(storedText);
  const fingerprint = code !== 0 ? sourceFingerprint(store.root) : { value: '', complete: false };
  let repeatedFailure = false;
  try { repeatedFailure = code !== 0 && fingerprint.complete && !archiveError && store.hasMatchingFailure({ sessionId: options.sessionId, commandKey, sourceFingerprint: fingerprint.value, errorSignature: signature }); }
  catch { repeatedFailure = false; }
  const result: RunResult = { ...reduction, id, sessionId: options.sessionId ?? null, executable: redact(options.executable), args: safeArgs, cwd, signal, timedOut, cancelled,
    durationMs: performance.now() - start, wrapperError, archiveError, displayedSize, commandStarted, childExitCode: code, chunkOrder, chunkOrderTruncated, rawObservedBytes, rawArchiveTruncated, repeatedFailure,
    sourceFingerprint: fingerprint.value, sourceFingerprintComplete: fingerprint.complete, commandKey };
  if (wrapperError || timedOut || cancelled || signal) result.status = 'failure';
  try { store.recordRun({ ...result, errorSignature: signature }); }
  catch (error) { result.archiveError ??= redact(`Run recording failed: ${String(error)}`); }
  return result;
}

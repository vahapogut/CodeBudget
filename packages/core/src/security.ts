/* eslint-disable no-control-regex -- explicitly remove terminal control characters */
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, existsSync, realpathSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export const SECURITY_VERSION = 'redaction-2';
export const hash = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
export const bytes = (text: string): number => Buffer.byteLength(text, 'utf8');
export const estimateTokens = (text: string): number => Math.ceil(bytes(text) / 3);
export function sanitize<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map(sanitize) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), /(?:secret|password|api[_-]?key|(?:access|refresh)[_-]?token|authorization|cookie)/i.test(key) && typeof item === 'string' ? '[REDACTED]' : sanitize(item)])) as T;
  return value;
}
export const safeJson = (value: unknown): string => JSON.stringify(sanitize(value));

/** Redact argv values paired with sensitive flags before storing command metadata. */
export function redactArguments(args: readonly string[]): string[] {
  let hideNext = false;
  return args.map((arg) => {
    if (hideNext) { hideNext = false; return '[REDACTED ARGUMENT]'; }
    const sensitive = /^--?(?:[A-Za-z0-9_-]*(?:token|password|passwd|secret|api[-_]?key|authorization|cookie)|credential)(?:=|$)/i;
    if (sensitive.test(arg)) {
      const equals = arg.indexOf('=');
      if (equals >= 0) return `${arg.slice(0, equals + 1)}[REDACTED ARGUMENT]`;
      hideNext = true; return redact(arg);
    }
    return redact(arg);
  });
}

/** Split already-redacted text only; no split occurs inside a UTF-8 code point. */
export function splitUtf8(text: string, maximumBytes = 64 * 1024): string[] {
  if (!Number.isInteger(maximumBytes) || maximumBytes < 4) throw new Error('UTF-8 chunk limit must be at least 4 bytes');
  const encoded = Buffer.from(text, 'utf8'); const chunks: string[] = [];
  for (let start = 0; start < encoded.length;) {
    let end = Math.min(start + maximumBytes, encoded.length);
    while (end < encoded.length && (encoded[end]! & 0xc0) === 0x80) end--;
    chunks.push(encoded.subarray(start, end).toString('utf8')); start = end;
  }
  return chunks;
}

/** Pattern detection is defense in depth, not a guarantee against all secrets. */
export function redact(text: string): string {
  if (typeof text !== 'string') throw new Error('Redaction requires text');
  return text
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
    .replace(/(\b(?:[A-Za-z0-9_]*(?:api[_-]?key|secret|password|access[_-]?token|refresh[_-]?token)|cookie|set-cookie)\s*["']?\s*[:=]\s*)(["'])(?:\\.|(?!\2)[\s\S])*?\2/gi, '$1$2[REDACTED]$2')
    .replace(/((?:authorization|proxy-authorization)\s*[:=]\s*["']?(?:Bearer|Basic)\s+)[^\s"',;}]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:[A-Za-z0-9_]*(?:api[_-]?key|secret|password|access[_-]?token|refresh[_-]?token)|cookie|set-cookie)\s*["']?\s*[:=]\s*)(?!["'])[^\s"',;}]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1[REDACTED]@');
}

export function isSensitivePath(path: string): boolean {
  return /(?:^|[\\/])(?:\.env(?:\..*)?|\.git|\.ssh|node_modules|vendor|dist|build|coverage|\.codebudget|id_rsa|id_ed25519)(?:$|[\\/])/i.test(path)
    || /\.(?:pem|key|p12|pfx|keystore)$/i.test(path);
}

export function safePath(root: string, target: string): string {
  const base = realpathSync(root);
  let candidate = resolve(base, target);
  let rel = relative(base, candidate);
  const escapes = (path: string): boolean => path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
  if (escapes(rel) && isAbsolute(target)) {
    // macOS /var -> /private/var (or a user-supplied root alias) may name the
    // same repository. Resolve only its root anchor, never linked descendants.
    let anchor: string | undefined;
    for (let current = candidate; ; current = dirname(current)) {
      try { if (relative(base, realpathSync(current)) === '') anchor = current; }
      catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
      if (dirname(current) === current) break;
    }
    // Use the outermost matching anchor: root/loop -> root must still be
    // checked as a descendant link rather than accepted as another root.
    if (anchor) { candidate = resolve(base, relative(anchor, candidate)); rel = relative(base, candidate); }
  }
  if (escapes(rel)) throw new Error('Path escapes repository');
  let current = base;
  for (const component of rel.split(sep).filter(Boolean)) {
    current = resolve(current, component);
    let linked = false;
    try { linked = lstatSync(current).isSymbolicLink(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (linked) throw new Error('Symlink access denied');
  }
  return candidate;
}

export function atomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Refusing symlink write');
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
    renameSync(tmp, path);
  } finally { if (existsSync(tmp)) unlinkSync(tmp); }
}

/** Bounded line buffering prevents a secret split across chunks from escaping. */
export class StreamRedactor {
  private readonly decoder = new StringDecoder('utf8');
  private carry = '';
  private dropping = false;
  private inKey = false;
  withheld = false;
  constructor(private readonly maxLineBytes = 64 * 1024, private readonly filter = redact) {}
  feed(chunk: Buffer): string[] { return this.consume(this.decoder.write(chunk), false); }
  end(): string[] { return this.consume(this.decoder.end(), true); }
  private consume(value: string, final: boolean): string[] {
    const out: string[] = [];
    const parts = (this.carry + value).split('\n');
    this.carry = parts.pop() ?? '';
    const partial = final ? this.carry : '';
    if (final) this.carry = '';
    const complete = parts.map(part => ({ part, ending: '\n' }));
    if (partial) complete.push({ part: partial, ending: '' });
    for (const { part, ending } of complete) {
      if (this.dropping) { this.dropping = false; continue; }
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(part)) { this.inKey = true; out.push(`[REDACTED PRIVATE KEY]${ending}`); }
      if (this.inKey) { if (/-----END [A-Z ]*PRIVATE KEY-----/.test(part)) this.inKey = false; continue; }
      if (bytes(part) > this.maxLineBytes) { this.withheld = true; out.push(`[WITHHELD: line exceeded safe redaction buffer]${ending}`); continue; }
      out.push(this.filter(part) + ending);
    }
    if (bytes(this.carry) > this.maxLineBytes) {
      this.carry = ''; this.dropping = true; this.withheld = true;
      out.push('[WITHHELD: line exceeded safe redaction buffer]\n');
    }
    return out;
  }
}

export function csvCell(value: unknown): string {
  let text = redact(value === null || value === undefined ? '' : String(value));
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

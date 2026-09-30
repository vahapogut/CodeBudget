/* eslint-disable no-control-regex -- explicitly remove terminal control characters */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export const SECURITY_VERSION = 'redaction-3';
export const hash = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
export const bytes = (text: string): number => Buffer.byteLength(text, 'utf8');
export const estimateTokens = (text: string): number => Math.ceil(bytes(text) / 3);

/**
 * Key names whose values are credentials: the name must END with one of these
 * suffixes, so `max_tokens`, `tokenizer` or `accessTokenCount` stay readable.
 */
const SENSITIVE_KEY = String.raw`[A-Za-z0-9_.-]*?(?:(?:api|access|secret|private|signing|encryption|master|deploy|license|client|account|ssh|app|shared[_-]?access)[_-]?key(?:[_-]?id)?|apikey|secret|passw(?:or)?d|passwd|pwd|passphrase|token|credentials?|cookie|set-cookie|session[_-]?(?:key|token|secret)|connection[_-]?string)`;
const SENSITIVE_KEY_NAME = new RegExp(`^${SENSITIVE_KEY}$`, 'i');
/** Shell state variables that merely end with a sensitive suffix. */
const EXEMPT_KEYS = new Set(['PWD', 'OLDPWD']);
export const isSensitiveKeyName = (key: string): boolean => !EXEMPT_KEYS.has(key) && (SENSITIVE_KEY_NAME.test(key) || /^(?:proxy-)?authorization$/i.test(key));

export function sanitize<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map(sanitize) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), isSensitiveKeyName(key) && typeof item === 'string' ? '[REDACTED]' : sanitize(item)])) as T;
  return value;
}
export const safeJson = (value: unknown): string => JSON.stringify(sanitize(value));

const SENSITIVE_FLAG = new RegExp(`^--?(${SENSITIVE_KEY})(?:=|$)`, 'i');
/** Redact argv values paired with sensitive flags before storing command metadata. */
export function redactArguments(args: readonly string[]): string[] {
  let hideNext = false;
  return args.map((arg) => {
    if (hideNext) { hideNext = false; return '[REDACTED ARGUMENT]'; }
    if (SENSITIVE_FLAG.test(arg)) {
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

const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g;
/** Well-known credential formats that are recognizable without a key name. */
const TOKEN_PATTERN = new RegExp([
  String.raw`sk-[A-Za-z0-9_-]{12,}`, String.raw`(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}`, String.raw`xox[abposr]-[A-Za-z0-9-]{10,}`,
  String.raw`AIza[0-9A-Za-z_-]{35}`, String.raw`ya29\.[0-9A-Za-z_-]{20,}`, String.raw`gh[pousr]_[A-Za-z0-9]{16,}`, String.raw`github_pat_[A-Za-z0-9_]{16,}`,
  String.raw`glpat-[A-Za-z0-9_-]{20,}`, String.raw`npm_[A-Za-z0-9]{36}`, String.raw`(?:AKIA|ASIA)[A-Z0-9]{16}`, String.raw`SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}`,
  String.raw`hf_[A-Za-z0-9]{30,}`, String.raw`dop_v1_[a-f0-9]{64}`, String.raw`shpat_[a-fA-F0-9]{32}`, String.raw`pypi-[A-Za-z0-9_-]{50,}`,
].map(item => `(?<![A-Za-z0-9_-])${item}(?![A-Za-z0-9_-])`).join('|'), 'g');
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
/** Userinfo in any scheme: https, postgres, mongodb+srv, redis (including an empty user), amqp... */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]{1,30}:\/\/)[^\s/:@]*:[^\s/@]+@/gi;
const AUTHORIZATION_HEADER = /((?:authorization|proxy-authorization)\s*[:=]\s*["']?(?:Bearer|Basic|Token|Digest)\s+)(?!\[REDACTED)[^\s"',;}]+/gi;
const QUOTED_ASSIGNMENT = new RegExp(String.raw`(?<![A-Za-z0-9_.-])(${SENSITIVE_KEY})(\s*["']?\s*[:=]\s*)(["'\x60])(?:\\.|(?!\3)[^\\\r\n])*\3`, 'gi');
const UNQUOTED_ASSIGNMENT = new RegExp(String.raw`(?<![A-Za-z0-9_.-])(${SENSITIVE_KEY})(\s*["']?\s*[:=]\s*)(?!["'\x60]|\[REDACTED|(?:null|true|false)\b)([^\s"'\x60,;}]+)`, 'gi');

/** Pattern detection is defense in depth, not a guarantee against all secrets. */
export function redact(text: string): string {
  if (typeof text !== 'string') throw new Error('Redaction requires text');
  return text
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(PRIVATE_KEY_BLOCK, '[REDACTED PRIVATE KEY]')
    .replace(TOKEN_PATTERN, '[REDACTED TOKEN]')
    .replace(JWT_PATTERN, '[REDACTED JWT]')
    .replace(URL_CREDENTIALS, '$1[REDACTED]@')
    .replace(AUTHORIZATION_HEADER, '$1[REDACTED]')
    .replace(QUOTED_ASSIGNMENT, (match, key: string, separator: string, quote: string) => EXEMPT_KEYS.has(key) ? match : `${key}${separator}${quote}[REDACTED]${quote}`)
    // A JSON-style quoted key keeps a quoted replacement so the document stays valid JSON.
    .replace(UNQUOTED_ASSIGNMENT, (match, key: string, separator: string) => EXEMPT_KEYS.has(key) ? match : `${key}${separator}${separator.includes('"') ? '"[REDACTED]"' : '[REDACTED]'}`);
}

export type PathExclusionReason = 'secret' | 'dependency' | 'local_state' | 'generated_output';
/** Manifests that mark a package root; generated directories next to one are build output. */
export const PACKAGE_MANIFESTS: readonly string[] = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'setup.py', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile', 'deno.json', 'mix.exs'];
const SECRET_DIRECTORIES = new Set(['.ssh', '.gnupg', '.aws', '.azure', '.kube', 'secret', 'secrets', '.secrets', 'credentials']);
const DEPENDENCY_DIRECTORIES = new Set(['.git', '.hg', '.svn', 'node_modules', 'bower_components', 'jspm_packages', '.pnpm-store', '.yarn', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.tox', '.gradle', '.cache', '.turbo', '.next', '.nuxt', '.svelte-kit', '.parcel-cache', '.angular', '.terraform']);
const GENERATED_DIRECTORIES = new Set(['dist', 'build', 'out', 'coverage', 'target', 'vendor', '.output', 'storybook-static']);
const LOCAL_STATE_DIRECTORY = /^\.codebudget(?:[-_.][A-Za-z0-9_-]+)*$/i;
const SECRET_FILE = /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|_netrc|\.git-credentials|\.htpasswd|\.pgpass|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|credentials|(?:secrets?|credentials?)\.(?:json|ya?ml|toml|ini|env|txt|xml|properties|conf|cfg))$/i;
const SECRET_EXTENSION = /\.(?:pem|key|p12|pfx|jks|keystore|ppk|kdbx|tfstate|tfstate\.backup|tfvars)$/i;

/**
 * One exclusion policy for every repository walk (runner fingerprint and indexer).
 * Secrets, dependencies and local state are excluded anywhere. Generated output
 * directories (dist, build, coverage, vendor...) only at the repository root or
 * directly beside a package manifest, so source folders such as src/build stay visible.
 */
export function classifyRepositoryPath(path: string, options: { directory?: boolean; isPackageRoot?: (directory: string) => boolean } = {}): PathExclusionReason | null {
  const parts = path.replaceAll('\\', '/').split('/').filter(part => part && part !== '.');
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!; const lower = part.toLowerCase();
    if (index < parts.length - 1 || options.directory) {
      if (SECRET_DIRECTORIES.has(lower)) return 'secret';
      if (DEPENDENCY_DIRECTORIES.has(lower)) return 'dependency';
      if (LOCAL_STATE_DIRECTORY.test(part)) return 'local_state';
      if (GENERATED_DIRECTORIES.has(lower) && (index === 0 || options.isPackageRoot?.(parts.slice(0, index).join('/')) === true)) return 'generated_output';
    } else if (SECRET_FILE.test(part) || SECRET_EXTENSION.test(part)) return 'secret';
  }
  return null;
}

/** Compatibility wrapper: true for any excluded path without package-root information. */
export function isSensitivePath(path: string): boolean {
  return classifyRepositoryPath(path) !== null;
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

/**
 * Replace a file atomically. Existing shared files keep their permission bits;
 * new shared files get 0644 and private files (state, receipts) get 0600.
 */
export function atomicWrite(path: string, text: string, options: { private?: boolean } = {}): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let mode = options.private ? 0o600 : 0o644;
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Refusing symlink write');
    if (!options.private) mode = stat.mode & 0o7777;
  }
  const tmp = `${path}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(tmp, 'wx', mode);
    fchmodSync(descriptor, mode);
    writeFileSync(descriptor, text);
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    renameSync(tmp, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(tmp)) unlinkSync(tmp);
  }
  if (process.platform !== 'win32') {
    try { const directory = openSync(dirname(path), 'r'); try { fsyncSync(directory); } finally { closeSync(directory); } } catch { /* directory sync is best effort */ }
  }
}

/** Create a private data directory that ignores itself, even without a root .gitignore rule. */
export function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const marker = join(directory, '.gitignore');
  if (!existsSync(marker)) atomicWrite(marker, '# Local CodeBudget data. Never commit this directory.\n*\n', { private: true });
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
      if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/.test(part)) { this.inKey = true; out.push(`[REDACTED PRIVATE KEY]${ending}`); }
      if (this.inKey) { if (/-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/.test(part)) this.inKey = false; continue; }
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

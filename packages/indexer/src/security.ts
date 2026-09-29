import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';

export function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

const excludedDirectories = new Set(['.git', '.codebudget', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.next', '.nuxt', '.cache', '.turbo', '__pycache__']);

/** These exclusions cannot be overridden by a negated ignore pattern. */
export function sensitivePath(path: string): boolean {
  const parts = path.replaceAll('\\', '/').split('/');
  return parts.some((part) => excludedDirectories.has(part.toLowerCase())
    || /^\.env(?:\..*)?$/i.test(part)
    || /^(?:id_rsa|id_ed25519|id_ecdsa|credentials|secrets?)(?:\..*)?$/i.test(part)
    || /\.(?:pem|key|p12|pfx|jks|keystore|sqlite|sqlite3|db)(?:-wal|-shm)?$/i.test(part));
}

export function normalizePath(path: string): string {
  if (path.includes('\0') || isAbsolute(path) || win32.isAbsolute(path) || /^[a-z]:/i.test(path)) {
    throw new Error('Source path must be repository-relative');
  }
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '' || part === '.')) {
    throw new Error('Invalid repository-relative source path');
  }
  return normalized;
}

export function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** Refuse links in every component, then validate the opened file identity. */
export function readSource(root: string, relativePath: string, maxBytes: number): string {
  const safePath = normalizePath(relativePath);
  if (sensitivePath(safePath)) throw new Error('Sensitive or excluded source path');
  const absolute = resolve(root, safePath);
  if (!within(root, absolute)) throw new Error('Source escapes repository root');
  let current = root;
  for (const part of safePath.split('/')) {
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Symlink sources are excluded');
  }
  if (!within(root, realpathSync(absolute))) throw new Error('Resolved source escapes repository root');
  const before = lstatSync(absolute, { bigint: true });
  if (!before.isFile() || before.size > BigInt(maxBytes)) throw new Error('Source is not a supported regular file or exceeds size limit');
  const descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    // Windows lstat can return dev=0 while fstat returns the volume serial number.
    const deviceChanged = before.dev !== 0n && opened.dev !== before.dev;
    if (deviceChanged || opened.ino !== before.ino || opened.size > BigInt(maxBytes)) throw new Error('Source identity changed while opening');
    // Repeat containment after opening to detect directory replacement. No repository scripts run.
    if (!within(root, realpathSync(absolute))) throw new Error('Source containment changed while opening');
    const bytes = readFileSync(descriptor);
    if (bytes.length > maxBytes) throw new Error('Source exceeded size limit while reading');
    if (bytes.includes(0)) throw new Error('Binary source is excluded');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally {
    closeSync(descriptor);
  }
}

/** Defense in depth for standalone use; core can supply its own stricter redactor. */
export function redactSource(value: string): string {
  return value
    .replace(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|secret|password|access[_-]?token|refresh[_-]?token)\s*[=:]\s*["'`])([^"'`\r\n]{8,})(["'`])/gi, '$1[REDACTED]$3')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}/gi, '$1[REDACTED]');
}

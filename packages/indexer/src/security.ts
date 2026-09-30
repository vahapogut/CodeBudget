import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, type BigIntStats } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { classifyRepositoryPath, PACKAGE_MANIFESTS, type PathExclusionReason } from '../../core/src/security.js';

export function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** SQLite databases and their journals are data, never text sources. */
const DATA_FILE = /\.(?:sqlite|sqlite3|db)(?:-wal|-shm|-journal)?$/i;
export type ExclusionReason = PathExclusionReason | 'data_file';

/**
 * The shared core repository policy (secrets, dependencies, local state, generated output beside a
 * package manifest) plus data files. These exclusions cannot be overridden by a negated ignore pattern.
 */
export function exclusionReason(path: string, options: { directory?: boolean; isPackageRoot?: (directory: string) => boolean } = {}): ExclusionReason | null {
  const reason = classifyRepositoryPath(path, options);
  if (reason) return reason;
  return !options.directory && DATA_FILE.test(path.split('/').at(-1) ?? '') ? 'data_file' : null;
}

/** Package roots detected from the working tree, for callers that check one path outside a walk. */
export const packageRootOnDisk = (root: string) => (directory: string): boolean => PACKAGE_MANIFESTS.some((manifest) => existsSync(join(root, directory, manifest)));

/** Compatibility helper: true for any hard-excluded path, without package-root information. */
export function sensitivePath(path: string): boolean {
  return exclusionReason(path) !== null;
}

/** Validates caller-supplied paths. Backslashes are treated as separators on every platform. */
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

/** Validates an indexed path. On POSIX a backslash is an ordinary filename character, never a separator. */
export function sourcePath(path: string): string {
  if (process.platform === 'win32') return normalizePath(path);
  if (path.includes('\0') || isAbsolute(path)) throw new Error('Source path must be repository-relative');
  if (!path || path.split('/').some((part) => part === '..' || part === '' || part === '.')) throw new Error('Invalid repository-relative source path');
  return path;
}

export function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** Stable skip reasons; messages never contain absolute paths. */
export type SourceErrorCode = 'excluded' | 'symlink' | 'outside_repository' | 'not_regular_file' | 'file_size_limit' | 'identity_changed' | 'changed_during_read' | 'binary' | 'invalid_utf8';
export class SourceError extends Error {
  constructor(readonly code: SourceErrorCode, message: string) { super(message); }
}
/** Map any read failure to a short reason without absolute paths. */
export function skipReason(error: unknown): string {
  if (error instanceof SourceError) return error.code;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && /^E[A-Z0-9]+$/.test(code) ? `unreadable:${code}` : 'unreadable';
}

export interface SourceRead { text: string; stat: BigIntStats }
/** Refuse links in every component, then validate the opened file identity and detect torn reads. */
export function readSourceFile(root: string, relativePath: string, maxBytes: number): SourceRead {
  const safePath = sourcePath(relativePath);
  if (exclusionReason(safePath, { isPackageRoot: packageRootOnDisk(root) })) throw new SourceError('excluded', 'Sensitive or excluded source path');
  const absolute = resolve(root, safePath);
  if (!within(root, absolute)) throw new SourceError('outside_repository', 'Source escapes repository root');
  let current = root;
  for (const part of safePath.split('/')) {
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new SourceError('symlink', 'Symlink sources are excluded');
  }
  if (!within(root, realpathSync(absolute))) throw new SourceError('outside_repository', 'Resolved source escapes repository root');
  const before = lstatSync(absolute, { bigint: true });
  if (!before.isFile()) throw new SourceError('not_regular_file', 'Source is not a regular file');
  if (before.size > BigInt(maxBytes)) throw new SourceError('file_size_limit', 'Source exceeds size limit');
  const descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    // Windows lstat can return dev=0 while fstat returns the volume serial number.
    const deviceChanged = before.dev !== 0n && opened.dev !== before.dev;
    if (deviceChanged || opened.ino !== before.ino) throw new SourceError('identity_changed', 'Source identity changed while opening');
    if (opened.size > BigInt(maxBytes)) throw new SourceError('file_size_limit', 'Source exceeds size limit');
    // Repeat containment after opening to detect directory replacement. No repository scripts run.
    if (!within(root, realpathSync(absolute))) throw new SourceError('outside_repository', 'Source containment changed while opening');
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (bytes.length > maxBytes) throw new SourceError('file_size_limit', 'Source exceeded size limit while reading');
    // A concurrent writer can tear a read; the caller retries a bounded number of times.
    if (BigInt(bytes.length) !== after.size || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) throw new SourceError('changed_during_read', 'Source changed while reading');
    if (bytes.includes(0)) throw new SourceError('binary', 'Binary source is excluded');
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), stat: after }; }
    catch { throw new SourceError('invalid_utf8', 'Source is not valid UTF-8 text'); }
  } finally {
    closeSync(descriptor);
  }
}

export function readSource(root: string, relativePath: string, maxBytes: number): string {
  return readSourceFile(root, relativePath, maxBytes).text;
}

/** Defense in depth for standalone use; core can supply its own stricter redactor. */
export function redactSource(value: string): string {
  return value
    .replace(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|secret|password|access[_-]?token|refresh[_-]?token)\s*[=:]\s*["'`])([^"'`\r\n]{8,})(["'`])/gi, '$1[REDACTED]$3')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}/gi, '$1[REDACTED]');
}

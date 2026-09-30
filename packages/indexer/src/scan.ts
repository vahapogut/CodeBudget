import { lstatSync, readdirSync, type BigIntStats, type Dirent } from 'node:fs';
import { extname, join } from 'node:path';
import { PACKAGE_MANIFESTS } from '../../core/src/security.js';
import { exclusionReason, skipReason, within } from './security.js';
import { ignoredBy, matcher, readRuleFile, type GlobalRules, type RuleSet } from './rules.js';

export const SUPPORTED_TEXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx', '.txt', '.yaml', '.yml', '.toml', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.css', '.scss', '.html', '.sql', '.sh', '.ps1', '.vue', '.svelte', '.rb', '.php', '.graphql', '.gql']);
export const supportedSource = (name: string): boolean => SUPPORTED_TEXT.has(extname(name).toLowerCase()) || ['Dockerfile', 'Makefile'].includes(name);
export interface Skip { path: string; reason: string }
/** A supported regular file found by the walk; `stat` identifies saved content without reading it. */
export interface ScanEntry { path: string; size: number; stat: string }
export interface Walk { entries: ScanEntry[]; skipped: Skip[]; keptScopes: string[] }

/** size:mtime:ctime:inode; the device is omitted because Windows lstat and fstat disagree about it. */
export const statKey = (stat: BigIntStats): string => `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.ino}`;
const RACY_NS = 3_000_000_000n;
/** Content modified within the timestamp granularity window is re-read next time (Git's racy-clean rule). */
export const storedStat = (stat: BigIntStats, now = BigInt(Date.now()) * 1_000_000n): string => stat.mtimeNs + RACY_NS > now || stat.ctimeNs + RACY_NS > now ? '' : statKey(stat);
const TRANSIENT = new Set(['EAGAIN', 'EBUSY', 'EINTR', 'EMFILE', 'ENFILE']);
export const transientError = (error: unknown): boolean => TRANSIENT.has((error as NodeJS.ErrnoException | undefined)?.code ?? '');
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Round-robin merge: every directory group receives a fair share before any group receives more. */
export function interleave<T>(groups: T[][]): T[] {
  const result: T[] = [];
  let active = groups.filter((group) => group.length);
  for (let index = 0; active.length; index++) {
    for (const group of active) result.push(group[index]!);
    active = active.filter((group) => group.length > index + 1);
  }
  return result;
}

/**
 * Walk without reading sources. Every exclusion except unsupported file types is recorded. A directory
 * whose ignore rules cannot be read is not descended (fail closed) and becomes a kept scope: previously
 * indexed rows below it are retained rather than deleted.
 */
export function walkRepository(root: string, dataDir: string, global: GlobalRules): Walk {
  const skipped: Skip[] = [...global.problems];
  const keptScopes: string[] = [];
  const packageRoots = new Set<string>();
  const isPackageRoot = (directory: string): boolean => packageRoots.has(directory);
  const visit = (directory: string, absoluteDirectory: string, inherited: RuleSet[]): ScanEntry[] => {
    let entries: Dirent[];
    try { entries = readdirSync(absoluteDirectory, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name)); }
    catch (error) { skipped.push({ path: directory || '.', reason: skipReason(error) }); if (transientError(error)) keptScopes.push(directory); return []; }
    if (entries.some((entry) => PACKAGE_MANIFESTS.includes(entry.name) && !entry.isDirectory())) packageRoots.add(directory);
    const rules = [...inherited];
    for (const name of ['.gitignore', '.codebudgetignore']) {
      if (!entries.some((entry) => entry.name === name)) continue;
      try { const text = readRuleFile(join(absoluteDirectory, name)); if (text !== null) rules.push({ base: directory, matcher: matcher(text, global.caseInsensitive) }); }
      catch (error) {
        skipped.push({ path: directory ? `${directory}/${name}` : name, reason: `ignore_rules_${skipReason(error)}` });
        keptScopes.push(directory);
        return [];
      }
    }
    const own: ScanEntry[] = [];
    const groups: ScanEntry[][] = [];
    for (const entry of entries) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      const absolute = join(absoluteDirectory, entry.name);
      if (within(dataDir, absolute)) { skipped.push({ path, reason: 'local_state' }); continue; }
      if (entry.isSymbolicLink()) { skipped.push({ path, reason: 'symlink' }); continue; }
      const isDirectory = entry.isDirectory();
      const excluded = exclusionReason(path, { directory: isDirectory, isPackageRoot });
      if (excluded) { skipped.push({ path, reason: excluded }); continue; }
      if (!isDirectory && !supportedSource(entry.name)) continue;
      let ignored: boolean;
      try { ignored = ignoredBy(rules, path, isDirectory); } catch { skipped.push({ path, reason: 'unsupported_path' }); continue; }
      if (ignored) { skipped.push({ path, reason: 'ignored' }); continue; }
      if (isDirectory) { groups.push(visit(path, absolute, rules)); continue; }
      if (!entry.isFile()) { skipped.push({ path, reason: 'not_regular_file' }); continue; }
      try { const stat = lstatSync(absolute, { bigint: true }); own.push({ path, size: Number(stat.size), stat: statKey(stat) }); }
      catch (error) { skipped.push({ path, reason: skipReason(error) }); }
    }
    return interleave([own, ...groups]);
  };
  const entries = visit('', root, global.rules);
  return { entries, skipped, keptScopes };
}

/** File-count and byte limits applied in walk order; only accepted sources consume them. */
export class SourceLimits {
  private files = 0;
  private bytes = 0;
  constructor(private readonly limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number }) {}
  check(size: number): string | null {
    if (this.files >= this.limits.maxFiles) return 'file_count_limit';
    if (size > this.limits.maxFileBytes) return 'file_size_limit';
    if (this.bytes + size > this.limits.maxTotalBytes) return 'total_source_bytes_limit';
    return null;
  }
  accept(size: number): void { this.files++; this.bytes += size; }
}
export const LIMIT_REASONS = new Set(['file_count_limit', 'total_source_bytes_limit']);
export const inScope = (scopes: readonly string[], path: string): boolean => scopes.some((scope) => scope === '' || path.startsWith(`${scope}/`));

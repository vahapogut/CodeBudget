import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { skipReason } from './security.js';

const MAX_RULE_BYTES = 1_048_576;
/** Rules scoped to a repository-relative directory ('' is the repository root). */
export interface RuleSet { base: string; matcher: Ignore }
export interface GlobalRules { rules: RuleSet[]; caseInsensitive: boolean; problems: { path: string; reason: string }[] }

/**
 * Read an ignore or Git configuration file as data. Git parses these byte-wise, so invalid UTF-8
 * (for example a Latin-1 comment) is decoded leniently instead of failing. A symlinked rule file is
 * followed: its patterns can only exclude more files and are never emitted. Returns null when absent.
 */
export function readRuleFile(path: string): string | null {
  let initial;
  try { initial = statSync(path); } catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null; throw error; }
  if (!initial.isFile()) throw Object.assign(new Error('Rule file is not a regular file'), { code: 'ENOTFILE' });
  // O_NONBLOCK: a FIFO swapped in after the check can never block the walk.
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw Object.assign(new Error('Rule file is not a regular file'), { code: 'ENOTFILE' });
    if (stat.size > MAX_RULE_BYTES) throw Object.assign(new Error('Rule file exceeds size limit'), { code: 'EFBIG' });
    const bytes = readFileSync(descriptor);
    if (bytes.length > MAX_RULE_BYTES) throw Object.assign(new Error('Rule file exceeds size limit'), { code: 'EFBIG' });
    return new TextDecoder('utf-8').decode(bytes);
  } finally { closeSync(descriptor); }
}

export const matcher = (text: string, caseInsensitive: boolean): Ignore => ignore({ ignorecase: caseInsensitive }).add(text);

/** Later rule sets take precedence; within one set the last matching pattern wins (Git semantics). */
export function ignoredBy(rules: readonly RuleSet[], path: string, directory: boolean): boolean {
  let ignored = false;
  for (const rule of rules) {
    const local = rule.base ? path.slice(rule.base.length + 1) : path;
    if (!local) continue;
    const result = rule.matcher.test(directory ? `${local}/` : local);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

/** Minimal Git config reader: last value wins; include directives and conditional includes are not followed. */
export function gitConfigValue(text: string, section: string, key: string): string | undefined {
  let current = '';
  let value: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    const header = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\](.*)$/.exec(line);
    if (header) { current = (header[2] === undefined ? header[1]! : `${header[1]!}.${header[2]}`).toLowerCase(); line = header[3]!.trim(); }
    if (!line || line.startsWith('#') || line.startsWith(';') || current !== section) continue;
    const entry = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/.exec(line);
    if (!entry || entry[1]!.toLowerCase() !== key) continue;
    value = entry[2] === undefined ? 'true' : configString(entry[2]);
  }
  return value;
}
function configString(raw: string): string {
  let result = '';
  let quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!;
    if (char === '\\' && index + 1 < raw.length) { const next = raw[++index]!; result += next === 'n' ? '\n' : next === 't' ? '\t' : next; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && (char === '#' || char === ';')) break;
    result += char;
  }
  return quoted ? result : result.trimEnd();
}
const configBoolean = (value: string | undefined): boolean | undefined => value === undefined ? undefined : /^(?:true|yes|on|1)$/i.test(value.trim()) ? true : /^(?:false|no|off|0|)$/i.test(value.trim()) ? false : undefined;

/** Locate $GIT_DIR and the common directory for a checkout, linked worktree or submodule root. */
export function gitDirectories(root: string): { gitDir: string; commonDir: string } | null {
  const dotGit = join(root, '.git');
  let gitDir: string;
  try {
    const stat = statSync(dotGit);
    if (stat.isDirectory()) gitDir = dotGit;
    else if (stat.isFile()) {
      const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readRuleFile(dotGit) ?? '');
      if (!pointer) return null;
      gitDir = resolve(root, pointer[1]!);
    } else return null;
  } catch { return null; }
  const common = (readRuleFile(join(gitDir, 'commondir')) ?? '').trim();
  return { gitDir, commonDir: common ? resolve(gitDir, common) : gitDir };
}

/** Detect case-insensitive matching by comparing the identity of a case-flipped existing path. */
export function caseInsensitiveFileSystem(existing: string, stop: string): boolean {
  for (let current = existing; ; current = dirname(current)) {
    const name = basename(current);
    const flipped = [...name].map((char) => char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase()).join('');
    if (flipped !== name) {
      try {
        const original = lstatSync(current, { bigint: true });
        const other = lstatSync(join(dirname(current), flipped), { bigint: true });
        return other.ino === original.ino && other.dev === original.dev;
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; }
    }
    if (current === stop || dirname(current) === current) break;
  }
  return process.platform === 'win32' || process.platform === 'darwin';
}

const expandHome = (value: string, root: string): string => value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : isAbsolute(value) ? value : resolve(root, value);
function globalConfig(): string {
  const xdg = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'git') : join(homedir(), '.config', 'git');
  const files = process.env.GIT_CONFIG_GLOBAL ? [process.env.GIT_CONFIG_GLOBAL] : [join(xdg, 'config'), join(homedir(), '.gitconfig')];
  return files.map((file) => { try { return readRuleFile(file) ?? ''; } catch { return ''; } }).join('\n');
}

/**
 * Repository-wide exclude sources, lowest precedence first: core.excludesFile (repository config, then
 * global config, default $XDG_CONFIG_HOME/git/ignore) and $GIT_DIR/info/exclude. Nothing is executed.
 * Like Git, an unreadable exclude source is reported and skipped.
 */
export function loadGlobalRules(root: string, probe: string): GlobalRules {
  const problems: GlobalRules['problems'] = [];
  const git = gitDirectories(root);
  let localConfig = '';
  if (git) { try { localConfig = readRuleFile(join(git.commonDir, 'config')) ?? ''; } catch (error) { problems.push({ path: '.git/config', reason: `ignore_rules_${skipReason(error)}` }); } }
  const shared = git ? `${globalConfig()}\n${localConfig}` : '';
  const caseInsensitive = configBoolean(gitConfigValue(localConfig, 'core', 'ignorecase')) ?? caseInsensitiveFileSystem(probe, root);
  const rules: RuleSet[] = [];
  const add = (label: string, file: string): void => {
    try { const text = readRuleFile(file); if (text !== null) rules.push({ base: '', matcher: matcher(text, caseInsensitive) }); }
    catch (error) { problems.push({ path: label, reason: `ignore_rules_${skipReason(error)}` }); }
  };
  if (git) {
    const configured = gitConfigValue(shared, 'core', 'excludesfile');
    const xdg = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'git') : join(homedir(), '.config', 'git');
    if (configured !== '') add('core.excludesFile', configured === undefined ? join(xdg, 'ignore') : expandHome(configured, root));
    add('.git/info/exclude', join(git.commonDir, 'info', 'exclude'));
  }
  return { rules, caseInsensitive, problems };
}

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseToml } from 'smol-toml';
import { ensurePrivateDirectory, hash } from '../../core/src/security.js';
import type { ClientId } from './capabilities.js';

type JsonObject = Record<string, unknown>;
export interface AdapterChangeOptions {
  client: ClientId;
  action: 'install' | 'uninstall';
  projectRoot: string;
  /** Portable default `codebudget`; the server resolves the project from the client's working directory. */
  command?: string;
  /** Default `mcp serve`. */
  args?: string[];
}
/** The CodeBudget registration only. Other entries and file text never enter a plan. */
export interface EntryChange { key: string; before: JsonObject | null; after: JsonObject | null }
export interface FileChange { path: string; role: 'config' | 'receipt'; operation: 'create' | 'update' | 'delete'; beforeHash: string | null; afterHash: string | null; entry: EntryChange | null }
/** An interrupted transaction found in the journal; applying the plan rolls it back and makes no other change. */
export interface AdapterRecovery { journalHash: string; client: ClientId | null; action: 'install' | 'uninstall' | null; startedAt: string | null; restore: string[]; keep: string[] }
export interface AdapterPlan {
  schemaVersion: 2; client: ClientId; action: 'install' | 'uninstall'; projectRoot: string;
  /** Registration an install writes; null for uninstall. */
  server: JsonObject | null;
  changes: FileChange[]; conflicts: string[]; notes: string[]; recovery: AdapterRecovery | null;
}
export interface AdapterSignalSource { on(signal: NodeJS.Signals, listener: () => void): unknown; off(signal: NodeJS.Signals, listener: () => void): unknown; raise(signal: NodeJS.Signals): void }
export interface AdapterApplyOptions {
  /** Fault injection: runs before change `index` is written, and with `changes.length` before the transaction commits. */
  beforeCommit?: (index: number) => void | Promise<void>;
  /** Interrupt source; defaults to this process's SIGINT and SIGTERM, which are re-raised after rollback. */
  signals?: AdapterSignalSource;
}
export interface AdapterApplyResult { applied: boolean; backups: string[]; recovered: string[]; notes: string[] }

interface Created {
  /** The configuration file did not exist; `directories` are the missing ancestors created for it. */
  file: boolean; directories: string[];
  /** JSON: CodeBudget created the whole document or only the mcpServers member. */
  container?: 'document' | 'servers' | null;
  /** JSON: whitespace inside the object that was empty before the insertion. */
  interior?: string;
  /** JSON: previous whitespace-only file text. */
  blank?: string;
  /** TOML: line ending added before the managed block. */
  separator?: string;
}
interface Receipt { schemaVersion: 1; client: ClientId; configPath: string; server: JsonObject; owned: true; created?: Created }
interface PlannedFile { change: FileChange; before: string | null; after: string | null; mode: number; beforeMode: number | null }
interface Planned { plan: AdapterPlan; files: PlannedFile[]; createdDirectories: string[]; removableDirectories: string[] }
interface JournalFile { path: string; beforeHash: string | null; afterHash: string | null; mode: number | null; backup: string | null }
interface Journal { schemaVersion: 1; id: string; client: ClientId; action: 'install' | 'uninstall'; pid: number; startedAt: string; files: JournalFile[]; directories: string[] }
type Edit = { conflict: string } | { after: string | null; previous: JsonObject | null; created?: Created; note?: string };
interface JsonNode { start: number; end: number; members?: JsonMember[] }
interface JsonMember { key: string; start: number; keyEnd: number; value: JsonNode }

const CONFIG_PATHS: Readonly<Record<ClientId, string>> = { claude: '.mcp.json', codex: '.codex/config.toml', cursor: '.cursor/mcp.json', antigravity: '.agents/mcp_config.json' };
const CLIENTS = Object.keys(CONFIG_PATHS) as ClientId[];
const DEFAULT_COMMAND = 'codebudget'; const DEFAULT_ARGS: readonly string[] = ['mcp', 'serve'];
const STATE = '.codebudget/adapters'; const BACKUPS = `${STATE}/backups`; const JOURNAL = `${STATE}/transaction.json`; const LOCK = `${STATE}/transaction.lock`;
const LEGACY_LOCK = '.codebudget-adapter.lock';
const KEEP_BACKUPS = 5; const STALE_LOCK_MS = 10 * 60_000; const MAX_FILE_BYTES = 4 * 1024 * 1024;
const SIGNALS = ['SIGINT', 'SIGTERM'] as const;
const TOML_HEADER = '[mcp_servers.codebudget]';
const TOML_START = '# CodeBudget managed MCP registration';
const TOML_END = '# End CodeBudget managed MCP registration';
const BACKUP_NAME = /^([A-Za-z0-9._%-]+)~(\d{13})-([0-9a-f]{8})\.backup$/;
const LEGACY_BACKUP = /^(claude|codex|cursor|antigravity)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.backup$/;
const BLANK = /^\uFEFF?[ \t\r\n]*$/;
const SCOPE_NOTE = 'Only project-local MCP registration is changed. Native Claude plugin is separately loaded with --plugin-dir.';
const FORMAT_NOTE = 'Only the CodeBudget entry is inserted, updated or removed; other bytes, key order, line endings, byte-order mark and file permissions are preserved.';
const BACKUP_NOTE = `Previous file versions are backed up to ${BACKUPS} (private, ignored by Git, newest ${KEEP_BACKUPS} per file).`;
const UPDATE_NOTE = 'The owned CodeBudget entry differs only in command or arguments; it is updated in place.';
const RECOVERY_NOTE = 'An interrupted adapter change was found. Applying this plan only rolls it back; run the command again afterwards for the requested change.';
const UNOWNED = 'Existing codebudget MCP entry is unowned or modified; no fields will be overwritten. Remove or rename that entry to let CodeBudget register its own.';
const REMOVED = 'MCP entry was removed after installation; remove stale ownership receipt explicitly before reinstalling.';
const EDITED = 'CodeBudget MCP entry was edited after installation; it is preserved.';
const STALE_PREVIEW = 'Configuration changed since preview; regenerate the plan';
const INVALID_RECEIPT = 'Invalid adapter ownership receipt';
const INVALID_JOURNAL = `Adapter transaction journal ${JOURNAL} is invalid; it is preserved for manual recovery.`;

const digest = (text: string | null): string | null => text === null ? null : hash(text);
// TOML parsers use null-prototype objects; compare config data, not JS prototypes.
const equal = (left: unknown, right: unknown): boolean => left === undefined || right === undefined ? left === right : isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)));
const plain = (value: unknown): JsonObject => JSON.parse(JSON.stringify(value)) as JsonObject;
const launchless = (value: unknown): unknown => isRecord(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'command' && key !== 'args')) : value;
const isRecord = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;
const at = (root: string, rel: string): string => join(root, ...rel.split('/'));
const relPath = (root: string, path: string): string => relative(root, path).split(sep).join('/');
const ancestors = (rel: string): string[] => rel.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'));
const hasControl = (text: string): boolean => [...text].some(char => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);
const defaultMode = (rel: string): number => rel.startsWith(`${STATE}/`) ? 0o600 : 0o644;
const MANAGED = new Set(CLIENTS.flatMap(client => [CONFIG_PATHS[client], `${STATE}/${client}.json`]));
const CREATABLE = new Set(CLIENTS.flatMap(client => ancestors(CONFIG_PATHS[client])));

function obj(value: unknown, label: string): JsonObject {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}
async function assertSafePath(root: string, path: string): Promise<void> {
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Adapter path must remain inside project root');
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Adapter refuses symlink configuration paths');
      if (stat.isFile() && stat.nlink > 1) throw new Error('Adapter refuses hard-linked configuration files');
    } catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
  }
}
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
/** Bounded strict UTF-8 read: the decoded text re-encodes to the same bytes, including a byte-order mark. */
async function readText(path: string, label: string): Promise<string | null> {
  let handle;
  try { handle = await open(path, 'r'); } catch (error) { if (errorCode(error) === 'ENOENT') return null; throw error; }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`${label} is not a regular file`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`${label} exceeds the ${MAX_FILE_BYTES}-byte adapter limit`);
    const data = await handle.readFile();
    try { return utf8.decode(data); } catch { throw new Error(`${label} is not valid UTF-8; file content omitted`); }
  } finally { await handle.close(); }
}
async function modeOf(path: string): Promise<number | null> {
  try { return (await lstat(path)).mode & 0o7777; } catch (error) { if (errorCode(error) === 'ENOENT') return null; throw error; }
}
async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  try { const handle = await open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); } } catch { /* directory sync is best effort */ }
}
/** Same contract as core atomicWrite, with an explicit mode so rewrites and rollbacks keep the original permissions. */
async function writeAtomic(path: string, text: string, mode: number): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', mode);
    try { await handle.chmod(mode); await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => undefined); }
  await syncDirectory(dirname(path));
}
async function removeFile(path: string): Promise<void> {
  try { await unlink(path); } catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
  await syncDirectory(dirname(path));
}
async function restore(path: string, text: string | null, mode: number): Promise<void> {
  if (text === null) return removeFile(path);
  await mkdir(dirname(path), { recursive: true });
  await writeAtomic(path, text, mode);
}
async function removeEmptyDirectories(root: string, directories: readonly string[]): Promise<void> {
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) await rmdir(at(root, directory)).catch(() => undefined);
}

// JSON: a position-tracking validator lets edits splice only the CodeBudget member and keep every other byte.
class JsonPositionError extends Error { constructor(readonly offset: number, readonly tooDeep = false) { super('Invalid JSON'); } }
const MAX_JSON_DEPTH = 128;
function parseJsonNodes(text: string): JsonNode {
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const fail = (tooDeep = false): never => { throw new JsonPositionError(at, tooDeep); };
  const space = () => { while (at < text.length && ' \t\r\n'.includes(text[at]!)) at++; };
  const string = () => {
    at++;
    for (;;) {
      const code = text.charCodeAt(at);
      if (at >= text.length || code < 0x20) fail();
      if (code === 0x22) { at++; return; }
      if (code !== 0x5c) { at++; continue; }
      const next = text[at + 1] ?? '';
      if (next === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(at + 2, at + 6))) fail(); at += 6; } else if (next && '"\\/bfnrt'.includes(next)) at += 2; else fail();
    }
  };
  const value = (depth: number): JsonNode => {
    space(); const start = at; const open = text[at];
    if (depth > MAX_JSON_DEPTH) fail(true);
    if (open === '{' || open === '[') {
      const close = open === '{' ? '}' : ']'; const members: JsonMember[] = []; at++; space();
      const done = (): JsonNode => { at++; return open === '{' ? { start, end: at, members } : { start, end: at }; };
      if (text[at] === close) return done();
      for (;;) {
        if (open === '{') {
          space(); const keyStart = at; if (text[at] !== '"') fail();
          string(); const keyEnd = at; space(); if (text[at] !== ':') fail(); at++;
          members.push({ key: JSON.parse(text.slice(keyStart, keyEnd)) as string, start: keyStart, keyEnd, value: value(depth + 1) });
        } else value(depth + 1);
        space(); if (text[at] === ',') { at++; continue; }
        if (text[at] !== close) fail();
        return done();
      }
    }
    if (open === '"') { string(); return { start, end: at }; }
    const scalar = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y; scalar.lastIndex = at;
    const match = scalar.exec(text); if (!match) return fail();
    at += match[0].length; return { start, end: at };
  };
  const root = value(0); space(); if (at !== text.length) fail();
  return root;
}
function parseJsonConfig(text: string, label: string): JsonNode {
  try { return parseJsonNodes(text); } catch (error) {
    if (!(error instanceof JsonPositionError)) throw new Error(`${label} is not valid JSON; file content omitted`);
    const head = text.slice(0, error.offset); const position = `line ${head.split('\n').length}, column ${head.length - head.lastIndexOf('\n')}`;
    throw new Error(error.tooDeep ? `${label} nests values deeper than ${MAX_JSON_DEPTH} levels (${position}); file content omitted` : `${label} is not valid JSON (${position}); file content omitted`);
  }
}
const lineStart = (text: string, offset: number): number => text.lastIndexOf('\n', offset - 1) + 1;
const indentOf = (text: string, offset: number): string => /^\uFEFF?([ \t]*)/.exec(text.slice(lineStart(text, offset)))?.[1] ?? '';
const firstOnLine = (text: string, offset: number): boolean => /^\uFEFF?[ \t]*$/.test(text.slice(lineStart(text, offset), offset));
const eolOf = (text: string): string => { const index = text.indexOf('\n'); return index > 0 && text[index - 1] === '\r' ? '\r\n' : '\n'; };
function unitOf(text: string, root: JsonNode): string {
  const first = root.members?.[0];
  if (!first || !firstOnLine(text, first.start)) return '  ';
  const outer = indentOf(text, root.start); const inner = indentOf(text, first.start);
  const unit = inner.startsWith(outer) ? inner.slice(outer.length) : '';
  return /^(?: {1,8}|\t{1,2})$/.test(unit) ? unit : '  ';
}
function inline(value: unknown, spaced: boolean): string {
  if (Array.isArray(value)) return `[${value.map(item => inline(item, spaced)).join(spaced ? ', ' : ',')}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}${spaced ? ': ' : ':'}${inline(item, spaced)}`);
    return !entries.length ? '{}' : spaced ? `{ ${entries.join(', ')} }` : `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
interface Style { multiline: boolean; indent: string; unit: string; eol: string; spaced: boolean }
const render = (value: unknown, style: Style): string => style.multiline ? JSON.stringify(value, null, style.unit).split('\n').join(style.eol + style.indent) : inline(value, style.spaced);
/** Insert after the last member, mirroring the container's own separators and the nearest structured value's layout. */
function insertMember(text: string, container: JsonNode, key: string, value: unknown, format: { unit: string; eol: string; multiline: boolean }): { text: string; interior?: string } {
  const members = container.members!; const last = members.at(-1); const name = JSON.stringify(key);
  if (!last) {
    const interior = text.slice(container.start + 1, container.end - 1);
    const outer = indentOf(text, container.start); const indent = outer + format.unit;
    const body = format.multiline ? `${format.eol}${indent}${name}: ${render(value, { ...format, indent, multiline: true, spaced: true })}${format.eol}${outer}` : `${name}:${inline(value, false)}`;
    return { text: text.slice(0, container.start + 1) + body + text.slice(container.end - 1), interior };
  }
  const between = text.slice(last.keyEnd, last.value.start); const colon = /^[ \t]*:[ \t]*$/.test(between) ? between : ': ';
  const reference = [...members].reverse().map(member => text.slice(member.value.start, member.value.end)).find(item => item.startsWith('{') || item.startsWith('[')) ?? null;
  const spaced = reference === null ? colon.endsWith(' ') : /[:,] /.test(reference);
  let insertion: string;
  if (text.slice(container.start, last.start).includes('\n') && firstOnLine(text, last.start)) {
    const indent = indentOf(text, last.start);
    insertion = `,${format.eol}${indent}${name}${colon}${render(value, { ...format, indent, multiline: reference === null || reference.includes('\n'), spaced })}`;
  } else {
    const previous = members.at(-2); const gap = previous ? text.slice(previous.value.end, last.start) : '';
    insertion = `${/^[ \t]*,[ \t]*$/.test(gap) ? gap : spaced ? ', ' : ','}${name}${colon}${inline(value, spaced)}`;
  }
  return { text: text.slice(0, last.value.end) + insertion + text.slice(last.value.end) };
}
/** Exact inverse of insertMember: removes the member with the separator that insertion added. */
function removeMember(text: string, container: JsonNode, index: number, interior: string | undefined): string {
  const members = container.members!; const target = members[index]!;
  if (members.length === 1) return text.slice(0, container.start + 1) + (interior ?? '') + text.slice(container.end - 1);
  if (index > 0) return text.slice(0, members[index - 1]!.value.end) + text.slice(target.value.end);
  return text.slice(0, target.start) + text.slice(members[1]!.start);
}
function replaceValue(text: string, member: JsonMember, value: unknown, unit: string, eol: string): string {
  const old = text.slice(member.value.start, member.value.end);
  return text.slice(0, member.value.start) + render(value, { multiline: old.includes('\n'), indent: indentOf(text, member.start), unit, eol, spaced: /[:,] /.test(old) }) + text.slice(member.value.end);
}
function locate(root: JsonNode, label: string): { servers?: JsonMember; entry?: JsonMember } | { conflict: string } {
  const maps = root.members!.filter(member => member.key === 'mcpServers');
  if (maps.length > 1) return { conflict: `${label} defines mcpServers more than once; resolve the duplicate before changing it.` };
  const servers = maps[0];
  if (!servers) return {};
  if (!servers.value.members) throw new Error(`${label}: mcpServers must be an object`);
  const entries = servers.value.members.filter(member => member.key === 'codebudget');
  if (entries.length > 1) return { conflict: `${label} defines mcpServers.codebudget more than once; resolve the duplicate before changing it.` };
  return { servers, entry: entries[0] };
}
const withCreated = (created: Created, interior: string | undefined): Created => interior === undefined ? created : { ...created, interior };
function jsonInstall(text: string | null, label: string, server: JsonObject, receipt: Receipt | null): Edit {
  if (text === null || BLANK.test(text)) {
    if (receipt) return { conflict: REMOVED };
    const eol = text === null ? '\n' : eolOf(text);
    const after = `${text?.startsWith('\uFEFF') ? '\uFEFF' : ''}${JSON.stringify({ mcpServers: { codebudget: server } }, null, 2).split('\n').join(eol)}${eol}`;
    return { after, previous: null, created: { file: text === null, directories: [], container: 'document', ...(text === null ? {} : { blank: text }) } };
  }
  const root = parseJsonConfig(text, label);
  if (!root.members) throw new Error(`${label} must contain a JSON object`);
  const found = locate(root, label);
  if ('conflict' in found) return found;
  const unit = unitOf(text, root); const eol = eolOf(text);
  if (found.entry) {
    const current = JSON.parse(text.slice(found.entry.value.start, found.entry.value.end)) as unknown;
    if (!receipt || !equal(current, receipt.server)) return { conflict: UNOWNED };
    if (equal(current, server)) return { after: text, previous: plain(current) };
    if (!equal(launchless(current), launchless(server))) return { conflict: UNOWNED };
    return { after: replaceValue(text, found.entry, server, unit, eol), previous: plain(current), note: UPDATE_NOTE };
  }
  if (receipt) return { conflict: REMOVED };
  if (found.servers) {
    const edit = insertMember(text, found.servers.value, 'codebudget', server, { unit, eol, multiline: text.slice(root.start, root.end).includes('\n') });
    return { after: edit.text, previous: null, created: withCreated({ file: false, directories: [], container: null }, edit.interior) };
  }
  const edit = insertMember(text, root, 'mcpServers', { codebudget: server }, { unit, eol, multiline: true });
  return { after: edit.text, previous: null, created: withCreated({ file: false, directories: [], container: 'servers' }, edit.interior) };
}
function jsonUninstall(text: string | null, label: string, receipt: Receipt): Edit {
  if (text === null || BLANK.test(text)) return { after: text, previous: null };
  const root = parseJsonConfig(text, label);
  if (!root.members) throw new Error(`${label} must contain a JSON object`);
  const found = locate(root, label);
  if ('conflict' in found) return found;
  if (!found.servers || !found.entry) return { after: text, previous: null };
  const current = JSON.parse(text.slice(found.entry.value.start, found.entry.value.end)) as unknown;
  if (!equal(current, receipt.server)) return { conflict: EDITED };
  const created = receipt.created; const servers = found.servers.value;
  let after: string | null;
  if (servers.members!.length > 1 || !created?.container) after = removeMember(text, servers, servers.members!.indexOf(found.entry), created?.container ? undefined : created?.interior);
  else if (created.container === 'servers' || root.members.length > 1) after = removeMember(text, root, root.members.indexOf(found.servers), created.container === 'servers' ? created.interior : undefined);
  // The whole document was CodeBudget's: restore the absent or blank file it replaced.
  else after = created.file ? null : created.blank ?? '';
  return { after, previous: plain(current) };
}
function jsonShape(text: string | null): { value: unknown; entry: unknown } {
  const value = text === null || BLANK.test(text) ? {} : JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
  const servers = isRecord(value) ? value.mcpServers : undefined; const entry = isRecord(servers) ? servers.codebudget : undefined;
  if (isRecord(value) && isRecord(servers)) { delete servers.codebudget; if (!Object.keys(servers).length) delete value.mcpServers; }
  return { value, entry };
}

// TOML: the owned block is delimited by markers, so unrelated comments and tables are never re-serialized.
function parseTomlConfig(text: string, label: string): JsonObject {
  let value: unknown;
  try { value = parseToml(text); } catch (error) {
    const { line, column } = error as { line?: unknown; column?: unknown };
    throw new Error(`${label} is not valid TOML${typeof line === 'number' && typeof column === 'number' ? ` (line ${line}, column ${column})` : ''}; file content omitted`);
  }
  return obj(value, 'Configuration');
}
function tomlServers(config: JsonObject, label: string): JsonObject {
  if (config.mcp_servers === undefined) return {};
  if (!isRecord(config.mcp_servers)) throw new Error(`${label}: mcp_servers must be a table`);
  return config.mcp_servers;
}
const tomlBlock = (server: JsonObject, eol = '\n'): string => [TOML_START, TOML_HEADER, `command = ${JSON.stringify(server.command)}`, `args = ${JSON.stringify(server.args)}`, TOML_END, ''].join(eol);
function findTomlBlock(text: string, server: JsonObject): { start: number; end: number; eol: string } | { conflict: string } {
  const start = text.indexOf(TOML_START); const end = text.indexOf(TOML_END, start);
  if (start < 0 || end < 0 || text.indexOf(TOML_START, start + 1) !== -1 || (start > 0 && text[start - 1] !== '\n' && !(start === 1 && text[0] === '\uFEFF'))) return { conflict: 'Managed TOML markers were edited; preserving configuration' };
  const close = end + TOML_END.length; const stop = close + (text.startsWith('\r\n', close) ? 2 : text[close] === '\n' ? 1 : 0);
  const block = text.slice(start, stop);
  if (block.replace(/\r\n/g, '\n') !== tomlBlock(server)) return { conflict: 'Managed TOML block was edited; preserving configuration' };
  return { start, end: stop, eol: block.includes('\r\n') ? '\r\n' : '\n' };
}
function tomlInstall(text: string | null, label: string, server: JsonObject, receipt: Receipt | null): Edit {
  const current = tomlServers(text === null ? {} : parseTomlConfig(text, label), label).codebudget;
  if (current !== undefined) {
    if (!receipt || !equal(current, receipt.server)) return { conflict: UNOWNED };
    if (equal(current, server)) return { after: text, previous: plain(current) };
    if (!equal(launchless(plain(current)), launchless(server))) return { conflict: UNOWNED };
    const block = findTomlBlock(text!, receipt.server);
    if ('conflict' in block) return block;
    return { after: text!.slice(0, block.start) + tomlBlock(server, block.eol) + text!.slice(block.end), previous: plain(current), note: UPDATE_NOTE };
  }
  if (receipt) return { conflict: REMOVED };
  const eol = text === null ? '\n' : eolOf(text); const separator = text && !text.endsWith('\n') ? eol : '';
  const after = `${text ?? ''}${separator}${tomlBlock(server, eol)}`;
  try { parseToml(after); } catch { return { conflict: `Appending the managed [mcp_servers.codebudget] block would make ${label} invalid (for example when mcp_servers is an inline table); ${label} is preserved.` }; }
  return { after, previous: null, created: { file: text === null, directories: [], ...(separator ? { separator } : {}) } };
}
function tomlUninstall(text: string | null, label: string, receipt: Receipt): Edit {
  if (text === null) return { after: null, previous: null };
  const current = tomlServers(parseTomlConfig(text, label), label).codebudget;
  if (current === undefined) return { after: text, previous: null };
  if (!equal(current, receipt.server)) return { conflict: EDITED };
  const block = findTomlBlock(text, receipt.server);
  if ('conflict' in block) return block;
  // Remove the line ending install added only while nothing follows the block.
  const separator = receipt.created?.separator ?? '';
  const start = separator && block.end === text.length && text.slice(block.start - separator.length, block.start) === separator ? block.start - separator.length : block.start;
  const rest = text.slice(0, start) + text.slice(block.end);
  try { parseToml(rest); } catch { return { conflict: 'Managed TOML block was edited; preserving configuration' }; }
  return { after: receipt.created?.file && rest === '' ? null : rest, previous: plain(current) };
}
function tomlShape(text: string | null): { value: unknown; entry: unknown } {
  const value = text === null ? {} : plain(parseToml(text));
  const servers = value.mcp_servers; const entry = isRecord(servers) ? servers.codebudget : undefined;
  if (isRecord(servers)) { delete servers.codebudget; if (!Object.keys(servers).length) delete value.mcp_servers; }
  return { value, entry };
}
/** Defense in depth: an edit may change only the CodeBudget entry and containers CodeBudget created. */
function verifyEdit(label: string, before: string | null, after: string | null, entry: JsonObject | null, shape: (text: string | null) => { value: unknown; entry: unknown }): void {
  const previous = shape(before); const next = shape(after);
  if (!equal(next.entry, entry ?? undefined) || !equal(previous.value, next.value)) throw new Error(`CodeBudget could not change ${label} without altering other settings; the file is preserved`);
}

function parseReceipt(text: string | null, client: ClientId, configRel: string): Receipt | null {
  if (text === null) return null;
  let value: JsonObject;
  try { value = obj(JSON.parse(text), 'Receipt'); } catch { throw new Error(INVALID_RECEIPT); }
  if (value.schemaVersion !== 1 || value.client !== client || value.configPath !== configRel || value.owned !== true || !isRecord(value.server)) throw new Error(INVALID_RECEIPT);
  const created = value.created; const allowed = ancestors(configRel);
  const whitespace = (item: unknown) => item === undefined || (typeof item === 'string' && /^[ \t\r\n]{0,4096}$/.test(item));
  if (created !== undefined && (!isRecord(created) || typeof created.file !== 'boolean' || !Array.isArray(created.directories) || !created.directories.every(item => typeof item === 'string' && allowed.includes(item))
    || ![undefined, null, 'document', 'servers'].includes(created.container as string | null | undefined) || !whitespace(created.interior) || !whitespace(created.separator)
    || !(created.blank === undefined || (typeof created.blank === 'string' && created.blank.length <= 4096 && BLANK.test(created.blank))))) throw new Error(INVALID_RECEIPT);
  return value as unknown as Receipt;
}
const receiptText = (receipt: Receipt): string => `${JSON.stringify(receipt, null, 2)}\n`;

// Locks: pid + start time; a lock whose process is gone or that is older than ten minutes is stale.
const alive = (pid: number): boolean => { if (pid === process.pid) return true; try { process.kill(pid, 0); return true; } catch (error) { return errorCode(error) === 'EPERM'; } };
async function lockState(path: string): Promise<{ live: boolean; pid: number | null; text: string } | null> {
  let text: string | null; let modified: number;
  try { text = await readText(path, LOCK); modified = (await lstat(path)).mtimeMs; } catch (error) { if (errorCode(error) === 'ENOENT') return null; throw error; }
  if (text === null) return null;
  let pid: number | null = null; let started = modified;
  try {
    const value = obj(JSON.parse(text), 'Lock');
    if (typeof value.pid === 'number' && Number.isSafeInteger(value.pid) && value.pid > 0) pid = value.pid;
    const time = Date.parse(String(value.startedAt)); if (Number.isFinite(time)) started = time;
  } catch { /* An unreadable lock is judged by its age. */ }
  return { live: Date.now() - started < STALE_LOCK_MS && (pid === null || alive(pid)), pid, text };
}
async function legacyLock(root: string): Promise<'live' | 'stale' | null> {
  try { return Date.now() - (await lstat(at(root, LEGACY_LOCK))).mtimeMs < STALE_LOCK_MS ? 'live' : 'stale'; } catch (error) { if (errorCode(error) === 'ENOENT') return null; throw error; }
}
const busy = (pid: number | null) => `Another CodeBudget adapter change is in progress${pid ? ` (process ${pid})` : ''}; retry after it finishes.`;
const LEGACY_BUSY = `An earlier CodeBudget version holds ${LEGACY_LOCK}; retry after it finishes, or remove that file if no adapter command is running.`;
async function acquireLock(root: string): Promise<string> {
  const path = at(root, LOCK); const token = randomUUID();
  const text = `${JSON.stringify({ schemaVersion: 1, pid: process.pid, startedAt: new Date().toISOString(), token })}\n`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      return token;
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      const state = await lockState(path);
      if (state?.live) throw new Error(busy(state.pid));
      // Replace a stale lock only while it still holds the content judged stale.
      if (state && await readText(path, LOCK) === state.text) await unlink(path).catch(() => undefined);
    }
  }
  throw new Error(busy(null));
}
async function releaseLock(root: string, token: string): Promise<void> {
  const path = at(root, LOCK);
  try { const text = await readText(path, LOCK); if (text !== null && (JSON.parse(text) as { token?: unknown }).token === token) await unlink(path); } catch { /* A replaced or removed lock is not ours. */ }
}

// Journal: written before any configuration changes; a leftover journal is rolled back before anything else.
function parseJournal(text: string): Journal {
  let value: JsonObject;
  try { value = obj(JSON.parse(text), 'Journal'); } catch { throw new Error(INVALID_JOURNAL); }
  const digestOrNull = (item: unknown) => item === null || (typeof item === 'string' && /^[0-9a-f]{64}$/.test(item));
  const valid = value.schemaVersion === 1 && typeof value.id === 'string' && typeof value.client === 'string' && Object.hasOwn(CONFIG_PATHS, value.client) && (value.action === 'install' || value.action === 'uninstall')
    && typeof value.startedAt === 'string' && Array.isArray(value.directories) && value.directories.every(item => typeof item === 'string' && CREATABLE.has(item))
    && Array.isArray(value.files) && value.files.length <= 4 && value.files.every(file => isRecord(file) && typeof file.path === 'string' && MANAGED.has(file.path)
      && digestOrNull(file.beforeHash) && digestOrNull(file.afterHash) && file.beforeHash !== file.afterHash
      && (file.mode === null || (typeof file.mode === 'number' && Number.isInteger(file.mode) && file.mode >= 0 && file.mode <= 0o7777))
      && (file.backup === null ? file.beforeHash === null : typeof file.backup === 'string' && BACKUP_NAME.test(file.backup) && file.beforeHash !== null));
  if (!valid) throw new Error(INVALID_JOURNAL);
  return value as unknown as Journal;
}
/** Inspect (write=false) or roll back (write=true) an interrupted transaction. Files changed after the interruption are kept. */
async function recoverJournal(root: string, write: boolean): Promise<{ recovery: AdapterRecovery; conflicts: string[] } | null> {
  const journalPath = at(root, JOURNAL);
  const text = await readText(journalPath, JOURNAL);
  if (text === null) return null;
  const recovery: AdapterRecovery = { journalHash: hash(text), client: null, action: null, startedAt: null, restore: [], keep: [] };
  let journal: Journal;
  try { journal = parseJournal(text); } catch (error) { if (write) throw error; return { recovery, conflicts: [(error as Error).message] }; }
  Object.assign(recovery, { client: journal.client, action: journal.action, startedAt: journal.startedAt });
  const conflicts: string[] = [];
  for (const file of [...journal.files].reverse()) {
    const path = at(root, file.path); await assertSafePath(root, path);
    const current = digest(await readText(path, file.path));
    if (current === file.beforeHash) continue;
    if (current !== file.afterHash) { recovery.keep.push(path); continue; }
    let previous: string | null = null;
    if (file.backup !== null) {
      previous = await readText(at(root, `${BACKUPS}/${file.backup}`), 'Backup').catch(() => null);
      if (digest(previous) !== file.beforeHash) { conflicts.push(`The backup needed to roll back ${file.path} is missing or damaged; ${JOURNAL} and ${BACKUPS} are kept for manual recovery.`); continue; }
    }
    recovery.restore.push(path);
    if (write) await restore(path, previous, file.mode ?? defaultMode(file.path));
  }
  if (write) {
    if (conflicts.length) throw new Error(conflicts.join(' '));
    await removeEmptyDirectories(root, journal.directories);
    await removeFile(journalPath);
    if (!recovery.keep.length) for (const file of journal.files) if (file.backup) await removeFile(at(root, `${BACKUPS}/${file.backup}`)).catch(() => undefined);
  }
  return { recovery, conflicts };
}
const backupName = (rel: string): string => `${encodeURIComponent(rel)}~${Date.now()}-${randomUUID().slice(0, 8)}.backup`;
/** Keep the newest backups per target file; older ones (including pre-journal `<client>-<uuid>` names) are pruned. */
async function pruneBackups(root: string): Promise<void> {
  const directory = at(root, BACKUPS); const groups = new Map<string, { name: string; order: number }[]>();
  let names: string[];
  try { names = await readdir(directory); } catch { return; }
  for (const name of names) {
    const current = BACKUP_NAME.exec(name); const legacy = current ? null : LEGACY_BACKUP.exec(name);
    if (!current && !legacy) continue;
    const order = current ? Number(current[2]) : (await lstat(join(directory, name)).catch(() => null))?.mtimeMs ?? 0;
    const key = current ? current[1]! : `legacy:${legacy![1]}`;
    groups.set(key, [...groups.get(key) ?? [], { name, order }]);
  }
  for (const entries of groups.values()) {
    entries.sort((a, b) => b.order - a.order || b.name.localeCompare(a.name));
    for (const { name } of entries.slice(KEEP_BACKUPS)) await unlink(join(directory, name)).catch(() => undefined);
  }
}

async function compute(options: AdapterChangeOptions, holdingLock: boolean): Promise<Planned> {
  const client = options.client as unknown;
  if (typeof client !== 'string' || !Object.hasOwn(CONFIG_PATHS, client)) throw new Error(`Unknown client; expected one of: ${CLIENTS.join(', ')}`);
  if (options.action !== 'install' && options.action !== 'uninstall') throw new Error('Adapter action must be install or uninstall');
  const id = client as ClientId; const root = await realpath(resolve(options.projectRoot));
  const configRel = CONFIG_PATHS[id]; const receiptRel = `${STATE}/${id}.json`;
  const configPath = at(root, configRel); const receiptPath = at(root, receiptRel);
  for (const rel of [configRel, receiptRel, JOURNAL, LOCK]) await assertSafePath(root, at(root, rel));
  const plan: AdapterPlan = { schemaVersion: 2, client: id, action: options.action, projectRoot: root, server: null, changes: [], conflicts: [], notes: [SCOPE_NOTE], recovery: null };
  const planned: Planned = { plan, files: [], createdDirectories: [], removableDirectories: [] };
  if (!holdingLock) {
    const lock = await lockState(at(root, LOCK)); const legacy = await legacyLock(root);
    if (lock?.live) plan.conflicts.push(busy(lock.pid)); else if (lock) plan.notes.push('A stale adapter lock from an interrupted run will be replaced.');
    if (legacy === 'live') plan.conflicts.push(LEGACY_BUSY); else if (legacy === 'stale') plan.notes.push(`A stale ${LEGACY_LOCK} from an earlier CodeBudget version will be removed.`);
    if (plan.conflicts.length) return planned;
  }
  const pending = await recoverJournal(root, false);
  if (pending) { plan.recovery = pending.recovery; plan.conflicts.push(...pending.conflicts); plan.notes.push(RECOVERY_NOTE); return planned; }
  const before = await readText(configPath, configRel); const receiptBefore = await readText(receiptPath, receiptRel);
  const receipt = parseReceipt(receiptBefore, id, configRel);
  const configMode = await modeOf(configPath); const receiptMode = await modeOf(receiptPath);
  const key = id === 'codex' ? 'mcp_servers.codebudget' : 'mcpServers.codebudget'; const shape = id === 'codex' ? tomlShape : jsonShape;
  const add = (path: string, role: FileChange['role'], old: string | null, next: string | null, beforeMode: number | null, entry: EntryChange | null) => {
    if (old === next) return;
    const change: FileChange = { path, role, operation: old === null ? 'create' : next === null ? 'delete' : 'update', beforeHash: digest(old), afterHash: digest(next), entry };
    planned.files.push({ change, before: old, after: next, beforeMode, mode: role === 'receipt' ? 0o600 : beforeMode ?? defaultMode(relPath(root, path)) });
    plan.changes.push(change);
  };
  if (options.action === 'install') {
    const command = options.command ?? DEFAULT_COMMAND; const args = options.args ?? [...DEFAULT_ARGS];
    if (typeof command !== 'string' || !command.trim() || hasControl(command) || !Array.isArray(args) || args.some(arg => typeof arg !== 'string' || hasControl(arg))) throw new Error('Invalid executable or argument');
    const server: JsonObject = id === 'claude' || id === 'cursor' ? { type: 'stdio', command, args: [...args] } : { command, args: [...args] };
    plan.server = server;
    const edit = id === 'codex' ? tomlInstall(before, configRel, server, receipt) : jsonInstall(before, configRel, server, receipt);
    if ('conflict' in edit) { plan.conflicts.push(edit.conflict); return planned; }
    if (edit.after === before) { plan.notes.push('The owned CodeBudget entry is already installed and current.'); return planned; }
    verifyEdit(configRel, before, edit.after, server, shape);
    const created = edit.created ? { ...edit.created, directories: before === null ? (await Promise.all(ancestors(configRel).map(async directory => await modeOf(at(root, directory)) === null ? directory : null))).filter((item): item is string => item !== null) : [] } : receipt?.created;
    planned.createdDirectories = edit.created && before === null ? created!.directories : [];
    add(receiptPath, 'receipt', receiptBefore, receiptText({ schemaVersion: 1, client: id, configPath: configRel, server, owned: true, ...(created ? { created } : {}) }), receiptMode, null);
    add(configPath, 'config', before, edit.after, configMode, { key, before: edit.previous, after: server });
    plan.notes.push(FORMAT_NOTE, BACKUP_NOTE, ...(edit.note ? [edit.note] : []));
  } else {
    if (!receipt) { plan.notes.push('No CodeBudget ownership receipt; nothing is removed.'); return planned; }
    const edit = id === 'codex' ? tomlUninstall(before, configRel, receipt) : jsonUninstall(before, configRel, receipt);
    if ('conflict' in edit) { plan.conflicts.push(edit.conflict); return planned; }
    if (edit.after !== before) {
      verifyEdit(configRel, before, edit.after, null, shape);
      add(configPath, 'config', before, edit.after, configMode, { key, before: edit.previous, after: null });
      if (edit.after === null) {
        planned.removableDirectories = receipt.created?.directories ?? [];
        plan.notes.push(`CodeBudget created ${configRel}; it is removed because nothing else remains${planned.removableDirectories.length ? ', together with created directories that are empty' : ''}.`);
      }
    }
    add(receiptPath, 'receipt', receiptBefore, null, receiptMode, null);
    plan.notes.push(FORMAT_NOTE, BACKUP_NOTE);
  }
  return planned;
}

export async function planAdapterChange(options: AdapterChangeOptions): Promise<AdapterPlan> {
  return (await compute(options, false)).plan;
}

const processSignals: AdapterSignalSource = { on: (signal, listener) => process.on(signal, listener), off: (signal, listener) => process.off(signal, listener), raise: (signal) => { process.kill(process.pid, signal); } };
const comparable = (plan: AdapterPlan) => JSON.stringify([plan.client, plan.action, plan.projectRoot, plan.server, plan.recovery, plan.conflicts, plan.changes.map(change => [change.path, change.role, change.operation, change.beforeHash, change.afterHash])]);

/**
 * Journaled apply: backups and a journal precede every configuration write, a lock under .codebudget/adapters
 * serializes runs, SIGINT/SIGTERM roll back before the signal is re-raised, and a failed rollback keeps the
 * journal and backups so the next adapter command finishes it.
 */
export async function applyAdapterPlan(plan: AdapterPlan, options: AdapterApplyOptions = {}): Promise<AdapterApplyResult> {
  if (!isRecord(plan) || plan.schemaVersion !== 2 || !Array.isArray(plan.changes) || !Array.isArray(plan.conflicts)) throw new Error('Unsupported adapter plan; regenerate it');
  if (plan.conflicts.length) throw new Error(`Adapter configuration conflict: ${plan.conflicts.join(' ')}`);
  const result: AdapterApplyResult = { applied: false, backups: [], recovered: [], notes: [] };
  if (!plan.changes.length && !plan.recovery) return result;
  const root = await realpath(plan.projectRoot);
  for (const rel of [STATE, BACKUPS, JOURNAL, LOCK]) await assertSafePath(root, at(root, rel));
  const signals = options.signals ?? processSignals; let interrupted: NodeJS.Signals | null = null;
  const listeners = SIGNALS.map(signal => [signal, () => { interrupted ??= signal; }] as const);
  for (const [signal, listener] of listeners) signals.on(signal, listener);
  const checkpoint = () => { if (interrupted) throw new Error(`Adapter change interrupted by ${interrupted}`); };
  try {
    ensurePrivateDirectory(at(root, STATE)); ensurePrivateDirectory(at(root, BACKUPS));
    const legacy = await legacyLock(root);
    if (legacy === 'live') throw new Error(LEGACY_BUSY);
    const token = await acquireLock(root);
    try {
      if (legacy === 'stale') await removeFile(at(root, LEGACY_LOCK));
      checkpoint();
      if (plan.recovery) {
        if (digest(await readText(at(root, JOURNAL), JOURNAL)) !== plan.recovery.journalHash) throw new Error(STALE_PREVIEW);
        const recovered = await recoverJournal(root, true);
        result.recovered = recovered?.recovery.restore ?? [];
        result.notes.push('The interrupted adapter change was rolled back; run the command again for the requested change.', ...(recovered?.recovery.keep.length ? ['Files changed after the interruption were kept as they are.'] : []));
        await pruneBackups(root);
        return result;
      }
      const launch = plan.server ? { command: plan.server.command as string, args: plan.server.args as string[] } : {};
      const planned = await compute({ client: plan.client, action: plan.action, projectRoot: root, ...launch }, true);
      if (comparable(planned.plan) !== comparable(plan)) throw new Error(STALE_PREVIEW);
      return await commit(root, planned, options, checkpoint, result);
    } finally { await releaseLock(root, token); }
  } finally {
    for (const [signal, listener] of listeners) signals.off(signal, listener);
    if (interrupted) signals.raise(interrupted);
  }
}

async function commit(root: string, planned: Planned, options: AdapterApplyOptions, checkpoint: () => void, result: AdapterApplyResult): Promise<AdapterApplyResult> {
  const { plan, files } = planned;
  const journal: Journal = { schemaVersion: 1, id: randomUUID(), client: plan.client, action: plan.action, pid: process.pid, startedAt: new Date().toISOString(), files: [], directories: planned.createdDirectories };
  for (const file of files) {
    const rel = relPath(root, file.change.path); let backup: string | null = null;
    if (file.before !== null) {
      backup = backupName(rel); const path = at(root, `${BACKUPS}/${backup}`);
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(file.before, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      result.backups.push(path);
    }
    journal.files.push({ path: rel, beforeHash: file.change.beforeHash, afterHash: file.change.afterHash, mode: file.beforeMode, backup });
  }
  await writeAtomic(at(root, JOURNAL), `${JSON.stringify(journal, null, 2)}\n`, 0o600);
  const committed: PlannedFile[] = [];
  try {
    for (const [index, file] of files.entries()) {
      await options.beforeCommit?.(index); checkpoint();
      const path = file.change.path; await assertSafePath(root, path);
      if (digest(await readText(path, relPath(root, path))) !== file.change.beforeHash) throw new Error('Configuration changed during installation; refusing overwrite');
      committed.push(file);
      await restore(path, file.after, file.mode);
    }
    await removeEmptyDirectories(root, planned.removableDirectories);
    await options.beforeCommit?.(files.length); checkpoint();
    await removeFile(at(root, JOURNAL));
  } catch (error) {
    throw await rollback(root, journal, committed, result, error);
  }
  result.applied = true;
  await pruneBackups(root).catch(() => { result.notes.push('Older backups could not be pruned.'); });
  return result;
}

/** Undo committed writes newest first. Each restore is guarded; backups and journal stay until every restore succeeded. */
async function rollback(root: string, journal: Journal, committed: PlannedFile[], result: AdapterApplyResult, error: unknown): Promise<Error> {
  const failures: unknown[] = []; const kept: string[] = [];
  for (const file of [...committed].reverse()) {
    try {
      const path = file.change.path; await assertSafePath(root, path);
      const current = digest(await readText(path, relPath(root, path)));
      if (current === file.change.beforeHash) continue;
      if (current !== file.change.afterHash) { kept.push(relPath(root, path)); continue; }
      await restore(path, file.before, file.beforeMode ?? file.mode);
    } catch (restoreError) { failures.push(restoreError); }
  }
  await removeEmptyDirectories(root, journal.directories);
  if (!failures.length) {
    try { await removeFile(at(root, JOURNAL)); } catch (journalError) { failures.push(journalError); }
    if (!failures.length && !kept.length) { for (const backup of result.backups) await removeFile(backup).catch(() => undefined); result.backups = []; }
  }
  const original = error instanceof Error ? error : new Error(String(error));
  const notes: string[] = [];
  if (kept.length) notes.push(`Rollback kept concurrently changed ${kept.join(', ')}.`);
  if (failures.length) notes.push(`Rollback incomplete: ${failures.length} restore step(s) failed (${failures.map(item => errorCode(item) ?? (item as Error)?.name ?? 'error').join(', ')}); ${JOURNAL} and backups in ${BACKUPS} are kept, and the next adapter command rolls back the rest.`);
  if (notes.length) original.message = `${original.message}. ${notes.join(' ')}`;
  return Object.assign(original, { rollbackErrors: failures, keptPaths: kept });
}

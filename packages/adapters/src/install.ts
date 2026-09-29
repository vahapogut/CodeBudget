import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseToml } from 'smol-toml';
import ignore from 'ignore';
import type { ClientId } from './capabilities.js';

type JsonObject = Record<string, unknown>;
export interface AdapterChangeOptions {
  client: ClientId;
  action: 'install' | 'uninstall';
  projectRoot: string;
  command?: string;
  args?: string[];
}
export interface FileChange { path: string; before: string | null; after: string | null; beforeHash: string | null }
export interface AdapterPlan { schemaVersion: 1; client: ClientId; action: 'install' | 'uninstall'; projectRoot: string; changes: FileChange[]; conflicts: string[]; notes: string[] }
interface Receipt { schemaVersion: 1; client: ClientId; configPath: string; server: JsonObject; owned: true }
const paths: Record<ClientId, string> = { claude: '.mcp.json', codex: '.codex/config.toml', cursor: '.cursor/mcp.json', antigravity: '.agents/mcp_config.json' };
const TOML_HEADER = '[mcp_servers.codebudget]';
const TOML_START = '# CodeBudget managed MCP registration';
const TOML_END = '# End CodeBudget managed MCP registration';
const hash = (text: string | null) => text === null ? null : createHash('sha256').update(text).digest('hex');
// TOML parsers use null-prototype objects; compare config data, not JS prototypes.
const equal = (left: unknown, right: unknown): boolean => left === undefined || right === undefined ? left === right : isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)));
function obj(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}
async function readOptional(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
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
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
function parseConfig(text: string | null, client: ClientId): JsonObject {
  if (!text?.trim()) return {};
  return obj(client === 'codex' ? parseToml(text) : JSON.parse(text), 'Configuration');
}
function serverMap(config: JsonObject, client: ClientId): JsonObject {
  const key = client === 'codex' ? 'mcp_servers' : 'mcpServers';
  return config[key] === undefined ? {} : obj(config[key], key);
}
function tomlBlock(server: JsonObject): string {
  return `${TOML_START}\n${TOML_HEADER}\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(server.args)}\n${TOML_END}\n`;
}
function removeTomlBlock(text: string, server: JsonObject): string {
  const start = text.indexOf(TOML_START);
  const end = text.indexOf(TOML_END, start);
  if (start < 0 || end < 0 || text.indexOf(TOML_START, start + 1) !== -1) throw new Error('Managed TOML markers were edited; preserving configuration');
  const afterEnd = end + TOML_END.length + (text[end + TOML_END.length] === '\r' ? 2 : text[end + TOML_END.length] === '\n' ? 1 : 0);
  const block = text.slice(start, afterEnd);
  if (block.replace(/\r\n/g, '\n') !== tomlBlock(server)) throw new Error('Managed TOML block was edited; preserving configuration');
  const parsed = serverMap(parseConfig(block, 'codex'), 'codex');
  if (!equal(parsed.codebudget, server) || Object.keys(parsed).length !== 1) throw new Error('Managed TOML block was edited; preserving configuration');
  const rest = text.slice(0, start) + text.slice(afterEnd);
  parseConfig(rest, 'codex');
  return rest;
}
export async function planAdapterChange(options: AdapterChangeOptions): Promise<AdapterPlan> {
  if (!(options.client in paths)) throw new Error('Unknown client');
  const root = await realpath(resolve(options.projectRoot));
  const configPath = join(root, paths[options.client]);
  const receiptPath = join(root, '.codebudget', 'adapters', `${options.client}.json`);
  await assertSafePath(root, configPath); await assertSafePath(root, receiptPath);
  const before = await readOptional(configPath);
  const receiptText = await readOptional(receiptPath);
  const plan: AdapterPlan = { schemaVersion: 1, client: options.client, action: options.action, projectRoot: root, changes: [], conflicts: [], notes: ['Only project-local MCP registration is changed. Native Claude plugin is separately loaded with --plugin-dir.'] };
  const config = parseConfig(before, options.client);
  const servers = serverMap(config, options.client);
  let receipt: Receipt | null = null;
  if (receiptText !== null) {
    const value = obj(JSON.parse(receiptText), 'Receipt');
    if (value.schemaVersion !== 1 || value.client !== options.client || value.configPath !== paths[options.client] || value.owned !== true) throw new Error('Invalid adapter ownership receipt');
    obj(value.server, 'Receipt server'); receipt = value as unknown as Receipt;
  }
  const add = (path: string, old: string | null, after: string | null) => { if (old !== after) plan.changes.push({ path, before: old, after, beforeHash: hash(old) }); };
  if (options.action === 'install') {
    const command = options.command ?? 'codebudget'; const args = options.args ?? ['mcp', 'serve'];
    if (!command.trim() || command.includes('\0') || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('Invalid executable or argument');
    const server: JsonObject = options.client === 'claude' || options.client === 'cursor' ? { type: 'stdio', command, args } : { command, args };
    if (servers.codebudget !== undefined) {
      if (!receipt || !equal(servers.codebudget, receipt.server) || !equal(server, receipt.server)) plan.conflicts.push('Existing codebudget MCP entry is unowned or modified; no fields will be overwritten.');
      return plan;
    }
    if (receipt) { plan.conflicts.push('MCP entry was removed after installation; remove stale ownership receipt explicitly before reinstalling.'); return plan; }
    const after = options.client === 'codex'
      ? `${before ?? ''}${before?.endsWith('\n') || !before ? '' : '\n'}${tomlBlock(server)}`
      : `${JSON.stringify({ ...config, mcpServers: { ...servers, codebudget: server } }, null, 2)}\n`;
    parseConfig(after, options.client);
    const ignorePath = join(root, '.gitignore'); await assertSafePath(root, ignorePath);
    const ignoreBefore = await readOptional(ignorePath);
    const excludes = ignore().add(ignoreBefore ?? '');
    if (!excludes.ignores('.codebudget/adapters/backups/probe') || !excludes.ignores('.codebudget/adapters/ownership.json')) {
      add(ignorePath, ignoreBefore, `${ignoreBefore ?? ''}${ignoreBefore?.endsWith('\n') || !ignoreBefore ? '' : '\n'}# CodeBudget local state and credential-bearing rollback backups\n/.codebudget/\n`);
    }
    add(configPath, before, after);
    add(receiptPath, receiptText, `${JSON.stringify({ schemaVersion: 1, client: options.client, configPath: paths[options.client], server, owned: true } satisfies Receipt, null, 2)}\n`);
  } else {
    if (!receipt) { plan.notes.push('No CodeBudget ownership receipt; nothing is removed.'); return plan; }
    if (servers.codebudget !== undefined && !equal(servers.codebudget, receipt.server)) { plan.conflicts.push('CodeBudget MCP entry was edited after installation; it is preserved.'); return plan; }
    if (servers.codebudget !== undefined) {
      let after: string;
      if (options.client === 'codex') {
        try { after = removeTomlBlock(before ?? '', receipt.server); } catch (error) { plan.conflicts.push((error as Error).message); return plan; }
      } else {
        const remaining = { ...servers }; delete remaining.codebudget;
        after = `${JSON.stringify({ ...config, mcpServers: remaining }, null, 2)}\n`;
      }
      add(configPath, before, after);
    }
    add(receiptPath, receiptText, null);
  }
  return plan;
}
async function atomicWrite(path: string, value: string | null): Promise<void> {
  if (value === null) { await unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); return; }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(value, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => undefined); }
}
export async function applyAdapterPlan(plan: AdapterPlan, options: { beforeCommit?: (index: number) => void | Promise<void> } = {}): Promise<{ applied: boolean; backups: string[] }> {
  if (plan.conflicts.length) throw new Error(`Adapter configuration conflict: ${plan.conflicts.join(' ')}`);
  if (!plan.changes.length) return { applied: false, backups: [] };
  const root = await realpath(plan.projectRoot);
  const lockPath = join(root, '.codebudget-adapter.lock');
  await assertSafePath(root, lockPath);
  const lock = await open(lockPath, 'wx', 0o600);
  const backups: string[] = []; const backupHashes = new Map<string, string | null>(); const committed: FileChange[] = [];
  try {
    for (const change of plan.changes) {
      await assertSafePath(root, change.path);
      if (hash(await readOptional(change.path)) !== change.beforeHash) throw new Error('Configuration changed since preview; regenerate the plan');
    }
    for (const [index, change] of plan.changes.entries()) {
      if (change.before !== null) {
        const backup = join(root, '.codebudget', 'adapters', 'backups', `${plan.client}-${randomUUID()}.backup`);
        await assertSafePath(root, backup); await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
        await writeFile(backup, change.before, { flag: 'wx', mode: 0o600 }); backups.push(backup); backupHashes.set(backup, hash(change.before));
      }
      await options.beforeCommit?.(index);
      await assertSafePath(root, change.path);
      if (hash(await readOptional(change.path)) !== change.beforeHash) throw new Error('Configuration changed during installation; refusing overwrite');
      await atomicWrite(change.path, change.after); committed.push(change);
    }
    return { applied: true, backups };
  } catch (error) {
    // Failed transactions retain no credential-bearing backup after undoing the ignore rule.
    // A concurrent edit to a backup is preserved; leave the exclusion in that rare case.
    let preserveExclusion = false;
    for (const backup of backups) {
      try {
        if (hash(await readOptional(backup)) === backupHashes.get(backup)) await unlink(backup);
        else preserveExclusion = true;
      } catch { preserveExclusion = true; }
    }
    for (const change of committed.reverse()) {
      if (preserveExclusion && change.path === join(root, '.gitignore')) continue;
      if (hash(await readOptional(change.path)) === hash(change.after)) await atomicWrite(change.path, change.before);
    }
    throw error;
  } finally { await lock.close(); await unlink(lockPath).catch(() => undefined); }
}

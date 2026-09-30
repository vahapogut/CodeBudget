import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClientId } from './capabilities.js';
import { applyAdapterPlan, planAdapterChange, type AdapterChangeOptions, type AdapterSignalSource } from './install.js';

const roots: string[] = [];
async function project(): Promise<string> { const path = await realpath(await mkdtemp(join(tmpdir(), 'codebudget-install-'))); roots.push(path); return path; }
afterEach(async () => { for (const root of roots.splice(0)) { const rel = relative(await realpath(tmpdir()), root); if (isAbsolute(root) && !rel.startsWith('..')) await rm(root, { recursive: true, force: true }); } });
const posix = process.platform !== 'win32';
const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const plan = (projectRoot: string, action: 'install' | 'uninstall', client: ClientId = 'claude', extra: Partial<AdapterChangeOptions> = {}) => planAdapterChange({ client, projectRoot, action, ...extra });
const install = async (projectRoot: string, client: ClientId = 'claude', extra: Partial<AdapterChangeOptions> = {}) => applyAdapterPlan(await plan(projectRoot, 'install', client, extra));
const uninstall = async (projectRoot: string, client: ClientId = 'claude') => applyAdapterPlan(await plan(projectRoot, 'uninstall', client));
const exists = async (path: string) => lstat(path).then(() => true, () => false);
const mode = async (path: string) => (await stat(path)).mode & 0o777;
const state = (root: string, ...parts: string[]) => join(root, '.codebudget', 'adapters', ...parts);
const portable = { type: 'stdio', command: 'codebudget', args: ['mcp', 'serve'] };
// Token-shaped fixtures are assembled at runtime so repository secret scanners do not report them as leaks.
const SLACK_SECRET = ['xoxb', '4417', '99231', 'Zq8RealSlackBotSecret'].join('-');
const SECRETS = `{"mcpServers":{"slack":{"command":"npx","env":{"SLACK_BOT_TOKEN":"${SLACK_SECRET}"}},"db":{"command":"npx","args":["postgresql://admin:Pr0dDbPassw0rd@db.internal:5432/app"]}}}\n`;
const leaks = (text: string) => ['xoxb-4417', 'SLACK_BOT_TOKEN', 'Pr0dDbPassw0rd', 'db.internal'].filter(secret => text.includes(secret));

describe('adapter plans disclose only the CodeBudget entry', () => {
  it('previews install, update and uninstall with the owned entry, paths and hashes only', async () => {
    const root = await project(); await writeFile(join(root, '.mcp.json'), SECRETS);
    const installPlan = await plan(root, 'install');
    expect(leaks(JSON.stringify(installPlan))).toEqual([]);
    expect(installPlan.changes.map(change => Object.keys(change).sort())).toEqual(Array(2).fill(['afterHash', 'beforeHash', 'entry', 'operation', 'path', 'role']));
    expect(installPlan.changes[1]).toMatchObject({ path: join(root, '.mcp.json'), role: 'config', operation: 'update', beforeHash: sha256(SECRETS), entry: { key: 'mcpServers.codebudget', before: null, after: portable } });
    await applyAdapterPlan(installPlan);
    const update = await plan(root, 'install', 'claude', { command: '/opt/node/bin/node', args: ['/opt/codebudget/cli.mjs', 'mcp', 'serve'] });
    expect(leaks(JSON.stringify(update))).toEqual([]);
    expect(update.changes[1]!.entry).toEqual({ key: 'mcpServers.codebudget', before: portable, after: { type: 'stdio', command: '/opt/node/bin/node', args: ['/opt/codebudget/cli.mjs', 'mcp', 'serve'] } });
    const removal = await plan(root, 'uninstall');
    expect(leaks(JSON.stringify(removal))).toEqual([]);
    expect(removal.changes[0]).toMatchObject({ operation: 'update', entry: { before: portable, after: null } });
    await applyAdapterPlan(removal);
    expect(await readFile(join(root, '.mcp.json'), 'utf8')).toBe(SECRETS);
  });

  it('reports parse failures with the path and position but never the file content', async () => {
    const root = await project(); await mkdir(join(root, '.codex'));
    await writeFile(join(root, '.codex', 'config.toml'), `[mcp_servers.slack]\ncommand = "npx"\nenv = { SLACK_BOT_TOKEN = "${SLACK_SECRET}" SLACK_TEAM_ID = "T0123" }\n`);
    const toml = await plan(root, 'install', 'codex').catch((error: Error) => error.message);
    expect(toml).toMatch(/^\.codex\/config\.toml is not valid TOML \(line 3, column \d+\); file content omitted$/); expect(leaks(String(toml))).toEqual([]);
    await writeFile(join(root, '.mcp.json'), `{\n  "mcpServers": { "slack": { "env": { "SLACK_BOT_TOKEN": '${SLACK_SECRET}' } } }\n}\n`);
    const json = await plan(root, 'install').catch((error: Error) => error.message);
    expect(json).toBe('.mcp.json is not valid JSON (line 2, column 58); file content omitted');
    await writeFile(join(root, '.mcp.json'), Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]));
    await expect(plan(root, 'install')).rejects.toThrow('.mcp.json is not valid UTF-8; file content omitted');
    await writeFile(join(root, '.mcp.json'), SECRETS); await install(root);
    await writeFile(state(root, 'claude.json'), `{"server": "${SLACK_SECRET}"`);
    const receipt = await plan(root, 'uninstall').catch((error: Error) => error.message);
    expect(receipt).toBe('Invalid adapter ownership receipt');
  });
});

describe('format-preserving configuration edits', () => {
  it('keeps every other byte of a tab-indented CRLF team file, including key order and 64-bit numbers', async () => {
    const root = await project(); const path = join(root, '.mcp.json');
    const original = '{\r\n\t"mcpServers": {\r\n\t\t"zeta": { "command": "zeta-mcp", "args": ["--channel", "1"] },\r\n\t\t"2024": { "command": "legacy" }\r\n\t},\r\n\t"x-team": { "guildId": 1234567890123456789 }\r\n}\r\n';
    await writeFile(path, original); await install(root);
    expect(await readFile(path, 'utf8')).toBe(original.replace('"2024": { "command": "legacy" }', '"2024": { "command": "legacy" },\r\n\t\t"codebudget": { "type": "stdio", "command": "codebudget", "args": ["mcp", "serve"] }'));
    await uninstall(root);
    expect(await readFile(path, 'utf8')).toBe(original);
  });

  it('adds a pretty entry to a pretty file and keeps a byte-order mark', async () => {
    const root = await project(); const path = join(root, '.mcp.json');
    const pretty = `${JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2)}\n`;
    await writeFile(path, pretty); await install(root);
    expect(await readFile(path, 'utf8')).toBe(`${JSON.stringify({ mcpServers: { other: { command: 'x' }, codebudget: portable } }, null, 2)}\n`);
    await uninstall(root); expect(await readFile(path, 'utf8')).toBe(pretty);
    await writeFile(path, '\uFEFF{"mcpServers":{}}\n'); await install(root);
    const installed = await readFile(path, 'utf8');
    expect(installed.startsWith('\uFEFF')).toBe(true); expect(JSON.parse(installed.slice(1))).toEqual({ mcpServers: { codebudget: portable } });
    await uninstall(root); expect(await readFile(path, 'utf8')).toBe('\uFEFF{"mcpServers":{}}\n');
  });

  it.each([
    '{"mcpServers":{}}', '{\n  "mcpServers": { }\n}\n', '{\n  "mcpServers": {\n  }\n}\n', '{\n    "setting": true\n}\n', '{}', '{ "a": [1, 2], "b": null }', '', '\n', '{"x":1,"mcpServers":{"other":{"command":"o"}},"y":[]}',
  ])('round-trips %j byte-for-byte', async (original) => {
    const root = await project(); const path = join(root, '.mcp.json'); await writeFile(path, original);
    await install(root);
    const installed = JSON.parse(await readFile(path, 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(installed.mcpServers.codebudget).toEqual(portable);
    await uninstall(root); expect(await readFile(path, 'utf8')).toBe(original);
  });

  it('removes a configuration file and directory it created, but never user additions', async () => {
    const root = await project(); const path = join(root, '.cursor', 'mcp.json');
    await install(root, 'cursor'); await uninstall(root, 'cursor');
    expect(await exists(join(root, '.cursor'))).toBe(false);
    await install(root, 'cursor');
    const config = JSON.parse(await readFile(path, 'utf8')) as { mcpServers: Record<string, unknown> };
    config.mcpServers.user = { command: 'mine' }; await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
    await writeFile(join(root, '.cursor', 'rules.md'), 'keep');
    await uninstall(root, 'cursor');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ mcpServers: { user: { command: 'mine' } } });
    expect(await readFile(join(root, '.cursor', 'rules.md'), 'utf8')).toBe('keep');
  });

  it('accepts exactly the JSON that JSON.parse accepts and reports rejections by position', async () => {
    const root = await project(); const path = join(root, '.mcp.json');
    const samples = ['{"a":"\\u00e9\\n","b":[1,-0.5e+3,true,false,null],"c":{}}', '{"\\u0041":1,"mcpServers":{"x":{}}}', '{"a":1,}', '{"a":01}', '{"a":"\t"}', "{'a':1}", '{"a":1} x', '{"a":"\\x"}', '{"a":[1,2', '{"a":-}', '{"a":1e}', '{"a" 1}', '[]', '"text"'];
    for (const sample of samples) {
      await writeFile(path, sample);
      let parses = true; try { JSON.parse(sample); } catch { parses = false; }
      const outcome = await plan(root, 'install').then(() => 'planned', (error: Error) => error.message);
      if (!parses) expect(outcome).toMatch(/^\.mcp\.json is not valid JSON \(line \d+, column \d+\); file content omitted$/);
      else if (sample.startsWith('{')) expect(outcome).toBe('planned');
      else expect(outcome).toBe('.mcp.json must contain a JSON object');
    }
    await writeFile(path, `{"mcpServers":{},"deep":${'['.repeat(200)}${']'.repeat(200)}}`);
    await expect(plan(root, 'install')).rejects.toThrow('.mcp.json nests values deeper than 128 levels');
  });

  it('treats duplicate keys as conflicts instead of guessing which one a client reads', async () => {
    const root = await project(); const text = '{"mcpServers":{"a":{}},"mcpServers":{"b":{}}}';
    await writeFile(join(root, '.mcp.json'), text);
    const duplicate = await plan(root, 'install');
    expect(duplicate.changes).toHaveLength(0); expect(duplicate.conflicts[0]).toContain('more than once');
    expect(await readFile(join(root, '.mcp.json'), 'utf8')).toBe(text);
  });

  it.each([
    ['no trailing newline', 'model = "o3"\n[mcp_servers.other]\ncommand = "other"'],
    ['trailing comment', 'model = "o3" # keep\n# final comment'],
    ['CRLF', '# team settings\r\nmodel = "o3"\r\n\r\n[mcp_servers.other]\r\ncommand = "other"\r\n'],
    ['byte-order mark', '\uFEFFmodel = "o3"\n'],
    ['empty file', ''],
  ])('round-trips Codex TOML with %s byte-for-byte', async (_name, original) => {
    const root = await project(); await mkdir(join(root, '.codex')); const path = join(root, '.codex', 'config.toml');
    await writeFile(path, original); await install(root, 'codex');
    const installed = await readFile(path, 'utf8');
    if (original.includes('\r\n')) expect(installed.replace(/\r\n/g, '')).not.toContain('\n');
    await uninstall(root, 'codex'); expect(await readFile(path, 'utf8')).toBe(original);
  });

  it('removes a Codex file it created and refuses an inline mcp_servers table as a conflict', async () => {
    const root = await project();
    await install(root, 'codex'); await uninstall(root, 'codex');
    expect(await exists(join(root, '.codex'))).toBe(false);
    await mkdir(join(root, '.codex')); await writeFile(join(root, '.codex', 'config.toml'), `mcp_servers = { other = { command = "x", env = { TOKEN = "${SLACK_SECRET}" } } }\n`);
    const inline = await plan(root, 'install', 'codex');
    expect(inline.changes).toHaveLength(0); expect(inline.conflicts[0]).toContain('inline table'); expect(leaks(JSON.stringify(inline))).toEqual([]);
  });
});

describe('journaled apply, interruption and rollback', () => {
  it('writes backups, lock and journal before the first configuration write', async () => {
    const root = await project(); const path = join(root, '.mcp.json'); await writeFile(path, SECRETS);
    const seen: { journal?: { files: { path: string; backup: string | null }[] }; lock?: { pid: number } } = {};
    const result = await applyAdapterPlan(await plan(root, 'install'), {
      async beforeCommit(index) {
        if (index !== 0) return;
        seen.journal = JSON.parse(await readFile(state(root, 'transaction.json'), 'utf8')) as typeof seen.journal;
        seen.lock = JSON.parse(await readFile(state(root, 'transaction.lock'), 'utf8')) as typeof seen.lock;
        expect(await readFile(path, 'utf8')).toBe(SECRETS);
      },
    });
    expect(seen.journal?.files.map(file => file.path)).toEqual(['.codebudget/adapters/claude.json', '.mcp.json']);
    expect(await readFile(state(root, 'backups', seen.journal!.files[1]!.backup!), 'utf8')).toBe(SECRETS);
    expect(seen.lock?.pid).toBe(process.pid); expect(result.applied).toBe(true);
    expect(await exists(state(root, 'transaction.json'))).toBe(false); expect(await exists(state(root, 'transaction.lock'))).toBe(false);
  });

  it('rolls back on SIGINT or SIGTERM, then re-raises the signal', async () => {
    const root = await project(); const path = join(root, '.mcp.json'); const original = '{"mcpServers":{}}\n'; await writeFile(path, original);
    const emitter = new EventEmitter(); const raised: NodeJS.Signals[] = [];
    const signals: AdapterSignalSource = { on: (signal, listener) => emitter.on(signal, listener), off: (signal, listener) => emitter.off(signal, listener), raise: signal => { raised.push(signal); } };
    await expect(applyAdapterPlan(await plan(root, 'install'), { signals, beforeCommit(index) { if (index === 1) emitter.emit('SIGTERM'); } })).rejects.toThrow('interrupted by SIGTERM');
    expect(raised).toEqual(['SIGTERM']); expect(emitter.listenerCount('SIGINT') + emitter.listenerCount('SIGTERM')).toBe(0);
    expect(await readFile(path, 'utf8')).toBe(original);
    for (const leftover of ['claude.json', 'transaction.json', 'transaction.lock']) expect(await exists(state(root, leftover))).toBe(false);
    expect((await readdir(state(root, 'backups'))).filter(name => name.endsWith('.backup'))).toEqual([]);
    expect((await install(root)).applied).toBe(true);
  });

  const child = async (root: string, index: number, signal: 'SIGINT' | 'SIGKILL') => {
    const directory = await project(); const script = join(directory, 'apply.mts');
    const module = pathToFileURL(fileURLToPath(new URL('./install.ts', import.meta.url))).href;
    await writeFile(script, `import { applyAdapterPlan, planAdapterChange } from ${JSON.stringify(module)};
const plan = await planAdapterChange({ client: 'claude', action: 'install', projectRoot: ${JSON.stringify(root)} });
await applyAdapterPlan(plan, { async beforeCommit(step) { if (step === ${index}) { process.kill(process.pid, ${JSON.stringify(signal)}); await new Promise(done => setTimeout(done, 300)); } } });
console.log('not reached');\n`);
    return spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: process.cwd(), encoding: 'utf8', timeout: 30000 });
  };

  it.skipIf(!posix).each([0, 1, 2])('a real SIGINT before step %i rolls back before the process exits', async (index) => {
    const root = await project(); const path = join(root, '.mcp.json'); await writeFile(path, SECRETS);
    const result = await child(root, index, 'SIGINT');
    expect(result.signal).toBe('SIGINT'); expect(result.stdout).not.toContain('not reached');
    expect(await readFile(path, 'utf8')).toBe(SECRETS);
    for (const leftover of ['claude.json', 'transaction.json', 'transaction.lock']) expect(await exists(state(root, leftover))).toBe(false);
    expect((await install(root)).applied).toBe(true);
  }, 30000);

  it.each([1, 2])('recovers the journal left by a process killed before step %i', async (index) => {
    const root = await project(); const path = join(root, '.mcp.json'); await writeFile(path, SECRETS);
    const result = await child(root, index, 'SIGKILL');
    expect(result.stdout).not.toContain('not reached');
    expect(await exists(state(root, 'transaction.json'))).toBe(true); expect(await exists(state(root, 'transaction.lock'))).toBe(true);
    const snapshot = async () => [await readFile(path, 'utf8'), await readFile(state(root, 'claude.json'), 'utf8').catch(() => null)];
    const leftover = await snapshot();
    const recovery = await plan(root, 'install');
    expect(recovery.changes).toHaveLength(0); expect(recovery.conflicts).toEqual([]);
    expect(recovery.recovery).toMatchObject({ client: 'claude', action: 'install', keep: [] });
    expect(recovery.recovery!.restore).toContain(state(root, 'claude.json'));
    expect(await snapshot()).toEqual(leftover);
    const recovered = await applyAdapterPlan(recovery);
    expect(recovered.applied).toBe(false); expect(recovered.recovered.length).toBeGreaterThan(0);
    expect(await readFile(path, 'utf8')).toBe(SECRETS);
    for (const file of ['claude.json', 'transaction.json', 'transaction.lock']) expect(await exists(state(root, file))).toBe(false);
    expect((await install(root)).applied).toBe(true);
    expect((JSON.parse(await readFile(path, 'utf8')) as { mcpServers: Record<string, unknown> }).mcpServers.codebudget).toEqual(portable);
  }, 30000);

  it('honours a live lock and replaces locks from dead processes or older than ten minutes', async () => {
    const root = await project(); const lockPath = state(root, 'transaction.lock');
    const preview = await plan(root, 'install');
    await mkdir(state(root), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    expect((await plan(root, 'install')).conflicts[0]).toContain('in progress');
    await expect(applyAdapterPlan(preview)).rejects.toThrow('in progress');
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date(Date.now() - 11 * 60_000).toISOString() }));
    expect((await plan(root, 'install')).notes.join(' ')).toContain('stale adapter lock');
    expect((await applyAdapterPlan(preview)).applied).toBe(true); expect(await exists(lockPath)).toBe(false);
    const dead = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' }).pid!;
    await writeFile(lockPath, JSON.stringify({ pid: dead, startedAt: new Date().toISOString() }));
    expect((await uninstall(root)).applied).toBe(true); expect(await exists(lockPath)).toBe(false);
  });

  it('respects a fresh lock from an earlier version and removes a stale one', async () => {
    const root = await project(); const legacy = join(root, '.codebudget-adapter.lock'); await writeFile(legacy, '');
    const preview = await plan(root, 'install');
    expect(preview.conflicts[0]).toContain('earlier CodeBudget version');
    const old = new Date(Date.now() - 11 * 60_000); await utimes(legacy, old, old);
    expect((await install(root)).applied).toBe(true); expect(await exists(legacy)).toBe(false);
  });

  it('keeps the original error, journal and backups when a restore fails, and the next run finishes the rollback', async () => {
    const root = await project(); const path = join(root, '.cursor', 'mcp.json');
    await install(root, 'cursor'); const installed = await readFile(path, 'utf8');
    const removal = await plan(root, 'uninstall', 'cursor');
    const failure = await applyAdapterPlan(removal, { async beforeCommit(index) { if (index === 2) { await writeFile(join(root, '.cursor'), 'blocks the restore'); throw new Error('ORIGINAL failure'); } } })
      .then(() => null, (error: Error & { rollbackErrors?: unknown[] }) => error);
    expect(failure?.message).toMatch(/^ORIGINAL failure\. Rollback incomplete: 1 restore step\(s\) failed/);
    expect(failure?.rollbackErrors).toHaveLength(1);
    expect(await exists(state(root, 'transaction.json'))).toBe(true);
    expect((await readdir(state(root, 'backups'))).filter(name => name.endsWith('.backup')).length).toBeGreaterThan(0);
    expect(await readFile(state(root, 'cursor.json'), 'utf8')).toContain('"owned": true');
    await rm(join(root, '.cursor'));
    const recovery = await plan(root, 'uninstall', 'cursor');
    expect(recovery.recovery?.restore).toEqual([path]);
    await applyAdapterPlan(recovery);
    expect(await readFile(path, 'utf8')).toBe(installed); expect(await exists(state(root, 'transaction.json'))).toBe(false);
    expect((await uninstall(root, 'cursor')).applied).toBe(true); expect(await exists(join(root, '.cursor'))).toBe(false);
  });

  it.skipIf(!posix)('preserves file modes on rewrite and restores them on rollback', async () => {
    const root = await project(); const path = join(root, '.mcp.json'); const ignore = join(root, '.gitignore');
    await writeFile(path, '{"mcpServers":{}}\n'); await chmod(path, 0o664);
    await writeFile(ignore, 'node_modules/\n'); await chmod(ignore, 0o755);
    await install(root);
    expect(await mode(path)).toBe(0o664); expect(await mode(state(root, 'claude.json'))).toBe(0o600);
    expect(await mode(ignore)).toBe(0o755); expect(await readFile(ignore, 'utf8')).toBe('node_modules/\n');
    const privateModes: number[] = [];
    await expect(applyAdapterPlan(await plan(root, 'uninstall'), {
      async beforeCommit(index) {
        if (index !== 2) return;
        const backups = (await readdir(state(root, 'backups'))).filter(item => item.endsWith('.backup'));
        for (const file of [...backups.map(name => state(root, 'backups', name)), state(root, 'transaction.json'), state(root, 'transaction.lock')]) privateModes.push(await mode(file));
        throw new Error('late failure');
      },
    })).rejects.toThrow('late failure');
    expect(privateModes.length).toBeGreaterThan(3); expect(new Set(privateModes)).toEqual(new Set([0o600]));
    expect(await mode(path)).toBe(0o664); expect(await readFile(path, 'utf8')).toContain('"codebudget"');
    await uninstall(root); expect(await mode(path)).toBe(0o664);
    const created = await project(); await install(created, 'cursor'); await chmod(join(created, '.cursor', 'mcp.json'), 0o640);
    const receipt = await readFile(state(created, 'cursor.json'), 'utf8');
    await expect(applyAdapterPlan(await plan(created, 'uninstall', 'cursor'), { beforeCommit(index) { if (index === 2) throw new Error('late failure'); } })).rejects.toThrow('late failure');
    expect(await mode(join(created, '.cursor', 'mcp.json'))).toBe(0o640); expect(await readFile(state(created, 'cursor.json'), 'utf8')).toBe(receipt);
  });
});

describe('private bounded backups', () => {
  it('keeps the newest five private backups per file, including pre-journal backup names', async () => {
    const root = await project(); await writeFile(join(root, '.mcp.json'), SECRETS);
    await mkdir(state(root, 'backups'), { recursive: true });
    for (let index = 0; index < 7; index++) {
      const legacy = state(root, 'backups', `claude-00000000-0000-4000-8000-00000000000${index}.backup`);
      await writeFile(legacy, SECRETS); const time = new Date(Date.now() - (10 - index) * 60_000); await utimes(legacy, time, time);
    }
    for (let cycle = 0; cycle < 4; cycle++) { await install(root); await uninstall(root); }
    const names = (await readdir(state(root, 'backups'))).filter(name => name.endsWith('.backup'));
    const groups = new Map<string, string[]>();
    for (const name of names) { const key = name.startsWith('claude-') ? 'legacy' : name.split('~')[0]!; groups.set(key, [...groups.get(key) ?? [], name]); }
    expect([...groups.keys()].sort()).toEqual(['.codebudget%2Fadapters%2Fclaude.json', '.mcp.json', 'legacy']);
    for (const group of groups.values()) expect(group.length).toBeLessThanOrEqual(5);
    expect(groups.get('legacy')!.sort()).toEqual([2, 3, 4, 5, 6].map(index => `claude-00000000-0000-4000-8000-00000000000${index}.backup`));
    if (posix) for (const name of names.filter(item => !item.startsWith('claude-'))) expect(await mode(state(root, 'backups', name))).toBe(0o600);
    expect(await readFile(join(root, '.mcp.json'), 'utf8')).toBe(SECRETS);
  });

  it.skipIf(!gitAvailable)('never exposes backups to Git, even after the project .gitignore is reset', async () => {
    const root = await project(); const git = (...args: string[]) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    expect(git('init', '-q').status).toBe(0);
    await writeFile(join(root, '.mcp.json'), SECRETS); await writeFile(join(root, '.gitignore'), 'node_modules/\n');
    const exposed = () => git('status', '--porcelain', '--untracked-files=all').stdout.split('\n').filter(line => line.includes('.codebudget'));
    for (let cycle = 0; cycle < 2; cycle++) {
      await install(root); expect(exposed()).toEqual([]);
      // A user discarding an unexpected .gitignore edit must not expose credential-bearing backups.
      await writeFile(join(root, '.gitignore'), 'node_modules/\n');
      await uninstall(root); expect(exposed()).toEqual([]);
    }
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe('node_modules/\n');
    // Even a root rule that re-includes the data directory cannot expose the self-ignoring backups.
    await writeFile(join(root, '.gitignore'), '.codebudget/\n!.codebudget/\n!.codebudget/**\n');
    await install(root); await uninstall(root); expect(exposed()).toEqual([]);
    expect(git('check-ignore', '-q', '.codebudget/adapters/backups/any.backup').status).toBe(0);
  });
});

describe('portable registration', () => {
  it('writes no machine-specific path by default', async () => {
    const root = await project(); const preview = await plan(root, 'install');
    expect(preview.server).toEqual(portable); expect(JSON.stringify(preview.changes)).not.toContain('--root');
    await applyAdapterPlan(preview);
    expect(await readFile(join(root, '.mcp.json'), 'utf8')).not.toContain(root);
  });

  it.each(['claude', 'codex'] as const)('updates an owned %s entry whose only difference is the launch command', async (client) => {
    const root = await project(); const configPath = join(root, client === 'codex' ? '.codex/config.toml' : '.mcp.json');
    const old = { command: '/home/alice/.nvm/versions/node/v22.16.0/bin/node', args: ['/cli.mjs', '--root', root, 'mcp', 'serve'] };
    await install(root, client, old);
    const upgraded = await plan(root, 'install', client, { ...old, command: '/home/alice/.nvm/versions/node/v22.22.2/bin/node' });
    expect(upgraded.conflicts).toEqual([]); expect(upgraded.changes.map(change => change.operation)).toEqual(['update', 'update']);
    expect(upgraded.notes.join(' ')).toContain('updated in place');
    await applyAdapterPlan(upgraded);
    expect(await readFile(configPath, 'utf8')).toContain('v22.22.2'); expect(await readFile(configPath, 'utf8')).not.toContain('v22.16.0');
    await install(root, client);
    const text = await readFile(configPath, 'utf8');
    expect(text).not.toContain('/home/alice'); expect(text).toContain('codebudget');
    await uninstall(root, client);
    expect(await exists(configPath)).toBe(false);
  });

  it('still refuses to overwrite an owned entry the user edited', async () => {
    const root = await project(); const path = join(root, '.mcp.json');
    await install(root, 'claude', { command: '/old/node', args: ['cli.mjs', 'mcp', 'serve'] });
    const config = JSON.parse(await readFile(path, 'utf8')) as { mcpServers: { codebudget: Record<string, unknown> } };
    config.mcpServers.codebudget.env = { USER: 'kept' }; config.mcpServers.codebudget.command = '/new/node';
    await writeFile(path, JSON.stringify(config));
    const preview = await plan(root, 'install');
    expect(preview.changes).toHaveLength(0); expect(preview.conflicts[0]).toContain('unowned or modified');
  });
});

describe('input validation', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'vscode'])('rejects the client name %s', async (client) => {
    const root = await project();
    await expect(planAdapterChange({ client: client as ClientId, projectRoot: root, action: 'install' })).rejects.toThrow('Unknown client; expected one of: claude, codex, cursor, antigravity');
  });

  it('rejects unknown actions, control characters and foreign plans, and plans without writing', async () => {
    const root = await project();
    await expect(planAdapterChange({ client: 'claude', projectRoot: root, action: 'remove' as 'install' })).rejects.toThrow('install or uninstall');
    await expect(plan(root, 'install', 'claude', { command: 'codebudget\n--evil' })).rejects.toThrow('Invalid executable');
    await expect(applyAdapterPlan({ schemaVersion: 1 } as never)).rejects.toThrow('Unsupported adapter plan');
    await plan(root, 'install');
    expect(await exists(join(root, '.codebudget'))).toBe(false);
  });
});

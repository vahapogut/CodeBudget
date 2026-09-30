import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectAdapters } from './capabilities.js';
import { measurePluginOverhead, processClaudeHook, type ClaudeHookOptions } from './claude-hook.js';
import { applyAdapterPlan, planAdapterChange } from './install.js';

const roots: string[] = [];
const configPaths = { claude: '.mcp.json', codex: '.codex/config.toml', cursor: '.cursor/mcp.json', antigravity: '.agents/mcp_config.json' } as const;
async function project() { const path = await mkdtemp(join(tmpdir(), 'codebudget-adapters-')); roots.push(path); return path; }
afterEach(async () => { for (const root of roots.splice(0)) { const rel = relative(tmpdir(), root); if (isAbsolute(root) && !rel.startsWith('..')) await rm(root, { recursive: true, force: true }); } });

describe('project-local adapter installation', () => {
  it.each(['claude', 'codex', 'cursor', 'antigravity'] as const)('%s is idempotent and uninstall owns only its entry', async (client) => {
    const projectRoot = await project();
    const options = { client, projectRoot, action: 'install' as const };
    const plan = await planAdapterChange(options);
    // Ownership receipt, then configuration; the project .gitignore is never edited.
    expect(plan.changes.map(change => change.role)).toEqual(['receipt', 'config']);
    const canonicalRoot = await realpath(projectRoot);
    expect(plan.changes.every((change) => change.path.startsWith(canonicalRoot))).toBe(true);
    await expect(readFile(plan.changes[0]!.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await applyAdapterPlan(plan)).applied).toBe(true);
    expect((await planAdapterChange(options)).changes).toHaveLength(0);
    const uninstall = await planAdapterChange({ ...options, action: 'uninstall' });
    const result = await applyAdapterPlan(uninstall);
    expect(result.backups).toHaveLength(2);
    // CodeBudget created the file (and its directory), so uninstall leaves nothing behind.
    await expect(readFile(join(projectRoot, configPaths[client]), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(projectRoot, '.gitignore'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(projectRoot, '.codebudget', 'adapters', 'backups', '.gitignore'), 'utf8')).toMatch(/^\*$/m);
    expect((await planAdapterChange({ ...options, action: 'uninstall' })).changes).toHaveLength(0);
  });

  it('preserves unrelated user config and user changes after install', async () => {
    const projectRoot = await project(); const path = join(projectRoot, '.mcp.json');
    await writeFile(path, JSON.stringify({ setting: 'before', mcpServers: { other: { command: 'other-tool' } } }));
    const install = await planAdapterChange({ client: 'claude', projectRoot, action: 'install' });
    const result = await applyAdapterPlan(install);
    const canonicalRoot = await realpath(projectRoot);
    expect(result.backups.every(path => path.startsWith(join(canonicalRoot, '.codebudget', 'adapters', 'backups')))).toBe(true);
    expect(JSON.parse(await readFile(result.backups[0]!, 'utf8')).setting).toBe('before');
    const config = JSON.parse(await readFile(path, 'utf8')) as { setting: string; mcpServers: Record<string, unknown> };
    config.setting = 'user-edited'; config.mcpServers.newUserServer = { command: 'later' }; await writeFile(path, JSON.stringify(config));
    await applyAdapterPlan(await planAdapterChange({ client: 'claude', projectRoot, action: 'uninstall' }));
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ setting: 'user-edited', mcpServers: { other: { command: 'other-tool' }, newUserServer: { command: 'later' } } });
  });

  it('does not overwrite a preexisting same-name server or claim ownership', async () => {
    const projectRoot = await project(); const path = join(projectRoot, '.mcp.json'); const value = '{"mcpServers":{"codebudget":{"command":"mine"}}}';
    await writeFile(path, value);
    const plan = await planAdapterChange({ client: 'claude', projectRoot, action: 'install' });
    expect(plan.conflicts).toHaveLength(1); expect(plan.changes).toHaveLength(0);
    await expect(applyAdapterPlan(plan)).rejects.toThrow('conflict');
    await applyAdapterPlan(await planAdapterChange({ client: 'claude', projectRoot, action: 'uninstall' }));
    expect(await readFile(path, 'utf8')).toBe(value);
  });

  it('preserves edits to the CodeBudget server as an uninstall conflict', async () => {
    const projectRoot = await project();
    const plan = await planAdapterChange({ client: 'cursor', projectRoot, action: 'install' }); await applyAdapterPlan(plan);
    const path = join(projectRoot, '.cursor', 'mcp.json'); const config = JSON.parse(await readFile(path, 'utf8'));
    config.mcpServers.codebudget.env = { USER_ADDED: 'preserve' }; await writeFile(path, JSON.stringify(config));
    const uninstall = await planAdapterChange({ client: 'cursor', projectRoot, action: 'uninstall' });
    expect(uninstall.conflicts).toHaveLength(1); expect(uninstall.changes).toHaveLength(0);
  });

  it('preserves TOML comments and unrelated late tables', async () => {
    const projectRoot = await project(); await mkdir(join(projectRoot, '.codex'));
    const path = join(projectRoot, '.codex', 'config.toml');
    const initial = '# keep my comment\nmodel = "custom"\n[mcp_servers.other]\ncommand = "other"\n';
    await writeFile(path, initial);
    await applyAdapterPlan(await planAdapterChange({ client: 'codex', projectRoot, action: 'install' }));
    await writeFile(path, `${await readFile(path, 'utf8')}\n[other]\nvalue = "later"\n`);
    await applyAdapterPlan(await planAdapterChange({ client: 'codex', projectRoot, action: 'uninstall' }));
    expect(await readFile(path, 'utf8')).toBe(`${initial}\n[other]\nvalue = "later"\n`);
  });

  it('preserves a user comment inserted into the owned TOML block', async () => {
    const projectRoot = await project(); const plan = await planAdapterChange({ client: 'codex', projectRoot, action: 'install' }); await applyAdapterPlan(plan);
    const path = join(projectRoot, '.codex', 'config.toml'); await writeFile(path, (await readFile(path, 'utf8')).replace('[mcp_servers.codebudget]', '[mcp_servers.codebudget]\n# My later comment'));
    expect((await planAdapterChange({ client: 'codex', projectRoot, action: 'uninstall' })).conflicts).toHaveLength(1);
  });

  it('rejects malformed config without changing it', async () => {
    const projectRoot = await project(); await writeFile(join(projectRoot, '.mcp.json'), '{ nope');
    await expect(planAdapterChange({ client: 'claude', projectRoot, action: 'install' })).rejects.toThrow();
    expect(await readFile(join(projectRoot, '.mcp.json'), 'utf8')).toBe('{ nope');
  });

  it('detects stale previews before any mutation', async () => {
    const projectRoot = await project(); const plan = await planAdapterChange({ client: 'claude', projectRoot, action: 'install' });
    await writeFile(join(projectRoot, '.mcp.json'), '{"new":"user"}');
    await expect(applyAdapterPlan(plan)).rejects.toThrow('changed since preview');
    expect(await readFile(join(projectRoot, '.mcp.json'), 'utf8')).toBe('{"new":"user"}');
  });

  it('rolls back the first commit when the receipt write fails', async () => {
    const projectRoot = await project(); const path = join(projectRoot, '.mcp.json'); const before = '{"mcpServers":{},"mine":true}'; await writeFile(path, before);
    const plan = await planAdapterChange({ client: 'claude', projectRoot, action: 'install' });
    await expect(applyAdapterPlan(plan, { beforeCommit(index) { if (index === 2) throw new Error('simulated disk failure'); } })).rejects.toThrow('simulated disk failure');
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('does not roll back over a concurrent user edit', async () => {
    const projectRoot = await project(); const path = join(projectRoot, '.mcp.json');
    const plan = await planAdapterChange({ client: 'claude', projectRoot, action: 'install' });
    await expect(applyAdapterPlan(plan, { async beforeCommit(index) { if (index === 2) { await writeFile(path, '{"user":"late"}'); throw new Error('stop'); } } })).rejects.toThrow('stop');
    expect(await readFile(path, 'utf8')).toBe('{"user":"late"}');
  });

  it('refuses symlink config directories escaping the project', async () => {
    const projectRoot = await project(); const outside = await project();
    await symlink(outside, join(projectRoot, '.cursor'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(planAdapterChange({ client: 'cursor', projectRoot, action: 'install' })).rejects.toThrow('symlink');
  });
  it('keeps credential backups in a self-ignoring directory without editing the project .gitignore', async () => {
    const projectRoot = await project(); const path = join(projectRoot, '.mcp.json');
    await writeFile(path, '{"mcpServers":{"other":{"env":{"API_KEY":"private"}}}}');
    const rules = 'mine/\n.codebudget/\n!.codebudget/\n!.codebudget/**\n';
    await writeFile(join(projectRoot, '.gitignore'), rules);
    const plan = await planAdapterChange({ client: 'claude', projectRoot, action: 'install' });
    expect(plan.changes.some(change => change.path.endsWith('.gitignore'))).toBe(false);
    const result = await applyAdapterPlan(plan); expect(result.backups.length).toBeGreaterThan(0);
    const backups = join(await realpath(projectRoot), '.codebudget', 'adapters', 'backups');
    expect(result.backups.every(backup => backup.startsWith(backups))).toBe(true);
    expect(await readFile(join(backups, '.gitignore'), 'utf8')).toMatch(/^\*$/m);
    await applyAdapterPlan(await planAdapterChange({ client: 'claude', projectRoot, action: 'uninstall' }));
    expect(await readFile(join(projectRoot, '.gitignore'), 'utf8')).toBe(rules);
  });
});

const testText = [' RUN v3.2.4', ...Array.from({ length: 100 }, (_, i) => ` ✓ test/case-${i}.test.ts (4 tests) 20ms`), ' FAIL test/failing.test.ts > preserves assertion', 'AssertionError: expected 1 to equal 2', 'Expected: 2', 'Received: 1', ' at test/failing.test.ts:9:2', ' Test Files 1 failed | 100 passed (101)', ' Tests 1 failed | 400 passed | 2 skipped (403)'].join('\n');
const native = { stdout: testText, stderr: 'stderr must remain distinct', interrupted: false, isImage: false, exitCode: 1 };
function event(response: Record<string, unknown> = native) { return { hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: 'session', tool_use_id: 'tool-1', tool_response: response }; }
function hookOptions(overrides: Partial<ClaudeHookOptions> = {}): ClaudeHookOptions { return { clientVersion: '2.1.216', mode: 'balanced', redact: (text) => text, archive: async () => 'repo:artifact:123', ...overrides }; }
function replacement(result: Awaited<ReturnType<typeof processClaudeHook>>): Record<string, unknown> { return (result.output?.hookSpecificOutput as Record<string, unknown>).updatedToolOutput as Record<string, unknown>; }

describe('Claude native hook contract', () => {
  it('replaces a structured result, archives masked evidence and preserves failure details', async () => {
    const archive = vi.fn(async (_text: string, _metadata: Record<string, unknown>) => 'repo:artifact:123'); const record = vi.fn();
    const result = await processClaudeHook(event(), hookOptions({ archive, record }));
    const rewritten = replacement(result);
    expect(rewritten.stdout).toContain('expected 1 to equal 2'); expect(rewritten.stdout).toContain('Expected: 2'); expect(rewritten.stdout).toContain('Received: 1');
    expect(rewritten.stdout).toContain('2 skipped'); expect(rewritten.stdout).toContain('repo:artifact:123'); expect(rewritten.stderr).toBe(native.stderr);
    expect(rewritten.exitCode).toBe(1); expect(rewritten.isImage).toBe(false); expect(rewritten.interrupted).toBe(false);
    expect(archive).toHaveBeenCalledOnce(); expect(JSON.parse(archive.mock.calls[0]![0]! as string).stdout).toBe(testText);
    expect(result.metrics?.reducedBytes).toBeLessThan(result.metrics!.originalBytes);
    expect(result.output).not.toHaveProperty('permissionDecision'); expect(record).toHaveBeenCalledOnce();
  });

  it('carries unknown exit status without inventing success', async () => {
    const result = await processClaudeHook(event({ stdout: testText, stderr: '', interrupted: false, isImage: false }), hookOptions());
    expect(replacement(result)).not.toHaveProperty('exitCode');
  });

  it.each(['2.1.215', '3.0.0', 'unknown', null])('unsupported version %s leaves output untouched', async (clientVersion) => {
    const archive = vi.fn(); expect((await processClaudeHook(event(), hookOptions({ clientVersion, archive }))).output).toBeNull(); expect(archive).not.toHaveBeenCalled();
  });

  it.each(['not json', 'null', '[]', '{"tool_name":"Bash"}'])('malformed input %s is silent', async (input) => { expect((await processClaudeHook(input, hookOptions())).output).toBeNull(); });
  it('limits input bytes', async () => { expect((await processClaudeHook(event(), hookOptions({ maxInputBytes: 2 }))).output).toBeNull(); });
  it('observes candidate savings without compression or archival in observe mode', async () => {
    const record = vi.fn(); const archive = vi.fn();
    const result = await processClaudeHook(event(), hookOptions({ mode: 'observe', record, archive }));
    expect(result.output).toBeNull(); expect(archive).not.toHaveBeenCalled(); expect(record).toHaveBeenCalledOnce();
    expect(result.metrics).toMatchObject({ applied: false, artifactId: null, candidateScope: 'estimated-with-placeholder-evidence-reference', providerUsage: null });
    expect(result.metrics!.reducedBytes).toBe(result.metrics!.originalBytes); expect(result.metrics!.candidateSavingsBytes).toBeGreaterThan(0);
  });
  it('does not let a metrics-write failure bypass redaction', async () => {
    const result = await processClaudeHook(event(), hookOptions({ mode: 'observe', redact: text => text.replace('stderr must', '[redacted]'), record: () => { throw new Error('disk full'); } }));
    expect(replacement(result).stderr).toContain('[redacted]'); expect(result.reason).toContain('persistence unavailable');
  });
  it('has independent redaction in observe mode', async () => {
    const result = await processClaudeHook(event(), hookOptions({ mode: 'observe', redact: (text) => text.replace('stderr must', '[redacted]') }));
    expect(replacement(result).stdout).toBe(testText); expect(replacement(result).stderr).toBe('[redacted] remain distinct');
  });
  it('fails closed without raw text when redaction throws', async () => {
    const archive = vi.fn(); const result = await processClaudeHook(event(), hookOptions({ archive, redact: () => { throw new Error('filter failed'); } }));
    expect(JSON.stringify(result.output)).not.toContain(testText); expect(replacement(result).stdout).toContain('withheld'); expect(archive).not.toHaveBeenCalled();
  });
  it('refuses semantic reduction when archival fails', async () => {
    expect((await processClaudeHook(event(), hookOptions({ archive: async () => { throw new Error('full disk'); } }))).output).toBeNull();
  });
  it('ignores reentrancy and already-reduced metadata', async () => {
    expect((await processClaudeHook(event(), hookOptions({ reentrant: true }))).output).toBeNull();
    const result = await processClaudeHook(event(), hookOptions());
    expect((await processClaudeHook(event(replacement(result)), hookOptions())).output).toBeNull();
  });
  it.each([{ ...native, isImage: true }, { ...native, interrupted: true }, { ...native, unexpected: 'new version' }, { ...native, exitCode: 'bad metadata' }, { stdout: 'plain string' }])('declines unsupported result %#', async (response) => {
    expect((await processClaudeHook(event(response), hookOptions())).output).toBeNull();
  });
  it('never treats a failure hook as a replaceable tool result', async () => {
    expect((await processClaudeHook({ ...event(), hook_event_name: 'PostToolUseFailure' }, hookOptions())).output).toBeNull();
  });
  it('lifecycle event records no model context', async () => {
    const onLifecycle = vi.fn();
    const result = await processClaudeHook({ hook_event_name: 'PreCompact', session_id: 's' }, hookOptions({ onLifecycle }));
    expect(result.output).toBeNull(); expect(onLifecycle).toHaveBeenCalledWith('PreCompact', 's');
  });
  it.each(['manual', 'auto'])('observes PostCompact %s as a visibility reset without forwarding its summary', async trigger => {
    const onLifecycle = vi.fn(); const archive = vi.fn();
    const result = await processClaudeHook({ hook_event_name: 'PostCompact', session_id: 's', trigger, compact_summary: 'private conversation content', transcript_path: '/private/session.jsonl' }, hookOptions({ onLifecycle, archive }));
    expect(onLifecycle).toHaveBeenCalledWith('PostCompact', 's'); expect(archive).not.toHaveBeenCalled(); expect(result.output).toBeNull();
    expect(JSON.stringify(onLifecycle.mock.calls)).not.toContain('private'); expect(JSON.stringify(result)).not.toContain('private');
  });
  it('declines unsupported PostCompact shapes; lifecycle handling does not depend on the output contract version', async () => {
    const onLifecycle = vi.fn(); const input = { hook_event_name: 'PostCompact', session_id: 's', trigger: 'manual', compact_summary: 'summary' };
    expect((await processClaudeHook({ ...input, trigger: 'future' }, hookOptions({ onLifecycle }))).output).toBeNull();
    expect((await processClaudeHook({ ...input, compact_summary: {} }, hookOptions({ onLifecycle }))).output).toBeNull();
    expect(onLifecycle).not.toHaveBeenCalled();
    for (const clientVersion of ['2.1.217', '3.0.0', null]) expect((await processClaudeHook(input, hookOptions({ onLifecycle, clientVersion }))).output).toBeNull();
    expect(onLifecycle).toHaveBeenCalledTimes(3);
  });
  it('measures only owned static instruction text', () => { expect(measurePluginOverhead('abc')).toMatchObject({ bytes: 3, estimatedTokens: 1, additionalHookContextBytes: 0 }); });
  it('never labels contract coverage as real model verification', () => {
    const adapters = inspectAdapters({ versions: { claude: '2.1.216', codex: '0.139.0' } });
    expect(adapters[0]!.capabilities.toolOutputReplacement).toMatchObject({ support: 'supported', verification: 'contract-tested' });
    expect(adapters[1]!.capabilities.toolOutputReplacement.support).toBe('unknown');
    expect(JSON.stringify(adapters)).not.toContain('verified-in-client');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { initialize } from '../../../packages/core/src/config.js';
import { Store } from '../../../packages/core/src/store.js';
import { defaults } from '../../../packages/core/src/config.js';
import { initializedProjectRoot } from './project-root.js';
import { runHook } from './hook.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'codebudget-hook-')); dirs.push(dir); return dir; };
/** A stand-in `claude` binary that only answers --version. */
function fakeClaude(version: string): NodeJS.ProcessEnv {
  const bin = temp(); const file = join(bin, 'claude');
  writeFileSync(file, `#!/bin/sh\necho "${version} (Claude Code)"\n`); chmodSync(file, 0o755);
  return { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, CLAUDE_PROJECT_DIR: '' };
}
const bash = (stdout: string) => JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: 'claude-1', tool_use_id: 't', tool_response: { stdout, stderr: '', interrupted: false, isImage: false } });

describe('project root resolution', () => {
  it('never adopts an initialized parent across a repository boundary', () => {
    const home = temp(); initialize(home);
    const repo = join(home, 'work', 'client-a'); mkdirSync(join(repo, '.git'), { recursive: true }); mkdirSync(join(repo, 'src'));
    expect(initializedProjectRoot(join(repo, 'src'), {})).toBeNull();
    initialize(repo); expect(initializedProjectRoot(join(repo, 'src'), {})).toBe(initializedProjectRoot(repo, {}));
  });
  it('lets hook and MCP agree on CLAUDE_PROJECT_DIR in nested initialized projects', () => {
    const mono = temp(); mkdirSync(join(mono, '.git')); initialize(mono);
    const app = join(mono, 'packages', 'app'); mkdirSync(app, { recursive: true }); initialize(app);
    const env = { CLAUDE_PROJECT_DIR: mono };
    expect(initializedProjectRoot(app, env)).toBe(initializedProjectRoot(mono, env));
  });
});

describe('native hook process', () => {
  it('does not open the evidence store for events it does not handle', async () => {
    const root = temp(); initialize(root); rmSync(join(root, '.codebudget'), { recursive: true, force: true });
    expect(await runHook(JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Read', session_id: 'x' }), root, {})).toBeNull();
    expect(existsSync(join(root, '.codebudget', 'state.sqlite'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('records why output replacement stayed off for an unsupported client', async () => {
    const root = temp(); initialize(root);
    expect(await runHook(bash('x\n'.repeat(500)), root, fakeClaude('2.0.5'))).toBeNull();
    const store = new Store(root, defaults());
    try { expect(store.events('hook')[0]).toMatchObject({ kind: 'hook-noop', clientVersion: '2.0.5', applied: false }); } finally { store.close(); }
  });

  it.skipIf(process.platform === 'win32')('replaces output on a current client and probes the version once per session', async () => {
    const root = temp(); initialize(root);
    const { setMode } = await import('../../../packages/core/src/config.js'); setMode(root, 'balanced');
    const env = fakeClaude('2.1.285');
    const noisy = 'INFO queue is idle\n'.repeat(300) + 'ERROR fixture.ts:7 Expected 401 Received 200\n';
    const first = await runHook(bash(noisy), root, env) as { hookSpecificOutput: { updatedToolOutput: { stdout: string } } } | null;
    expect(first?.hookSpecificOutput.updatedToolOutput.stdout).toContain('Expected 401 Received 200');
    // The cached session version wins over the binary on PATH for later events of the same session.
    const later = await runHook(bash(noisy), root, fakeClaude('9.9.9'));
    expect(later).not.toBeNull();
  });
});

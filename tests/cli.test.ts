import { afterEach, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLocalTokenizer, estimatedTokenizer, type ContextPackage } from '../packages/indexer/src/index.js';
import { Store } from '../packages/core/src/store.js';
import { defaults } from '../packages/core/src/config.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const cli = resolve('apps/cli/src/index.ts');
function setup() { const root = mkdtempSync(join(tmpdir(), 'cb-cli-')); dirs.push(root); return root; }
function run(root: string, args: string[], input?: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', cli, '--root', root, ...args], { encoding: 'utf8', input, shell: false, windowsHide: true, timeout: 15000 });
}
it('CLI handles init, stdin task, checkpoint, artifact, real report and child nonzero', () => {
  const root = setup(); expect(run(root, ['init']).status).toBe(0);
  const session = JSON.parse(run(root, ['session', 'start'], 'repair token').stdout) as { id: string };
  const command = run(root, ['run', '--session', session.id, '--json', '--', process.execPath, '-e', 'console.log("error at auth.ts:3");process.exit(3)']);
  expect(command.status).toBe(3); const value = JSON.parse(command.stdout) as { artifactId: string };
  expect(run(root, ['artifact', 'read', value.artifactId]).stdout).toContain('auth.ts:3');
  expect(JSON.parse(run(root, ['report', '--session', session.id]).stdout).runs).toHaveLength(1);
  expect(JSON.parse(run(root, ['session', 'checkpoint', '--session', session.id]).stdout).epoch).toBe(1);
  expect(JSON.parse(run(root, ['session', 'close', '--session', session.id]).stdout).status).toBe('closed');
}, 30000);
it('CLI raw pipeline preserves byte output and treats shell markers as literal arguments', () => {
  const root = setup(); const result = run(root, ['run', '--raw', '--', process.execPath, '-e', 'process.stdout.write(process.argv[1]); process.stderr.write("diagnostic");', '$(touch should-not-exist);|<>']);
  expect(result.status).toBe(0); expect(result.stdout).toBe('$(touch should-not-exist);|<>'); expect(result.stderr).toContain('diagnostic');
});
it('CLI adapter dry-run does not mutate configs and benchmark plan runs no model', () => {
  const root = setup(); writeFileSync(join(root, '.mcp.json'), '{"mcpServers":{"mine":{"command":"mine"}}}');
  expect(run(root, ['adapters', 'install', 'claude', '--dry-run']).status).toBe(0);
  expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe('{"mcpServers":{"mine":{"command":"mine"}}}');
  const plan = JSON.parse(run(root, ['benchmark', 'tasks', '--dry-run', '--repeats', '1']).stdout);
  expect(plan.status).toBe('not_run'); expect(plan.taskCount).toBe(30); expect(plan.modelCalls).toBe(0);
});
it('development CLI adapter registration remains executable from the target project', () => {
  const root = setup();
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const installed = run(root, ['adapters', 'install', 'claude', '--apply', '--command', process.execPath, '--arg', '--import', '--arg', tsx, '--arg', cli, '--arg', 'mcp', '--arg', 'serve']);
  expect(installed.status).toBe(0);
  const config = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8')) as { mcpServers: { codebudget: { command: string; args: string[] } } };
  const server = config.mcpServers.codebudget;
  expect(server.args).not.toContain('--root');
  const help = spawnSync(server.command, [...server.args, '--help'], { cwd: root, encoding: 'utf8', shell: false, timeout: 15000 });
  expect(help.status).toBe(0); expect(help.stdout).toContain('serve');
});
it('adapter registration is portable by default and warns when codebudget is not on PATH', () => {
  const root = setup();
  const preview = spawnSync(process.execPath, ['--import', 'tsx', cli, '--root', root, 'adapters', 'install', 'claude', '--dry-run'], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 15000, env: { ...process.env, PATH: '' } });
  expect(preview.status).toBe(0);
  const plan = JSON.parse(preview.stdout) as { server: unknown; notes: string[] };
  expect(plan.server).toEqual({ type: 'stdio', command: 'codebudget', args: ['mcp', 'serve'] });
  expect(plan.notes.join(' ')).toContain('codebudget is not on PATH');
  expect(run(root, ['adapters', 'install', 'claude', '--arg', 'x']).stderr).toContain('--arg requires --command');
});
it('MCP server without --root serves the nearest initialized project and refuses an uninitialized directory', () => {
  const root = setup(); expect(run(root, ['init']).status).toBe(0);
  const nested = join(root, 'src', 'deep'); mkdirSync(nested, { recursive: true });
  const bare = setup();
  const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n';
  // A temporary working directory cannot resolve the bare tsx specifier; use its file URL.
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const serve = (cwd: string, projectDir: string) => spawnSync(process.execPath, ['--import', tsx, cli, 'mcp', 'serve'], { cwd, input: initialize, encoding: 'utf8', shell: false, windowsHide: true, timeout: 20000, env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir } });
  const fromNested = serve(nested, '');
  expect(fromNested.status).toBe(0); expect(fromNested.stdout).toContain('serverInfo');
  expect(existsSync(join(nested, '.codebudget'))).toBe(false);
  const fromProjectDir = serve(bare, root);
  expect(fromProjectDir.status).toBe(0); expect(fromProjectDir.stdout).toContain('serverInfo');
  expect(existsSync(join(bare, '.codebudget'))).toBe(false);
  const refused = serve(bare, '');
  expect(refused.status).toBe(1); expect(refused.stderr).toContain('No initialized CodeBudget project');
  expect(existsSync(join(bare, '.codebudget'))).toBe(false);
}, 60000);

it('CLI context measures its actual stdout serialization including metadata and escaped source', () => {
  const root = setup();
  writeFileSync(join(root, 'auth.ts'), 'export function rotateToken() {\n return "quoted source";\n}\n');
  const store = new Store(root, defaults());
  const acceptanceCriteria = ['Reject refresh token reuse'];
  const constraints = ['Preserve the public function signature'];
  const session = store.startSession('auth.ts', { acceptanceCriteria, constraints });
  store.close();
  const result = run(root, ['context', '--task', 'auth.ts', '--budget', '8000', '--session', session.id]);
  expect(result.status).toBe(0);
  const context = JSON.parse(result.stdout) as ContextPackage;
  expect(context.sources[0]?.code).toContain('return "quoted source";');
  expect(context.status).toBe('ready');
  expect(context.acceptanceCriteria).toEqual(acceptanceCriteria);
  expect(context.constraints).toEqual(constraints);
  expect(context.tokenMeasurement.tokens).toBe(estimatedTokenizer.count(result.stdout));
  expect(context.tokenMeasurement.tokens).toBeLessThanOrEqual(context.budget);
  expect(result.stdout).toBe(JSON.stringify(context));
});

it('CLI refuses malformed session constraints instead of coercing them into context instructions', () => {
  const root = setup();
  const store = new Store(root, defaults());
  const session = store.startSession('auth', { constraints: [{ unexpected: 'object' }] });
  store.close();
  const result = run(root, ['context', '--task', 'auth', '--session', session.id]);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('expected string');
});

it('CLI forwards dependency policy and exact-local encoding config, with explicit override and fallback', async () => {
  const root = setup();
  writeFileSync(join(root, 'entry.ts'), 'import "./helper"; export const greeting = "日本語";');
  writeFileSync(join(root, 'helper.ts'), 'export const helper = 1;');
  writeFileSync(join(root, '.codebudget.json'), JSON.stringify({ contextDependencies: { maxDepth: 0, maxFiles: 8 }, contextTokenizer: { encoding: 'cl100k_base', model: 'gpt-4' } }));
  const result = run(root, ['context', '--task', 'entry.ts', '--budget', '8000']);
  expect(result.status).toBe(0);
  const context = JSON.parse(result.stdout) as ContextPackage;
  const tokenizer = await createLocalTokenizer({ encoding: 'cl100k_base', model: 'gpt-4' });
  expect(context.tokenMeasurement).toMatchObject({ accuracy: 'exact_local', encoding: 'cl100k_base', model: 'gpt-4' });
  expect(context.tokenMeasurement.tokens).toBe(tokenizer.count(result.stdout));
  expect(context.dependencyExpansion.maxDepth).toBe(0);
  expect(context.sources.map(source => source.path)).toEqual(['entry.ts']);
  const fallbackResult = run(root, ['context', '--task', 'entry.ts', '--tokenizer', 'o200k_base', '--model', 'unknown-model']);
  expect(fallbackResult.status).toBe(0);
  const fallback = JSON.parse(fallbackResult.stdout) as ContextPackage;
  expect(fallback.tokenMeasurement).toMatchObject({ accuracy: 'estimated', encoding: null, model: 'unknown-model', modelMapping: 'unknown' });
  expect(fallback.tokenMeasurement.fallbackReason).toContain('No verified local encoding mapping');
  expect(fallback.tokenMeasurement.tokens).toBe(estimatedTokenizer.count(fallbackResult.stdout));
}, 15000);
it('MCP server exits instead of hanging after an oversized request line', async () => {
  const root = setup(); expect(run(root, ['init']).status).toBe(0);
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['--import', 'tsx', cli, '--root', root, 'mcp', 'serve'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
  // The server closes its input on purpose; a write still in flight then fails with EPIPE.
  child.stdin.on('error', () => undefined);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'prepare_context', arguments: { task: 'x'.repeat(300 * 1024), budget: 8000 } } }) + '\n');
  const code = await Promise.race([exited, new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 10000))]);
  if (code === 'timeout') child.kill();
  expect(code).toBe(1);
}, 20000);
it('CLI validates parsers, forwards piped stdin and prints complete run records on request', () => {
  const root = setup(); expect(run(root, ['init']).status).toBe(0);
  const unknown = run(root, ['run', '--parser', 'pytest', '--', process.execPath, '-e', '0']);
  expect(unknown.status).toBe(1); expect(unknown.stderr).toContain('Unknown parser pytest');
  const echo = ['-e', 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("got:"+s.trim()))'];
  const piped = run(root, ['run', '--json', '--', process.execPath, ...echo], 'hello pipeline');
  expect(piped.status).toBe(0); const result = JSON.parse(piped.stdout) as { id: string; output: string };
  expect(result.output).toContain('got:hello pipeline');
  expect(run(root, ['run', '--no-stdin', '--', process.execPath, ...echo], 'ignored').stdout).toContain('got:');
  expect(run(root, ['run', '--no-stdin', '--', process.execPath, ...echo], 'ignored').stdout).not.toContain('ignored');
  expect((JSON.parse(run(root, ['report', '--run', result.id]).stdout) as { output: string }).output).toContain('got:hello pipeline');
}, 60000);
it('CLI reports readable configuration errors and actionable doctor warnings', () => {
  const root = setup(); expect(run(root, ['init']).status).toBe(0);
  const invalid = run(root, ['config', 'mode', 'turbo']);
  expect(invalid.status).toBe(1); expect(invalid.stderr).toContain('mode must be observe, balanced or experimental'); expect(invalid.stderr).not.toContain('"code"');
  const doctor = JSON.parse(run(root, ['doctor']).stdout) as { warnings: string[] };
  expect(doctor.warnings.join(' ')).toContain('Mode is observe');
}, 60000);

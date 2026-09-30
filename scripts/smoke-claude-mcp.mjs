import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Health-checks the CodeBudget MCP server through the installed Claude Code client. No prompt, login, approval or
// model request is sent: the client runs with an empty temporary configuration directory and home, and the server is
// registered only in that temporary local scope, so no global or project configuration is read or changed.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultFile = path.join(repository, process.argv.includes('--record') ? 'docs/claude-client-smoke-result.json' : 'dist/claude-client-smoke-result.json');
const temporary = await mkdtemp(path.join(tmpdir(), 'codebudget-claude-smoke-'));
const configDirectory = path.join(temporary, 'claude-config');
const home = path.join(temporary, 'home');
const project = path.join(temporary, 'project');
const cli = path.join(repository, 'dist/cli.js');
const environment = {
  ...Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATHEXT'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : [])),
  HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: configDirectory,
  DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
};
const record = {
  schemaVersion: 1, capturedAt: new Date().toISOString(), platform: process.platform, nodeVersion: process.version,
  client: 'claude', clientVersion: null, status: 'not_run', modelCalls: 0, promptsSubmitted: 0, accountAccess: false,
  globalConfigurationChanges: false, isolatedClientHome: true, approvalBypassFlags: false, checks: [],
  clientCommands: [], registration: null, listedServers: [],
  limitations: [
    'Client health check only: the client starts the server, completes the MCP initialize handshake and reads its capabilities. Tool calls inside a model session, plugin hooks, usage exports and quality are not exercised.',
    'The registration omits --root, so the server resolves the project from CLAUDE_PROJECT_DIR or the working directory the client chose.',
  ],
};
const normalize = value => {
  let text = String(value);
  for (const [original, replacement] of [[temporary, '<temporary>'], [repository, '<repository>'], [tmpdir(), '<system-temp>'], [process.execPath, '<node>']]) {
    text = text.replaceAll(original.replaceAll('\\', '\\\\'), replacement).replaceAll(original, replacement);
  }
  return text;
};
const claude = args => {
  record.clientCommands.push(['claude', ...args].map(normalize).join(' '));
  const result = spawnSync('claude', args, { cwd: project, env: environment, encoding: 'utf8', shell: false, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
  if (result.error) throw Object.assign(result.error, { unavailable: result.error.code === 'ENOENT' });
  assert.equal(result.status, 0, normalize(result.stderr + result.stdout));
  return result.stdout;
};
try {
  await mkdir(configDirectory); await mkdir(home); await mkdir(project);
  const init = spawnSync(process.execPath, [cli, '--root', project, 'init'], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 60000 });
  assert.equal(init.status, 0, normalize(init.stderr));
  record.clientVersion = claude(['--version']).trim();
  record.registration = { scope: 'local (temporary configuration directory)', command: 'node', args: ['<repository>/dist/cli.js', 'mcp', 'serve'] };
  claude(['mcp', 'add', '--scope', 'local', 'codebudget', '--', process.execPath, cli, 'mcp', 'serve']);
  const listed = claude(['mcp', 'list']);
  // Every server line looks like "<name>: <command> - <status>"; only the temporary registration may appear.
  record.listedServers = listed.split(/\r?\n/).filter(line => / - /.test(line) && /^[^\s:]+:/.test(line)).map(line => normalize(line.trim()));
  assert.equal(record.listedServers.length, 1, `Isolation failed: the client listed ${record.listedServers.length} servers`);
  assert.match(record.listedServers[0], /^codebudget: .* - .*\bConnected\b/, 'CodeBudget is not reported as connected');
  record.checks.push({ name: 'isolated client lists only the temporary CodeBudget registration', passed: true });
  const details = claude(['mcp', 'get', 'codebudget']);
  assert.match(details, /Status:.*\bConnected\b/, 'Server details do not report a connection');
  record.checks.push({ name: 'Claude Code health check connects to the CodeBudget MCP server', passed: true });
  record.status = 'passed';
} catch (error) {
  record.status = error?.unavailable ? 'unavailable' : 'failed';
  record.error = normalize(error instanceof Error ? error.message : error);
  if (!error?.unavailable) process.exitCode = 1;
} finally {
  const resolved = path.resolve(temporary);
  assert.ok(path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('codebudget-claude-smoke-'), 'Unsafe temporary cleanup path');
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  record.temporaryFilesRemoved = true;
  await mkdir(path.dirname(resultFile), { recursive: true });
  await writeFile(resultFile, JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
}

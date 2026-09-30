import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Uses installed Codex only. Never starts a thread/turn or reads the user's Codex home.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'codebudget-client-smoke-'));
const project = path.join(temporary, 'project');
const codexHome = path.join(temporary, 'codex-home');
const schemaDirectory = path.join(temporary, 'schema');
const cli = path.join(repository, 'dist/cli.js');
const environment = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATHEXT'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
environment.CODEX_HOME = codexHome;
const record = {
  schemaVersion: 1, capturedAt: new Date().toISOString(), platform: process.platform, nodeVersion: process.version,
  client: 'codex', clientVersion: null, status: 'not_run', modelCalls: 0, threadsStarted: 0, turnsStarted: 0,
  accountAccess: false, globalConfigurationChanges: false, isolatedClientHome: true,
  outboundMethods: [], checks: [], limitations: ['MCP inventory handshake only; no model session, usage export, output replacement or quality claim.', 'Claude health check is not exercised by this script.'],
};
let server;
let stderr = '';
const normalize = value => {
  let text = String(value);
  for (const [original, replacement] of [[temporary, '<temporary>'], [repository, '<repository>'], [tmpdir(), '<system-temp>']]) {
    text = text.replaceAll(original.replaceAll('\\', '\\\\'), replacement).replaceAll(original, replacement);
  }
  return text;
};
const command = (executable, args) => {
  const result = spawnSync(executable, args, { cwd: project, env: environment, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, normalize(result.stderr + result.stdout));
  return result.stdout;
};
try {
  await mkdir(project); await mkdir(codexHome);
  record.clientVersion = command('codex', ['--version']).trim();
  // The only trusted workspace and all persisted client state are temporary.
  await writeFile(path.join(codexHome, 'config.toml'), `[analytics]\nenabled = false\n[feedback]\nenabled = false\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n`);
  command('codex', ['app-server', 'generate-json-schema', '--out', schemaDirectory]);
  const requestSchema = JSON.parse(await readFile(path.join(schemaDirectory, 'ClientRequest.json'), 'utf8'));
  const supportedMethods = requestSchema.oneOf.flatMap(entry => entry.properties?.method?.enum ?? []);
  for (const method of ['initialize', 'mcpServerStatus/list']) assert.ok(supportedMethods.includes(method), `Installed schema must support ${method}`);
  const initialization = JSON.parse(command(process.execPath, [cli, '--root', project, 'init']));
  assert.equal(initialization.config.mode, 'observe');
  // codebudget may not be on PATH here; the explicit launch still omits --root, so the handshake also shows that
  // Codex starts the server inside the project and the server finds it from its working directory.
  const installation = JSON.parse(command(process.execPath, [cli, '--root', project, 'adapters', 'install', 'codex', '--apply', '--command', process.execPath, '--arg', cli, '--arg', 'mcp', '--arg', 'serve']));
  assert.equal(installation.plan.conflicts.length, 0);
  record.checks.push({ name: 'built CLI installs owned project-local Codex registration', passed: true });
  record.schemaSource = 'Installed codex app-server generate-json-schema (ClientRequest, InitializeParams, ListMcpServerStatusParams/Response)';
  record.clientArgv = ['codex', 'app-server', '--stdio'];
  record.configSource = 'CLI adapter install writes <temporary>/project/.codex/config.toml; trust and analytics settings live only in <temporary>/codex-home/config.toml';
  const pending = new Map();
  let nextId = 0;
  let buffer = '';
  let protocolError;
  server = spawn('codex', ['app-server', '--stdio'], { cwd: project, env: environment, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const failPending = error => { for (const promise of pending.values()) { clearTimeout(promise.timer); promise.reject(error); } pending.clear(); };
  server.on('error', failPending);
  server.on('close', code => failPending(new Error(`Codex app-server closed (${code})`)));
  server.stderr.on('data', chunk => { if (stderr.length < 32000) stderr += chunk.toString().slice(0, 32000 - stderr.length); });
  server.stdout.on('data', chunk => {
    buffer += chunk.toString();
    if (buffer.length > 1024 * 1024) { protocolError = new Error('Client protocol response exceeded 1 MiB'); failPending(protocolError); return; }
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { protocolError = new Error('Client emitted non-JSON protocol output'); failPending(protocolError); return; }
      const promise = pending.get(message.id);
      if (promise) { clearTimeout(promise.timer); pending.delete(message.id); if (message.error) promise.reject(new Error(JSON.stringify(message.error))); else promise.resolve(message.result); }
      else if (message.id !== undefined && message.method) {
        // This handshake must never authorize an unexpected client request.
        protocolError = new Error(`Unexpected server request: ${message.method}`); failPending(protocolError);
      }
    }
  });
  const send = (method, params, notification = false) => {
    assert.ok(['initialize', 'initialized', 'mcpServerStatus/list'].includes(method));
    record.outboundMethods.push(method);
    const id = ++nextId;
    const message = notification ? { method } : { id, method, params };
    if (notification) { server.stdin.write(JSON.stringify(message) + '\n'); return; }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}`)); }, 30000);
      pending.set(id, { resolve, reject, timer });
      server.stdin.write(JSON.stringify(message) + '\n');
    });
  };
  await send('initialize', { clientInfo: { name: 'codebudget-local-mcp-smoke', version: '1' }, capabilities: { experimentalApi: false } });
  send('initialized', undefined, true);
  const inventory = await send('mcpServerStatus/list', { detail: 'full' });
  if (protocolError) throw protocolError;
  const registered = inventory.data.find(item => item.name === 'codebudget');
  assert.ok(registered, `CodeBudget missing from client inventory: ${JSON.stringify(inventory)}`);
  const tools = Object.values(registered.tools).map(tool => tool.name).sort();
  assert.deepEqual(tools, ['get_changes', 'prepare_context', 'read_evidence']);
  for (const tool of Object.values(registered.tools)) assert.equal(tool.inputSchema.type, 'object');
  record.checks.push({ name: 'actual Codex app-server initializes CodeBudget MCP and discovers all three tool schemas', passed: true });
  record.server = { name: registered.name, authStatus: registered.authStatus, serverInfo: registered.serverInfo ?? null, tools };
  record.status = 'passed';
} catch (error) {
  record.status = 'failed'; record.error = normalize(error instanceof Error ? error.message : error); process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    server.stdin.end();
    await new Promise(resolve => { const timer = setTimeout(resolve, 3000); server.once('close', () => { clearTimeout(timer); resolve(); }); });
    if (server.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { shell: false, windowsHide: true, timeout: 10000, stdio: 'ignore' });
      else server.kill('SIGTERM');
      await new Promise(resolve => { if (server.exitCode !== null) return resolve(); const timer = setTimeout(resolve, 3000); server.once('close', () => { clearTimeout(timer); resolve(); }); });
    }
  }
  record.clientStderr = normalize(stderr);
  const resolved = path.resolve(temporary);
  assert.ok(path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('codebudget-client-smoke-'), 'Unsafe temporary cleanup path');
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  record.temporaryFilesRemoved = true;
  await writeFile(path.join(repository, 'docs/client-smoke-result.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
}

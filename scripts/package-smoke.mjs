import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { URLSearchParams } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { packRelease } from './package.mjs';

const sourceManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const archive = await packRelease();
const project = await mkdtemp(path.join(tmpdir(), 'codebudget-installed-'));
const pnpm = process.env.npm_execpath;
let dashboard;
const record = { schemaVersion: 1, archive: path.basename(archive), platform: process.platform, runtime: process.version, results: [], modelCalls: 0, globalChanges: false };
const check = (name, fn) => { const value = fn(); record.results.push({ name, passed: true }); return value; };
try {
  await writeFile(path.join(project, 'package.json'), '{"name":"clean-codebudget-smoke","private":true,"type":"module"}');
  const install = spawnSync(process.execPath, [pnpm, 'add', archive, '--ignore-scripts'], { cwd: project, encoding: 'utf8', shell: false, windowsHide: true, timeout: 120000 });
  check('clean tarball install without native build scripts', () => assert.equal(install.status, 0, install.stderr));
  const installed = path.join(project, 'node_modules/codebudget'); const cli = path.join(installed, 'dist/cli.js');
  const installedFiles = await readdir(installed, { recursive: true });
  check('release excludes local agent instruction files', () => {
    assert.ok(!installedFiles.some(file => path.basename(file).toLowerCase() === 'agents.md'));
  });
  const run = args => {
    const value = spawnSync(process.execPath, [cli, ...args], { cwd: project, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000 });
    if (value.status !== 0) throw new Error(`CLI ${args[0]} failed: ${value.stderr} ${value.stdout}`); return value.stdout;
  };
  const installedManifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  const buildManifest = JSON.parse(await readFile(path.join(installed, 'dist/build-manifest.json'), 'utf8'));
  check('installed release version and license metadata', () => {
    assert.equal(installedManifest.version, sourceManifest.version);
    assert.equal(buildManifest.version, sourceManifest.version);
    assert.equal(run(['--version']).trim(), sourceManifest.version);
    assert.equal(installedManifest.license, 'SEE LICENSE IN LICENSE');
  });
  check('installed init observes by default', () => assert.equal(JSON.parse(run(['init'])).config.mode, 'observe'));
  await writeFile(path.join(project, 'rotate.ts'), 'export function rotateToken() { return "fresh"; }');
  check('installed offline WASM index', () => assert.ok(JSON.parse(run(['index'])).symbols >= 1));
  const context = JSON.parse(run(['context', '--task', 'rotateToken', '--budget', '8000']));
  check('installed actual context', () => assert.ok(context.sources.some(s => s.code.includes('rotateToken'))));
  const exactContext = JSON.parse(run(['context', '--task', 'rotateToken', '--budget', '8000', '--tokenizer', 'o200k_base', '--model', 'gpt-4o']));
  check('installed offline o200k tokenizer with explicit model mapping', () => {
    assert.equal(exactContext.tokenMeasurement.accuracy, 'exact_local');
    assert.equal(exactContext.tokenMeasurement.encoding, 'o200k_base');
    assert.equal(exactContext.tokenMeasurement.modelMapping, 'verified');
    assert.ok(exactContext.sources.some(source => source.code.includes('rotateToken')));
  });
  const unknownModel = JSON.parse(run(['context', '--task', 'rotateToken', '--budget', '8000', '--tokenizer', 'o200k_base', '--model', 'unknown-fixture-model']));
  check('installed unknown model uses labeled estimate', () => {
    assert.equal(unknownModel.tokenMeasurement.accuracy, 'estimated');
    assert.equal(unknownModel.tokenMeasurement.modelMapping, 'unknown');
  });
  const session = JSON.parse(run(['session', 'start', '--task', 'repair rotateToken']));
  const result = JSON.parse(run(['run', '--session', session.id, '--json', '--', process.execPath, '-e', 'console.log("INFO repeated evidence\\n".repeat(100))']));
  check('installed argv run + session report', () => { assert.equal(result.exitCode, 0); assert.equal(JSON.parse(run(['report', '--session', session.id])).runs.length, 1); });
  check('installed artifact read', () => assert.ok(JSON.parse(run(['artifact', 'read', result.artifactId])).historicalEvidence));
  const wasmFiles = await readdir(path.join(installed, 'dist/assets'));
  check('installed offline asset list', () => assert.equal(wasmFiles.filter(n => n.endsWith('.wasm')).length, 4));
  const configPath = path.join(project, '.codebudget.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await writeFile(configPath, JSON.stringify({ ...config, contextTokenizer: { encoding: 'cl100k_base', model: 'gpt-4' } }));
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, '--root', project, 'mcp', 'serve'], cwd: project, stderr: 'pipe' });
  const client = new Client({ name: 'installed-smoke', version: '1' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    check('installed MCP stdio schema', () => {
      assert.equal(tools.tools.length, 3);
      assert.equal(client.getServerVersion()?.version, sourceManifest.version);
    });
    const response = await client.callTool({ name: 'prepare_context', arguments: { task: 'rotateToken', budget: 8000 } });
    check('installed MCP worker, WASM and protocol', () => { assert.ok(!response.isError, JSON.stringify(response)); assert.match(JSON.stringify(response), /rotateToken/); });
    check('installed offline cl100k tokenizer through MCP worker', () => {
      const content = JSON.parse(response.content.find(item => item.type === 'text').text);
      assert.equal(content.tokenMeasurement.accuracy, 'exact_local');
      assert.equal(content.tokenMeasurement.encoding, 'cl100k_base');
      assert.equal(content.tokenMeasurement.model, 'gpt-4');
    });
  } finally { await client.close(); }
  dashboard = spawn(process.execPath, [cli, '--root', project, 'dashboard'], { cwd: project, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Dashboard startup timeout')), 15000); let text = '';
    dashboard.stderr.on('data', chunk => { text += chunk.toString(); const match = text.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s]*/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    dashboard.once('error', reject); dashboard.once('exit', code => { clearTimeout(timer); reject(new Error(`Dashboard exited ${code}: ${text}`)); });
  });
  const parsed = new URL(url); const token = new URLSearchParams(parsed.hash.slice(1)).get('token'); parsed.hash = '';
  const page = await fetch(parsed);
  check('installed dashboard static assets', () => assert.equal(page.status, 200));
  const unauthorized = await fetch(new URL('/api/report', parsed));
  check('installed dashboard requires authentication', () => assert.ok([401,403].includes(unauthorized.status)));
  const report = await fetch(new URL('/api/report', parsed), { headers: { Authorization: `Bearer ${token}`, Origin: parsed.origin } });
  check('installed dashboard reads actual SQLite report', () => assert.equal(report.status, 200));
  const body = await report.text(); assert.match(body, /rotateToken|runs/);
  const plugin = path.join(installed, 'plugins/claude-codebudget');
  const pluginManifest = JSON.parse(await readFile(path.join(plugin, '.claude-plugin/plugin.json'), 'utf8'));
  const distributionLicenseFiles = ['LICENSE', 'LEGACY_LICENSE', 'LICENSING.md', 'NOTICE', 'THIRD_PARTY_NOTICES.md'];
  const distributionLicenseContents = await Promise.all(distributionLicenseFiles.map(async file => ({
    file,
    source: await readFile(new URL(`../${file}`, import.meta.url), 'utf8'),
    installed: await readFile(path.join(installed, file), 'utf8'),
    plugin: await readFile(path.join(plugin, file), 'utf8'),
  })));
  check('installed license terms, legacy grant and standalone plugin parity', () => {
    assert.equal(pluginManifest.version, sourceManifest.version);
    assert.equal(pluginManifest.license, 'LicenseRef-CodeBudget-Free-Use-1.0');
    for (const item of distributionLicenseContents) {
      assert.ok(item.source.length > 0, item.file);
      assert.equal(item.installed, item.source, `Installed root ${item.file}`);
      assert.equal(item.plugin, item.source, `Standalone plugin ${item.file}`);
    }
    const current = distributionLicenseContents.find(item => item.file === 'LICENSE').installed;
    const legacy = distributionLicenseContents.find(item => item.file === 'LEGACY_LICENSE').installed;
    assert.match(current, /CodeBudget Free Use License/);
    assert.match(legacy, /Apache License/);
    assert.match(legacy, /Version 2\.0, January 2004/);
    assert.match(legacy, /irrevocable\s+copyright license/);
  });
  const licenseInventory = JSON.parse(await readFile(path.join(plugin, 'docs/dependency-licenses.json'), 'utf8'));
  const licenseFiles = [...distributionLicenseFiles, ...licenseInventory.entries.flatMap(entry => entry.notices)];
  const licenseContents = await Promise.all(licenseFiles.map(file => readFile(path.join(plugin, file), 'utf8')));
  check('installed standalone plugin license inventory and texts', () => { assert.ok(licenseInventory.entries.length > 0); assert.ok(licenseContents.every(text => text.length > 0)); });
  const validated = spawnSync('claude', ['plugin', 'validate', '--strict', plugin], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 20000 });
  record.results.push({ name: 'installed native Claude manifest validation', passed: validated.status === 0, unavailable: Boolean(validated.error) });
  if (!validated.error) assert.equal(validated.status, 0, validated.stderr + validated.stdout);
  if (!validated.error) {
    run(['config', 'mode', 'balanced']);
    const nested = path.join(project, 'nested'); await mkdir(nested);
    const lifecycle = spawnSync(process.execPath, [path.join(plugin, 'dist/hook.mjs')], { cwd: nested, input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'local-protocol-test', cwd: nested }), encoding: 'utf8', shell: false, windowsHide: true, timeout: 20000 });
    assert.equal(lifecycle.status, 0); assert.equal(lifecycle.stdout, '');
    const lifecycleReport = JSON.parse(run(['report']));
    check('installed plugin overhead measured without injected context', () => assert.ok(lifecycleReport.pluginOverhead.some(item => item.bytes > 0 && item.additionalHookContextBytes === 0)));
    const nativeSession = lifecycleReport.sessions.find(item => item.id !== session.id);
    assert.ok(nativeSession);
    for (const event of ['PreCompact', 'PostCompact']) {
      const compacted = spawnSync(process.execPath, [path.join(plugin, 'dist/hook.mjs')], { cwd: nested,
        input: JSON.stringify({ hook_event_name: event, session_id: 'local-protocol-test', cwd: nested, trigger: 'auto', compact_summary: 'PRIVATE_COMPACTION_FIXTURE_MUST_NOT_BE_RETAINED' }),
        encoding: 'utf8', shell: false, windowsHide: true, timeout: 20000 });
      assert.equal(compacted.status, 0); assert.equal(compacted.stdout, '');
    }
    check('installed compaction lifecycle resets visibility without storing summaries', () => {
      const afterCompaction = JSON.parse(run(['report']));
      assert.equal(afterCompaction.sessions.find(item => item.id === nativeSession.id).epoch, nativeSession.epoch + 2);
      assert.doesNotMatch(JSON.stringify(afterCompaction), /PRIVATE_COMPACTION_FIXTURE_MUST_NOT_BE_RETAINED/);
    });
    const observed = { stdout: 'INFO queue is idle\n'.repeat(200) + 'ERROR fixture.ts:7 Expected 401 Received 200\n', stderr: 'Failure preserved separately\n', interrupted: false, isImage: false, exitCode: 1 };
    const hookEvent = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'local-contract-1', session_id: 'local-protocol-test', cwd: project, tool_input: { command: 'fixture only: no command executed by hook' }, tool_response: observed };
    const hook = spawnSync(process.execPath, [path.join(plugin, 'dist/hook.mjs')], { cwd: nested, input: JSON.stringify(hookEvent), encoding: 'utf8', shell: false, windowsHide: true, timeout: 20000 });
    const replaced = JSON.parse(hook.stdout).hookSpecificOutput.updatedToolOutput;
    check('installed standalone hook protocol reduction (not a model session)', () => {
      assert.equal(hook.status, 0, hook.stderr); assert.ok(Buffer.byteLength(JSON.stringify(replaced)) < Buffer.byteLength(JSON.stringify(observed)));
      assert.match(replaced.stdout, /Expected 401 Received 200/); assert.equal(replaced.stderr, observed.stderr); assert.equal(replaced.exitCode, 1);
    });
    const evidenceId = replaced.stdout.match(/CodeBudget evidence: ([\w-]+)/)?.[1]; assert.ok(evidenceId);
    check('installed hook archive retrieval', () => assert.match(run(['artifact', 'read', evidenceId]), /fixture.ts:7/));
    const pluginClient = new Client({ name: 'plugin-protocol-smoke', version: '1' });
    const pluginTransport = new StdioClientTransport({ command: process.execPath, args: [path.join(plugin, 'dist/mcp.mjs')], cwd: nested, stderr: 'pipe' });
    try {
      await pluginClient.connect(pluginTransport);
      const read = await pluginClient.callTool({ name: 'read_evidence', arguments: { id: evidenceId } });
      check('installed plugin MCP shares hook project root from a subdirectory', () => { assert.ok(!read.isError, JSON.stringify(read)); assert.match(JSON.stringify(read), /fixture.ts:7/); });
    } finally { await pluginClient.close(); }
  }
  console.log(JSON.stringify(record, null, 2));
} finally {
  if (dashboard && dashboard.exitCode === null) { dashboard.kill(); await new Promise(resolve => dashboard.once('close', resolve)); }
  await writeFile('docs/package-smoke-result.json', JSON.stringify(record, null, 2) + '\n');
  if (path.dirname(path.resolve(project)) === path.resolve(tmpdir()) && path.basename(project).startsWith('codebudget-installed-')) await rm(project, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  else process.stderr.write('Refused unsafe package smoke cleanup path\n');
}

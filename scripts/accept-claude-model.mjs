import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Real model acceptance (R22). One headless Claude Code session loads the plugin from this repository for that
// session only, runs a noisy verbose Vitest suite in a temporary project and must (1) receive the hook's reduced
// result with its evidence reference, (2) still see the diagnostics and (3) recover an omitted passing line through
// read_evidence. --scenario passing (default) prints a deprecation warning and exits 0; --scenario failing ends with a
// failed assertion and a non-zero exit. It sends real model requests under the client's login, so it runs only when
// confirmed.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
// --preflight-only prepares the project and checks the fixture, reducer, client and login without a model request.
const preflightOnly = args.includes('--preflight-only');
if (!preflightOnly && !args.includes('--confirm-model-calls')) {
  console.error('This check starts one real model session under your Claude Code login and uses part of its quota. Rerun with --confirm-model-calls to proceed, or with --preflight-only to check everything else first.');
  process.exit(2);
}
const useLogin = args.includes('--use-login');
const model = option('--model');
const scenario = option('--scenario') ?? 'passing';
if (!['passing', 'failing'].includes(scenario)) { console.error('--scenario must be passing or failing'); process.exit(2); }
// One file per scenario and client version, for example docs/claude-model-acceptance-passing-2.1.286.json.
const resultFile = () => path.join(repository, args.includes('--record') ? 'docs' : 'dist', `claude-model-acceptance-${scenario}-${/\d+\.\d+\.\d+/.exec(record.clientVersion ?? '')?.[0] ?? 'unknown'}.json`);
const temporary = await mkdtemp(path.join(tmpdir(), 'codebudget-model-acceptance-'));
const project = path.join(temporary, 'project');
const configDirectory = path.join(temporary, 'claude-config');
const home = path.join(temporary, 'home');
const cli = path.join(repository, 'dist/cli.js');
const plugin = path.join(repository, 'plugins/claude-codebudget');
const vitest = path.join(repository, 'node_modules/vitest/vitest.mjs');
const marker = `RET-${randomBytes(4).toString('hex')}`;
const WARNING = 'DeprecationWarning: legacyTotal() is deprecated and will be removed in 3.0; use total() instead';
// NO_COLOR keeps the test output free of terminal escapes, as in most CI logs; comparisons also strip them.
const quiet = { DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', NO_COLOR: '1' };
// By default the client runs with an empty temporary configuration directory and home: no user settings, plugins,
// hooks or MCP servers take part. --use-login keeps the normal configuration for logins that live there.
const environment = useLogin ? { ...process.env, ...quiet } : {
  ...Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATHEXT'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : [])),
  HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: configDirectory, ...quiet,
};
const readEvidenceTools = ['mcp__plugin_codebudget_codebudget__read_evidence'];
const record = {
  schemaVersion: 1, capturedAt: new Date().toISOString(), platform: process.platform, nodeVersion: process.version,
  client: 'claude', clientVersion: null, status: 'not_run', scenario, isolatedClientConfiguration: !useLogin, globalConfigurationChanges: false,
  approvalBypassFlags: false, permissionMode: 'dontAsk', allowedTools: ['Bash(npm test)', ...readEvidenceTools], model: null,
  modelRequests: null, turns: null, clientReportedCostUsd: null, clientReportedUsage: null, checks: [],
  command: 'npm test', raw: null, modelVisible: null, retrieval: null, finalAnswer: null, localRecords: null, permissionDenials: [], session: null, hookEvents: [],
  limitations: [
    'One session, one synthetic project and one command shape (verbose Vitest output). It shows whether the mechanism works end to end, not how often or how much it helps.',
    'Cost and usage figures are the values the client reported for this session; they are not provider invoices.',
  ],
};
const normalize = value => {
  let text = String(value);
  for (const [original, replacement] of [[temporary, '<temporary>'], [repository, '<repository>'], [tmpdir(), '<system-temp>'], [process.execPath, '<node>']]) {
    for (const variant of [original, original.replaceAll('\\', '/'), original.replaceAll('\\', '\\\\')]) text = text.replaceAll(variant, replacement);
  }
  return text;
};
const check = (name, passed, detail) => { record.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail: normalize(detail) }) }); return Boolean(passed); };
const run = (executable, commandArgs, options = {}) => spawnSync(executable, commandArgs, { cwd: project, env: environment, encoding: 'utf8', shell: false, windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 * 1024, ...options });
// eslint-disable-next-line no-control-regex -- removes terminal escape sequences before comparing text
const plain = value => value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
const text = content => plain(typeof content === 'string' ? content : Array.isArray(content) ? content.map(block => typeof block === 'string' ? block : block?.type === 'text' ? String(block.text ?? '') : '').join('\n') : '');
const bytes = value => Buffer.byteLength(value, 'utf8');

try {
  await mkdir(project); await mkdir(configDirectory); await mkdir(home);
  // 120 passing tests printed one per line by the verbose reporter, then either a deprecation warning from a passing
  // test or one failing assertion.
  const tests = Array.from({ length: 120 }, (_, index) => {
    const item = index + 1;
    const name = item === 60 ? `line item 60 keeps its price (marker ${marker})` : `line item ${item} keeps its price`;
    return `  test('${name}', () => { expect(total([{ price: ${item}, quantity: 1 }])).toBe(${item}); });`;
  });
  await writeFile(path.join(project, 'invoice.test.mjs'), [
    '// Invoice fixture tests; one expectation is wrong on purpose.',
    'const total = items => items.reduce((sum, item) => sum + item.price * item.quantity, 0);',
    ...scenario === 'passing' ? [`const legacyTotal = items => { console.warn('${WARNING}'); return total(items); };`] : [],
    "describe('invoice totals', () => {", ...tests,
    ...scenario === 'failing' ? [
      "  test('invoice 4127 sums every line', () => {",
      '    expect(total([{ price: 4000, quantity: 1 }, { price: 217, quantity: 1 }])).toBe(4127);',
      '  });',
    ] : ["  test('legacy helper still sums', () => { expect(legacyTotal([{ price: 2, quantity: 2 }])).toBe(4); });"],
    '});', '',
  ].join('\n'));
  await writeFile(path.join(project, 'package.json'), `${JSON.stringify({ name: 'codebudget-acceptance-fixture', private: true, type: 'module', scripts: { test: `node "${vitest.replaceAll('\\', '/')}" run --globals --reporter=verbose` } }, null, 2)}\n`);
  for (const step of [['init'], ['config', 'mode', 'balanced']]) {
    const result = run(process.execPath, [cli, '--root', project, ...step]);
    assert.equal(result.status, 0, normalize(result.stderr));
  }

  // Free preflight: the suite fails, prints the marker, and the balanced reducer omits it, so no model session is wasted.
  const direct = run(process.execPath, [vitest, 'run', '--globals', '--reporter=verbose']);
  const output = plain(direct.stderr + direct.stdout);
  // The diagnostics the model must see and quote: the failed assertion and its location, or the warning and the count.
  const diagnostics = scenario === 'failing'
    ? [/AssertionError: (expected \d+ to be \d+)/.exec(output)?.[1], /(invoice\.test\.mjs:\d+:\d+)/.exec(output)?.[1]]
    : [output.includes(WARNING) ? WARNING : undefined, /Tests\s+(121) passed/.exec(output)?.[1]];
  record.raw = { exitCode: direct.status, stdoutBytes: bytes(direct.stdout), stderrBytes: bytes(direct.stderr), diagnostics, markerInStdout: direct.stdout.includes(marker) };
  assert.ok((scenario === 'failing') === (direct.status !== 0) && diagnostics.every(Boolean) && direct.stdout.includes(marker), `The fixture suite did not behave as designed: ${normalize(direct.stderr.slice(0, 2000))}`);
  const preview = run(process.execPath, [cli, '--root', project, 'run', '--no-stdin', '--', process.execPath, vitest, 'run', '--globals', '--reporter=verbose']);
  assert.ok(!preview.stdout.includes(marker) && diagnostics.every(value => plain(preview.stdout).includes(value)), `The balanced reducer does not omit the marker line or loses a diagnostic for this output; a model session would not test retrieval: ${normalize(preview.stderr.slice(0, 2000))}`);

  const version = run('claude', ['--version']);
  if (version.error) throw Object.assign(version.error, { unavailable: version.error.code === 'ENOENT' });
  assert.equal(version.status, 0, normalize(version.stderr));
  record.clientVersion = version.stdout.trim();
  const auth = run('claude', ['auth', 'status', '--json']);
  let loggedIn = false;
  try { loggedIn = JSON.parse(auth.stdout).loggedIn === true; } catch { /* reported below */ }
  if (!loggedIn) throw Object.assign(new Error(useLogin ? 'The client reports that it is not logged in.' : 'The isolated client configuration is not logged in; rerun with --use-login to use your normal Claude Code login.'), { unavailable: true });

  if (preflightOnly) {
    record.status = 'preflight_passed'; record.modelRequests = 0;
  } else {
    const prompt = [
      'Run this project\'s test suite exactly once with the command `npm test`. Do not edit, create or delete files and do not run any other command.',
      'Then answer from what you observed:',
      scenario === 'failing' ? '1. The exact assertion message of the failing test and its file:line:column location.' : '1. The exact deprecation warning printed during the run and the number of passing tests.',
      '2. The test output references archived CodeBudget evidence. Use the CodeBudget read_evidence tool with that evidence ID to read the full original output and find the passing test whose name contains the word "marker". Quote its marker value, which starts with RET-.',
      'Reply with exactly three lines:',
      ...scenario === 'failing' ? ['FAILURE: <assertion message>', 'LOCATION: <file:line:column>'] : ['WARNING: <warning text>', 'PASSED: <number of passing tests>'],
      'MARKER: <marker value>',
    ].join('\n');
    const session = run('claude', ['-p', '--plugin-dir', plugin, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--tools', 'Bash', '--allowedTools', ...record.allowedTools, '--permission-mode', 'dontAsk', '--no-session-persistence', ...(model ? ['--model', model] : [])], { input: prompt, timeout: 600000 });
    if (session.error) throw session.error;
    const messages = session.stdout.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    // The normalized stream stays out of the repository: it is for inspecting a failed run.
    await mkdir(path.join(repository, 'dist'), { recursive: true });
    await writeFile(path.join(repository, 'dist/claude-model-acceptance-transcript.jsonl'), messages.map(message => normalize(JSON.stringify(message))).join('\n') + '\n');
    const init = messages.find(message => message.type === 'system' && message.subtype === 'init');
    const result = messages.findLast(message => message.type === 'result');
    const toolUses = messages.filter(message => message.type === 'assistant').flatMap(message => (message.message?.content ?? []).filter(block => block.type === 'tool_use'));
    const toolResults = new Map(messages.filter(message => message.type === 'user').flatMap(message => (Array.isArray(message.message?.content) ? message.message.content : []).filter(block => block.type === 'tool_result').map(block => [block.tool_use_id, { text: text(block.content), isError: block.is_error === true }])));
    record.model = init?.model ?? null;
    record.modelRequests = new Set(messages.filter(message => message.type === 'assistant' && message.message?.id).map(message => message.message.id)).size;
    record.turns = result?.num_turns ?? null;
    record.clientReportedCostUsd = result?.total_cost_usd ?? null;
    record.clientReportedUsage = result?.usage ?? null;
    record.permissionDenials = (result?.permission_denials ?? []).map(denial => ({ tool: denial.tool_name, input: normalize(JSON.stringify(denial.tool_input ?? {})) }));
    record.session = { exitCode: session.status, resultSubtype: result?.subtype ?? null, isError: result?.is_error ?? null, stderrTail: normalize(plain(session.stderr).slice(-1000)) };
    record.hookEvents = messages.filter(message => message.type === 'system' && /^hook_/.test(String(message.subtype))).map(message => ({ subtype: message.subtype, event: message.hook_event ?? message.hook_name ?? null, exitCode: message.exit_code ?? null, outcome: message.outcome ?? null }));
    assert.ok(init && result, `The session produced no init or result message (exit ${session.status}): ${normalize((session.stderr || session.stdout).slice(-2000))}`);

    const readEvidenceTool = init.tools?.find(tool => /^mcp__.*codebudget.*__read_evidence$/.test(tool));
    check('the session loaded the plugin from this repository and connected its MCP server', (init.plugins ?? []).some(entry => /codebudget/.test(entry.name ?? '')) && (init.mcp_servers ?? []).some(server => /codebudget/.test(server.name) && server.status === 'connected') && readEvidenceTools.includes(readEvidenceTool), JSON.stringify({ plugins: (init.plugins ?? []).map(entry => entry.name), mcpServers: init.mcp_servers ?? [], readEvidenceTool }));
    const bash = toolUses.find(use => use.name === 'Bash' && String(use.input?.command ?? '').trim() === 'npm test');
    const visible = bash ? toolResults.get(bash.id) : undefined;
    const evidenceId = /\[CodeBudget evidence: ([A-Za-z0-9:_-]+); retrieve with read_evidence/.exec(visible?.text ?? '')?.[1] ?? null;
    record.modelVisible = visible ? { bytes: bytes(visible.text), rawBytes: record.raw.stdoutBytes + record.raw.stderrBytes, evidenceId, markerPresent: visible.text.includes(marker), text: normalize(visible.text) } : null;
    check('the model ran npm test through Bash', Boolean(bash && visible));
    check('the model-visible Bash result is the reduced output with an evidence reference', Boolean(evidenceId) && !visible.text.includes(marker) && bytes(visible.text) < record.raw.stdoutBytes + record.raw.stderrBytes);
    check('the model-visible Bash result keeps the diagnostics', Boolean(visible && diagnostics.every(value => visible.text.includes(value))));
    const retrieval = toolUses.find(use => use.name === readEvidenceTool && use.input?.id === evidenceId);
    const retrieved = retrieval ? toolResults.get(retrieval.id) : undefined;
    record.retrieval = retrieval ? { input: retrieval.input, bytes: bytes(retrieved?.text ?? ''), isError: retrieved?.isError ?? null, markerPresent: Boolean(retrieved?.text.includes(marker)) } : null;
    check('the model retrieved the omitted line through read_evidence', Boolean(retrieved && !retrieved.isError && retrieved.text.includes(marker)));
    record.finalAnswer = normalize(plain(String(result.result ?? '')));
    check('the final answer quotes the diagnostics and the retrieved marker', !result.is_error && diagnostics.every(value => record.finalAnswer.includes(value)) && record.finalAnswer.includes(marker));

    const report = JSON.parse(run(process.execPath, [cli, '--root', project, 'report']).stdout);
    const hook = (report.hookMetrics ?? []).find(metric => metric.artifactId === evidenceId);
    const stored = (report.retrievals ?? []).filter(event => event.id === evidenceId);
    record.localRecords = { hook: hook ? { applied: hook.applied, originalBytes: hook.originalBytes, reducedBytes: hook.reducedBytes, clientVersion: hook.clientVersion, reason: hook.reason ?? null } : null, retrievals: stored.map(event => ({ source: event.source, returnedBytes: event.returnedBytes })) };
    check('local records show the applied replacement and an MCP retrieval of the same evidence', hook?.applied === true && stored.some(event => event.source === 'mcp'));
    record.status = record.checks.every(entry => entry.passed) ? 'passed' : 'failed';
    if (record.status !== 'passed') process.exitCode = 1;
  }
} catch (error) {
  record.status = error?.unavailable ? 'unavailable' : 'failed';
  record.error = normalize(error instanceof Error ? error.message : error);
  if (!error?.unavailable) process.exitCode = 1;
} finally {
  const resolved = path.resolve(temporary);
  assert.ok(path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('codebudget-model-acceptance-'), 'Unsafe temporary cleanup path');
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  record.temporaryFilesRemoved = true;
  await mkdir(path.dirname(resultFile()), { recursive: true });
  await writeFile(resultFile(), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
}

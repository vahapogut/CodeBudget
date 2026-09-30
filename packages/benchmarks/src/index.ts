import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import type * as TypeScriptApi from 'typescript';
import { reduceOutput, type ReducerFormat } from '../../reducers/src/index.js';
import { analyzeSource, hiddenEvaluators } from './evaluators.js';
import { getTaskContext, pilotTasks, type PilotTask } from './tasks.js';

export { getTaskContext, pilotTasks, type PilotTask, type TaskCategory } from './tasks.js';
export { capturedReplayCases } from './captured.js';
export interface ReplayCase { id: string; format: ReducerFormat; text: string; exitCode: number | null; expectedEvidence: readonly string[]; corpus?: 'synthetic' | 'captured'; toolVersion?: string; capturedAt?: string; }
export const replayCases: readonly ReplayCase[] = [
  { id: 'vitest-3-human', format: 'vitest', text: ' RUN v3.2.4\n' + Array.from({ length: 100 }, (_, i) => ` ✓ tests/detailed-success-${i}.test.ts (10 tests) 3ms`).join('\n') + '\n FAIL auth.test.ts > rejects reuse\nExpected: 401\nReceived: 200\n ❯ auth.test.ts:42:9\n Test Files 1 failed | 100 passed\n Tests 1 failed | 1000 passed | 2 skipped | 1 cancelled\n', exitCode: 1, expectedEvidence: ['rejects reuse', 'Expected: 401', 'Received: 200', 'auth.test.ts:42:9', '2 skipped', '1 cancelled'] },
  { id: 'jest-29-human', format: 'jest', text: Array.from({ length: 60 }, (_, i) => `PASS tests/success-${i}.test.ts`).join('\n') + '\nFAIL tests/refund.test.ts\n ● rejects negative refund\n Expected: 400\n Received: 200\n at refund.test.ts:18:2\nTest Suites: 1 failed, 60 passed\nTests: 1 failed, 60 passed, 2 skipped\n', exitCode: 1, expectedEvidence: ['rejects negative refund', 'Expected: 400', 'Received: 200', 'refund.test.ts:18:2', '2 skipped'] },
  { id: 'tsc-5-human', format: 'tsc', text: '\n\nsrc/index.ts(7,9): error TS2322: string is not assignable to number\n\n\n 7 const count: number = name;\n\nFound 1 error.\n\n', exitCode: 2, expectedEvidence: ['src/index.ts(7,9)', 'TS2322', 'const count'] },
  { id: 'eslint-9-json', format: 'eslint', text: JSON.stringify([{ filePath: '/repo/a.ts', messages: [{ ruleId: 'no-unused-vars', severity: 2, line: 4, column: 2, message: 'unused token' }], errorCount: 1, warningCount: 0 }], null, 4), exitCode: 1, expectedEvidence: ['no-unused-vars', 'unused token'] },
  { id: 'git-status-human', format: 'git-status', text: 'On branch main\n\n\nChanges not staged for commit:\n\n\n modified: src/a.ts\n deleted: src/b.ts\n\n', exitCode: 0, expectedEvidence: ['modified: src/a.ts', 'deleted: src/b.ts'] },
  { id: 'git-diff-patch', format: 'git-diff', text: Array.from({ length: 8 }, (_, i) => `diff --git a/${i}.ts b/${i}.ts\nindex aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa..bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 100644\n--- a/${i}.ts\n+++ b/${i}.ts\n@@ -1,2 +1,2 @@\n context\n-old\n+new\n`).join(''), exitCode: 0, expectedEvidence: ['-old', '+new', ' context', '@@ -1,2 +1,2 @@'] },
  { id: 'rg-14-lines', format: 'search', text: Array.from({ length: 50 }, (_, i) => `packages/really-long-component/src/refresh-token-service.ts:${i + 1}:4:token_${i}`).join('\n'), exitCode: 0, expectedEvidence: ['refresh-token-service.ts', '1:4:token_0', '50:4:token_49'] },
  { id: 'json-response', format: 'json', text: JSON.stringify({ status: 'failed', details: { expected: 401, actual: 200, at: 'auth.ts:42' }, entries: Array.from({ length: 40 }, (_, i) => ({ id: i, valid: false })) }, null, 4), exitCode: 1, expectedEvidence: ['"status":"failed"', 'auth.ts:42'] },
  { id: 'exact-logs', format: 'logs', text: '2026-09-29T12:00:00Z begin\n' + Array.from({ length: 100 }, () => 'INFO queue poll for tenant=alpha returned zero pending work items').join('\n') + '\n2026-09-29T12:00:10Z ERROR request 4 expected 200 actual 503\n', exitCode: 1, expectedEvidence: ['100 occurrences', '12:00:00Z', '12:00:10Z', 'request 4 expected 200 actual 503'] },
  { id: 'unknown-future-format', format: 'unknown', text: 'Unknown future format\nThis must be passed through exactly.\n', exitCode: null, expectedEvidence: ['Unknown future format', 'This must be passed through exactly.'] },
];

function replayRow(item: ReplayCase, hinted: boolean) {
  const memoryBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  // The runner and the Claude hook never pass a format, so only the separately reported hinted pass supplies one.
  const result = reduceOutput({ text: item.text, exitCode: item.exitCode, mode: 'balanced', artifactId: `replay:${item.id}`, ...(hinted ? { format: item.format } : {}) });
  const durationMs = performance.now() - start;
  const heapDeltaBytes = process.memoryUsage().heapUsed - memoryBefore;
  const missingEvidence = item.expectedEvidence.filter(text => !result.output.includes(text));
  return { id: item.id, corpus: item.corpus ?? 'synthetic', toolVersion: item.toolVersion ?? null, capturedAt: item.capturedAt ?? null, labeledFormat: item.format, reducerId: result.reducerId, detectedAsLabeled: result.reducerId === (item.format === 'unknown' ? 'identity' : item.format), reason: result.reason, originalBytes: result.originalSize, reducedBytes: result.reducedSize, reducedEnvelopeBytes: Buffer.byteLength(JSON.stringify(result)), durationMs, observedHeapDeltaBytes: heapDeltaBytes, preservationPassed: result.preservation.valid && missingEvidence.length === 0 && result.exitCode === item.exitCode, missingEvidence, applied: result.applied };
}
function replayTotals(rows: readonly ReturnType<typeof replayRow>[]) {
  const originalBytes = rows.reduce((sum, row) => sum + row.originalBytes, 0);
  const reducedBytes = rows.reduce((sum, row) => sum + row.reducedBytes, 0);
  const corpora = [...new Set(rows.map(row => row.corpus))].map(corpus => {
    const selected = rows.filter(row => row.corpus === corpus);
    const input = selected.reduce((total, row) => total + row.originalBytes, 0);
    const output = selected.reduce((total, row) => total + row.reducedBytes, 0);
    return { corpus, cases: selected.length, originalBytes: input, reducedBytes: output, byteReductionFraction: input ? (input - output) / input : null, preservationPassed: selected.every(row => row.preservationPassed), notDetectedAsLabeled: selected.filter(row => !row.detectedAsLabeled).map(row => row.id) };
  });
  return { rows: [...rows], corpora, originalBytes, reducedBytes, byteReductionFraction: corpora.length === 1 && originalBytes ? (originalBytes - reducedBytes) / originalBytes : null, preservationPassed: rows.every(row => row.preservationPassed) };
}

/** Primary figures use automatic detection, exactly as product callers invoke the reducers; hinted figures are separate. */
export function replayBenchmark(cases: readonly ReplayCase[] = replayCases) {
  const detected = replayTotals(cases.map(item => replayRow(item, false)));
  const hinted = replayTotals(cases.map(item => replayRow(item, true)));
  return {
    schemaVersion: 1 as const, kind: 'replay' as const, detection: 'automatic' as const, ...detected,
    preservationPassed: detected.preservationPassed && hinted.preservationPassed,
    hinted: { detection: 'labeled-format-hint' as const, note: 'Each case replayed with its labeled format as a hint. The runner and Claude hook never supply such hints; these figures are for comparison only.', ...hinted },
    measurement: 'UTF-8 output bytes at one already-redacted boundary; schema envelope shown separately.',
    memoryMeasurement: 'Heap samples before/after each reducer; not peak RSS, allocation profiling, or a bounded-memory guarantee.',
    taskSavingsConclusion: 'not_measured' as const,
    limitations: [detected.corpora.length > 1 ? 'Synthetic and actually captured corpora are reported separately; no blended reduction percentage.' : detected.corpora[0]?.corpus === 'captured' ? 'Actually executed local tool captures; streams replayed as documented concatenation.' : 'Synthetic versioned fixtures, not executed tool captures.', 'Primary figures use automatic format detection as the runner and Claude hook do; format-hinted figures are reported separately under `hinted`.', 'No model calls, task completion, billing or subscription quota measured.', 'Replay percentages are not end-to-end task savings.'],
  };
}

export type BenchmarkCondition = 'native-baseline' | 'optimized-baseline' | 'codebudget';
export const benchmarkConditions: readonly BenchmarkCondition[] = ['native-baseline', 'optimized-baseline', 'codebudget'];
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 0x100000000; };
}
function hashFiles(files: Readonly<Record<string, string>>): string {
  const hash = createHash('sha256');
  for (const key of Object.keys(files).sort()) hash.update(key).update('\0').update(files[key]!).update('\0');
  return hash.digest('hex');
}
/** Hashes the workspace exactly as written on disk, with the same framing as the planned in-memory hash. */
export async function hashWorkspaceFiles(directory: string): Promise<string> {
  const hash = createHash('sha256');
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    if (!entry.isFile()) throw new Error(`Unexpected non-file workspace entry: ${entry.name}`);
    hash.update(entry.name).update('\0').update(await readFile(path.join(directory, entry.name))).update('\0');
  }
  return hash.digest('hex');
}
export interface TaskBenchmarkPlanOptions { seed?: number; repeats?: number; taskIds?: readonly string[]; }
export function createTaskBenchmarkPlan(options: TaskBenchmarkPlanOptions = {}) {
  const seed = options.seed ?? 42;
  const repeats = options.repeats ?? 3;
  if (!Number.isSafeInteger(seed) || !Number.isInteger(repeats) || repeats < 1 || repeats > 100) throw new Error('seed must be an integer; repeats must be 1..100');
  const ids = options.taskIds ?? pilotTasks.map(task => task.id);
  if (new Set(ids).size !== ids.length || ids.length === 0) throw new Error('Task IDs must be nonempty and unique');
  const tasks = ids.map(getTaskContext);
  const schedule = tasks.flatMap(task => Array.from({ length: repeats }, (_, repeat) => benchmarkConditions.map(condition => ({ taskId: task.id, repeat, condition, initialFilesHash: hashFiles(task.files) }))).flat());
  const next = random(seed);
  for (let index = schedule.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [schedule[index], schedule[other]] = [schedule[other]!, schedule[index]!];
  }
  return {
    schemaVersion: 1 as const, kind: 'task-plan' as const, status: 'not_run' as const, dryRun: true as const,
    seed, repeats, taskCount: tasks.length, runCount: schedule.length, conditions: benchmarkConditions,
    categories: [...new Set(tasks.map(task => task.category))],
    tasks: tasks.map(task => ({ id: task.id, title: task.title, category: task.category, license: task.license, humanReviewRequired: task.humanReviewRequired, initialFilesHash: hashFiles(task.files) })),
    schedule, modelCalls: 0,
    cacheState: 'uncontrolled/unknown',
    baselinePolicy: { 'native-baseline': 'Native client defaults with the full task files.', 'optimized-baseline': 'Same client/model, native file search, targeted reads and output options enabled as documented by the runner.', codebudget: 'Same client/model and permissions, with CodeBudget context/reducers and all retrieval costs included.' },
    note: 'A dry-run plan is not a completed model benchmark. Runner, pinned versions, spend/run limits and explicit opt-in are required.',
  };
}

export interface TaskRunResult {
  taskId: string;
  repeat: number;
  condition: BenchmarkCondition;
  success: boolean;
  typecheckPassed: boolean;
  evaluatorPassed: boolean;
  humanReviewRequired: boolean;
  durationMs: number;
  attempts: number;
  retrievalCalls: number;
  totalTokens: number | null;
  consumptionSource: 'provider_reported' | 'client_reported' | 'locally_estimated' | 'unknown';
  cost: number | null;
  currency: string | null;
  cacheState: string;
  runKind: 'model' | 'local-contract';
  error: string | null;
  /** SHA-256 of the workspace files read back from disk before the runner started. */
  initialFilesHash?: string;
}
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
const mean = (values: readonly number[]): number => sum(values) / values.length;
function interval(values: readonly number[], seed = 42) {
  if (values.length < 2) return null;
  const next = random(seed);
  const sampled = Array.from({ length: 2000 }, () => mean(Array.from({ length: values.length }, () => values[Math.floor(next() * values.length)]!))).sort((a, b) => a - b);
  return { low: sampled[Math.floor(sampled.length * 0.025)]!, high: sampled[Math.floor(sampled.length * 0.975)]!, confidence: 0.95, method: 'paired-task bootstrap; repeats averaged within task' };
}
export function aggregateTaskResults(results: readonly TaskRunResult[]) {
  if (new Set(results.map(result => result.runKind)).size > 1) throw new Error('Model runs and local-contract checks require separate reports');
  const seen = new Set<string>();
  for (const result of results) {
    const key = `${result.taskId}:${result.repeat}:${result.condition}`;
    if (seen.has(key)) throw new Error(`Duplicate benchmark result: ${key}`);
    seen.add(key);
    if (result.success && (!result.typecheckPassed || !result.evaluatorPassed || result.error !== null)) throw new Error('Successful benchmark result requires passing typecheck and evaluator with no error');
    if (result.totalTokens !== null && (!Number.isFinite(result.totalTokens) || result.totalTokens < 0)) throw new Error('Invalid token total');
    if (result.cost !== null && (!Number.isFinite(result.cost) || result.cost < 0)) throw new Error('Invalid cost total');
    if (!Number.isInteger(result.attempts) || result.attempts < 1 || !Number.isInteger(result.retrievalCalls) || result.retrievalCalls < 0) throw new Error('Invalid attempt/retrieval counts');
  }
  const conditions = benchmarkConditions.map(condition => {
    const rows = results.filter(row => row.condition === condition);
    const successes = rows.filter(row => row.success).length;
    const sources = [...new Set(rows.map(row => row.consumptionSource))];
    const tokenCoverageComplete = rows.length > 0 && rows.every(row => row.totalTokens !== null) && sources.length === 1 && sources[0] !== 'unknown';
    const totalTokens = tokenCoverageComplete ? sum(rows.map(row => row.totalTokens!)) : null;
    const currencies = [...new Set(rows.map(row => row.currency))];
    const totalCost = rows.length > 0 && rows.every(row => row.cost !== null && row.currency !== null) && currencies.length === 1 ? sum(rows.map(row => row.cost!)) : null;
    return { condition, runs: rows.length, successes, failures: rows.length - successes, successRate: rows.length ? successes / rows.length : null, totalTokens, consumptionSource: sources.length === 1 ? sources[0]! : 'mixed_or_unknown', tokensPerSuccessfulTask: successes > 0 && totalTokens !== null ? totalTokens / successes : null, totalCost, costPerSuccessfulTask: successes > 0 && totalCost !== null ? totalCost / successes : null, currency: totalCost !== null ? currencies[0]! : null, totalAttempts: sum(rows.map(row => row.attempts)), totalRetrievalCalls: sum(rows.map(row => row.retrievalCalls)), totalDurationMs: sum(rows.map(row => row.durationMs)) };
  });
  const paired = (['native-baseline', 'optimized-baseline'] as const).map(baseline => {
    const pairs = [...new Set(results.map(row => row.taskId))].flatMap(taskId => {
      const cb = results.filter(row => row.taskId === taskId && row.condition === 'codebudget');
      const base = results.filter(row => row.taskId === taskId && row.condition === baseline);
      const matched = cb.flatMap(row => { const other = base.find(item => item.repeat === row.repeat); return other ? [{ row, other }] : []; });
      if (!matched.length) return [];
      const comparableTokens = matched.every(({ row, other }) => row.totalTokens !== null && other.totalTokens !== null && row.consumptionSource === other.consumptionSource && row.consumptionSource !== 'unknown');
      return [{ taskId, matchedRepeats: matched.length, successDifference: mean(matched.map(({ row, other }) => Number(row.success) - Number(other.success))), tokenDifference: comparableTokens ? mean(matched.map(({ row, other }) => row.totalTokens! - other.totalTokens!)) : null, consumptionSource: comparableTokens && new Set(matched.map(({ row }) => row.consumptionSource)).size === 1 ? matched[0]!.row.consumptionSource : 'mixed_or_unknown' }];
    });
    const successValues = pairs.map(pair => pair.successDifference);
    const sources = new Set(pairs.filter(pair => pair.tokenDifference !== null).map(pair => pair.consumptionSource));
    const tokenValues = sources.size === 1 && !sources.has('mixed_or_unknown') ? pairs.flatMap(pair => pair.tokenDifference === null ? [] : [pair.tokenDifference]) : [];
    return { baseline, pairs, taskCount: pairs.length, meanSuccessDifference: successValues.length ? mean(successValues) : null, successInterval: interval(successValues), meanTokenDifference: tokenValues.length ? mean(tokenValues) : null, tokenInterval: interval(tokenValues), tokenTaskCount: tokenValues.length };
  });
  return { schemaVersion: 1 as const, kind: 'task-results' as const, conditions, paired, conclusion: 'inconclusive' as const, realModelRuns: results.filter(result => result.runKind === 'model').length, localContractRuns: results.filter(result => result.runKind === 'local-contract').length, notes: ['Failed attempts remain in all consumption totals.', 'Unknown consumption is null, never zero.', 'Paired differences are CodeBudget minus baseline; all matched outcomes are included, not only successes.', 'Intervals describe this pilot only; no universal quality or non-inferiority claim.', 'Hidden tests do not establish general behavioral equivalence; flagged tasks still require human review.', 'Do not mix local-contract and model runs in a performance claim.'] };
}

function command(executable: string, args: readonly string[], cwd: string, timeoutMs: number, input = ''): Promise<{ ok: boolean; output: string; stdoutTail: string }> {
  return new Promise(resolve => {
    const child = spawn(executable, [...args], { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let stdoutTail = '';
    let settled = false;
    const collect = (data: Buffer): void => { if (output.length < 32_000) output += data.toString('utf8').slice(0, 32_000 - output.length); };
    child.stdout.on('data', (data: Buffer) => { collect(data); stdoutTail = (stdoutTail + data.toString('utf8')).slice(-65_536); });
    child.stderr.on('data', collect);
    // A child that exits without reading stdin must not turn EPIPE into an unhandled error.
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
    const timer = setTimeout(() => { child.kill(); finish(false, 'Evaluator timeout'); }, timeoutMs);
    function finish(ok: boolean, error = ''): void { if (!settled) { settled = true; clearTimeout(timer); resolve({ ok, output: error || output, stdoutTail }); } }
    child.on('error', error => finish(false, error.message));
    child.on('close', code => finish(code === 0));
  });
}

/**
 * TypeScript is needed only to evaluate candidates, so it is resolved lazily: installations without it still load,
 * replay and plan benchmarks, and evaluation fails with an explicit message instead of a module-resolution error.
 */
export function resolveTypeScript(resolver: NodeJS.Require = createRequire(import.meta.url)): { ts: typeof TypeScriptApi; compiler: string } {
  try { return { ts: resolver('typescript') as typeof TypeScriptApi, compiler: resolver.resolve('typescript/bin/tsc') }; }
  catch (error) { throw new Error('Task evaluation requires the "typescript" package, a development dependency that CodeBudget does not bundle. Install typescript where the evaluator runs; replay benchmarks and task plans do not need it.', { cause: error }); }
}

async function removeTemporary(directory: string): Promise<void> {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !/^codebudget-(?:evaluator|task)-/.test(path.basename(resolved))) throw new Error('Refusing cleanup outside benchmark temporary directories');
  await rm(resolved, { recursive: true, force: true });
}

/** Evaluation is free and local. Candidate code is executed; use only an authorized benchmark workspace. */
export async function evaluateTaskCandidate(taskId: string, files: Readonly<Record<string, string>>, timeoutMs = 15_000) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('Evaluator timeout must be a positive finite duration');
  const started = performance.now();
  const evaluator = hiddenEvaluators[taskId];
  if (!evaluator) throw new Error(`No evaluator for task: ${taskId}`);
  const source = files['solution.ts'];
  if (typeof source !== 'string') return { success: false, typecheckPassed: false, evaluatorPassed: false, error: 'Missing solution.ts' };
  const { ts, compiler } = resolveTypeScript();
  const temporary = await mkdtemp(path.join(tmpdir(), 'codebudget-evaluator-'));
  try {
    await writeFile(path.join(temporary, 'solution.ts'), source);
    await writeFile(path.join(temporary, 'package.json'), '{"type":"module"}');
    const typecheck = await command(process.execPath, [compiler, 'solution.ts', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--outDir', 'out', '--noEmitOnError'], temporary, Math.max(1, timeoutMs - (performance.now() - started)));
    if (!typecheck.ok) return { success: false, typecheckPassed: false, evaluatorPassed: false, error: typecheck.output };
    // Constraints inspect the syntax tree, so comments and string literals cannot satisfy or violate them.
    const constraint = evaluator.constraint?.(analyzeSource(ts, source)) ?? null;
    if (constraint) return { success: false, typecheckPassed: true, evaluatorPassed: false, error: `Task-specific refactor constraint failed: ${constraint}` };
    // Exit status alone is not success: a candidate can exit(0) while being imported. The per-run completion token
    // reaches the evaluator through stdin before the candidate loads and is printed only after the last assertion.
    const completion = `CODEBUDGET_EVALUATION_COMPLETE ${randomBytes(16).toString('hex')}`;
    const script = `import assert from 'node:assert/strict';\nconst chunks = [];\nfor await (const chunk of process.stdin) chunks.push(chunk);\nconst completion = Buffer.concat(chunks).toString('utf8');\nconst m = await import('./out/solution.js');\n${evaluator.assertions}\nprocess.stdout.write('\\n' + completion + '\\n');\n`;
    await writeFile(path.join(temporary, 'evaluate.mjs'), script);
    const remaining = timeoutMs - (performance.now() - started);
    if (remaining <= 0) return { success: false, typecheckPassed: true, evaluatorPassed: false, error: 'Evaluator timeout' };
    const behavior = await command(process.execPath, [path.join(temporary, 'evaluate.mjs')], temporary, remaining, completion);
    const completed = behavior.ok && behavior.stdoutTail.includes(`\n${completion}\n`);
    return { success: completed, typecheckPassed: true, evaluatorPassed: completed, error: completed ? null : behavior.ok ? 'Evaluator exited with status 0 before completing all assertions' : behavior.output };
  } finally { await removeTemporary(temporary); }
}

export interface RunnerReply {
  files: Readonly<Record<string, string>>;
  totalTokens: number | null;
  consumptionSource: TaskRunResult['consumptionSource'];
  cost: number | null;
  currency: string | null;
  attempts: number;
  retrievalCalls: number;
}
export interface TaskBenchmarkRunnerOptions extends TaskBenchmarkPlanOptions {
  explicitOptIn: boolean;
  runKind: 'model' | 'local-contract';
  maxRuns: number;
  maxSpend: number;
  currency: string;
  timeoutMs: number;
  maxAttempts?: number;
  model: string;
  modelVersion: string;
  client: string;
  clientVersion: string;
  settings: Readonly<Record<string, unknown>>;
  permissions: string;
  cacheState: string;
  verifiedPricing?: { sourceUrl: string; verifiedAt: string; usageClass: string; currency: string };
  runner: (context: { task: PilotTask; condition: BenchmarkCondition; workspace: string; signal: AbortSignal; runBudget: { remainingSpend: number; currency: string; timeoutMs: number; maxAttempts: number }; settings: Readonly<Record<string, unknown>> }) => Promise<RunnerReply>;
}

/** Provider integrations are caller supplied. This module never opens a network connection. */
export async function runTaskBenchmark(options: TaskBenchmarkRunnerOptions) {
  if (!options.explicitOptIn) throw new Error('Task execution requires explicit opt-in');
  const maxAttempts = options.maxAttempts ?? 1;
  if (![options.model, options.modelVersion, options.client, options.clientVersion, options.permissions, options.cacheState, options.currency].every(value => value.trim().length > 0)) throw new Error('Pin model/client versions, permissions, currency and cache state');
  if (!Number.isInteger(options.maxRuns) || options.maxRuns < 1 || !Number.isFinite(options.maxSpend) || options.maxSpend < 0 || !Number.isFinite(options.timeoutMs) || options.timeoutMs < 1 || !Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('Explicit valid run, spend, timeout and attempt budgets required');
  const plan = createTaskBenchmarkPlan(options);
  if (plan.runCount > options.maxRuns) throw new Error(`Plan needs ${plan.runCount} runs; budget allows ${options.maxRuns}`);
  // Fail before any runner (and any possibly paid model call) starts when candidates could not be evaluated.
  resolveTypeScript();
  const results: TaskRunResult[] = [];
  let spent = 0;
  let stoppedReason: string | null = null;
  for (const run of plan.schedule) {
    if (options.runKind === 'model' && spent >= options.maxSpend) { stoppedReason = 'spend_budget_reached'; break; }
    const task = getTaskContext(run.taskId);
    const workspace = await mkdtemp(path.join(tmpdir(), 'codebudget-task-'));
    const controller = new AbortController();
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const base: TaskRunResult = { taskId: task.id, repeat: run.repeat, condition: run.condition, success: false, typecheckPassed: false, evaluatorPassed: false, humanReviewRequired: task.humanReviewRequired, durationMs: 0, attempts: 1, retrievalCalls: 0, totalTokens: null, consumptionSource: 'unknown', cost: null, currency: null, cacheState: options.cacheState, runKind: options.runKind, error: null };
    try {
      for (const [filename, content] of Object.entries(task.files)) await writeFile(path.join(workspace, filename), content);
      const writtenHash = await hashWorkspaceFiles(workspace);
      base.initialFilesHash = writtenHash;
      if (writtenHash !== run.initialFilesHash) throw new Error('Workspace files on disk differ from the planned initial files; runner not started');
      const reply = await Promise.race([
        options.runner({ task, condition: run.condition, workspace, signal: controller.signal, runBudget: { remainingSpend: Math.max(0, options.maxSpend - spent), currency: options.currency, timeoutMs: options.timeoutMs, maxAttempts }, settings: options.settings }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Runner timeout; provider may still charge in-flight requests')); }, options.timeoutMs); }),
      ]);
      if (timer) { clearTimeout(timer); timer = undefined; }
      if (reply.totalTokens !== null && (!Number.isFinite(reply.totalTokens) || reply.totalTokens < 0)) throw new Error('Runner returned an invalid token total');
      if (reply.cost !== null && (!Number.isFinite(reply.cost) || reply.cost < 0)) throw new Error('Runner returned an invalid cost');
      if (!Number.isInteger(reply.attempts) || reply.attempts < 1 || reply.attempts > maxAttempts || !Number.isInteger(reply.retrievalCalls) || reply.retrievalCalls < 0) throw new Error('Runner returned invalid attempt/retrieval counts or exceeded its attempt budget');
      if (options.runKind === 'model' && reply.cost !== null && (!options.verifiedPricing || options.verifiedPricing.currency !== reply.currency)) throw new Error('Model costs require verified pricing metadata in the same currency');
      const remaining = options.timeoutMs - (performance.now() - start);
      if (remaining <= 0) throw new Error('Run timeout before evaluator');
      const evaluated = await evaluateTaskCandidate(task.id, reply.files, remaining);
      results.push({ ...base, ...evaluated, totalTokens: reply.totalTokens, consumptionSource: reply.consumptionSource, cost: reply.cost, currency: reply.currency, attempts: reply.attempts, retrievalCalls: reply.retrievalCalls, durationMs: performance.now() - start });
      if (reply.cost === null || reply.currency !== options.currency) { if (options.runKind === 'model') stoppedReason = 'unknown_or_incomparable_spend'; }
      else spent += reply.cost;
    } catch (error) {
      results.push({ ...base, durationMs: performance.now() - start, error: error instanceof Error ? error.message : String(error) });
      if (options.runKind === 'model') stoppedReason = 'failed_run_with_unknown_spend';
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
      await removeTemporary(workspace);
    }
    if (stoppedReason) break;
  }
  return {
    schemaVersion: 1 as const, kind: 'task-execution' as const, status: stoppedReason ? 'stopped' as const : 'completed' as const,
    plan, manifest: { model: options.model, modelVersion: options.modelVersion, client: options.client, clientVersion: options.clientVersion, settings: options.settings, permissions: options.permissions, cacheState: options.cacheState, timeoutMs: options.timeoutMs, maxRuns: options.maxRuns, maxAttempts, concurrency: 1, maxSpend: options.maxSpend, currency: options.currency, verifiedPricing: options.verifiedPricing ?? null },
    results, aggregate: aggregateTaskResults(results), observedSpend: spent, stoppedReason,
    spendLimitNote: 'A local admission limit, not a provider-guaranteed hard spending cap. In-flight calls may incur cost after cancellation.',
  };
}

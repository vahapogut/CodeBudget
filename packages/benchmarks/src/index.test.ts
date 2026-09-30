import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { aggregateTaskResults, capturedReplayCases, createTaskBenchmarkPlan, evaluateTaskCandidate, getTaskContext, hashWorkspaceFiles, pilotTasks, replayBenchmark, replayCases, resolveTypeScript, runTaskBenchmark, type TaskRunResult } from './index.js';
import { referenceSolutions } from './solutions.fixture.js';

describe('free replay and task harness', () => {
  it('replays every reducer family with preserved evidence and explicit measurement limits', () => {
    const report = replayBenchmark();
    expect(report.rows).toHaveLength(10);
    expect(report.hinted.rows).toHaveLength(10);
    expect(report.preservationPassed).toBe(true);
    expect(report.originalBytes).toBeGreaterThan(report.reducedBytes);
    expect(report.taskSavingsConclusion).toBe('not_measured');
    expect(report.rows.every(row => row.reducedEnvelopeBytes >= row.reducedBytes)).toBe(true);
  });

  it('reports automatic detection as the primary figure and labeled format hints separately', () => {
    const mislabeled = { id: 'vitest-labeled-eslint', format: 'eslint' as const, text: replayCases[0]!.text, exitCode: 1, expectedEvidence: ['rejects reuse'] };
    const report = replayBenchmark([mislabeled]);
    expect(report.detection).toBe('automatic');
    expect(report.rows[0]).toMatchObject({ labeledFormat: 'eslint', reducerId: 'vitest', detectedAsLabeled: false, applied: true });
    expect(report.hinted.rows[0]).toMatchObject({ reducerId: 'identity', reason: 'unknown_format', applied: false });
    expect(report.corpora[0]!.notDetectedAsLabeled).toEqual(['vitest-labeled-eslint']);
    expect(report.reducedBytes).toBeLessThan(report.hinted.reducedBytes);
    const synthetic = replayBenchmark();
    expect(synthetic.rows.find(row => row.id === 'json-response')).toMatchObject({ reducerId: 'json', applied: true });
    // The synthetic Git status text is space-indented; Git itself indents entries with a tab, so it is not recognized.
    expect(synthetic.corpora[0]!.notDetectedAsLabeled).toEqual(['git-status-human']);
  });

  it('exposes actual captures with provenance and never blends their percentage with synthetic fixtures', () => {
    const captured = replayBenchmark(capturedReplayCases);
    expect(captured.rows).toHaveLength(9);
    expect(captured.preservationPassed).toBe(true);
    expect(captured.rows.every(row => row.corpus === 'captured' && row.toolVersion && row.capturedAt)).toBe(true);
    expect(captured.corpora).toHaveLength(1);
    expect(captured.corpora[0]!.corpus).toBe('captured');
    const combined = replayBenchmark([...replayCases, ...capturedReplayCases]);
    expect(combined.rows).toHaveLength(19);
    expect(combined.corpora.map(item => item.corpus)).toEqual(['synthetic', 'captured']);
    expect(combined.hinted.corpora.map(item => item.corpus)).toEqual(['synthetic', 'captured']);
    expect(combined.byteReductionFraction).toBeNull();
    expect(combined.hinted.byteReductionFraction).toBeNull();
    expect(combined.corpora.every(item => item.byteReductionFraction !== null)).toBe(true);
    expect(combined.limitations[0]).toContain('no blended');
  });

  it('counts only content reduction, never line-ending normalization, in captured replays', () => {
    const report = replayBenchmark(capturedReplayCases);
    const tsc = report.rows.find(row => row.id === 'tsc-actual')!;
    expect(tsc).toMatchObject({ reducerId: 'tsc', reason: 'no_gain', originalBytes: 176, reducedBytes: 176, applied: false });
    for (const row of report.rows) if (!row.applied) expect(row.reducedBytes).toBe(row.originalBytes);
  });

  it('creates a reproducible randomized three-condition plan for 30 distinct tasks', () => {
    const plan = createTaskBenchmarkPlan({ seed: 19, repeats: 2 });
    expect(plan.taskCount).toBe(30);
    expect(plan.runCount).toBe(180);
    expect(plan.modelCalls).toBe(0);
    expect(plan.status).toBe('not_run');
    expect(new Set(pilotTasks.map(task => (task.files['solution.ts'] ?? '') + (task.files['evidence.log'] ?? ''))).size).toBe(30);
    expect(plan.categories).toHaveLength(5);
    expect(createTaskBenchmarkPlan({ seed: 19, repeats: 2 })).toEqual(plan);
    expect(createTaskBenchmarkPlan({ seed: 20, repeats: 2 }).schedule).not.toEqual(plan.schedule);
    for (const task of plan.tasks) expect(new Set(plan.schedule.filter(run => run.taskId === task.id).map(run => run.initialFilesHash)).size).toBe(1);
  });

  it('keeps hidden evaluator assertions and solutions out of task context', () => {
    const context = getTaskContext('bug-01');
    expect(Object.keys(context.files)).toEqual(['solution.ts']);
    expect(JSON.stringify(context)).not.toContain('assert.equal');
    expect(JSON.stringify(context)).not.toContain(referenceSolutions['bug-01']);
  });

  it('includes failed attempts in cost and keeps unobserved consumption null', () => {
    const base: TaskRunResult = { taskId: 'bug-01', repeat: 0, condition: 'codebudget', success: false, typecheckPassed: false, evaluatorPassed: false, humanReviewRequired: false, durationMs: 1, attempts: 2, retrievalCalls: 3, totalTokens: 100, consumptionSource: 'client_reported', cost: 1, currency: 'USD', cacheState: 'unknown', runKind: 'local-contract', error: null };
    const report = aggregateTaskResults([base, { ...base, taskId: 'bug-02', success: true, typecheckPassed: true, evaluatorPassed: true, totalTokens: 50, cost: 2 }]);
    const result = report.conditions.find(row => row.condition === 'codebudget')!;
    expect(result.tokensPerSuccessfulTask).toBe(150);
    expect(result.costPerSuccessfulTask).toBe(3);
    expect(result.totalAttempts).toBe(4);
    expect(aggregateTaskResults([base]).conditions.find(row => row.condition === 'codebudget')!.tokensPerSuccessfulTask).toBeNull();
    expect(aggregateTaskResults([{ ...base, totalTokens: null }]).conditions.find(row => row.condition === 'codebudget')!.totalTokens).toBeNull();
    expect(() => aggregateTaskResults([base, base])).toThrow('Duplicate');
  });

  it('requires passing evaluation evidence before aggregating a claimed success', () => {
    const successful: TaskRunResult = { taskId: 'bug-01', repeat: 0, condition: 'codebudget', success: true, typecheckPassed: true, evaluatorPassed: true, humanReviewRequired: false, durationMs: 1, attempts: 1, retrievalCalls: 0, totalTokens: null, consumptionSource: 'unknown', cost: null, currency: null, cacheState: 'unknown', runKind: 'local-contract', error: null };
    for (const contradictory of [{ typecheckPassed: false }, { evaluatorPassed: false }, { error: 'Evaluator timeout' }]) {
      expect(() => aggregateTaskResults([{ ...successful, ...contradictory }])).toThrow('requires passing typecheck and evaluator with no error');
    }
    expect(aggregateTaskResults([successful]).conditions.find(row => row.condition === 'codebudget')!.successes).toBe(1);
  });

  it('computes paired task distributions and honest uncertainty', () => {
    const rows: TaskRunResult[] = [];
    for (let index = 0; index < 3; index += 1) for (const condition of ['native-baseline', 'optimized-baseline', 'codebudget'] as const) rows.push({ taskId: `bug-0${index + 1}`, repeat: 0, condition, success: true, typecheckPassed: true, evaluatorPassed: true, humanReviewRequired: false, durationMs: 1, attempts: 1, retrievalCalls: 0, totalTokens: condition === 'codebudget' ? 80 : 100, consumptionSource: 'locally_estimated', cost: null, currency: null, cacheState: 'unknown', runKind: 'local-contract', error: null });
    const report = aggregateTaskResults(rows);
    expect(report.paired[0]!.meanTokenDifference).toBe(-20);
    expect(report.paired[0]!.tokenInterval).toMatchObject({ low: -20, high: -20 });
    expect(report.conclusion).toBe('inconclusive');
    expect(report.realModelRuns).toBe(0);
  });

  it('requires explicit opt-in before invoking any model runner', async () => {
    let called = false;
    await expect(runTaskBenchmark({ explicitOptIn: false, runner: async () => { called = true; throw new Error(); } } as unknown as Parameters<typeof runTaskBenchmark>[0])).rejects.toThrow('opt-in');
    expect(called).toBe(false);
  });

  it('executes all conditions locally with identical starting files and hidden acceptance', async () => {
    const seen: string[] = [];
    const report = await runTaskBenchmark({
      explicitOptIn: true, runKind: 'local-contract', maxRuns: 3, maxSpend: 0, currency: 'USD', timeoutMs: 15_000,
      model: 'reference-fixture', modelVersion: '1', client: 'local-contract', clientVersion: '1', settings: {}, permissions: 'temporary authorized fixture execution', cacheState: 'uncontrolled/unknown', repeats: 1, taskIds: ['bug-01'],
      runner: async context => {
        expect(await readFile(path.join(context.workspace, 'solution.ts'), 'utf8')).toBe(getTaskContext('bug-01').files['solution.ts']);
        expect(JSON.stringify(context.task)).not.toContain('assert.equal');
        seen.push(context.condition);
        return { files: { 'solution.ts': referenceSolutions['bug-01']! }, totalTokens: null, consumptionSource: 'unknown', cost: 0, currency: 'USD', attempts: 1, retrievalCalls: 0 };
      },
    });
    expect(new Set(seen).size).toBe(3);
    expect(report.status).toBe('completed');
    expect(report.results.every(result => result.success)).toBe(true);
    expect(report.results.every(result => result.initialFilesHash === report.plan.tasks[0]!.initialFilesHash)).toBe(true);
    expect(report.aggregate.realModelRuns).toBe(0);
    expect(report.aggregate.localContractRuns).toBe(3);
  }, 45_000);

  it('hashes initial workspace files as written on disk and detects any divergence', async () => {
    const task = getTaskContext('log-01');
    const planned = createTaskBenchmarkPlan({ repeats: 1, taskIds: ['log-01'] }).tasks[0]!.initialFilesHash;
    const directory = await mkdtemp(path.join(tmpdir(), 'codebudget-hash-test-'));
    try {
      for (const [name, content] of Object.entries(task.files)) await writeFile(path.join(directory, name), content);
      expect(await hashWorkspaceFiles(directory)).toBe(planned);
      await writeFile(path.join(directory, 'evidence.log'), task.files['evidence.log']!.replace('\n', '\r\n'));
      expect(await hashWorkspaceFiles(directory)).not.toBe(planned);
      await writeFile(path.join(directory, 'evidence.log'), task.files['evidence.log']!);
      await writeFile(path.join(directory, 'notes.txt'), '');
      expect(await hashWorkspaceFiles(directory)).not.toBe(planned);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('explains a missing TypeScript installation instead of failing with a module error', () => {
    const missing = Object.assign(() => { throw Object.assign(new Error("Cannot find module 'typescript'"), { code: 'MODULE_NOT_FOUND' }); }, { resolve: () => { throw new Error('unreachable'); } }) as unknown as NodeJS.Require;
    expect(() => resolveTypeScript(missing)).toThrow('Task evaluation requires the "typescript" package');
    expect(resolveTypeScript().compiler).toMatch(/typescript[\\/]bin[\\/]tsc$/);
  });

  it('rejects plans exceeding the explicit run budget', async () => {
    await expect(runTaskBenchmark({ explicitOptIn: true, runKind: 'local-contract', maxRuns: 1, maxSpend: 0, currency: 'USD', timeoutMs: 10, model: 'fixture', modelVersion: '1', client: 'fixture', clientVersion: '1', settings: {}, permissions: 'none', cacheState: 'unknown', runner: async () => { throw new Error('Must not run'); } })).rejects.toThrow('budget allows');
  });

  it('times out and cancels a nonresponsive local runner without fabricating usage', async () => {
    let cancelled = 0;
    const report = await runTaskBenchmark({ explicitOptIn: true, runKind: 'local-contract', maxRuns: 3, maxSpend: 0, currency: 'USD', timeoutMs: 20, model: 'fixture', modelVersion: '1', client: 'fixture', clientVersion: '1', settings: {}, permissions: 'none', cacheState: 'unknown', repeats: 1, taskIds: ['bug-01'], runner: context => {
      context.signal.addEventListener('abort', () => { cancelled += 1; });
      return new Promise(() => {});
    } });
    expect(cancelled).toBe(3);
    expect(report.results.every(row => !row.success && row.totalTokens === null && row.error?.includes('timeout'))).toBe(true);
  });

  it.each(pilotTasks.map(task => [task.id] as const))('hidden evaluator and strict typecheck accept original reference solution for %s', async id => {
    const result = await evaluateTaskCandidate(id, { 'solution.ts': referenceSolutions[id]! });
    expect(result, result.error ?? '').toMatchObject({ success: true, typecheckPassed: true, evaluatorPassed: true });
  }, 30_000);

  it.each(['bug-01', 'type-01', 'reg-01', 'ref-01', 'log-01'])('controlled wrong candidate fails %s evaluator', async id => {
    const result = await evaluateTaskCandidate(id, getTaskContext(id).files);
    expect(result.success).toBe(false);
  }, 30_000);

  it.each([
    ['exits with status 0 while it is imported', '(globalThis as any).process.exit(0);\n'],
    ['forces status 0 from an exit handler', '(globalThis as any).process.on("exit",()=>{(globalThis as any).process.exitCode=0;});\n'],
  ])('does not accept a wrong candidate that %s', async (_case, prefix) => {
    const result = await evaluateTaskCandidate('bug-01', { 'solution.ts': prefix + getTaskContext('bug-01').files['solution.ts']! });
    expect(result).toMatchObject({ success: false, typecheckPassed: true, evaluatorPassed: false });
    expect(result.error).toContain('before completing all assertions');
  }, 30_000);

  it.each([
    ['ref-01', 'the required calls appear only in a comment', 'export function normalizeName(v:string):string{return v.trim().toLowerCase();}\n// solve uses normalizeName(first) and normalizeName(second)\nexport function solve(first:string,second:string):string{return first.trim().toLowerCase()+":"+second.trim().toLowerCase();}'],
    ['ref-04', 'the helper use appears only in a comment', 'export function isValid(v:string):boolean{return v.trim().length>0;}\n// values.filter(isValid)\nexport function solve(values:string[]):string[]{return values.filter(v=>v.trim().length>0);}'],
    ['ref-06', 'the join appears only in a string', 'export function solve(parts:string[]):string{const note=".join(";let r="";for(const p of parts)if(p)r+=(r?"/":"")+p;return note?r:r;}'],
    ['ref-03', 'recursion uses a renamed parameter', 'export function solve(n:number):number{return n<=1?1:n*solve(n-1);}'],
    ['ref-03', 'recursion moves into a helper', 'function factorial(n:number):number{return n<=1?1:n*factorial(n-1);}\nexport function solve(value:number):number{return factorial(value);}'],
    ['ref-03', 'a named function expression recurses', 'export const solve=function step(n:number):number{return n<=1?1:n*step(n-1);};'],
  ])('%s refactor constraint fails when %s', async (id, _case, source) => {
    const result = await evaluateTaskCandidate(id, { 'solution.ts': source });
    expect(result).toMatchObject({ success: false, typecheckPassed: true, evaluatorPassed: false });
    expect(result.error).toContain('Task-specific refactor constraint failed');
  }, 30_000);

  it.each([
    ['ref-05', '// JSON.parse(JSON.stringify(user)) was the old approach\ntype User={name:string;nickname?:string|undefined;profile:{active:boolean}};\nexport function solve(user:User):User{const note="not JSON.stringify";return note?{...user,profile:{...user.profile}}:user;}'],
    ['ref-03', '// previously: return value * solve(value - 1)\nexport function solve(value:number):number{let r=1;for(let i=2;i<=value;i++)r*=i;return r;}'],
    ['ref-01', 'export function normalizeName(v:string):string{return v.trim().toLowerCase();}\nexport function solve(a:string,b:string):string{return normalizeName(a)+":"+normalizeName(b);}'],
  ])('%s constraint judges code, not comments, strings or parameter names', async (id, source) => {
    expect(await evaluateTaskCandidate(id, { 'solution.ts': source })).toMatchObject({ success: true, error: null });
  }, 30_000);

  it.each([
    ['reg-01', 'checks only the upper bound', 'export function regression(c:(v:number,min:number,max:number)=>number):boolean{return c(11,0,10)===10;}'],
    ['reg-02', 'never checks a zero discount', 'export function regression(c:(p:number,d:number)=>number):boolean{return c(100,25)===75;}'],
    ['reg-03', 'never checks an ordinary non-leap year', 'export function regression(c:(y:number)=>boolean):boolean{return !c(1900)&&c(2000)&&c(2024);}'],
    ['reg-04', 'checks the mean only on a single value', 'export function regression(c:(v:number[])=>number|null):boolean{return c([])===null&&c([4])===4;}'],
    ['reg-05', 'checks only already-sorted input', 'export function regression(c:(v:number[])=>number[]):boolean{const v=[1,2,10];const r=c(v);return JSON.stringify(r)==="[1,2,10]"&&r!==v;}'],
    ['reg-06', 'never checks case differences', 'export function regression(c:(a:string,b:string)=>boolean):boolean{return c(" a ","a")&&!c("a","b");}'],
  ])('%s rejects a regression test that %s', async (id, _case, source) => {
    const result = await evaluateTaskCandidate(id, { 'solution.ts': source });
    expect(result).toMatchObject({ success: false, typecheckPassed: true, evaluatorPassed: false });
  }, 30_000);
});

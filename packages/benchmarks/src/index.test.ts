import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { aggregateTaskResults, capturedReplayCases, createTaskBenchmarkPlan, evaluateTaskCandidate, getTaskContext, pilotTasks, replayBenchmark, replayCases, runTaskBenchmark, type TaskRunResult } from './index.js';
import { referenceSolutions } from './solutions.fixture.js';

describe('free replay and task harness', () => {
  it('replays every reducer family with preserved evidence and explicit measurement limits', () => {
    const report = replayBenchmark();
    expect(report.rows).toHaveLength(10);
    expect(report.preservationPassed).toBe(true);
    expect(report.originalBytes).toBeGreaterThan(report.reducedBytes);
    expect(report.taskSavingsConclusion).toBe('not_measured');
    expect(report.rows.every(row => row.reducedEnvelopeBytes >= row.reducedBytes)).toBe(true);
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
    expect(combined.byteReductionFraction).toBeNull();
    expect(combined.corpora.every(item => item.byteReductionFraction !== null)).toBe(true);
    expect(combined.limitations[0]).toContain('no blended');
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
    expect(report.aggregate.realModelRuns).toBe(0);
    expect(report.aggregate.localContractRuns).toBe(3);
  }, 45_000);

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
});

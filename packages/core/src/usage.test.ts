import { describe, expect, it } from 'vitest';
import { importUsageIntoStore, LEGACY_CODEX_SCOPE, observedUsageTotal, parseUsageImport, summarizeUsageCoverage, type UsageImportOptions } from './usage.js';
import type { UsageEvent } from './store.js';

const options: UsageImportOptions = { format: 'claude-otel', repositoryId: 'repo-a', clientVersion: '2.1.216', observedAt: '2026-09-29T12:00:00.000Z' };
const attrs = (data: Record<string, string | number>) => Object.entries(data).map(([key, value]) => ({ key, value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value } }));
function logs(data: Record<string, string | number> = {}) {
  return JSON.stringify({ resourceLogs: [{ scopeLogs: [{ logRecords: [{ body: { stringValue: 'claude_code.api_request' }, attributes: attrs({ 'event.name': 'api_request', 'event.timestamp': '2026-09-29T11:00:00Z', 'session.id': 'external-session', request_id: 'req-1', model: 'claude-test', input_tokens: 10, cache_read_tokens: 80, cache_creation_tokens: 20, output_tokens: 5, ...data }) }] }] }] });
}
function metrics(temporality: number, samples = [100, 150]) {
  return JSON.stringify({ resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: 'claude_code.token.usage', sum: { aggregationTemporality: temporality, dataPoints: samples.map((n, i) => ({ attributes: attrs({ type: 'input' }), startTimeUnixNano: '1700000000000000000', timeUnixNano: String(1700000010000000000n + BigInt(i) * 1000000000n), asInt: String(n) })) } }] }] }] });
}
const codexOptions: UsageImportOptions = { ...options, format: 'codex-jsonl', clientVersion: '0.139.0', importId: 'capture-a' };
const codexText = [JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }), JSON.stringify({ type: 'item.completed', item: { text: 'api_key=secret-that-must-not-be-copied' } }), JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 10 } })].join('\n');

describe('versioned explicit usage imports', () => {
  it('imports official Claude request counts with disjoint cached input', () => {
    const event = parseUsageImport(logs(), options).events[0]!;
    expect(event).toMatchObject({ source: 'client_reported', input: 10, cachedInput: 80, cacheWrite: 20, output: 5, total: 115, counter: 'delta', reasoning: null, taskId: null, sessionId: null, timestampSource: 'client' });
    expect(event.externalSessionHash).not.toBe('external-session');
  });
  it('does not invent missing values, model, or task attribution', () => {
    const value = JSON.parse(logs()); const list = value.resourceLogs[0].scopeLogs[0].logRecords[0].attributes as { key: string }[];
    value.resourceLogs[0].scopeLogs[0].logRecords[0].attributes = list.filter(item => !['cache_read_tokens', 'model'].includes(item.key));
    expect(parseUsageImport(JSON.stringify(value), options).events[0]).toMatchObject({ cachedInput: null, model: null, total: null, taskId: null });
  });
  it('does not copy OTel user emails, prompts or tool contents into usage', () => {
    const output = JSON.stringify(parseUsageImport(logs({ 'user.email': 'private@example.com', prompt: 'private code', 'tool_input': 'api_key=very-secret', model: 'sk-abcdefghijklmnopqrst' }), options));
    expect(output).not.toContain('private@example.com'); expect(output).not.toContain('private code'); expect(output).not.toContain('very-secret'); expect(output).not.toContain('sk-abcdefghijklmnopqrst');
  });
  it('uses explicit local attribution and repository-isolates event identities', () => {
    const first = parseUsageImport(logs(), { ...options, sessionId: 'local', taskId: 'task' }).events[0]!;
    const second = parseUsageImport(logs(), { ...options, repositoryId: 'repo-b' }).events[0]!;
    expect(first.sessionId).toBe('local'); expect(first.taskId).toBe('task'); expect(first.eventId).not.toBe(second.eventId);
  });
  it('preserves cumulative samples instead of adding 100+150', () => {
    const result = parseUsageImport(metrics(2), options);
    expect(result.events.map(e => e.input)).toEqual([100, 150]); expect(result.events.every(e => e.counter === 'cumulative' && e.total === null)).toBe(true);
    expect(result.warnings.join(' ')).toContain('not summed');
  });
  it('does not add metric dimensions to request totals', () => {
    const combined = JSON.stringify({ ...JSON.parse(logs()), ...JSON.parse(metrics(1)) });
    const result = parseUsageImport(combined, options);
    expect(result.events.filter(e => e.scope === 'claude-otel-token-metric').every(e => e.total === null)).toBe(true);
    expect(result.events.filter(e => e.scope === 'claude-otel-api-request')[0]!.total).toBe(115);
  });
  it('rejects metric temporality omissions', () => { expect(() => parseUsageImport(metrics(0), options)).toThrow('aggregationTemporality'); });
  it('imports Codex turn usage without counting cache or reasoning twice', () => {
    const result = parseUsageImport(codexText, codexOptions); const event = result.events[0]!;
    expect(event).toMatchObject({ input: 100, cachedInput: 80, output: 20, reasoning: 10, total: 120, model: null, cacheWrite: null, timestampSource: 'import-observation', counter: 'cumulative', scope: 'codex-exec-thread-total', importerVersion: '1.2.0' });
    expect(event.series).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('secret-that-must-not-be-copied'); expect(JSON.stringify(result)).not.toContain('thread-1');
  });
  it('requires stable capture identity for Codex and does not accept unknown versions', () => {
    expect(() => parseUsageImport(codexText, { ...codexOptions, importId: undefined })).toThrow('importId');
    expect(() => parseUsageImport(logs(), { ...options, clientVersion: 'future' })).toThrow('Unsupported Claude');
    expect(() => parseUsageImport(codexText, { ...codexOptions, clientVersion: 'future' })).toThrow('Unsupported Codex');
  });
  it('deduplicates repeated imports even when observedAt changes', () => {
    const saved = new Map<string, UsageEvent>();
    const store = { repositoryId: 'repo-a', usage: () => [...saved.values()], addUsage(event: UsageEvent) { if (saved.has(event.correlationId)) return false; saved.set(event.correlationId, event); return true; } };
    expect(importUsageIntoStore(store, codexText, codexOptions).added).toBe(1);
    expect(importUsageIntoStore(store, codexText, { ...codexOptions, observedAt: '2026-09-30T12:00:00Z' }).duplicates).toBe(1);
    expect(saved.size).toBe(1);
  });
  it('rejects conflicting duplicates instead of silently corrupting totals', () => {
    const first = parseUsageImport(logs(), options).events[0]!;
    const store = { repositoryId: 'repo-a', usage: () => [first], addUsage: () => { throw new Error('must not write'); } };
    expect(() => importUsageIntoStore(store, logs({ input_tokens: 999 }), options)).toThrow('Conflicting stored');
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid counts %s', (input_tokens) => { expect(() => parseUsageImport(logs({ input_tokens }), options)).toThrow('safe integers'); });
  it('rejects oversized inputs, malformed JSON and impossible subset counts', () => {
    expect(() => parseUsageImport(logs(), { ...options, maxBytes: 1 })).toThrow('byte limit');
    expect(() => parseUsageImport('{ api_key=secret', options)).toThrow('content omitted');
    expect(() => parseUsageImport(codexText.replace('"cached_input_tokens":80', '"cached_input_tokens":180'), codexOptions)).toThrow('Cached input');
  });
  it('separates a subsystem from a reported agent type and never invents agent identity', () => {
    const main = parseUsageImport(logs({ query_source: 'repl_main_thread' }), options).events[0]!;
    expect(main.agent).toBeNull(); expect(main.attribution).toMatchObject({ category: 'main', agentIdentity: null, basis: 'reported-main-thread' });
    const subsystem = parseUsageImport(logs({ query_source: 'compact' }), options).events[0]!;
    expect(subsystem.agent).toBeNull(); expect(subsystem.attribution.category).toBe('unknown');
    const subagent = parseUsageImport(logs({ 'agent.name': 'custom', query_source: 'agent' }), options).events[0]!;
    expect(subagent.attribution).toEqual({ querySource: 'agent', agentType: 'custom', agentIdentity: null, category: 'subagent', basis: 'reported-agent-type' });
  });
  it('retains bounded metric interval metadata without changing legacy correlation IDs', () => {
    const text = metrics(2); const first = parseUsageImport(text, options).events[0]!;
    expect(first.metric).toMatchObject({ dimension: 'input', startTimeUnixNano: '1700000000000000000', timeUnixNano: '1700000010000000000', value: 100 });
    expect(first.metric!.seriesId).toHaveLength(64);
    expect(() => parseUsageImport(text.replace('1700000000000000000', '999999999999999999999999999999999999'), options)).toThrow('timestamp');
    expect(() => parseUsageImport(text.replace('1700000000000000000', '1800000000000000000'), options)).toThrow('start time');
  });
  it('rejects a repeated import with a conflicting local session association', () => {
    const previous = parseUsageImport(logs(), { ...options, sessionId: 'original' }).events;
    const store = { repositoryId: options.repositoryId, usage: () => previous, addUsage: () => { throw new Error('must validate before writing'); } };
    expect(() => importUsageIntoStore(store, logs(), { ...options, sessionId: 'different' })).toThrow('Conflicting stored usage');
  });
  it('ignores unverified Codex attribution lookalikes', () => {
    const input = JSON.stringify({ type: 'turn.completed', agent_id: 'private-agent', 'agent.name': 'invented', query_source: 'subagent', usage: { input_tokens: 1, output_tokens: 1 } });
    const event = parseUsageImport(input, codexOptions).events[0]!;
    expect(event.attribution).toMatchObject({ category: 'unknown', agentType: null, agentIdentity: null });
    expect(JSON.stringify(event)).not.toContain('private-agent'); expect(JSON.stringify(event)).not.toContain('invented');
  });
});

describe('bounded usage coverage', () => {
  it('reports missing fields and unobserved coverage as unknown even for complete recorded totals', () => {
    const events = parseUsageImport(codexText, codexOptions).events;
    const report = summarizeUsageCoverage(events);
    expect(report).toMatchObject({ analyzedRecords: 1, unobservedCalls: null, coverageRatio: null, subagentIdentityCoverage: null, cost: null, subscriptionQuota: null });
    expect(report.missing).toMatchObject({ model: 1, cacheWrite: 1, clientTimestamp: 1, localSession: 1, localTask: 1, agentIdentity: 1 });
    // A Codex turn is a thread running total, never an eligible delta.
    expect(report.groups[0]).toMatchObject({ recordedDeltaTokens: null, eligibleDeltaRecords: 0, cumulativeRecords: 1, runningTotals: { seriesCount: 1, attributedRecords: 1, unattributableRecords: 0, recordedTokens: 120 } });
    expect(report.attributionRecords).toEqual({ main: 0, subagent: 0, auxiliary: 0, unknown: 1 });
  });
  it('reports known subagent categories but does not fabricate unique agent coverage', () => {
    const events = [parseUsageImport(logs({ 'agent.name': 'custom' }), options).events[0]!, parseUsageImport(logs({ request_id: 'req-2', query_source: 'repl_main_thread' }), options).events[0]!];
    const report = summarizeUsageCoverage(events);
    expect(report.attributionRecords).toEqual({ main: 1, subagent: 1, auxiliary: 0, unknown: 0 });
    expect(report.missing.agentIdentity).toBe(2); expect(report.subagentIdentityCoverage).toBeNull();
  });
  it('keeps cumulative snapshots separate from delta request totals and detects a reset or decrease', () => {
    const events = [...parseUsageImport(metrics(2, [100, 150, 20]), options).events, ...parseUsageImport(logs(), options).events];
    const report = summarizeUsageCoverage(events);
    expect(report.counters).toMatchObject({ cumulativeRecords: 3, reportedDeltaRecords: 1 });
    expect(report.groups.find(group => group.scope === 'claude-otel-api-request')?.recordedDeltaTokens).toBe(115);
    expect(report.groups.find(group => group.scope === 'claude-otel-token-metric')?.recordedDeltaTokens).toBeNull();
    expect(report.metricSeries).toHaveLength(1);
    expect(report.metricSeries[0]).toMatchObject({ samples: 3, lastValue: 20, resetsOrDecreases: 1, total: null });
  });
  it('reports absent cumulative start times without deriving interval consumption', () => {
    const value = JSON.parse(metrics(2));
    for (const point of value.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints) delete point.startTimeUnixNano;
    const report = summarizeUsageCoverage(parseUsageImport(JSON.stringify(value), options).events);
    expect(report.metricSeries[0]).toMatchObject({ missingStartTimeRecords: 2, total: null });
  });
  it('bounds event and group work and makes truncation visible without partial totals', () => {
    const events = [0, 1, 2].map(index => ({ ...parseUsageImport(logs({ request_id: `req-${index}` }), options).events[0]!, scope: `scope-${index}` }));
    const report = summarizeUsageCoverage(events, { maxEvents: 2, maxGroups: 1 });
    expect(report).toMatchObject({ scannedRecords: 2, analyzedRecords: 2, omittedRecords: 1, omittedGroupRecords: 1, truncated: true });
    expect(report.groups).toHaveLength(1); expect(report.groups[0]!.recordedDeltaTokens).toBeNull();
    expect(() => summarizeUsageCoverage(events, { maxEvents: 50_001 })).toThrow('limit');
  });
  it('deduplicates identical records and excludes conflicting correlations', () => {
    const event = parseUsageImport(logs(), options).events[0]!;
    expect(summarizeUsageCoverage([event, event])).toMatchObject({ analyzedRecords: 1, duplicateRecords: 1 });
    const report = summarizeUsageCoverage([event, { ...event, total: 200 }]);
    expect(report).toMatchObject({ analyzedRecords: 0, conflictingCorrelations: 1 }); expect(report.groups).toHaveLength(0);
  });
  it('does not infer legacy agent attribution or sum estimated counts into measured groups', () => {
    const event: UsageEvent = { ...parseUsageImport(logs(), options).events[0]!, agent: 'repl_main_thread' };
    delete (event as Partial<ReturnType<typeof parseUsageImport>['events'][number]>).attribution;
    const report = summarizeUsageCoverage([{ ...event, source: 'locally_estimated' }]);
    expect(report.attributionRecords.unknown).toBe(1); expect(report.counters.locallyEstimatedRecords).toBe(1); expect(report.groups[0]!.recordedDeltaTokens).toBeNull();
    expect(() => summarizeUsageCoverage([event, { ...event, repositoryId: 'other' }])).toThrow('repository scoped');
  });
  it('keeps distinct measurement sources separate and redacts scope labels', () => {
    const event = parseUsageImport(logs(), options).events[0]!;
    const report = summarizeUsageCoverage([event, { ...event, eventId: 'provider', correlationId: 'provider', source: 'provider_reported', scope: 'password=private-value' }]);
    expect(report.groups).toHaveLength(2); expect(report.groups.map(group => group.recordedDeltaTokens)).toEqual([115, 115]);
    expect(JSON.stringify(report)).not.toContain('private-value'); expect(report).not.toHaveProperty('total');
  });
  it('reports integer overflow without calling present counts missing', () => {
    const event = parseUsageImport(logs(), options).events[0]!;
    const report = summarizeUsageCoverage([{ ...event, total: Number.MAX_SAFE_INTEGER }, { ...event, eventId: 'second', correlationId: 'second', total: 1 }]);
    expect(report.groups[0]).toMatchObject({ totalOverflow: true, recordedDeltaTokens: null, missingTotalRecords: 0 });
  });
});

const turn = (input: number, cached: number, output: number, reasoning: number) => JSON.stringify({ type: 'turn.completed', usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning } });
const thread = (id: string) => JSON.stringify({ type: 'thread.started', thread_id: id });
function memoryStore() {
  const saved = new Map<string, UsageEvent>();
  return { saved, repositoryId: 'repo-a', usage: () => [...saved.values()], addUsage(event: UsageEvent) { if (saved.has(event.correlationId)) return false; saved.set(event.correlationId, event); return true; } };
}

describe('Codex running totals', () => {
  const threadId = '019a0000-0000-7000-8000-000000000001';
  // `codex exec` then `codex exec resume`: the resumed thread's totals continue from the first run (1100 -> 2600).
  const run1 = [thread(threadId), '{"type":"turn.started"}', turn(1000, 200, 100, 40)].join('\n');
  const run2 = [thread(threadId), '{"type":"turn.started"}', turn(2400, 900, 200, 80)].join('\n');

  it('uses the largest running total per thread instead of summing turns or re-imports', () => {
    const store = memoryStore();
    importUsageIntoStore(store, run1, { ...codexOptions, importId: 'run-1' }); importUsageIntoStore(store, run2, { ...codexOptions, importId: 'run-2' });
    expect(observedUsageTotal(store.usage())).toBe(2600);
    const copy = importUsageIntoStore(store, run1, { ...codexOptions, importId: 'run-1-copy', observedAt: '2026-09-30T12:00:00Z' });
    expect(copy).toMatchObject({ added: 0, duplicates: 1 });
    expect(store.saved.size).toBe(2); expect(observedUsageTotal(store.usage())).toBe(2600);
    const events = store.usage();
    expect(new Set(events.map(event => event.series)).size).toBe(1); expect(events.every(event => event.counter === 'cumulative')).toBe(true);
    expect(JSON.stringify(events)).not.toContain(threadId);
    expect(summarizeUsageCoverage(events).groups[0]!.runningTotals).toMatchObject({ seriesCount: 1, attributedRecords: 2, recordedTokens: 2600 });
  });

  it('counts a repeated observation once and adds separate threads', () => {
    const line = turn(1000, 200, 100, 40);
    const repeated = parseUsageImport([thread('t-1'), line, line].join('\n'), codexOptions);
    expect(repeated.events).toHaveLength(1); expect(observedUsageTotal(repeated.events)).toBe(1100);
    const two = parseUsageImport([thread('a'), turn(100, 0, 0, 0), turn(250, 0, 50, 0), thread('b'), turn(40, 0, 10, 0)].join('\n'), codexOptions);
    expect(two.events).toHaveLength(3); expect(observedUsageTotal(two.events)).toBe(300 + 50);
  });

  it('treats all-zero Codex usage as unknown rather than a measured zero', () => {
    const result = parseUsageImport([thread('t-1'), turn(0, 0, 0, 0)].join('\n'), codexOptions);
    expect(result.events[0]).toMatchObject({ input: null, cachedInput: null, output: null, reasoning: null, total: null, counter: 'cumulative' });
    expect(result.warnings.join(' ')).toContain('all-zero usage');
    const known = parseUsageImport([thread('t-2'), turn(10, 0, 5, 0)].join('\n'), codexOptions).events;
    expect(observedUsageTotal(known)).toBe(15); expect(observedUsageTotal([...known, ...result.events])).toBeNull();
    const report = summarizeUsageCoverage([...known, ...result.events]);
    expect(report.missing.total).toBe(1); expect(report.groups[0]!.runningTotals).toMatchObject({ seriesCount: 2, missingTotalRecords: 1, recordedTokens: null });
  });

  it('reports a restarted Codex running total as unknown instead of an understated maximum', () => {
    // Codex replaces per-field totals when it reports the context window full; a later, smaller sample proves it.
    const within = parseUsageImport([thread('t-1'), turn(1000, 200, 100, 40), turn(300, 0, 50, 0)].join('\n'), codexOptions);
    expect(within.events.map(event => event.total)).toEqual([1100, null]); expect(within.events[1]).toMatchObject({ input: 300, output: 50 });
    expect(within.warnings.join(' ')).toContain('decreased within this capture'); expect(observedUsageTotal(within.events)).toBeNull();
    const store = memoryStore(); importUsageIntoStore(store, [thread('t-1'), turn(1000, 200, 100, 40), turn(300, 0, 50, 0)].join('\n'), codexOptions);
    expect(importUsageIntoStore(store, [thread('t-1'), turn(300, 0, 50, 0)].join('\n'), { ...codexOptions, importId: 'later' }).added).toBe(1);
    expect(observedUsageTotal(store.usage())).toBeNull();
    // Separate captures whose samples cross in some field reveal the same restart.
    const crossing = [...parseUsageImport([thread('t-2'), turn(1000, 200, 100, 40)].join('\n'), codexOptions).events, ...parseUsageImport([thread('t-2'), turn(300, 0, 500, 0)].join('\n'), { ...codexOptions, importId: 'b' }).events];
    expect(observedUsageTotal(crossing)).toBeNull();
    expect(summarizeUsageCoverage(crossing).groups[0]!.runningTotals).toMatchObject({ seriesCount: 1, restartedSeries: 1, missingTotalRecords: 0, recordedTokens: null });
  });

  it('keeps turns without a thread unattributable and out of totals', () => {
    const result = parseUsageImport(turn(10, 0, 5, 0), codexOptions);
    expect(result.events[0]).toMatchObject({ series: null, total: 15, counter: 'cumulative' });
    expect(result.warnings.join(' ')).toContain('no preceding thread.started');
    expect(observedUsageTotal(result.events)).toBeNull();
    const report = summarizeUsageCoverage(result.events);
    expect(report.counters).toMatchObject({ cumulativeRecords: 1, unattributableCumulativeRecords: 1, reportedDeltaRecords: 0 });
    expect(report.groups[0]!.runningTotals).toMatchObject({ unattributableRecords: 1, attributedRecords: 0, recordedTokens: null });
    expect(parseUsageImport(turn(10, 0, 5, 0), codexOptions).events[0]!.correlationId).toBe(result.events[0]!.correlationId);
  });

  it('excludes legacy Codex delta records and re-imports the capture without conflict', () => {
    const current = parseUsageImport(run1, { ...codexOptions, importId: 'run-1' }).events[0]!;
    const legacy: UsageEvent = { ...current, scope: LEGACY_CODEX_SCOPE, counter: 'delta', series: undefined, eventId: 'legacy', correlationId: 'codex-turn:legacy:0' };
    const store = memoryStore(); store.addUsage(legacy);
    expect(observedUsageTotal(store.usage())).toBeNull();
    expect(summarizeUsageCoverage(store.usage()).counters).toMatchObject({ legacyRunningTotalRecords: 1, reportedDeltaRecords: 0 });
    expect(importUsageIntoStore(store, run1, { ...codexOptions, importId: 'run-1' }).added).toBe(1);
    expect(observedUsageTotal(store.usage())).toBe(1100);
  });
});

describe('observed usage total', () => {
  const request = parseUsageImport(logs(), options).events[0]!;
  const delta = (id: string, extra: Partial<UsageEvent> = {}): UsageEvent => ({ ...request, eventId: id, correlationId: id, ...extra });
  const running = (id: string, series: string | null, total: number | null): UsageEvent => delta(id, { counter: 'cumulative', series, total, scope: 'codex-exec-thread-total' });

  it('adds reported deltas to the largest total of each cumulative series', () => {
    expect(observedUsageTotal([])).toBeNull();
    expect(observedUsageTotal([delta('a'), delta('b', { total: 20 })])).toBe(135);
    expect(observedUsageTotal([delta('a'), running('r1', 's1', 100), running('r2', 's1', 300), running('r3', 's2', 7)])).toBe(115 + 300 + 7);
    expect(observedUsageTotal([delta('a'), running('r1', null, 1_000)])).toBe(115);
    expect(observedUsageTotal([running('r1', null, 1_000)])).toBeNull();
  });

  it('excludes estimates, unknown sources, metric dimensions and legacy Codex records', () => {
    const excluded = [
      delta('estimate', { source: 'locally_estimated', total: 50 }), delta('unknown', { source: 'future' as UsageEvent['source'], total: 60 }),
      delta('metric', { scope: 'claude-otel-token-metric', total: 70 }), delta('legacy', { scope: LEGACY_CODEX_SCOPE, total: 80 }),
      delta('odd-counter', { counter: 'gauge' as UsageEvent['counter'], total: 90 }),
    ];
    expect(observedUsageTotal([delta('a'), ...excluded])).toBe(115); expect(observedUsageTotal(excluded)).toBeNull();
  });

  it.each([null, -1, 1.5, Number.MAX_SAFE_INTEGER + 2])('returns null for a qualifying total of %s', (total) => {
    expect(observedUsageTotal([delta('a'), delta('b', { total })])).toBeNull();
    expect(observedUsageTotal([delta('a'), running('r', 's', total)])).toBeNull();
  });

  it('returns null on overflow or conflicting duplicates and counts identical duplicates once', () => {
    expect(observedUsageTotal([delta('a', { total: Number.MAX_SAFE_INTEGER }), delta('b', { total: 1 })])).toBeNull();
    expect(observedUsageTotal([running('r1', 's1', Number.MAX_SAFE_INTEGER), running('r2', 's2', 1)])).toBeNull();
    expect(observedUsageTotal([delta('a'), delta('a')])).toBe(115);
    expect(observedUsageTotal([delta('a'), delta('a', { total: 116 })])).toBeNull();
  });
});

describe('OTLP JSON Lines captures', () => {
  const batch = (id: string, timestamp: string) => JSON.stringify({ resourceLogs: [{ resource: { attributes: attrs({ 'service.name': 'claude-code', 'session.id': 's-1' }) }, scopeLogs: [{ scope: { name: 'com.anthropic.claude_code.events' }, logRecords: [{ timeUnixNano: '1790000000000000000', body: { stringValue: 'claude_code.api_request' }, attributes: attrs({ 'event.name': 'api_request', 'event.timestamp': timestamp, request_id: id, model: 'claude-test', input_tokens: '12', output_tokens: '340', cache_read_tokens: '5000', cache_creation_tokens: '0' }) }] }] }] });

  it('merges one export batch per line, as written by OTel file exporters', () => {
    const text = `\uFEFF${batch('req-a', '2026-09-30T10:00:00Z')}\r\n\r\n${batch('req-b', '2026-09-30T10:00:05Z')}\r\n${metrics(2)}\n${batch('req-a', '2026-09-30T10:00:00Z')}\n`;
    const result = parseUsageImport(text, options);
    expect(result.events.filter(event => event.scope === 'claude-otel-api-request').map(event => event.total)).toEqual([5352, 5352]);
    expect(result.events.filter(event => event.scope === 'claude-otel-token-metric')).toHaveLength(2);
    expect(result.warnings.filter(warning => warning.startsWith('Metric dimensions'))).toHaveLength(1);
    expect(parseUsageImport(JSON.stringify(JSON.parse(logs()), null, 2), options).events).toHaveLength(1);
  });

  it('keeps errors content-free and applies the byte limit to the whole capture', () => {
    const secret = 'api_key=sk-live-secret-value';
    const second = parseUsageImport.bind(null, `${batch('req-a', '2026-09-30T10:00:00Z')}\n{"broken": "${secret}"\n`, options);
    expect(second).toThrow('Usage import line 2 is not valid JSON; input content omitted from error');
    try { second(); } catch (error) { expect((error as Error).message).not.toContain('secret'); }
    expect(() => parseUsageImport(`{"broken": "${secret}"\n${batch('req-a', '2026-09-30T10:00:00Z')}`, options)).toThrow('not valid JSON or JSON Lines; input content omitted from error');
    expect(() => parseUsageImport(`${batch('req-a', '2026-09-30T10:00:00Z')}\n{"resourceSpans":[]}`, options)).toThrow('Expected OTLP JSON');
    const text = `${batch('req-a', '2026-09-30T10:00:00Z')}\n${batch('req-b', '2026-09-30T10:00:00Z')}`;
    expect(() => parseUsageImport(text, { ...options, maxBytes: Buffer.byteLength(text) - 1 })).toThrow('byte limit');
  });
});

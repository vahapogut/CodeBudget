import type { UsageEvent } from './store.js';
import { hash, redact } from './security.js';

export type UsageImportFormat = 'claude-otel' | 'codex-jsonl';
export interface UsageImportOptions {
  format: UsageImportFormat;
  repositoryId: string;
  clientVersion: string;
  observedAt: string;
  /** Explicit local session/task mapping; external session IDs are not local IDs. */
  sessionId?: string;
  taskId?: string;
  /** Stable capture identity; reuse on re-import, including renamed/partially copied files. */
  importId?: string;
  maxBytes?: number;
}
export interface ImportedUsageEvent extends UsageEvent {
  importerVersion: '1.2.0';
  clientVersion: string;
  externalSessionHash: string | null;
  timestampSource: 'client' | 'import-observation';
  coverage: string;
  tokenRelationship: 'claude-disjoint-input-cache' | 'codex-cache-subset-of-input' | 'single-metric-dimension';
  attribution: UsageAttribution;
  metric: UsageMetric | null;
}
export interface UsageAttribution {
  querySource: string | null;
  agentType: string | null;
  /** A type or subsystem is not a unique agent identity. These export contracts do not supply one. */
  agentIdentity: null;
  category: 'main' | 'subagent' | 'auxiliary' | 'unknown';
  basis: 'reported-category' | 'reported-agent-type' | 'reported-main-thread' | 'unknown';
}
export interface UsageMetric {
  seriesId: string;
  dimension: 'input' | 'output' | 'cacheRead' | 'cacheCreation';
  startTimeUnixNano: string | null;
  timeUnixNano: string;
  value: number | null;
}
export interface UsageImportResult { schemaVersion: 1; events: ImportedUsageEvent[]; warnings: string[]; ignored: number }
type Obj = Record<string, unknown>;
/** Codex 0.139.0 `turn.completed.usage` is the thread's running total, imported as cumulative per hashed thread. */
const CODEX_SCOPE = 'codex-exec-thread-total';
/** Importer 1.1.0 stored the same running totals as per-turn deltas; such records are never summed. */
export const LEGACY_CODEX_SCOPE = 'codex-exec-turn';
const METRIC_SCOPE = 'claude-otel-token-metric';
const record = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
function count(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Usage token values must be nonnegative safe integers or null');
  return value;
}
const textValue = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? redact(value.slice(0, 300)) : null;
function attribution(attrs: Obj = {}): UsageAttribution {
  const querySource = textValue(attrs.query_source); const agentType = textValue(attrs['agent.name']);
  const category = ['main', 'subagent', 'auxiliary'].includes(querySource ?? '') ? querySource as 'main' | 'subagent' | 'auxiliary' : null;
  return { querySource, agentType, agentIdentity: null,
    category: category ?? (agentType ? 'subagent' : querySource === 'repl_main_thread' ? 'main' : 'unknown'),
    basis: category ? 'reported-category' : agentType ? 'reported-agent-type' : querySource === 'repl_main_thread' ? 'reported-main-thread' : 'unknown' };
}
const orderedAttributes = (value: Obj) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
function nanoseconds(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{1,25}$/.test(value) || BigInt(value) > 8_640_000_000_000_000_000_000n) throw new Error('Invalid OTLP nanosecond timestamp');
  return BigInt(value).toString();
}
function attributes(value: unknown): Obj {
  const output: Obj = Object.create(null) as Obj;
  if (!Array.isArray(value)) return output;
  for (const entry of value) {
    if (!record(entry) || typeof entry.key !== 'string' || !record(entry.value)) continue;
    output[entry.key] = entry.value.stringValue ?? entry.value.intValue ?? entry.value.doubleValue ?? entry.value.boolValue;
  }
  return output;
}
function parseJson(text: string, line?: number): unknown {
  try { return JSON.parse(text) as unknown; } catch { throw new Error(`Usage import ${line === undefined ? '' : `line ${line} `}is not valid JSON; input content omitted from error`); }
}
function base(options: UsageImportOptions, id: string, scope: string, externalSession: unknown): ImportedUsageEvent {
  return {
    schemaVersion: 1, eventId: hash(`${options.repositoryId}:${id}`), correlationId: id, timestamp: new Date(options.observedAt).toISOString(), repositoryId: options.repositoryId,
    sessionId: options.sessionId ?? null, taskId: options.taskId ?? null, source: 'client_reported', scope, model: null,
    input: null, cachedInput: null, cacheWrite: null, output: null, reasoning: null, total: null, counter: 'delta', agent: null, series: null,
    importerVersion: '1.2.0', clientVersion: options.clientVersion, externalSessionHash: typeof externalSession === 'string' ? hash(externalSession) : null,
    timestampSource: 'import-observation', coverage: 'Only the explicitly supplied export; missing events remain unobserved', tokenRelationship: 'single-metric-dimension',
    attribution: attribution(), metric: null,
  };
}
function stamp(event: ImportedUsageEvent, value: unknown): void {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) { event.timestamp = new Date(value).toISOString(); event.timestampSource = 'client'; }
}
function sumKnown(values: (number | null)[]): number | null {
  if (values.some(value => value === null)) return null;
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (!Number.isSafeInteger(total)) throw new Error('Usage total exceeds safe integer range');
  return total;
}
/**
 * Codex 0.139.0 exec JSONL fills `turn.completed.usage` from the thread's running `ThreadTokenUsage.total`
 * (carried over on resume), or emits all zeros when it received no token count. Each observation is a cumulative
 * sample of its hashed `thread.started` thread, identified by thread and counts, so re-imports and repeated lines
 * never add up; totals take the largest observation per thread.
 */
function codex(text: string, options: UsageImportOptions, result: UsageImportResult): void {
  if (options.clientVersion !== '0.139.0') throw new Error('Unsupported Codex usage export version; contract is 0.139.0');
  if (!options.importId?.trim()) throw new Error('Codex import requires a stable importId for this captured run');
  let thread: string | null = null; let turn = 0; let unknown = 0; let unattributed = 0; let decreased = 0;
  const latest = new Map<string, readonly (number | null)[]>();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const value = parseJson(line, index + 1);
    if (!record(value)) throw new Error('Every Codex JSONL line must be an object');
    if (value.type === 'thread.started') { thread = textValue(value.thread_id); result.ignored++; continue; }
    if (value.type !== 'turn.completed') { result.ignored++; continue; }
    if (!record(value.usage)) throw new Error('Codex turn.completed must contain usage');
    const counts = [count(value.usage.input_tokens), count(value.usage.cached_input_tokens), count(value.usage.output_tokens), count(value.usage.reasoning_output_tokens)] as const;
    const [input, cachedInput, output, reasoning] = counts;
    if (cachedInput !== null && input !== null && cachedInput > input) throw new Error('Cached input cannot exceed Codex input total');
    if (reasoning !== null && output !== null && reasoning > output) throw new Error('Reasoning cannot exceed Codex output total');
    // Usage::default(): zeros mean no token count was received, not a turn that consumed nothing.
    const reported = counts.filter(item => item !== null); const noUsage = reported.length > 0 && reported.every(item => item === 0);
    const values = noUsage ? [null, null, null, null] as const : counts;
    const series = thread === null ? null : hash(`codex-thread:${thread}`);
    // Codex replaces the per-field totals when it reports the context window full; a later, smaller sample of the
    // same thread in this capture proves such a restart, and usage before it is unobservable.
    const previous = series === null || noUsage ? undefined : latest.get(series);
    const restarted = previous?.some((item, position) => item !== null && values[position] !== null && values[position]! < item) ?? false;
    if (series !== null && !noUsage) latest.set(series, values);
    const id = series === null ? `codex-turn-total:${hash(options.importId)}:${turn}` : `codex-thread-total:${hash(JSON.stringify([series, ...values, ...(restarted ? ['restarted'] : [])]))}`;
    turn++;
    const event = base(options, id, CODEX_SCOPE, thread);
    [event.input, event.cachedInput, event.output, event.reasoning] = values;
    event.counter = 'cumulative'; event.series = series; event.total = restarted ? null : sumKnown([event.input, event.output]); event.tokenRelationship = 'codex-cache-subset-of-input';
    event.coverage = [
      'Codex thread running total at turn completion (cumulative per hashed thread); cache is included in input and reasoning in output. Model and event time are absent from the official event.',
      ...(noUsage ? ['Codex reported all-zero usage, which it emits when no token count was received; counts are unknown, not zero.'] : []),
      ...(series === null ? ['No thread.started line preceded this turn, so the thread is unknown and the observation is excluded from totals.'] : []),
      ...(restarted ? ['This running total is smaller than an earlier sample of the same thread in this capture, so Codex restarted its totals; the thread total is unknown.'] : []),
    ].join(' ');
    if (noUsage) unknown++; if (series === null) unattributed++; if (restarted) decreased++;
    result.events.push(event);
  }
  result.warnings.push('Codex turn.completed usage is the thread running total in 0.139.0; observations are stored as cumulative samples per hashed thread and totals use the largest observation per thread, never a sum of turns.');
  if (decreased) result.warnings.push(`${decreased} Codex running total(s) decreased within this capture; Codex restarts per-field totals when it reports the context window full, so those samples have an unknown total.`);
  result.warnings.push('Codex import timestamp is the supplied capture observation time, not an invented event time. Reuse importId when re-importing a capture; thread observations deduplicate by thread and counts regardless of importId.');
  if (unknown) result.warnings.push(`${unknown} Codex turn(s) reported all-zero usage; Codex emits zeros when it received no token count, so those counts are unknown.`);
  if (unattributed) result.warnings.push(`${unattributed} Codex turn(s) had no preceding thread.started line; they are unattributable and excluded from totals.`);
}
function claudeLogs(root: Obj, options: UsageImportOptions, result: UsageImportResult): void {
  if (!Array.isArray(root.resourceLogs)) return;
  for (const resource of root.resourceLogs) {
    if (!record(resource) || !Array.isArray(resource.scopeLogs)) continue;
    const resourceAttrs = attributes(record(resource.resource) ? resource.resource.attributes : null);
    for (const scope of resource.scopeLogs) {
      if (!record(scope) || !Array.isArray(scope.logRecords)) continue;
      for (const log of scope.logRecords) {
        if (!record(log)) continue;
        const attrs = { ...resourceAttrs, ...attributes(log.attributes) };
        const body = record(log.body) ? log.body.stringValue : null;
        if (attrs['event.name'] !== 'api_request' && body !== 'claude_code.api_request') { result.ignored++; continue; }
        const requestId = textValue(attrs.request_id) ?? textValue(attrs.client_request_id);
        if (!requestId) { result.warnings.push('Skipped Claude API request with no stable request ID; cross-import deduplication is unavailable.'); result.ignored++; continue; }
        const event = base(options, `claude-request:${hash(requestId)}`, 'claude-otel-api-request', attrs['session.id']);
        event.input = count(attrs.input_tokens); event.cachedInput = count(attrs.cache_read_tokens); event.cacheWrite = count(attrs.cache_creation_tokens); event.output = count(attrs.output_tokens);
        event.total = sumKnown([event.input, event.cachedInput, event.cacheWrite, event.output]);
        event.model = textValue(attrs.model); event.attribution = attribution(attrs); event.agent = event.attribution.agentType; event.tokenRelationship = 'claude-disjoint-input-cache';
        stamp(event, attrs['event.timestamp']); result.events.push(event);
      }
    }
  }
}
function claudeMetrics(root: Obj, options: UsageImportOptions, result: UsageImportResult): void {
  if (!Array.isArray(root.resourceMetrics)) return;
  for (const resource of root.resourceMetrics) {
    if (!record(resource) || !Array.isArray(resource.scopeMetrics)) continue;
    const resourceAttrs = attributes(record(resource.resource) ? resource.resource.attributes : null);
    for (const scope of resource.scopeMetrics) {
      if (!record(scope) || !Array.isArray(scope.metrics)) continue;
      for (const metric of scope.metrics) {
        if (!record(metric) || metric.name !== 'claude_code.token.usage' || !record(metric.sum) || !Array.isArray(metric.sum.dataPoints)) continue;
        const temporality = metric.sum.aggregationTemporality;
        if (temporality !== 1 && temporality !== 2) throw new Error('OTLP metric requires explicit numeric delta (1) or cumulative (2) aggregationTemporality');
        for (const point of metric.sum.dataPoints) {
          if (!record(point)) continue;
          const attrs = { ...resourceAttrs, ...attributes(point.attributes) };
          const type = attrs.type;
          if (!['input', 'output', 'cacheRead', 'cacheCreation'].includes(String(type))) { result.ignored++; continue; }
          const timeUnixNano = nanoseconds(point.timeUnixNano); const startTimeUnixNano = nanoseconds(point.startTimeUnixNano);
          if (timeUnixNano === null) throw new Error('OTLP point requires timeUnixNano string');
          if (startTimeUnixNano !== null && BigInt(startTimeUnixNano) > BigInt(timeUnixNano)) throw new Error('OTLP metric start time exceeds sample time');
          const seriesId = hash(JSON.stringify([options.repositoryId, orderedAttributes(resourceAttrs), orderedAttributes(attrs), temporality]));
          // Preserve the v1 correlation key so re-imports of existing captures stay idempotent.
          const identity = JSON.stringify([resourceAttrs, attrs, point.startTimeUnixNano ?? null, point.timeUnixNano, temporality]);
          const event = base(options, `claude-metric:${hash(identity)}`, METRIC_SCOPE, attrs['session.id']);
          event.counter = temporality === 2 ? 'cumulative' : 'delta';
          event.model = textValue(attrs.model); event.attribution = attribution(attrs); event.agent = event.attribution.agentType;
          const value = count(point.asInt ?? point.asDouble);
          event.metric = { seriesId, dimension: type as UsageMetric['dimension'], startTimeUnixNano, timeUnixNano, value };
          if (type === 'input') event.input = value;
          else if (type === 'output') event.output = value;
          else if (type === 'cacheRead') event.cachedInput = value;
          else event.cacheWrite = value;
          const millis = Number(BigInt(timeUnixNano) / 1_000_000n);
          if (Number.isFinite(millis) && millis < 8.64e15) stamp(event, new Date(millis).toISOString());
          event.total = null;
          event.coverage = 'Single metric dimension; do not add to API-request records or other cumulative samples. Unknown session/task linkage is not inferred.';
          result.events.push(event);
        }
      }
    }
  }
  if (result.events.some(event => event.scope === METRIC_SCOPE)) result.warnings.push('Metric dimensions are imported with total=null; cumulative samples are not summed and metric totals are not added to request-log totals.');
}
/** One OTLP JSON document, or JSON Lines as written by OTel file exporters and the Collector fileexporter (one batch per line). */
function otlpBatches(text: string): Obj[] {
  let batches: unknown[];
  try { batches = [JSON.parse(text) as unknown]; } catch {
    batches = [];
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try { batches.push(JSON.parse(line) as unknown); } catch { throw new Error(batches.length ? `Usage import line ${index + 1} is not valid JSON; input content omitted from error` : 'Usage import is not valid JSON or JSON Lines; input content omitted from error'); }
    }
  }
  if (!batches.length || batches.some(batch => !record(batch) || (!Array.isArray(batch.resourceLogs) && !Array.isArray(batch.resourceMetrics)))) throw new Error('Expected OTLP JSON resourceLogs or resourceMetrics');
  return batches as Obj[];
}

/** Parse explicit local exports. No network access, home discovery, prompt or transcript import. */
export function parseUsageImport(text: string, options: UsageImportOptions): UsageImportResult {
  if (Buffer.byteLength(text, 'utf8') > (options.maxBytes ?? 8 * 1024 * 1024)) throw new Error('Usage import exceeds input byte limit');
  if (!options.repositoryId || !Number.isFinite(Date.parse(options.observedAt))) throw new Error('Usage import requires repositoryId and valid observedAt');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const result: UsageImportResult = { schemaVersion: 1, events: [], warnings: [], ignored: 0 };
  if (options.format === 'codex-jsonl') codex(text, options, result);
  else if (options.format === 'claude-otel') {
    if (options.clientVersion !== '2.1.216') throw new Error('Unsupported Claude usage export version; contract is 2.1.216');
    for (const batch of otlpBatches(text)) { claudeLogs(batch, options, result); claudeMetrics(batch, options, result); }
  } else throw new Error('Unsupported usage import format');
  const unique = new Map<string, ImportedUsageEvent>();
  for (const event of result.events) {
    const previous = unique.get(event.correlationId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error('Conflicting duplicate usage event; import rejected');
    unique.set(event.correlationId, event);
  }
  result.events = [...unique.values()]; result.warnings = [...new Set(result.warnings)];
  return result;
}

export function importUsageIntoStore(store: { repositoryId: string; usage(): UsageEvent[]; addUsage(event: UsageEvent): boolean }, text: string, options: Omit<UsageImportOptions, 'repositoryId'>) {
  const parsed = parseUsageImport(text, { ...options, repositoryId: store.repositoryId });
  const known = new Map(store.usage().map(event => [event.correlationId, event]));
  const counts = ['input', 'cachedInput', 'cacheWrite', 'output', 'reasoning', 'total', 'counter', 'source', 'scope', 'sessionId', 'taskId'] as const;
  for (const event of parsed.events) {
    const previous = known.get(event.correlationId);
    if (previous && (counts.some(key => previous[key] !== event[key]) || (previous.series ?? null) !== (event.series ?? null))) throw new Error('Conflicting stored usage event; import rejected');
  }
  let added = 0; for (const event of parsed.events) if (store.addUsage(event)) added++;
  return { ...parsed, added, duplicates: parsed.events.length - added };
}

const TOKEN_DIMENSIONS = ['input', 'cachedInput', 'cacheWrite', 'output', 'reasoning', 'total'] as const;
const usableCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const reportedSource = (event: UsageEvent) => event.source === 'client_reported' || event.source === 'provider_reported';
/** Only reported, non-metric records measure consumption; legacy Codex records mislabeled running totals as deltas. */
const measured = (event: UsageEvent) => reportedSource(event) && event.scope !== METRIC_SCOPE && event.scope !== LEGACY_CODEX_SCOPE;
const seriesOf = (event: UsageEvent): string | null => typeof event.series === 'string' && event.series.length > 0 ? event.series : null;
const RUNNING_FIELDS = ['input', 'cachedInput', 'output', 'reasoning', 'total'] as const;
/** Samples of one running total are ordered in every reported field; two samples that cross reveal a restart. */
function ordered(samples: readonly UsageEvent[]): boolean {
  const sorted = [...samples].sort((a, b) => (a.total ?? 0) - (b.total ?? 0));
  return sorted.every((sample, index) => index === 0 || RUNNING_FIELDS.every(field => { const before = sorted[index - 1]![field]; const after = sample[field]; return before === null || after === null || before <= after; }));
}
export const OBSERVED_USAGE_TOTAL_SCOPE = 'Imported reported deltas plus the largest running total of each cumulative series; no invisible IDE calls counted';

/**
 * Observed token total for a report: the sum of reported delta totals plus, for each cumulative series
 * (source, scope and `series`), its largest observed running total. Cumulative records without a series are
 * unattributable and excluded; Claude metric dimensions, legacy Codex records and local estimates are excluded.
 * Returns null when nothing qualifies, when a qualifying total is missing, unsafe or negative, when the samples of
 * a series cross (a restarted counter), when one correlation carries conflicting totals, or on overflow.
 * It is an observation of supplied records, not billing or quota.
 */
export function observedUsageTotal(events: readonly UsageEvent[]): number | null {
  const seen = new Map<string, number | null>(); const samples = new Map<string, UsageEvent[]>();
  let total = 0; let qualifying = 0;
  for (const event of events) {
    if (!measured(event) || (event.counter !== 'delta' && event.counter !== 'cumulative')) continue;
    const series = seriesOf(event);
    if (event.counter === 'cumulative' && series === null) continue;
    if (!usableCount(event.total)) return null;
    const key = `${event.repositoryId}\u0000${event.correlationId}`;
    if (seen.has(key)) { if (seen.get(key) !== event.total) return null; continue; }
    seen.set(key, event.total); qualifying++;
    if (event.counter === 'delta') total += event.total;
    else { const id = JSON.stringify([event.repositoryId, event.source, event.scope, series]); const group = samples.get(id); if (group) group.push(event); else samples.set(id, [event]); }
  }
  for (const group of samples.values()) {
    if (!ordered(group)) return null;
    total += group.reduce((maximum, event) => Math.max(maximum, event.total!), 0);
  }
  return qualifying && Number.isSafeInteger(total) ? total : null;
}
interface RunningTotals {
  seriesCount: number; attributedRecords: number; unattributableRecords: number; missingTotalRecords: number; totalOverflow: boolean;
  /** Series whose samples cross in some field: the counter restarted, so its largest sample is not its total. */
  restartedSeries: number;
  /** Sum over series of each series' largest running total; null when incomplete, restarted, overflowing, truncated or absent. */
  recordedTokens: number | null;
}
interface CoverageGroup {
  source: UsageEvent['source'] | 'unknown'; scope: string; records: number; deltaRecords: number; cumulativeRecords: number;
  eligibleDeltaRecords: number; missingTotalRecords: number; totalOverflow: boolean; recordedDeltaTokens: number | null;
  runningTotals: RunningTotals;
}
interface MetricSeriesCoverage {
  seriesId: string; dimension: UsageMetric['dimension']; counter: UsageEvent['counter']; samples: number;
  firstSampleTime: string; lastSampleTime: string; lastValue: number | null; missingStartTimeRecords: number;
  resetsOrDecreases: number; total: null;
}
function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Usage coverage limit must be an integer between 1 and ${maximum}`);
  return value;
}

/** Bounded diagnostics about supplied records, never an estimate of unseen calls or billing. */
export function summarizeUsageCoverage(events: readonly UsageEvent[], options: { maxEvents?: number; maxGroups?: number } = {}) {
  const maxEvents = boundedLimit(options.maxEvents, 10_000, 50_000); const maxGroups = boundedLimit(options.maxGroups, 32, 128);
  const scanned = events.slice(0, maxEvents); const unique = new Map<string, UsageEvent>(); const conflicts = new Set<string>();
  let duplicateRecords = 0;
  for (const event of scanned) {
    const key = `${event.repositoryId}:${event.correlationId}`; const previous = unique.get(key);
    if (previous) {
      const fields = [...TOKEN_DIMENSIONS, 'source', 'scope', 'counter', 'sessionId', 'taskId'] as const;
      if (fields.some(field => previous[field] !== event[field]) || seriesOf(previous) !== seriesOf(event)) conflicts.add(key);
      else duplicateRecords++;
    } else unique.set(key, event);
  }
  if (new Set([...unique.values()].map(event => event.repositoryId)).size > 1) throw new Error('Usage coverage must remain repository scoped');
  const accepted = [...unique].filter(([key]) => !conflicts.has(key)).map(([, event]) => event);
  const missing = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0, model: 0, localSession: 0, localTask: 0, clientTimestamp: 0, agentType: 0, agentIdentity: 0 };
  const attributionRecords = { main: 0, subagent: 0, auxiliary: 0, unknown: 0 };
  const counters = { reportedDeltaRecords: 0, metricDeltaRecords: 0, cumulativeRecords: 0, unattributableCumulativeRecords: 0, legacyRunningTotalRecords: 0, locallyEstimatedRecords: 0, unknownSourceRecords: 0 };
  const groups = new Map<string, CoverageGroup>(); const series = new Map<string, { summary: MetricSeriesCoverage; points: UsageMetric[] }>();
  const runningSamples = new Map<CoverageGroup, Map<string, UsageEvent[]>>();
  let omittedGroupRecords = 0; let omittedMetricRecords = 0; let legacyMetricRecords = 0; let invalidCountRecords = 0;
  const sorted = [...accepted].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.eventId.localeCompare(b.eventId));
  for (const event of sorted) {
    const imported = event as Partial<ImportedUsageEvent>;
    for (const dimension of TOKEN_DIMENSIONS) if (!usableCount(event[dimension])) missing[dimension]++;
    if (TOKEN_DIMENSIONS.some(dimension => event[dimension] !== null && !usableCount(event[dimension]))) invalidCountRecords++;
    if (!event.model) missing.model++; if (!event.sessionId) missing.localSession++; if (!event.taskId) missing.localTask++;
    if (imported.timestampSource !== 'client') missing.clientTimestamp++;
    if (!imported.attribution?.agentType) missing.agentType++;
    // Names and source categories never establish a unique subagent identity.
    missing.agentIdentity++;
    const category = imported.attribution?.category;
    attributionRecords[category && ['main', 'subagent', 'auxiliary'].includes(category) ? category : 'unknown']++;
    const isMetric = event.scope === METRIC_SCOPE; const isLegacyRunningTotal = event.scope === LEGACY_CODEX_SCOPE;
    const source = ['client_reported', 'provider_reported', 'locally_estimated'].includes(event.source) ? event.source : 'unknown';
    const eligible = event.counter === 'delta' && measured(event);
    const running = event.counter === 'cumulative' && measured(event); const seriesId = seriesOf(event);
    if (source === 'unknown') counters.unknownSourceRecords++;
    else if (source === 'locally_estimated') counters.locallyEstimatedRecords++;
    else if (isLegacyRunningTotal) counters.legacyRunningTotalRecords++;
    else if (event.counter === 'cumulative') { counters.cumulativeRecords++; if (running && seriesId === null) counters.unattributableCumulativeRecords++; }
    else if (isMetric) counters.metricDeltaRecords++;
    else counters.reportedDeltaRecords++;
    const scope = textValue(event.scope) ?? 'unknown'; const key = JSON.stringify([source, scope]);
    let group = groups.get(key);
    if (!group && groups.size < maxGroups) {
      group = { source, scope, records: 0, deltaRecords: 0, cumulativeRecords: 0, eligibleDeltaRecords: 0, missingTotalRecords: 0, totalOverflow: false, recordedDeltaTokens: null,
        runningTotals: { seriesCount: 0, attributedRecords: 0, unattributableRecords: 0, missingTotalRecords: 0, totalOverflow: false, restartedSeries: 0, recordedTokens: null } };
      groups.set(key, group); runningSamples.set(group, new Map());
    }
    if (!group) omittedGroupRecords++;
    else {
      group.records++; if (event.counter === 'cumulative') group.cumulativeRecords++; else group.deltaRecords++;
      if (eligible) {
        group.eligibleDeltaRecords++;
        if (!usableCount(event.total)) group.missingTotalRecords++;
        else if (!group.missingTotalRecords && !group.totalOverflow) {
          const sum = (group.recordedDeltaTokens ?? 0) + event.total;
          if (Number.isSafeInteger(sum)) group.recordedDeltaTokens = sum;
          else group.totalOverflow = true;
        }
      }
      if (running && seriesId === null) group.runningTotals.unattributableRecords++;
      else if (running) {
        // A running total is summarized by its largest observation per series, never by adding samples.
        const bySeries = runningSamples.get(group)!; const samples = bySeries.get(seriesId!);
        group.runningTotals.attributedRecords++;
        if (!usableCount(event.total)) group.runningTotals.missingTotalRecords++;
        if (samples) samples.push(event); else bySeries.set(seriesId!, [event]);
      }
    }
    if (isMetric) {
      const metric = imported.metric;
      let validMetric = false;
      try { validMetric = !!metric && /^[a-f0-9]{64}$/.test(metric.seriesId) && ['input', 'output', 'cacheRead', 'cacheCreation'].includes(metric.dimension) && nanoseconds(metric.timeUnixNano) !== null && (metric.startTimeUnixNano === null || nanoseconds(metric.startTimeUnixNano) !== null) && (metric.value === null || usableCount(metric.value)); } catch { /* Legacy or invalid metadata cannot establish a metric series. */ }
      if (!metric || !validMetric) { legacyMetricRecords++; continue; }
      const metricKey = `${event.source}:${event.counter}:${metric.seriesId}`;
      let item = series.get(metricKey);
      if (!item && series.size < maxGroups) {
        item = { summary: { seriesId: metric.seriesId, dimension: metric.dimension, counter: event.counter, samples: 0, firstSampleTime: '', lastSampleTime: '', lastValue: null, missingStartTimeRecords: 0, resetsOrDecreases: 0, total: null }, points: [] };
        series.set(metricKey, item);
      }
      if (!item) omittedMetricRecords++; else item.points.push(metric);
    }
  }
  for (const group of groups.values()) {
    if (group.missingTotalRecords || group.totalOverflow || events.length > maxEvents || conflicts.size) group.recordedDeltaTokens = null;
    const totals = group.runningTotals; const bySeries = [...runningSamples.get(group)!.values()];
    totals.seriesCount = bySeries.length; totals.restartedSeries = bySeries.filter(samples => !ordered(samples)).length;
    const sum = bySeries.reduce((value, samples) => value + samples.reduce((maximum, sample) => usableCount(sample.total) ? Math.max(maximum, sample.total) : maximum, 0), 0);
    totals.totalOverflow = !Number.isSafeInteger(sum);
    totals.recordedTokens = !bySeries.length || totals.missingTotalRecords || totals.restartedSeries || totals.totalOverflow || events.length > maxEvents || conflicts.size ? null : sum;
  }
  for (const { summary, points } of series.values()) {
    points.sort((a, b) => BigInt(a.timeUnixNano) < BigInt(b.timeUnixNano) ? -1 : BigInt(a.timeUnixNano) > BigInt(b.timeUnixNano) ? 1 : 0);
    summary.samples = points.length; summary.firstSampleTime = points[0]!.timeUnixNano; summary.lastSampleTime = points.at(-1)!.timeUnixNano; summary.lastValue = points.at(-1)!.value;
    summary.missingStartTimeRecords = points.filter(point => point.startTimeUnixNano === null).length;
    if (summary.counter === 'cumulative') for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1]!; const next = points[i]!;
      if ((previous.startTimeUnixNano !== null && next.startTimeUnixNano !== null && previous.startTimeUnixNano !== next.startTimeUnixNano)
        || (previous.value !== null && next.value !== null && next.value < previous.value)) summary.resetsOrDecreases++;
    }
  }
  return {
    schemaVersion: 1 as const, scope: 'Supplied records only; missing fields count records, not missing calls or tokens',
    suppliedRecords: events.length, scannedRecords: scanned.length, analyzedRecords: accepted.length,
    omittedRecords: events.length - scanned.length, duplicateRecords, conflictingCorrelations: conflicts.size, invalidCountRecords,
    limits: { maxEvents, maxGroups }, truncated: events.length > maxEvents || omittedGroupRecords > 0 || omittedMetricRecords > 0,
    missing, counters, attributionRecords, groups: [...groups.values()], omittedGroupRecords,
    metricSeries: [...series.values()].map(item => item.summary), omittedMetricRecords, legacyMetricRecords,
    unobservedCalls: null, coverageRatio: null, subagentIdentityCoverage: null, cost: null, subscriptionQuota: null,
    limitations: [
      'Input files cannot establish how many events were never exported; coverage ratio remains unknown.',
      'Cumulative snapshots and metric dimensions are not added to request deltas. Resets or decreases are observations, not inferred usage.',
      'Running totals (Codex thread usage) count the largest observation per series, never a sum of samples. A visible counter restart makes the total unknown; a restart hidden between captures makes the largest observation an understatement. Records without a series are unattributable and excluded; legacy Codex records that stored running totals as deltas are excluded until re-imported.',
      'Per-group recorded deltas and running totals describe those records only; groups are not summed and may overlap.',
      'A reported subagent category or agent type is not a unique agent identity. Legacy ambiguous agent fields stay unattributed.',
    ],
  };
}

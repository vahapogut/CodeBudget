import { Buffer } from 'node:buffer';

export type ReducerFormat = 'vitest' | 'jest' | 'tsc' | 'eslint' | 'git-status' | 'git-diff' | 'search' | 'json' | 'logs' | 'unknown';
export type ReductionMode = 'observe' | 'balanced' | 'experimental';
export type LineEnding = '\n' | '\r\n';
export interface ReductionInput {
  text: string;
  exitCode: number | null;
  artifactId?: string;
  mode?: ReductionMode;
  truncated?: boolean;
  alreadyReduced?: boolean;
  format?: ReducerFormat;
  consumer?: 'agent' | 'machine';
}
export interface Diagnostic { severity: 'error' | 'warning' | 'info'; message: string; }
/** `missing` and `unexpected` are bounded diagnostic samples; `valid` is the verdict. */
export interface PreservationResult { valid: boolean; missing: string[]; unexpected?: string[]; }
export interface ParsedOutput {
  format: ReducerFormat;
  text: string;
  /** Logical lines without terminators. Uniform CRLF input is split on CRLF; mixed endings keep CR inside lines. */
  lines: string[];
  /** Original lines that must survive in order. Every other line was explicitly declared removable by the reducer. */
  protectedEvidence: string[];
  structured?: unknown;
  eol?: LineEnding;
  trailingNewline?: boolean;
  /** Exact lines the reducer may add, each at most once, such as a grouping summary or a not-a-patch label. */
  allowedAdditions?: string[];
}
export interface Reducer {
  id: ReducerFormat;
  version: string;
  /** Reduction is only honest when the caller archived the original and passes its artifact ID. */
  requiresArtifact?: boolean;
  supports(input: ReductionInput): boolean;
  parse(input: ReductionInput): ParsedOutput | null;
  reduce(parsed: ParsedOutput, input: ReductionInput): string;
  validatePreservation(parsed: ParsedOutput, output: string): PreservationResult;
}
export interface ReductionResult {
  schemaVersion: 1;
  status: 'success' | 'failure' | 'unknown';
  exitCode: number | null;
  summary: string;
  diagnostics: Diagnostic[];
  artifactId: string | null;
  detailsAvailable: boolean;
  truncated: boolean;
  originalSize: number;
  reducedSize: number;
  sizeUnit: 'bytes';
  reducerId: string;
  reducerVersion: string;
  output: string;
  applied: boolean;
  reason: string;
  estimatedTokens: { original: number; reduced: number; method: 'utf8-bytes-div-3'; accuracy: 'estimated' };
  preservation: PreservationResult;
}
export interface EvidenceValidationOptions {
  /** Line terminator of the original. Inferred from the output (uniform CRLF or LF) when omitted. */
  eol?: LineEnding;
  /** Required trailing-newline state of the output. Unchecked when omitted. */
  trailingNewline?: boolean;
  /** Exact added lines, each allowed at most once. When omitted, any added line is allowed. */
  allowedAdditions?: readonly string[];
}

const VERSION = '2.0.0';
/** Prefix of the line the Claude hook appends to replaced output. Text carrying it was already reduced. */
export const EVIDENCE_MARKER = '[CodeBudget evidence:';
const REPORT_LIMIT = 20;
// Detection inspects a bounded sample; the chosen reducer then checks every line in one linear pass.
const SAMPLE_EDGE_LINES = 200;
const SAMPLE_LINE_CHARS = 1024;
const PASS_LINE_CHARS = 600;
const size = (text: string): number => Buffer.byteLength(text, 'utf8');
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const some = (lines: readonly string[], pattern: RegExp): boolean => lines.some(line => pattern.test(line));
const bounded = (items: string[], total: number): string[] => total > items.length ? [...items, `[+${total - items.length} more]`] : items;

interface LineModel { lines: string[]; eol: LineEnding; trailingNewline: boolean; }
/** One split. Uniform CRLF is remembered and restored; mixed endings keep CR in the line so nothing is normalized. */
function lineModel(text: string): LineModel {
  const lines = text.split('\n');
  const trailingNewline = lines.length > 1 && lines[lines.length - 1] === '';
  if (trailingNewline) lines.pop();
  const terminated = trailingNewline ? lines.length : lines.length - 1;
  let crlf = terminated > 0;
  for (let index = 0; crlf && index < terminated; index += 1) crlf = lines[index]!.endsWith('\r');
  if (crlf) for (let index = 0; index < terminated; index += 1) lines[index] = lines[index]!.slice(0, -1);
  return { lines, eol: crlf ? '\r\n' : '\n', trailingNewline };
}
const render = (lines: readonly string[], model: { eol?: LineEnding; trailingNewline?: boolean }): string => {
  const eol = model.eol ?? '\n';
  return lines.join(eol) + (model.trailingNewline && lines.length > 0 ? eol : '');
};
const isUniformCrlf = (text: string): boolean => text.includes('\r\n') && !/(?:^|[^\r])\n/.test(text);
/** Inverse of `render`; null when the required final terminator is missing. */
function splitOutput(output: string, eol: LineEnding, trailingNewline: boolean | undefined): string[] | null {
  if (output === '') return trailingNewline === false ? [''] : [];
  let body = output;
  if (trailingNewline === true) { if (!body.endsWith(eol)) return null; body = body.slice(0, -eol.length); }
  else if (trailingNewline === undefined && body.endsWith(eol)) body = body.slice(0, -eol.length);
  return body.split(eol);
}
function trimLineBreaks(text: string): string {
  let end = text.length;
  while (end > 0 && (text.charCodeAt(end - 1) === 10 || text.charCodeAt(end - 1) === 13)) end -= 1;
  return end === text.length ? text : text.slice(0, end);
}
/** Line-ending or final-newline differences are normalization, never a reduction. */
const normalizationOnly = (original: string, candidate: string): boolean => trimLineBreaks(original.replaceAll('\r\n', '\n')) === trimLineBreaks(candidate.replaceAll('\r\n', '\n'));
const carriesReductionMarker = (text: string): boolean => text.startsWith(EVIDENCE_MARKER) || text.includes('\n' + EVIDENCE_MARKER);

/**
 * Linear, ordered evidence validation. Every evidence line, including whitespace-only lines and duplicates,
 * must appear as a whole output line in the original order. Other output lines must be declared additions.
 */
export function validateEvidence(evidence: readonly string[], output: string, options: EvidenceValidationOptions = {}): PreservationResult {
  const lines = splitOutput(output, options.eol ?? (isUniformCrlf(output) ? '\r\n' : '\n'), options.trailingNewline);
  if (!lines) return { valid: false, missing: ['[line terminator or trailing newline changed]'] };
  const additions = options.allowedAdditions ? new Map<string, number>() : undefined;
  for (const line of options.allowedAdditions ?? []) additions!.set(line, (additions!.get(line) ?? 0) + 1);
  const unexpected: string[] = [];
  let unexpectedCount = 0;
  let next = 0;
  for (const line of lines) {
    // Greedy in-order matching is optimal for a subsequence check; each line is compared once.
    if (next < evidence.length && line === evidence[next]) { next += 1; continue; }
    if (!additions) continue;
    const remaining = additions.get(line) ?? 0;
    if (remaining > 0) { additions.set(line, remaining - 1); continue; }
    unexpectedCount += 1;
    if (unexpected.length < REPORT_LIMIT) unexpected.push(line);
  }
  const missing = bounded(evidence.slice(next, next + REPORT_LIMIT), evidence.length - next);
  return { valid: next === evidence.length && unexpectedCount === 0, missing, ...(unexpectedCount ? { unexpected: bounded(unexpected, unexpectedCount) } : {}) };
}

/** Keep numeric lexemes, duplicate object keys, key order and string escapes unchanged. */
function compactJson(text: string): string {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (quoted) {
      if (escaped) escaped = false;
      else if (code === 92) escaped = true;
      else if (code === 34) quoted = false;
    } else if (code === 34) quoted = true;
    else if (code === 32 || code === 9 || code === 10 || code === 13) {
      if (index > start) parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts.join('');
}
function jsonDocument(text: string): unknown {
  let index = 0;
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  if (text[index] !== '{' && text[index] !== '[') return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}
function validateJson(original: string, output: string): PreservationResult {
  const valid = jsonDocument(output) !== undefined && compactJson(original) === compactJson(output);
  return { valid, missing: valid ? [] : ['JSON value changed or became invalid'] };
}

const DIFF_START = /^diff --(?:git|cc|combined) /;
const UNIFIED_HUNK = /^@@ -\d{1,10}(?:,\d{1,10})? \+\d{1,10}(?:,\d{1,10})? @@/;
/** Git diffs (including combined) and plain unified diffs. Checked on every line; the test is a prefix scan. */
function diffShaped(lines: readonly string[]): boolean {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith('diff --') && DIFF_START.test(line)) return true;
    if (line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ ') && UNIFIED_HUNK.test(lines[index + 2] ?? '')) return true;
  }
  return false;
}

interface Probe { text: string; model: LineModel; sample: string[]; json: unknown; diff: boolean; }
let cachedProbe: Probe | undefined;
/** Shared, single-pass view of one input so that detectors never rescan or re-parse whole outputs. */
function probe(text: string): Probe {
  if (cachedProbe?.text === text) return cachedProbe;
  const model = lineModel(text);
  const edge = model.lines.length <= SAMPLE_EDGE_LINES * 2 ? model.lines : [...model.lines.slice(0, SAMPLE_EDGE_LINES), ...model.lines.slice(-SAMPLE_EDGE_LINES)];
  const sample = edge.map(line => line.length > SAMPLE_LINE_CHARS ? line.slice(0, SAMPLE_LINE_CHARS) : line);
  cachedProbe = { text, model, sample, json: jsonDocument(text), diff: diffShaped(model.lines) };
  return cachedProbe;
}

interface Plan { removable?: ReadonlySet<number>; additions?: string[]; structured?: unknown; data?: unknown; }
interface ReducerSpec {
  /** Accepts JSON documents; all other reducers leave valid JSON to JSON-aware reducers. */
  json?: boolean;
  requiresArtifact?: boolean;
  /** Cheap detection on the bounded sample. */
  detect(probe: Probe): boolean;
  /** Linear full check; returns the explicit removal/addition plan or null when the grammar does not hold. */
  plan(probe: Probe, input: ReductionInput): Plan | null;
  reduce?(parsed: ParsedOutput, plan: Plan): string;
  validate?(parsed: ParsedOutput, output: string, plan: Plan | undefined): PreservationResult;
}
const plans = new WeakMap<ParsedOutput, Plan>();

/** Drops only declared lines, puts declared additions first and keeps the input's terminators. */
function dropDeclared(parsed: ParsedOutput, plan: Plan): string {
  if (!plan.removable?.size) return parsed.text;
  const kept = parsed.lines.filter((_line, index) => !plan.removable!.has(index));
  return render([...(plan.additions ?? []), ...kept], parsed);
}
function orderedPreservation(parsed: ParsedOutput, output: string): PreservationResult {
  if (output === parsed.text) return { valid: true, missing: [] };
  return validateEvidence(parsed.protectedEvidence, output, { eol: parsed.eol ?? '\n', trailingNewline: parsed.trailingNewline ?? false, allowedAdditions: parsed.allowedAdditions ?? [] });
}

function makeReducer(id: ReducerFormat, spec: ReducerSpec): Reducer {
  // Explicit format is a hint, not permission to misparse arbitrary content. Diff-shaped text belongs to the diff reducer only.
  const admissible = (candidate: Probe): boolean => (id === 'git-diff' || !candidate.diff) && (spec.json === true || candidate.json === undefined);
  return {
    id, version: VERSION, ...(spec.requiresArtifact ? { requiresArtifact: true } : {}),
    supports: input => input.format === id || (input.format === undefined && admissible(probe(input.text)) && spec.detect(probe(input.text))),
    parse(input) {
      const candidate = probe(input.text);
      if (!admissible(candidate) || !spec.detect(candidate)) return null;
      const plan = spec.plan(candidate, input);
      if (!plan) return null;
      const { lines, eol, trailingNewline } = candidate.model;
      const removable = plan.removable;
      const protectedEvidence = plan.structured !== undefined ? [] : removable?.size ? lines.filter((_line, index) => !removable.has(index)) : lines.slice();
      const parsed: ParsedOutput = { format: id, text: input.text, lines, protectedEvidence, eol, trailingNewline, allowedAdditions: plan.additions ?? [], ...(plan.structured !== undefined ? { structured: plan.structured } : {}) };
      plans.set(parsed, plan);
      return parsed;
    },
    reduce(parsed) {
      const plan = plans.get(parsed);
      if (!plan) return parsed.text;
      if (plan.structured !== undefined) return compactJson(parsed.text) + (parsed.trailingNewline ? parsed.eol ?? '\n' : '');
      return (spec.reduce ?? dropDeclared)(parsed, plan);
    },
    validatePreservation(parsed, output) {
      const plan = plans.get(parsed);
      if (parsed.structured !== undefined) return validateJson(parsed.text, output);
      return spec.validate ? spec.validate(parsed, output, plan) : orderedPreservation(parsed, output);
    },
  };
}
const removableWhere = (lines: readonly string[], predicate: (line: string) => boolean): Set<number> => {
  const result = new Set<number>();
  for (let index = 0; index < lines.length; index += 1) if (predicate(lines[index]!)) result.add(index);
  return result;
};
// Package-manager wrapper lines that may surround a tool's own output.
const WRAPPER_LINE = /^(?:> \S| ?ELIFECYCLE\b| ?ERR_PNPM_|npm (?:ERR!|error|warn) )/;

/* ---------- git diff: detected first, never loses whitespace-only lines ---------- */
const DIFF_EXTENDED_HEADER = /^(?:old mode|new mode|deleted file mode|new file mode|copy from|copy to|rename from|rename to|similarity index|dissimilarity index|index) /;
const INDEX_LINE = /^index [0-9a-f]{4,64}(?:,[0-9a-f]{4,64}){0,8}\.\.[0-9a-f]{4,64}(?: [0-7]{6})?$/;
/** Deliberately independent of the artifact ID: placeholder and real IDs produce byte-identical output. */
export const DIFF_EVIDENCE_LABEL = 'Diff evidence; NOT AN APPLYABLE PATCH: index lines omitted, full patch archived.';
const gitDiff = makeReducer('git-diff', {
  requiresArtifact: true,
  detect: candidate => candidate.diff,
  plan(candidate, input) {
    // Only redundant object-id lines inside an extended header are removable, and only with an archived original.
    const { lines } = candidate.model;
    const removable = new Set<number>();
    if (input.artifactId) {
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index]!.startsWith('diff --') || !DIFF_START.test(lines[index]!)) continue;
        for (let next = index + 1; next < lines.length && DIFF_EXTENDED_HEADER.test(lines[next]!); next += 1) if (INDEX_LINE.test(lines[next]!)) removable.add(next);
      }
    }
    return { removable, additions: removable.size ? [DIFF_EVIDENCE_LABEL] : [] };
  },
});

/* ---------- test runners: group only clean successful lines; blank lines are data ---------- */
const FAILURE_START = /^[ \t]*(?:FAIL\b|FAILED\b|[×✕✗][ \t]|AssertionError\b|Error:|●[ \t]|⎯)/;
const CONSOLE_START = /^(?:stdout|stderr) \||^[ \t]*console\.(?:log|info|warn|error|debug)$/;
const PASS_LINES = [
  /^[ \t]*PASS[ \t]+\S+\.[cm]?[jt]sx?(?:[ \t]+\(\d{1,6}(?:\.\d{1,3})?[ \t]?m?s\))?[ \t]*$/,
  /^[ \t]*[✓√✔][ \t]\S.{0,400}?[ \t]{1,4}\(\d{1,7} tests?\)(?:[ \t]\d{1,9}(?:\.\d{1,3})?[ \t]?m?s)?[ \t]*$/,
  /^[ \t]*[✓√✔][ \t]\S.{0,400}?[ \t](?:\d{1,9}(?:\.\d{1,3})?[ \t]?m?s|\(\d{1,9}(?:\.\d{1,3})?[ \t]?m?s\))[ \t]*$/,
];
// Pass lines carrying counts, retries, repeats or flakiness are evidence and are never grouped.
const PASS_ANNOTATION = /\|[ \t]*\d{1,7}[ \t]+(?:failed|skipped|todo|pending)|\b\d{1,7}[ \t]+(?:failed|skipped|todo|pending)\b|\((?:retry|repeat)[ \t]+x\d{1,7}\)|\bflak(?:y|iness)\b|\bretr(?:y|ied|ies)\b|\bMB heap used\b/i;
function testPassLines(lines: readonly string[]): Set<number> {
  const result = new Set<number>();
  let failureSection = false;
  let consoleBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (consoleBlock) { if (line.trim() === '') consoleBlock = false; continue; }
    if (FAILURE_START.test(line)) failureSection = true;
    if (CONSOLE_START.test(line)) { consoleBlock = true; continue; }
    if (!failureSection && line.length <= PASS_LINE_CHARS && PASS_LINES.some(pattern => pattern.test(line)) && !PASS_ANNOTATION.test(line)) result.add(index);
  }
  return result;
}
const structuredTests = (value: unknown): boolean => isRecord(value) && Array.isArray(value.testResults) && typeof value.numTotalTests === 'number';
function testPlan(candidate: Probe): Plan {
  if (candidate.json !== undefined) return { structured: candidate.json };
  const passes = testPassLines(candidate.model.lines);
  return passes.size < 2 ? {} : { removable: passes, additions: [`${passes.size} successful test/suite lines grouped.`] };
}
const VITEST_SIGNATURE = /^[ \t]*(?:Test Files[ \t]{1,20}\d|RUN[ \t]{1,20}v\d)/;
const VITEST_NAME = /\bvitest\b/i;
const TEST_RESULT_SIGNATURE = /^[ \t]*Tests?[ \t]{1,20}\d|[✓×✕]/;
const JEST_SIGNATURE = /^(?:Test Suites:|Tests:[ \t]{1,20}\d)|^[ \t]*(?:PASS|FAIL)[ \t]{1,20}\S+\.[cm]?[jt]sx?(?:[ \t]|$)/;
const vitest = makeReducer('vitest', {
  json: true,
  detect: candidate => candidate.json !== undefined ? structuredTests(candidate.json) : (some(candidate.sample, VITEST_SIGNATURE) || some(candidate.sample, VITEST_NAME)) && some(candidate.sample, TEST_RESULT_SIGNATURE),
  plan: testPlan,
});
const jest = makeReducer('jest', {
  json: true,
  detect: candidate => candidate.json !== undefined ? structuredTests(candidate.json) : some(candidate.sample, JEST_SIGNATURE),
  plan: testPlan,
});

/* ---------- TypeScript compiler ---------- */
const TSC_DIAGNOSTIC = /^(?:\S.{0,1000}?(?:\(\d{1,7},\d{1,7}\): |:\d{1,7}:\d{1,7} - ))?(?:error|warning|message) TS\d{1,6}: /;
const TSC_OTHER = /^(?:[ \t]|\d{1,7} |~|Found \d{1,7} errors?\b|Errors {2}Files$|\[?\d{1,2}:\d{2}:\d{2}(?: [AP]M)?\]? )/;
const tsc = makeReducer('tsc', {
  detect: candidate => some(candidate.sample, TSC_DIAGNOSTIC),
  plan(candidate) {
    // Every non-empty line must belong to compiler output; empty separator lines are the only removable lines.
    let diagnostics = 0;
    for (const line of candidate.model.lines) {
      if (line === '' || TSC_OTHER.test(line) || WRAPPER_LINE.test(line)) continue;
      if (!TSC_DIAGNOSTIC.test(line)) return null;
      diagnostics += 1;
    }
    return diagnostics ? { removable: removableWhere(candidate.model.lines, line => line === '') } : null;
  },
});

/* ---------- ESLint ---------- */
const ESLINT_MESSAGE = /^[ \t]{1,8}\d{1,7}:\d{1,7}[ \t]+(?:error|warning)[ \t]/;
const ESLINT_FILE = /^(?:[A-Za-z]:[\\/]|[\\/]|\.{1,2}[\\/])?[^\s:*?"<>|][^\t:*?"<>|]*\.[A-Za-z0-9]{1,10}$/;
const ESLINT_SUMMARY = /^(?:[✖✗×] \d{1,7} problems? \(\d{1,7} errors?, \d{1,7} warnings?\)|[ \t]+\d{1,7} errors? and \d{1,7} warnings? potentially fixable with the `--fix` option\.)$/;
const eslintJson = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.every(item => isRecord(item) && typeof item.filePath === 'string' && Array.isArray(item.messages));
const eslint = makeReducer('eslint', {
  json: true,
  detect: candidate => candidate.json !== undefined ? eslintJson(candidate.json) : some(candidate.sample, ESLINT_MESSAGE),
  plan(candidate) {
    if (candidate.json !== undefined) return { structured: candidate.json };
    let messages = 0;
    for (const line of candidate.model.lines) {
      if (line === '' || ESLINT_SUMMARY.test(line) || ESLINT_FILE.test(line) || WRAPPER_LINE.test(line)) continue;
      if (!ESLINT_MESSAGE.test(line)) return null;
      messages += 1;
    }
    return messages ? { removable: removableWhere(candidate.model.lines, line => line === '') } : null;
  },
});

/* ---------- JSON: tried before line-oriented formats ---------- */
const json = makeReducer('json', { json: true, detect: candidate => candidate.json !== undefined, plan: candidate => ({ structured: candidate.json }) });

/* ---------- git status: every non-empty line must fit porcelain v1, v2 or the long format ---------- */
const STATUS_HEAD = /^(?:On branch \S.*|HEAD detached (?:at|from) \S+|Not currently on any branch\.|(?:interactive )?rebase in progress; onto \S+)$/s;
const STATUS_STATE = /^(?:On branch \S.*|HEAD detached (?:at|from) \S+|Not currently on any branch\.|Your branch (?:is up to date with|is ahead of|is behind|and|is based on) '.+|and have \d{1,9} and \d{1,9} different commits each, respectively\.|No commits yet|Initial commit|You have unmerged paths\.|All conflicts fixed but you are still merging\.|You are currently \S.*|You are in (?:a sparse checkout|the middle of an am session).*|(?:interactive )?rebase in progress; onto \S+|No commands remaining\.|(?:Cherry-pick|Revert) currently in progress\.|The current patch is empty\.|nothing to commit.*|nothing added to commit but untracked files present.*|no changes added to commit.*|Untracked files not listed.*|It took \d{1,9}(?:\.\d{1,9})? seconds to \S.*|may speed it up, but you have to be careful not to forget to add|new files yourself \(see 'git help status'\)\.|You can use '--no-ahead-behind' to avoid this\.)$/s;
const STATUS_SECTION = /^(?:Changes to be committed|Changes not staged for commit|Unmerged paths|Untracked files|Ignored files|Submodule changes to be committed|Submodules changed but not updated):$/;
const STATUS_HINT = /^ {2}\(.+\)$/s;
const STATUS_ENTRY = /^(?:\t| {8})(?:(?:new file|modified|deleted|renamed|copied|typechange|unmerged|unknown|both deleted|added by us|deleted by them|added by them|deleted by us|both added|both modified):[ \t]+)?\S.*$/s;
const STATUS_TODO_HEADER = /^(?:Last commands? done \(\d{1,9} commands? done\)|Next commands? to do \(\d{1,9} remaining commands?\)):$/;
const STATUS_TODO_LINE = /^ {3}\S.*$/s;
const PORCELAIN_V1 = /^(?:[MTADRCU][ MTADRCU]| [MTADRCU]|\?\?|!!) \S.*$/s;
const PORCELAIN_V1_BRANCH = /^## \S.*$/s;
const PORCELAIN_V2_ENTRY = [
  /^1 [.MTADRCU]{2} (?:N\.\.\.|S[C.][M.][U.]) [0-7]{6} [0-7]{6} [0-7]{6} [0-9a-f]{4,64} [0-9a-f]{4,64} \S.*$/s,
  /^2 [.MTADRCU]{2} (?:N\.\.\.|S[C.][M.][U.]) [0-7]{6} [0-7]{6} [0-7]{6} [0-9a-f]{4,64} [0-9a-f]{4,64} [RC]\d{1,3} \S.*$/s,
  /^u [.MTADRCU]{2} (?:N\.\.\.|S[C.][M.][U.]) [0-7]{6} [0-7]{6} [0-7]{6} [0-7]{6} [0-9a-f]{4,64} [0-9a-f]{4,64} [0-9a-f]{4,64} \S.*$/s,
  /^# (?:branch\.(?:oid|head|upstream|ab)|stash) \S.*$/s,
];
const PORCELAIN_V2_OTHER = /^[?!] \S.*$/s;
const firstNonEmpty = (lines: readonly string[]): string | undefined => lines.find(line => line !== '');
/** Porcelain output has no blank lines; an optional `## branch` header may only come first. */
function porcelainV1(lines: readonly string[]): boolean {
  let entries = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (PORCELAIN_V1.test(line)) entries += 1;
    else if (index !== 0 || !PORCELAIN_V1_BRANCH.test(line)) return false;
  }
  return entries > 0;
}
/** Porcelain v2 needs at least one header or ordinary/renamed/unmerged entry, not only `?`/`!` lines. */
function porcelainV2(lines: readonly string[]): boolean {
  let anchored = false;
  for (const line of lines) {
    if (PORCELAIN_V2_ENTRY.some(pattern => pattern.test(line))) anchored = true;
    else if (!PORCELAIN_V2_OTHER.test(line)) return false;
  }
  return anchored;
}
/** Long `git status`: returns empty and hint lines (removable), or null when any line falls outside the grammar. */
function longStatusRemovable(lines: readonly string[]): Set<number> | null {
  const removable = new Set<number>();
  let headSeen = false;
  let section = false;
  let todo = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line === '') { removable.add(index); continue; }
    if (!headSeen) { if (!STATUS_HEAD.test(line)) return null; headSeen = true; continue; }
    if (STATUS_HINT.test(line)) { removable.add(index); continue; }
    if (section && STATUS_ENTRY.test(line)) continue;
    if (todo && STATUS_TODO_LINE.test(line)) continue;
    if (STATUS_SECTION.test(line)) { section = true; todo = false; continue; }
    if (STATUS_TODO_HEADER.test(line)) { todo = true; section = false; continue; }
    if (!STATUS_STATE.test(line)) return null;
    section = false; todo = false;
  }
  return headSeen ? removable : null;
}
const gitStatus = makeReducer('git-status', {
  detect(candidate) {
    const sample = candidate.sample.filter(line => line !== '');
    const head = firstNonEmpty(candidate.model.lines);
    return head !== undefined && (STATUS_HEAD.test(head) || porcelainV1(sample) || porcelainV2(sample));
  },
  plan(candidate) {
    const { lines } = candidate.model;
    if (porcelainV1(lines) || porcelainV2(lines)) return {};
    const removable = longStatusRemovable(lines);
    return removable ? { removable } : null;
  },
});

/* ---------- exact repeated log lines; timestamped logs are claimed here so no other grammar misreads them ---------- */
const LOG_MARKER = /^\[exact repeated line: (\d{1,9}) occurrences; order unchanged\]$/;
const logMarker = (count: number): string => `[exact repeated line: ${count} occurrences; order unchanged]`;
const TIMESTAMP_START = /^(?:[\w.-]{1,64}[ \t]*\|[ \t]*)?\[?(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,9})?\]?[ \t])/;
interface LogRun { start: number; count: number; }
function logRuns(lines: readonly string[], eolBytes: number): LogRun[] {
  const runs: LogRun[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    let count = 1;
    while (index + count < lines.length && lines[index + count] === line) count += 1;
    // Group only when the marker is smaller than the repeated copies it replaces.
    if (count > 1 && (count - 1) * (size(line) + eolBytes) > size(logMarker(count)) + eolBytes) runs.push({ start: index, count });
    index += count;
  }
  return runs;
}
const logs = makeReducer('logs', {
  detect(candidate) {
    const { lines } = candidate.model;
    for (let index = 1; index < lines.length; index += 1) if (lines[index] !== '' && lines[index] === lines[index - 1]) return true;
    const sample = candidate.sample.filter(line => line.trim() !== '');
    return sample.length >= 2 && sample.filter(line => TIMESTAMP_START.test(line)).length * 2 >= sample.length;
  },
  plan(candidate) {
    const { lines, eol } = candidate.model;
    // A literal marker line in the input would make reconstruction ambiguous, so such input is left unchanged.
    if (lines.some(line => line.startsWith('[exact repeated line: ') && LOG_MARKER.test(line))) return {};
    return { data: logRuns(lines, eol.length) };
  },
  reduce(parsed, plan) {
    const runs = (plan.data ?? []) as LogRun[];
    if (!runs.length) return parsed.text;
    const output: string[] = [];
    let cursor = 0;
    for (const run of runs) {
      for (; cursor < run.start; cursor += 1) output.push(parsed.lines[cursor]!);
      output.push(parsed.lines[run.start]!, logMarker(run.count));
      cursor = run.start + run.count;
    }
    for (; cursor < parsed.lines.length; cursor += 1) output.push(parsed.lines[cursor]!);
    return render(output, parsed);
  },
  validate(parsed, output) {
    if (output === parsed.text) return { valid: true, missing: [] };
    const lines = splitOutput(output, parsed.eol ?? '\n', parsed.trailingNewline ?? false);
    const invalid = { valid: false, missing: ['Log content, ordering or repetition count changed'] };
    if (!lines) return invalid;
    const restored: string[] = [];
    for (const line of lines) {
      const match = line.startsWith('[exact repeated line: ') ? LOG_MARKER.exec(line) : null;
      if (match && restored.length) {
        const count = Number(match[1]);
        if (count < 2 || restored.length + count - 1 > parsed.lines.length) return { valid: false, missing: ['Invalid repetition count'] };
        const prior = restored[restored.length - 1]!;
        for (let index = 1; index < count; index += 1) restored.push(prior);
      } else restored.push(line);
    }
    return restored.length === parsed.lines.length && restored.every((line, index) => line === parsed.lines[index]) ? { valid: true, missing: [] } : invalid;
  },
});

/* ---------- search results: path:line:text with plausible paths; contiguous runs only ---------- */
const SEARCH_LINE = /^((?:[A-Za-z]:[\\/])?[^\s|:<>"*?]{1,4096}):([1-9]\d{0,8}:.*)$/s;
// A path needs a letter and must not be a date/time fragment such as "2026-09-29T12".
const plausiblePath = (path: string): boolean => /[A-Za-z_]/.test(path) && !/^\d{4}-\d{2}-\d{2}/.test(path) && !/T\d{2}$/.test(path);
function searchLine(line: string): { path: string; rest: string } | null {
  const match = SEARCH_LINE.exec(line);
  return match && plausiblePath(match[1]!) ? { path: match[1]!, rest: match[2]! } : null;
}
const search = makeReducer('search', {
  detect: candidate => candidate.sample.every(line => searchLine(line) !== null),
  plan(candidate) {
    const entries: { path: string; rest: string }[] = [];
    for (const line of candidate.model.lines) {
      const entry = searchLine(line);
      if (!entry) return null;
      entries.push(entry);
    }
    return { data: entries };
  },
  reduce(parsed, plan) {
    // Only consecutive lines of one path share a header, so the global order stays reconstructible.
    const entries = (plan.data ?? []) as { path: string; rest: string }[];
    const output: string[] = [];
    let grouped = false;
    for (let index = 0; index < entries.length;) {
      const { path } = entries[index]!;
      let count = 1;
      while (index + count < entries.length && entries[index + count]!.path === path) count += 1;
      // A header costs the path once plus a terminator; each match line then costs two spaces instead of `path:`.
      if (count > 1 && (count - 1) * size(path) > count + (parsed.eol ?? '\n').length) {
        output.push(path);
        for (let offset = 0; offset < count; offset += 1) output.push(`  ${entries[index + offset]!.rest}`);
        grouped = true;
      } else for (let offset = 0; offset < count; offset += 1) output.push(parsed.lines[index + offset]!);
      index += count;
    }
    return grouped ? render(output, parsed) : parsed.text;
  },
  validate(parsed, output) {
    if (output === parsed.text) return { valid: true, missing: [] };
    const lines = splitOutput(output, parsed.eol ?? '\n', parsed.trailingNewline ?? false);
    if (!lines) return { valid: false, missing: ['Line terminator or trailing newline changed'] };
    // Reconstruct every original line in global order; any regrouping, loss or addition fails.
    const restored: string[] = [];
    let header: string | null = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (line.startsWith('  ')) {
        if (header === null) return { valid: false, missing: ['Match line without a path header'] };
        restored.push(`${header}:${line.slice(2)}`);
      } else if (lines[index + 1]?.startsWith('  ')) header = line;
      else { header = null; restored.push(line); }
    }
    const missing: string[] = [];
    const length = Math.max(restored.length, parsed.lines.length);
    for (let index = 0; index < length && missing.length < REPORT_LIMIT; index += 1) if (restored[index] !== parsed.lines[index]) missing.push(parsed.lines[index] ?? '[unexpected extra line]');
    return { valid: missing.length === 0, missing };
  },
});

export const reducers: readonly Reducer[] = [gitDiff, vitest, jest, tsc, eslint, json, gitStatus, logs, search];

/** No content is executed. Callers must redact before this API and gate artifact retrieval separately. */
export function reduceOutput(input: ReductionInput): ReductionResult {
  const originalSize = size(input.text);
  let output = input.text;
  let chosen: Reducer | undefined;
  let preservation: PreservationResult = { valid: true, missing: [] };
  let reason = 'unknown_format';
  let candidateSize = originalSize;
  try {
    if (input.alreadyReduced || carriesReductionMarker(input.text)) reason = 'already_reduced';
    else if (input.consumer === 'machine') reason = 'machine_consumer_requires_original';
    else {
      for (const reducer of reducers) {
        if (!reducer.supports(input)) continue;
        const parsed = reducer.parse(input);
        if (!parsed) continue;
        chosen = reducer;
        if (reducer.requiresArtifact && !input.artifactId) { reason = 'artifact_required'; break; }
        const candidate = reducer.reduce(parsed, input);
        preservation = reducer.validatePreservation(parsed, candidate);
        candidateSize = size(candidate);
        if (!preservation.valid) reason = 'preservation_failed';
        else if (candidateSize >= originalSize || normalizationOnly(input.text, candidate)) { reason = 'no_gain'; candidateSize = originalSize; }
        else if ((input.mode ?? 'observe') === 'observe') reason = 'observe_only';
        else { output = candidate; reason = 'reduced'; }
        break;
      }
    }
  } finally { cachedProbe = undefined; }
  const reducedSize = size(output);
  const diagnostics: Diagnostic[] = [];
  if (input.truncated) diagnostics.push({ severity: 'warning', message: 'Source output is truncated; this is incomplete evidence.' });
  if (!preservation.valid) diagnostics.push({ severity: 'warning', message: 'Preservation validation rejected the candidate; original output retained.' });
  if (reason === 'observe_only') diagnostics.push({ severity: 'info', message: `Candidate reduction: ${originalSize - candidateSize} bytes; observe mode leaves content unchanged.` });
  if (reason === 'artifact_required') diagnostics.push({ severity: 'info', message: 'This reducer needs an archived original (artifactId); output retained.' });
  return {
    schemaVersion: 1, status: input.exitCode === null ? 'unknown' : input.exitCode === 0 ? 'success' : 'failure', exitCode: input.exitCode,
    summary: reason === 'reduced' ? `${chosen!.id}: ${originalSize} to ${reducedSize} bytes.` : `Output retained: ${reason}.`,
    diagnostics, artifactId: input.artifactId ?? null, detailsAvailable: Boolean(input.artifactId), truncated: input.truncated ?? false,
    originalSize, reducedSize, sizeUnit: 'bytes', reducerId: chosen?.id ?? 'identity', reducerVersion: chosen?.version ?? VERSION,
    output, applied: reason === 'reduced', reason,
    estimatedTokens: { original: Math.ceil(originalSize / 3), reduced: Math.ceil(reducedSize / 3), method: 'utf8-bytes-div-3', accuracy: 'estimated' }, preservation,
  };
}

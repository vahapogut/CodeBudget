import { Buffer } from 'node:buffer';

export type ReducerFormat = 'vitest' | 'jest' | 'tsc' | 'eslint' | 'git-status' | 'git-diff' | 'search' | 'json' | 'logs' | 'unknown';
export type ReductionMode = 'observe' | 'balanced' | 'experimental';
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
export interface PreservationResult { valid: boolean; missing: string[]; }
export interface ParsedOutput {
  format: ReducerFormat;
  text: string;
  lines: string[];
  protectedEvidence: string[];
  structured?: unknown;
}
export interface Reducer {
  id: ReducerFormat;
  version: string;
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

const VERSION = '1.0.0';
const MARKER = '[CodeBudget reduced';
const linesOf = (text: string): string[] => text.split(/\r?\n/);
const size = (text: string): number => Buffer.byteLength(text, 'utf8');
const jsonParse = (text: string): unknown => { try { return JSON.parse(text) as unknown; } catch { return undefined; } };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const looksJson = (text: string): boolean => (text.trimStart().startsWith('[') || text.trimStart().startsWith('{')) && jsonParse(text) !== undefined;
const unchangedEvidence = (lines: string[]): string[] => [...new Set(lines.filter(line => line.trim().length > 0))];

/** Keep numeric lexemes, duplicate object keys, key order and string escapes unchanged. */
function compactJson(text: string): string {
  let quoted = false;
  let escaped = false;
  let output = '';
  for (const char of text) {
    if (quoted) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') { quoted = true; output += char; }
    else if (!/\s/.test(char)) output += char;
  }
  return output;
}

/** Exact evidence validation is deliberately separate and can reject a faulty reducer. */
export function validateEvidence(evidence: readonly string[], output: string): PreservationResult {
  const missing = evidence.filter(item => !output.includes(item));
  return { valid: missing.length === 0, missing };
}

function parser(id: ReducerFormat, detect: (input: ReductionInput) => boolean, transform: (parsed: ParsedOutput, input: ReductionInput) => string, evidence?: (input: ReductionInput) => string[]): Reducer {
  return {
    id, version: VERSION,
    supports: input => input.format === id || (input.format === undefined && detect(input)),
    parse(input) {
      // Explicit format is a hint, not permission to misparse arbitrary content.
      if (!detect(input)) return null;
      return { format: id, text: input.text, lines: linesOf(input.text), protectedEvidence: evidence?.(input) ?? unchangedEvidence(linesOf(input.text)), ...(looksJson(input.text) ? { structured: jsonParse(input.text) } : {}) };
    },
    reduce: transform,
    validatePreservation: (parsed, output) => validateEvidence(parsed.protectedEvidence, output),
  };
}

function compactBlankLines(parsed: ParsedOutput): string {
  return parsed.lines.filter(line => line.trim()).join('\n');
}

function testPassLines(input: ReductionInput): Set<number> {
  const result = new Set<number>();
  let failureSection = false;
  for (const [index, line] of linesOf(input.text).entries()) {
    if (/^\s*(?:FAIL\b|FAILED\b|[×✕]\s|AssertionError\b|Error:|●\s)/.test(line)) failureSection = true;
    // Jest PASS suite lines and Vitest check-mark lines have recognizable timing/count suffixes.
    if (!failureSection && (/^\s*PASS\s+\S+\.[cm]?[jt]sx?(?:\s|$)/.test(line) || /^\s*[✓√✔]\s+.+(?:\(\d+ tests?[^)]*\)|\d+(?:\.\d+)?\s?m?s)\s*$/.test(line))) result.add(index);
  }
  return result;
}

function reduceHumanTests(parsed: ParsedOutput, input: ReductionInput): string {
  if (parsed.structured !== undefined) return compactJson(parsed.text);
  const passes = testPassLines(input);
  if (passes.size < 2) return compactBlankLines(parsed);
  return [`${passes.size} successful test/suite lines grouped.`, ...parsed.lines.filter((line, index) => !passes.has(index) && line.trim())].join('\n');
}

const humanTestEvidence = (input: ReductionInput): string[] => {
  if (looksJson(input.text)) return [];
  const passes = testPassLines(input);
  return unchangedEvidence(linesOf(input.text).filter((_line, index) => !passes.has(index)));
};

function structuredTests(text: string): boolean {
  const value = jsonParse(text);
  return isRecord(value) && Array.isArray(value.testResults) && typeof value.numTotalTests === 'number';
}
const vitest = parser('vitest', input => structuredTests(input.text) || (/(?:\bTest Files\s+\d|\bRUN\s+v\d|\bvitest\b)/i.test(input.text) && /(?:Tests?\s+\d|[✓×✕])/.test(input.text)), reduceHumanTests, humanTestEvidence);
const jest = parser('jest', input => structuredTests(input.text) || /^Test Suites:|^Tests:\s+\d|^\s*(?:PASS|FAIL)\s+\S+\.[cm]?[jt]sx?/m.test(input.text), reduceHumanTests, humanTestEvidence);
for (const reducer of [vitest, jest]) reducer.validatePreservation = (parsed, output) => parsed.structured === undefined ? validateEvidence(parsed.protectedEvidence, output) : validateJson(parsed.text, output);
const tsc = parser('tsc', input => /(?:\(\d+,\d+\)|:\d+:\d+)\s*:?\s*(?:error|warning) TS\d+:/m.test(input.text), compactBlankLines);

const eslint = parser('eslint', input => {
  const value = jsonParse(input.text);
  return (Array.isArray(value) && value.length > 0 && value.every(item => isRecord(item) && typeof item.filePath === 'string' && Array.isArray(item.messages))) || /\d+:\d+\s+(?:error|warning)\s+.+/m.test(input.text);
}, parsed => parsed.structured === undefined ? compactBlankLines(parsed) : compactJson(parsed.text), input => looksJson(input.text) ? [] : unchangedEvidence(linesOf(input.text)));
eslint.validatePreservation = (parsed, output) => parsed.structured === undefined ? validateEvidence(parsed.protectedEvidence, output) : validateJson(parsed.text, output);

const gitStatus = parser('git-status', input => /^(?:On branch |## |# branch\.|[ MADRCU?!]{2} .+|[12u?] .+)$/m.test(input.text), compactBlankLines);

const gitDiff = parser('git-diff', input => /^diff --git /m.test(input.text) && /^(?:@@ |Binary files |GIT binary patch)/m.test(input.text), (parsed, input) => {
  // Remove only redundant object-id lines; retain every path, hunk and context line.
  // The output is clearly marked so consumers cannot mistake it for an applicable patch.
  if (!input.artifactId) return parsed.text;
  const body = parsed.lines.filter(line => !/^index [0-9a-f]+\.\.[0-9a-f]+(?: \d+)?$/.test(line)).join('\n');
  return `Diff evidence; NOT AN APPLYABLE PATCH. Full patch: artifact ${input.artifactId}.\n${body}`;
}, input => unchangedEvidence(linesOf(input.text).filter(line => !/^index [0-9a-f]+\.\.[0-9a-f]+(?: \d+)?$/.test(line))));

function reduceSearch(parsed: ParsedOutput): string {
  const groups = new Map<string, string[]>();
  for (const line of parsed.lines.filter(item => item.length)) {
    // Greedy path permits Windows drive letters and colons in file names.
    const match = /^(.*?):(\d+)(?::(\d+))?:(.*)$/.exec(line);
    if (!match) return parsed.text;
    const path = match[1]!;
    const evidence = `${match[2]}${match[3] ? ':' + match[3] : ''}:${match[4]}`;
    const entries = groups.get(path) ?? [];
    entries.push(evidence);
    groups.set(path, entries);
  }
  return [...groups].map(([path, matches]) => `${path}\n${matches.map(match => `  ${match}`).join('\n')}`).join('\n');
}
const search = parser('search', input => linesOf(input.text).filter(line => line.length > 0).length > 0 && linesOf(input.text).filter(line => line.length > 0).every(line => /^(.*?):(\d+)(?::(\d+))?:(.*)$/.test(line)), reduceSearch, () => []);
search.validatePreservation = (parsed, output) => {
  if (output === parsed.text) return { valid: true, missing: [] };
  const actual = new Map<string, string[]>();
  let path = '';
  for (const line of output.split('\n')) {
    if (!line.startsWith('  ')) { path = line; actual.set(path, []); }
    else actual.get(path)?.push(line.slice(2));
  }
  const missing: string[] = [];
  for (const line of parsed.lines.filter(line => line.length)) {
    const match = /^(.*?):(\d+)(?::(\d+))?:(.*)$/.exec(line)!;
    const key = `${match[2]}${match[3] ? ':' + match[3] : ''}:${match[4]}`;
    const list = actual.get(match[1]!);
    const index = list?.indexOf(key) ?? -1;
    if (index < 0) missing.push(line); else list!.splice(index, 1);
  }
  return { valid: missing.length === 0, missing };
};

function validateJson(original: string, output: string): PreservationResult {
  const value = jsonParse(output);
  const valid = value !== undefined && compactJson(original) === compactJson(output);
  return { valid, missing: valid ? [] : ['JSON value changed or became invalid'] };
}
const json = parser('json', input => looksJson(input.text), parsed => compactJson(parsed.text), () => []);
json.validatePreservation = (parsed, output) => validateJson(parsed.text, output);

/** Only exact consecutive duplicates are grouped. Variable details and timestamps stay verbatim. */
const logs = parser('logs', input => {
  const lines = linesOf(input.text);
  return lines.some((line, index) => line.length > 0 && index > 0 && line === lines[index - 1]);
}, parsed => {
  const output: string[] = [];
  for (let index = 0; index < parsed.lines.length; index += 1) {
    const line = parsed.lines[index]!;
    let count = 1;
    while (parsed.lines[index + count] === line) count += 1;
    output.push(line);
    if (count > 1) output.push(`[exact repeated line: ${count} occurrences; order unchanged]`);
    index += count - 1;
  }
  return output.join('\n');
});
logs.validatePreservation = (parsed, output) => {
  if (output === parsed.text) return { valid: true, missing: [] };
  const restored: string[] = [];
  for (const line of output.split('\n')) {
    const match = /^\[exact repeated line: (\d+) occurrences; order unchanged\]$/.exec(line);
    if (match && restored.length) {
      const count = Number(match[1]);
      if (count > parsed.lines.length || count < 2) return { valid: false, missing: ['Invalid repetition count'] };
      const prior = restored.at(-1)!;
      for (let index = 1; index < count; index += 1) restored.push(prior);
    } else restored.push(line);
  }
  const valid = restored.join('\n') === parsed.lines.join('\n');
  return { valid, missing: valid ? [] : ['Log content, ordering or repetition count changed'] };
};

export const reducers: readonly Reducer[] = [vitest, jest, tsc, eslint, gitDiff, gitStatus, search, json, logs];

/** No content is executed. Callers must redact before this API and gate artifact retrieval separately. */
export function reduceOutput(input: ReductionInput): ReductionResult {
  const originalSize = size(input.text);
  let output = input.text;
  let chosen: Reducer | undefined;
  let preservation: PreservationResult = { valid: true, missing: [] };
  let reason = 'unknown_format';
  let candidateSize = originalSize;
  if (input.alreadyReduced || input.text.startsWith(MARKER)) reason = 'already_reduced';
  else if (input.consumer === 'machine') reason = 'machine_consumer_requires_original';
  else {
    for (const reducer of reducers) {
      if (!reducer.supports(input)) continue;
      const parsed = reducer.parse(input);
      if (!parsed) continue;
      chosen = reducer;
      const candidate = reducer.reduce(parsed, input);
      preservation = reducer.validatePreservation(parsed, candidate);
      candidateSize = size(candidate);
      if (!preservation.valid) reason = 'preservation_failed';
      else if (candidateSize >= originalSize) reason = 'no_gain';
      else if ((input.mode ?? 'observe') === 'observe') reason = 'observe_only';
      else { output = candidate; reason = 'reduced'; }
      break;
    }
  }
  const reducedSize = size(output);
  const diagnostics: Diagnostic[] = [];
  if (input.truncated) diagnostics.push({ severity: 'warning', message: 'Source output is truncated; this is incomplete evidence.' });
  if (!preservation.valid) diagnostics.push({ severity: 'warning', message: 'Preservation validation rejected the candidate; original output retained.' });
  if (reason === 'observe_only') diagnostics.push({ severity: 'info', message: `Candidate reduction: ${originalSize - candidateSize} bytes; observe mode leaves content unchanged.` });
  return {
    schemaVersion: 1, status: input.exitCode === null ? 'unknown' : input.exitCode === 0 ? 'success' : 'failure', exitCode: input.exitCode,
    summary: reason === 'reduced' ? `${chosen!.id}: ${originalSize} to ${reducedSize} bytes.` : `Output retained: ${reason}.`,
    diagnostics, artifactId: input.artifactId ?? null, detailsAvailable: Boolean(input.artifactId), truncated: input.truncated ?? false,
    originalSize, reducedSize, sizeUnit: 'bytes', reducerId: chosen?.id ?? 'identity', reducerVersion: chosen?.version ?? VERSION,
    output, applied: reason === 'reduced', reason,
    estimatedTokens: { original: Math.ceil(originalSize / 3), reduced: Math.ceil(reducedSize / 3), method: 'utf8-bytes-div-3', accuracy: 'estimated' }, preservation,
  };
}

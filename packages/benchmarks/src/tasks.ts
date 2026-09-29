export type TaskCategory = 'bugfix' | 'type-error' | 'regression-test' | 'refactor' | 'log-diagnosis';
export interface PilotTask {
  id: string;
  category: TaskCategory;
  title: string;
  prompt: string;
  files: Readonly<Record<string, string>>;
  acceptance: readonly string[];
  humanReviewRequired: boolean;
  license: 'Apache-2.0';
}

function task(id: string, category: TaskCategory, title: string, prompt: string, source: string, extra: Record<string, string> = {}): PilotTask {
  return {
    id, category, title, prompt,
    files: { 'solution.ts': source + '\n', ...extra },
    acceptance: ['Strict TypeScript typecheck passes.', 'Task-specific hidden behavioral checks pass.', 'Keep the exported API and do not add dependencies.'],
    humanReviewRequired: category === 'refactor' || category === 'log-diagnosis',
    license: 'Apache-2.0',
  };
}

/** Original tiny tasks; every condition receives byte-identical files and acceptance criteria. */
export const pilotTasks: readonly PilotTask[] = [
  task('bug-01', 'bugfix', 'Clamp both boundaries', 'Fix clamp so values below min and above max clamp to the appropriate bound.', 'export function solve(value: number, min: number, max: number): number { return Math.min(min, Math.max(max, value)); }'),
  task('bug-02', 'bugfix', 'Chunk final remainder', 'Split values into chunks of positive integer size and keep the final short chunk. Throw RangeError for nonpositive size.', 'export function solve(values: number[], size: number): number[][] { const out: number[][] = []; for (let i = 0; i + size <= values.length; i += size) out.push(values.slice(i, i + size)); return out; }'),
  task('bug-03', 'bugfix', 'Apply percentage discount', 'Return the final nonnegative price after a percentage discount. Percent is between 0 and 100 inclusive.', 'export function solve(price: number, percent: number): number { return price * percent / 100; }'),
  task('bug-04', 'bugfix', 'Preserve query values', 'Build a query string with URLSearchParams. Include empty strings and zero; omit only null and undefined.', 'export function solve(values: Record<string, string | number | null | undefined>): string { const query = new URLSearchParams(); for (const [key,value] of Object.entries(values)) if (value) query.set(key, String(value)); return query.toString(); }'),
  task('bug-05', 'bugfix', 'Gregorian leap years', 'Correct leap-year detection including century and four-century exceptions.', 'export function solve(year: number): boolean { return year % 4 === 0; }'),
  task('bug-06', 'bugfix', 'Numeric median', 'Return numeric median without mutating the input. Empty input returns null.', 'export function solve(values: number[]): number | null { if (!values.length) return null; const sorted = values.sort(); return sorted[Math.floor(sorted.length / 2)]!; }'),
  task('type-01', 'type-error', 'Nullable display name', 'Fix strict types and return a trimmed display name or "Anonymous" when absent or blank.', 'export function solve(name: string | null): string { return name.trim() || "Anonymous"; }'),
  task('type-02', 'type-error', 'Discriminated response', 'Narrow the response union. Success returns the value; failure returns the negative error code.', 'type Response = { ok: true; value: number } | { ok: false; errorCode: number }; export function solve(response: Response): number { return response.value; }'),
  task('type-03', 'type-error', 'Readonly sorted view', 'Return a sorted ascending copy of a readonly array without mutating the input.', 'export function solve(values: readonly number[]): number[] { return values.sort((a, b) => a - b); }'),
  task('type-04', 'type-error', 'Complete coordinates', 'Fix coordinate output to always contain numeric x and y, defaulting missing fields to zero.', 'export function solve(value: Partial<{ x: number; y: number }>): { x: number; y: number } { return { x: value.x, y: value.y }; }'),
  task('type-05', 'type-error', 'Async result typing', 'Make the async exported function type-correct while preserving doubled numeric output.', 'export async function solve(value: number): number { return value * 2; }'),
  task('type-06', 'type-error', 'Safe dictionary lookup', 'Look up an optional dictionary entry and return a lowercase value, defaulting to "missing".', 'export function solve(values: Record<string, string | undefined>, key: string): string { return values[key].toLowerCase(); }'),
  task('reg-01', 'regression-test', 'Test inclusive bound', 'Implement regression(candidate) to return true only when a clamp candidate handles below, within and above bounds correctly. Candidate takes (value,min,max).', 'export function regression(candidate: (value: number, min: number, max: number) => number): boolean { return true; }'),
  task('reg-02', 'regression-test', 'Test zero discount', 'Implement regression(candidate) to check both a zero discount and a nonzero discount. Candidate takes price and percent and returns final price.', 'export function regression(candidate: (price: number, percent: number) => number): boolean { return true; }'),
  task('reg-03', 'regression-test', 'Test leap centuries', 'Implement regression(candidate) to check Gregorian leap-year century rules and ordinary years.', 'export function regression(candidate: (year: number) => boolean): boolean { return true; }'),
  task('reg-04', 'regression-test', 'Test empty collection', 'Implement regression(candidate) to check mean of empty and nonempty arrays. Empty mean must be null.', 'export function regression(candidate: (values: number[]) => number | null): boolean { return true; }'),
  task('reg-05', 'regression-test', 'Test numeric sort', 'Implement regression(candidate) to check numeric ascending sort and ensure the input is not mutated.', 'export function regression(candidate: (values: number[]) => number[]): boolean { return true; }'),
  task('reg-06', 'regression-test', 'Test case normalization', 'Implement regression(candidate) to check case-insensitive, whitespace-trimmed string equality including unequal strings.', 'export function regression(candidate: (left: string, right: string) => boolean): boolean { return true; }'),
  task('ref-01', 'refactor', 'Share name normalization', 'Extract and use an exported normalizeName helper for both inputs. Preserve trimmed lowercase colon-separated output.', 'export function solve(first: string, second: string): string { return first.trim().toLowerCase() + ":" + second.trim().toLowerCase(); }'),
  task('ref-02', 'refactor', 'Remove array mutation', 'Refactor to return the three smallest numbers using a copy; do not mutate input. Preserve ascending numeric order.', 'export function solve(values: number[]): number[] { values.sort((a, b) => a - b); return values.slice(0, 3); }'),
  task('ref-03', 'refactor', 'Replace recursion with iteration', 'Replace recursive factorial with an iterative implementation without self-recursion. Inputs are integers from 0 to 15.', 'export function solve(value: number): number { return value <= 1 ? 1 : value * solve(value - 1); }'),
  task('ref-04', 'refactor', 'Share valid-entry predicate', 'Extract an exported isValid helper, use it in solve, and keep only nonempty trimmed strings while preserving original nonempty values.', 'export function solve(values: string[]): string[] { return values.filter(value => value.trim().length > 0); }'),
  task('ref-05', 'refactor', 'Remove JSON cloning', 'Replace JSON serialization cloning with object copying while preserving optional undefined fields and nested profile isolation.', 'type User = { name: string; nickname?: string | undefined; profile: { active: boolean } }; export function solve(user: User): User { return JSON.parse(JSON.stringify(user)) as User; }'),
  task('ref-06', 'refactor', 'Replace repeated string assembly', 'Use an array join in solve to build slash-separated nonempty segments without changing behavior.', 'export function solve(parts: string[]): string { let result = ""; for (const part of parts) if (part) result += (result ? "/" : "") + part; return result; }'),
  task('log-01', 'log-diagnosis', 'Identify retry root cause', 'Inspect evidence.log. Implement solve() returning the exact root-cause error code, ignoring later retry noise.', 'export function solve(): string { return "unknown"; }', { 'evidence.log': '12:00 INFO connection established\n12:01 ERROR DB_CONNECTION_REFUSED\n12:02 WARN retrying attempt=1\n12:03 ERROR RETRY_EXHAUSTED\n' }),
  task('log-02', 'log-diagnosis', 'Locate failed request', 'Inspect evidence.log. Return the request ID whose first authorization failure preceded its final 500 response.', 'export function solve(): string { return "unknown"; }', { 'evidence.log': 'req=a status=200\nreq=b error=TOKEN_EXPIRED\nreq=c status=200\nreq=b status=500\n' }),
  task('log-03', 'log-diagnosis', 'Explain compiler failure', 'Inspect evidence.log. Return the source file and line causing the compile failure in the form file:line.', 'export function solve(): string { return "unknown"; }', { 'evidence.log': 'dependencies up to date\nsrc/checkout.ts(27,9): error TS2322: Type string is not assignable to number\nbuild failed\n' }),
  task('log-04', 'log-diagnosis', 'Identify failing assertion', 'Inspect evidence.log. Return the failed test full name, retaining the suite and test separator.', 'export function solve(): string { return "unknown"; }', { 'evidence.log': 'PASS cache > caches successful response\nFAIL billing > rejects negative credit\nExpected: 400\nReceived: 200\nTests: 1 passed, 1 failed\n' }),
  task('log-05', 'log-diagnosis', 'Distinguish warning from crash', 'Inspect evidence.log. Return the fatal error code, not the earlier warning code.', 'export function solve(): string { return "unknown"; }', { 'evidence.log': 'WARN DEPRECATED_OPTION\nINFO startup complete\nERROR DISK_QUOTA_EXCEEDED\nFATAL WRITE_FAILED\n' }),
  task('log-06', 'log-diagnosis', 'Recover incident count', 'Inspect evidence.log. Return the total number of failed requests. The repeated-line marker gives total occurrences, not additional occurrences.', 'export function solve(): number { return 0; }', { 'evidence.log': 'request failed: status=503\n[exact repeated line: 7 occurrences; order unchanged]\nrequest succeeded: status=200\nrequest failed: status=504\n' }),
];

/** This is the entire agent-visible task context; hidden evaluator code is intentionally absent. */
export function getTaskContext(id: string): PilotTask {
  const found = pilotTasks.find(item => item.id === id);
  if (!found) throw new Error(`Unknown pilot task: ${id}`);
  return structuredClone(found);
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reducers, validateEvidence, type ReducerFormat, type ReductionInput } from './index.js';

const fixture = (name: string): string => readFileSync(new URL(`../../../tests/fixtures/reducers/${name}`, import.meta.url), 'utf8');
/** Parses and reduces with one reducer; `validate` stays bound to that parse, as reduceOutput uses it. */
function prepared(id: ReducerFormat, input: ReductionInput) {
  const reducer = reducers.find(item => item.id === id)!;
  const parsed = reducer.parse(input);
  if (!parsed) throw new Error(`${id} did not recognize its fixture`);
  const output = reducer.reduce(parsed, input);
  expect(reducer.validatePreservation(parsed, output).valid).toBe(true);
  expect(output).not.toBe(input.text);
  return { output, lines: output.split('\n'), validate: (candidate: string) => reducer.validatePreservation(parsed, candidate) };
}
const move = <T>(items: readonly T[], from: number, to: number): T[] => { const copy = [...items]; const [item] = copy.splice(from, 1); copy.splice(to, 0, item!); return copy; };

describe('ordered evidence validation', () => {
  const evidence = ['FAIL auth.test.ts', '', 'Expected: 401', '  ', 'Received: 200', 'Expected: 401', 'at auth.test.ts:42:19'];

  it('accepts evidence in its original order with added summary lines', () => {
    expect(validateEvidence(evidence, ['2 successful test/suite lines grouped.', ...evidence].join('\n')).valid).toBe(true);
    expect(validateEvidence(evidence, evidence.join('\n') + '\n').valid).toBe(true);
  });

  it.each([
    ['alphabetically sorted', [...evidence].sort()],
    ['first occurrence only', evidence.filter((line, index) => evidence.indexOf(line) === index)],
    ['whitespace-only lines removed', evidence.filter(line => line.trim())],
    ['location moved before the failure', move(evidence, 6, 0)],
    ['two lines merged', [...evidence.slice(0, 4), 'Received: 200 Expected: 401', evidence[6]!]],
  ])('rejects %s output', (_name, lines) => {
    const result = validateEvidence(evidence, lines.join('\n'));
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('limits added lines to declared additions, each at most once', () => {
    expect(validateEvidence(['a', 'b'], 'label\na\nb', { allowedAdditions: ['label'] }).valid).toBe(true);
    expect(validateEvidence(['a', 'b'], 'label\na\nlabel\nb', { allowedAdditions: ['label'] }).valid).toBe(false);
    const forged = validateEvidence(['a', 'b'], 'a\nTests: all passed\nb', { allowedAdditions: ['label'] });
    expect(forged).toMatchObject({ valid: false, unexpected: ['Tests: all passed'] });
  });

  it('enforces the original line terminator and trailing newline when they are given', () => {
    expect(validateEvidence(['a', 'b'], 'a\r\nb\r\n', { eol: '\r\n', trailingNewline: true }).valid).toBe(true);
    expect(validateEvidence(['a', 'b'], 'a\nb\n', { eol: '\r\n', trailingNewline: true }).valid).toBe(false);
    expect(validateEvidence(['a', 'b'], 'a\r\nb', { eol: '\r\n', trailingNewline: true }).valid).toBe(false);
  });

  it('bounds the reported samples for very large outputs', () => {
    const lines = Array.from({ length: 5000 }, (_, index) => `line ${index}`);
    const result = validateEvidence(lines, '', { allowedAdditions: [] });
    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(21);
    expect(result.missing.at(-1)).toBe('[+4980 more]');
  });
});

describe('controlled fault injection against real reducer candidates', () => {
  const balanced = (text: string, artifactId = 'fault:injection'): ReductionInput => ({ text, exitCode: 1, mode: 'balanced', artifactId });

  it('rejects sorted, relocated, forged and miscounted test output', () => {
    const { lines, validate } = prepared('vitest', balanced(fixture('vitest-3.2-failure.txt')));
    expect(validate([...lines].sort().join('\n')).valid).toBe(false);
    const location = lines.findIndex(line => line.includes('tests/auth.test.ts:42:19'));
    expect(validate(move(lines, location, 1).join('\n')).valid).toBe(false);
    expect(validate([...lines, 'Tests all passed'].join('\n')).valid).toBe(false);
    expect(lines[0]).toBe('5 successful test/suite lines grouped.');
    expect(validate(['4 successful test/suite lines grouped.', ...lines.slice(1)].join('\n')).valid).toBe(false);
  });

  it('rejects first-occurrence-only output when failures repeat identical lines', () => {
    const failure = (name: string) => `FAIL tests/${name}.test.ts\n  ● ${name} rejects reuse\n    Expected: 401\n    Received: 200\n      at tests/${name}.test.ts:9:3`;
    const text = ['PASS tests/a.test.ts', 'PASS tests/b.test.ts', failure('refresh'), failure('session'), 'Tests: 2 failed, 2 passed, 4 total'].join('\n');
    const { lines, validate } = prepared('jest', balanced(text));
    const deduplicated = lines.filter((line, index) => lines.indexOf(line) === index);
    expect(deduplicated.length).toBeLessThan(lines.length);
    expect(validate(deduplicated.join('\n')).valid).toBe(false);
  });

  it('rejects merged compiler diagnostics', () => {
    const { lines, validate } = prepared('tsc', balanced(fixture('tsc-5.9.txt')));
    const first = lines.findIndex(line => line.includes('TS2322'));
    const second = lines.findIndex(line => line.includes('TS2345'));
    const merged = lines.filter((_line, index) => index !== second).map((line, index) => index === first ? `${line} ${lines[second]}` : line);
    expect(validate(merged.join('\n')).valid).toBe(false);
  });

  it('rejects dropped whitespace-only diff lines, duplicate labels and reordered files', () => {
    const { lines, validate } = prepared('git-diff', balanced(fixture('git-diff-mixed.txt')));
    expect(validate(lines.filter(line => line !== ' ').join('\n')).valid).toBe(false);
    expect(validate([lines[0]!, ...lines].join('\n')).valid).toBe(false);
    const secondFile = lines.findIndex((line, index) => index > 1 && line.startsWith('diff --git'));
    expect(validate([lines[0]!, ...lines.slice(secondFile), ...lines.slice(1, secondFile)].join('\n')).valid).toBe(false);
  });

  it('rejects reordered or dropped git status entries', () => {
    const { lines, validate } = prepared('git-status', balanced(fixture('git-status-long.txt')));
    const modified = lines.findIndex(line => line.includes('modified:'));
    expect(validate(move(lines, modified, modified + 1).join('\n')).valid).toBe(false);
    expect(validate(lines.filter(line => !line.includes('deleted:')).join('\n')).valid).toBe(false);
  });

  it('rejects search output regrouped across a different path', () => {
    const text = ['src/a.ts:1:1:first', 'src/a.ts:2:1:second', 'src/other.ts:7:3:between', 'src/a.ts:9:1:after'].join('\n');
    const { validate } = prepared('search', balanced(text));
    expect(validate('src/a.ts\n  1:1:first\n  2:1:second\n  9:1:after\nsrc/other.ts:7:3:between').valid).toBe(false);
  });

  it('rejects a reduced CRLF candidate whose terminators were normalized', () => {
    const text = fixture('tsc-5.9.txt').replaceAll('\n', '\r\n');
    const { output, validate } = prepared('tsc', balanced(text));
    expect(output.replaceAll('\r\n', '')).not.toContain('\n');
    expect(validate(output.replaceAll('\r\n', '\n')).valid).toBe(false);
  });
});

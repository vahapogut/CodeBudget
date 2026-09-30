import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIFF_EVIDENCE_LABEL, EVIDENCE_MARKER, reduceOutput, reducers, type ReductionInput } from './index.js';

const fixture = (name: string): string => readFileSync(new URL(`../../../tests/fixtures/reducers/${name}`, import.meta.url), 'utf8');
const balanced = (text: string, extra: Partial<ReductionInput> = {}) => reduceOutput({ text, exitCode: 1, mode: 'balanced', artifactId: 'repo:session:artifact', ...extra });
const count = (text: string, line: string): number => text.split('\n').filter(item => item.replace(/\r$/, '') === line).length;
const pythonSource = Array.from({ length: 120 }, (_, index) => index % 4 === 0 ? '' : index % 4 === 1 ? `def step_${index}(value):` : `   return value + ${index}`).join('\n') + '\n';

describe('strict, diff-first format detection', () => {
  it.each([
    ['Python traceback', 'Traceback (most recent call last):\n   File "app.py", line 3, in <module>\n     main()\nValueError: bad value\n\n\nDone\n'],
    ['YAML literal block', 'job:\n   script: |\n      echo one\n\n      echo two\n   when: always\n'],
    ['numbered list', 'Steps:\n1 install dependencies\n2 run tests\n\n\n3 deploy\n'],
    ['pytest output', 'collected 2 items\n\ntest_a.py .F                                                            [100%]\n\n=================================== FAILURES ===================================\n    def test_b():\n>       assert 1 == 2\nE       assert 1 == 2\n\ntest_a.py:5: AssertionError\n'],
    ['Python source with three-space indentation', pythonSource],
    ['space-indented text that only resembles git status', 'On branch main\n\n\nChanges not staged for commit:\n\n\n modified: src/a.ts\n deleted: src/b.ts\n\n'],
  ])('%s is not git status and keeps every line', (_name, text) => {
    const result = balanced(text);
    expect(result.reducerId).not.toBe('git-status');
    expect(result.output).toBe(text);
  });

  it('recognizes real long-format git status and removes only blank and hint lines', () => {
    const text = fixture('git-status-long.txt');
    const result = balanced(text);
    expect(result).toMatchObject({ reducerId: 'git-status', applied: true, preservation: { valid: true } });
    const kept = text.split('\n').filter(line => line !== '' && !line.startsWith('  ('));
    expect(result.output).toBe(kept.join('\n') + '\n');
    expect(result.output).toContain('\trenamed:    src/old-name.ts -> src/new-name.ts');
  });

  it.each(['git-status-porcelain-v1.txt', 'git-status-porcelain-v2.txt', 'git-status-2.50.txt'])('recognizes %s without a format hint', name => {
    const text = fixture(name);
    const result = balanced(text);
    expect(result.reducerId).toBe('git-status');
    expect(result.preservation.valid).toBe(true);
    if (!name.includes('porcelain')) expect(result.applied).toBe(true);
    else expect({ reason: result.reason, output: result.output }).toEqual({ reason: 'no_gain', output: text });
  });

  it('routes a git diff containing compiler and test-runner lines to the diff reducer', () => {
    const text = fixture('git-diff-mixed.txt');
    const result = balanced(text);
    expect(result).toMatchObject({ reducerId: 'git-diff', applied: true, preservation: { valid: true } });
    expect(result.output.startsWith(`${DIFF_EVIDENCE_LABEL}\n`)).toBe(true);
    expect(count(result.output, ' ')).toBe(count(text, ' '));
    expect(count(text, ' ')).toBe(9);
    // Restoring the omitted index lines reproduces the original patch byte for byte.
    const index = text.split('\n').filter(line => line.startsWith('index '));
    const restored = result.output.split('\n').slice(1).flatMap(line => line.startsWith('diff --git ') ? [line, index.shift()!] : [line]);
    expect(restored.join('\n')).toBe(text);
  });

  it.each([['combined', 'git-diff-combined.txt'], ['unified', 'unified-diff.txt']])('treats a %s diff as a diff and keeps whitespace-only lines', (_kind, name) => {
    const text = fixture(name);
    const result = balanced(text);
    expect(result.reducerId).toBe('git-diff');
    expect(result.output).toBe(text);
    expect(count(result.output, ' ') + count(result.output, '  ')).toBeGreaterThan(0);
  });

  it.each(['tsc', 'vitest', 'jest', 'git-status', 'logs', 'search'] as const)('ignores a %s format hint on diff-shaped text', format => {
    const text = fixture('git-diff-mixed.txt');
    const result = balanced(text, { format });
    expect(result.reason).toBe('unknown_format');
    expect(result.output).toBe(text);
  });

  it('detects indented JSON before any line grammar', () => {
    const text = JSON.stringify({ status: 'failed', entries: Array.from({ length: 5 }, (_, id) => ({ id, valid: false })) }, null, 4);
    const result = balanced(text);
    expect(result).toMatchObject({ reducerId: 'json', applied: true });
    expect(JSON.parse(result.output)).toEqual(JSON.parse(text));
  });

  it.each([
    ['docker compose', ['api-1  | 2026-09-29T12:00:01.100Z GET /health 200', 'api-1  | 2026-09-29T12:00:01.180Z GET /users 200', 'db-1   | 2026-09-29T12:00:02.000Z checkpoint starting', 'api-1  | 2026-09-29T12:00:02.050Z GET /orders 500']],
    ['Python logging', ['2026-09-29 12:59:58,120 INFO worker started', '2026-09-29 12:59:59,001 WARNING slow response', '2026-09-29 13:00:00,500 ERROR request failed']],
    ['ISO timestamps', ['2026-09-29T12:00:00Z INFO begin', '2026-09-29T12:00:01Z WARN retry', '2026-09-29T12:01:00Z ERROR gave up']],
    ['clock prefixes', ['12:00:01 INFO begin', '12:00:02 WARN retry', '12:01:00 ERROR gave up']],
  ])('keeps %s logs in order and out of the search grammar', (_name, lines) => {
    const text = lines.join('\n') + '\n';
    const result = balanced(text);
    expect(result.reducerId).not.toBe('search');
    expect(result.output).toBe(text);
    expect(reducers.find(item => item.id === 'search')!.parse({ text, exitCode: 0, format: 'search' })).toBeNull();
  });

  it('groups only contiguous search runs, so the global order is reconstructible', () => {
    const text = ['src/auth/refresh.ts:1:1:first', 'src/auth/refresh.ts:2:1:second', 'src/other.ts:7:3:between', 'src/auth/refresh.ts:9:1:after', 'src/auth/refresh.ts:12:4:last'].join('\n');
    const result = balanced(text);
    expect(result).toMatchObject({ reducerId: 'search', applied: true, preservation: { valid: true } });
    expect(result.output).toBe('src/auth/refresh.ts\n  1:1:first\n  2:1:second\nsrc/other.ts:7:3:between\nsrc/auth/refresh.ts\n  9:1:after\n  12:4:last');
  });

  it('requires positive line numbers and a plausible path for search results', () => {
    for (const text of ['12:00:01:message\n12:00:02:other', 'a.ts:0:zero\na.ts:0:again', 'my file.ts:1:a\nmy file.ts:2:b']) {
      expect(balanced(text).reducerId).not.toBe('search');
    }
  });
});

describe('test output fidelity', () => {
  const vitestRun = (lines: string[]) => [' RUN  v5.0.2 /project', '', ...lines, '', ' Test Files  1 failed | 6 passed (7)', '      Tests  1 failed | 30 passed | 3 skipped | 1 todo (35)'].join('\n');

  it('keeps blank lines that belong to expected/received values', () => {
    const diff = ['- Expected', '+ Received', '', '  Invoice 2026-0042', '', '  Line item: consulting', '', '-', '  Line item: travel'];
    const text = vitestRun([' ✓ a.test.ts (4 tests) 3ms', ' ✓ b.test.ts (5 tests) 4ms', ' ❯ z.test.ts (1 test | 1 failed) 9ms', '   × renders 9ms', '', ' FAIL  z.test.ts > renders', 'AssertionError: expected strings to match', '', ...diff, '', ' ❯ z.test.ts:3:9']);
    const result = balanced(text);
    expect(result).toMatchObject({ reducerId: 'vitest', applied: true, preservation: { valid: true } });
    expect(result.output).toContain(diff.join('\n'));
    expect(count(result.output, '')).toBe(count(text, ''));
    expect(result.output).not.toContain('a.test.ts (4 tests)');
  });

  it('never groups pass lines carrying skipped, todo, retry, repeat or flaky annotations', () => {
    const annotated = [' ✓ c.test.ts (10 tests | 3 skipped) 12ms', ' ✓ d.test.ts (4 tests | 1 todo) 3ms', '   ✓ refresh token 5ms (retry x2)', '   ✓ session cache 4ms (repeat x3)', '   ✓ flaky network probe 7ms'];
    const text = vitestRun([' ✓ a.test.ts (4 tests) 3ms', ' ✓ b.test.ts (5 tests) 4ms', ...annotated, ' × z.test.ts > renders 9ms']);
    const result = balanced(text);
    expect(result.applied).toBe(true);
    expect(result.output.startsWith('2 successful test/suite lines grouped.')).toBe(true);
    for (const line of annotated) expect(result.output).toContain(line);
  });
});

describe('markers, line endings and artifact placeholders', () => {
  it('treats the Claude hook evidence marker as already reduced', () => {
    const reduced = balanced(fixture('vitest-3.2-failure.txt'));
    const hooked = `${reduced.output}\n${EVIDENCE_MARKER} 00000000-0000-4000-8000-000000000000; retrieve with read_evidence; reducer ${reduced.reducerId}@${reduced.reducerVersion}]`;
    const again = balanced(hooked);
    expect(again).toMatchObject({ reason: 'already_reduced', applied: false, output: hooked });
  });

  it('reports CRLF and final-newline normalization as no gain', () => {
    const tscActual = "type-failure.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.\r\ntype-failure.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'.\r\n";
    for (const format of [undefined, 'tsc'] as const) expect(balanced(tscActual, { format })).toMatchObject({ reducerId: 'tsc', reason: 'no_gain', output: tscActual, originalSize: 176, reducedSize: 176 });
    const compactJson = '{"status":"failed","line":42}\r\n';
    expect(balanced(compactJson)).toMatchObject({ reducerId: 'json', reason: 'no_gain', output: compactJson });
  });

  it('keeps the input CRLF style and trailing newline when a reduction applies', () => {
    for (const name of ['tsc-5.9.txt', 'vitest-3.2-failure.txt', 'git-status-long.txt', 'logs.txt']) {
      const text = fixture(name).replaceAll('\n', '\r\n');
      const result = balanced(text);
      expect(result.applied, name).toBe(true);
      expect(result.output.replaceAll('\r\n', ''), name).not.toContain('\n');
      expect(result.output.endsWith('\r\n'), name).toBe(text.endsWith('\r\n'));
    }
  });

  it('produces byte-identical diff evidence for a placeholder and a real artifact ID', () => {
    const text = fixture('git-diff-mixed.txt');
    const placeholder = balanced(text, { artifactId: '00000000-0000-4000-8000-000000000000' });
    const real = balanced(text, { artifactId: 'c0ffee00-1234-4abc-8def-0123456789ab' });
    const longer = balanced(text, { artifactId: 'repository:session:an-unusually-long-artifact-identifier' });
    expect(placeholder.applied).toBe(true);
    expect(real.output).toBe(placeholder.output);
    expect(longer.output).toBe(placeholder.output);
    expect(placeholder.reducedSize).toBe(Buffer.byteLength(placeholder.output));
    expect(balanced(text, { artifactId: '00000000-0000-4000-8000-000000000000' })).toEqual(placeholder);
  });

  it('explains that diff reduction needs an archived original instead of claiming no gain', () => {
    const text = fixture('git-diff-mixed.txt');
    const result = reduceOutput({ text, exitCode: 0, mode: 'balanced' });
    expect(result).toMatchObject({ reducerId: 'git-diff', reason: 'artifact_required', applied: false, output: text, reducedSize: result.originalSize });
  });
});

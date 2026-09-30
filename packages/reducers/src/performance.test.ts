import { describe, expect, it } from 'vitest';
import { reduceOutput, validateEvidence } from './index.js';

// Robust on a loaded machine: warm up, interleave the n and 4n runs so both see the same load, keep the fastest
// of five, floor the denominator at 25 ms and compare growth (linear is about 4x, quadratic about 16x). On a fast
// machine the n run can fall near a 10 ms floor while garbage collection lengthens the 4n run; a quadratic
// implementation already takes seconds for the n run, so the higher floor keeps the check discriminating.
// Absolute caps stay far above the tens of milliseconds these inputs take.
const elapsed = (run: () => unknown): number => { const start = performance.now(); run(); return performance.now() - start; };
const fastest = (run: () => unknown, repeats = 3): number => Math.min(...Array.from({ length: repeats }, () => elapsed(run)));
function growth(run: (text: string) => unknown, make: (size: number) => string, small: number): { largeMs: number; ratio: number } {
  const [smallText, largeText] = [make(small), make(small * 4)];
  run(smallText); run(largeText);
  let [smallMs, largeMs] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  for (let round = 0; round < 5; round += 1) { smallMs = Math.min(smallMs, elapsed(() => run(smallText))); largeMs = Math.min(largeMs, elapsed(() => run(largeText))); }
  return { largeMs, ratio: largeMs / Math.max(smallMs, 25) };
}
const reduce = (text: string) => reduceOutput({ text, exitCode: 1, mode: 'balanced', artifactId: 'performance:fixture' });
const lines = (count: number, line: (index: number) => string): string => Array.from({ length: count }, (_, index) => line(index)).join('\n') + '\n';

describe('near-linear reduction on large outputs', () => {
  const shapes: [string, (count: number) => string][] = [
    ['TypeScript diagnostics with code frames', count => lines(count, index => index % 4 === 0 ? `src/module${index}.ts(${index + 1},5): error TS2322: Type 'string' is not assignable to type 'number'.` : index % 4 === 1 ? '' : index % 4 === 2 ? `  ${index + 1} const value: number = name;` : '           ~~~~~')],
    ['Vitest passing files and one failure', count => ' RUN  v5.0.2 /project\n' + lines(count, index => ` ✓ tests/case-${index}.test.ts (4 tests) 20ms`) + ' FAIL  tests/z.test.ts > fails\nAssertionError: expected 1 to be 2\n Tests  1 failed | 4 passed\n'],
    ['Jest passing suites and one failure', count => lines(count, index => `PASS tests/suite-${index}.test.ts`) + 'FAIL tests/z.test.ts\n  ● fails\n    Expected: 2\n    Received: 1\nTests: 1 failed, 4 passed, 5 total\n'],
    ['ripgrep results over many paths', count => lines(count, index => `packages/service-${Math.floor(index / 25)}/src/refresh-token.ts:${index + 1}:7:const token${index} = issue();`)],
    ['repeated log lines', count => lines(count, index => index % 50 === 0 ? `2026-09-29T12:00:${String(index % 60).padStart(2, '0')}Z ERROR request ${index} failed` : 'INFO queue poll returned zero pending work items for tenant alpha')],
    ['multi-file git diff', count => lines(count, index => [`diff --git a/src/f${index}.ts b/src/f${index}.ts`, `index ${(1000000 + index).toString(16)}..${(2000000 + index).toString(16)} 100644`, `--- a/src/f${index}.ts`, `+++ b/src/f${index}.ts`, '@@ -1,2 +1,2 @@', ' ', `-export const value${index} = 1;`, `+export const value${index} = 2;`][index % 8]!)],
    ['long-format git status', count => 'On branch main\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n' + lines(count, index => `\tmodified:   src/generated/file-${index}.ts`) + '\nno changes added to commit (use "git add" and/or "git commit -a")\n'],
    ['pretty-printed JSON', count => JSON.stringify(Array.from({ length: Math.ceil(count / 4) }, (_, id) => ({ id, status: 'failed', path: `src/f${id}.ts` })), null, 2)],
    ['timestamped service logs', count => lines(count, index => `api-1  | 2026-09-29T12:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.100Z GET /orders/${index} 200`)],
    ['ESLint stylish output', count => '/repo/src/auth.ts\n' + lines(count, index => `  ${index + 1}:7  error  'token${index}' is assigned a value but never used  no-unused-vars`) + '\n✖ 1 problem (1 error, 0 warnings)\n'],
    ['unrecognized source text', count => lines(count, index => index % 5 === 0 ? '' : `   return compute(${index}) + ${'x'.repeat(40)};`)],
  ];

  it.each(shapes)('%s: 50,000 lines reduce well under 3 s with near-linear growth', (_name, make) => {
    const { largeMs, ratio } = growth(reduce, make, 12_500);
    expect(largeMs).toBeLessThan(1_500);
    expect(ratio).toBeLessThan(10);
  }, 120_000);

  it('validates 50,000 ordered evidence lines in linear time', () => {
    const evidence = new Map<string, string[]>();
    const make = (count: number) => { const items = Array.from({ length: count }, (_, index) => `${index} ${'x'.repeat(70)}`); const text = items.join('\n'); evidence.set(text, items); return text; };
    const validate = (text: string) => validateEvidence(evidence.get(text)!, text);
    const { largeMs, ratio } = growth(validate, make, 12_500);
    expect([...evidence].every(([text]) => validate(text).valid)).toBe(true);
    expect(largeMs).toBeLessThan(1_000);
    expect(ratio).toBeLessThan(10);
  }, 60_000);

  it('reduces a 3.5 MB command output and a 15,000-line compiler run twice (as the hook does) quickly', () => {
    const numbered = lines(50_000, index => `${index} ${'x'.repeat(70)}`);
    expect(Buffer.byteLength(numbered)).toBeGreaterThan(3_500_000);
    expect(fastest(() => reduce(numbered), 1)).toBeLessThan(1_500);
    const compiler = lines(15_000, index => `src/module${index}.ts(${index + 1},5): error TS2322: Type 'string' is not assignable to type 'number'.`);
    expect(fastest(() => { reduceOutput({ text: compiler, exitCode: 2, mode: 'balanced', consumer: 'agent', artifactId: '00000000-0000-4000-8000-000000000000' }); reduce(compiler); }, 1)).toBeLessThan(1_500);
  }, 60_000);
});

describe('regular expressions stay bounded on adversarial input', () => {
  const adversarial: [string, (size: number) => string][] = [
    ['blank lines before a bare PASS token', size => '\n'.repeat(size) + 'PASS'],
    ['one long digit run', size => '1'.repeat(size)],
    ['digit runs separated by colons', size => ('1'.repeat(997) + ':').repeat(Math.ceil(size / 998))],
    ['whitespace after a compiler location', size => 'a.ts(1,2)' + ' '.repeat(size) + 'x'],
    ['an endless pass-line candidate', size => ' RUN  v5.0.2\n ✓ ' + 'x '.repeat(size / 2) + '\n Tests 1 passed'],
    ['tab-indented pseudo status entries', size => 'On branch main\n' + '\t'.repeat(size)],
    ['an unterminated JSON prefix', size => '[' + '{"a":'.repeat(Math.ceil(size / 5))],
    ['a service prefix without a timestamp', size => 'api-1 | ' + '1'.repeat(size)],
  ];

  it.each(adversarial)('%s', (_name, make) => {
    const { largeMs, ratio } = growth(reduce, make, 30_000);
    expect(largeMs).toBeLessThan(1_000);
    expect(ratio).toBeLessThan(10);
  }, 60_000);

  it('handles 80,000 blank lines and 120 KB of digits in observe mode as the hook does', () => {
    for (const text of ['\n'.repeat(80_000) + 'x', '1'.repeat(120_000)]) {
      expect(fastest(() => reduceOutput({ text, exitCode: 0, mode: 'observe', consumer: 'agent', artifactId: '00000000-0000-4000-8000-000000000000' }), 1)).toBeLessThan(1_000);
    }
  }, 30_000);
});

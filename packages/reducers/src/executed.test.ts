import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reduceOutput, type ReducerFormat } from './index.js';

interface Capture { id: string; format: ReducerFormat; filename: string; stderrFilename: string; toolVersion: string; args: string[]; exitCode: number; inputs: { path: string; sha256: string; bytes: number }[]; stdoutBytes: number; stderrBytes: number; }
const directory = new URL('../../../tests/fixtures/reducers/executed/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as { generator: string; stdoutStderrSeparate: boolean; captures: Capture[] };
const read = (name: string): string => readFileSync(new URL(name, directory), 'utf8');
const emptyLines = (text: string): number => text.split('\n').filter(line => line === '').length;
// The value diff printed by both runners: from the "- Expected" header to the last value line.
const valueDiff = (text: string): string => {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line.trim().startsWith('- Expected'));
  const end = lines.findIndex(line => line.trim() === 'Total due in thirty days');
  return lines.slice(start, end + 1).join('\n');
};

describe('actually executed test-runner captures with blank-line values', () => {
  it('keeps executed-command provenance for each capture', () => {
    expect(manifest.generator).toBe('packages/benchmarks/scripts/capture-test-runner-fixtures.ts');
    expect(manifest.stdoutStderrSeparate).toBe(true);
    expect(manifest.captures.map(capture => [capture.id, capture.format, capture.toolVersion])).toEqual([['vitest-5-blank-line-diff', 'vitest', '5.0.2'], ['vitest-5-verbose-blank-line-diff', 'vitest', '5.0.2'], ['jest-30-blank-line-diff', 'jest', '30.5.2']]);
    for (const capture of manifest.captures) {
      expect(Buffer.byteLength(read(capture.filename))).toBe(capture.stdoutBytes);
      expect(Buffer.byteLength(read(capture.stderrFilename))).toBe(capture.stderrBytes);
      expect(capture.inputs.length).toBeGreaterThan(0);
      expect(capture.exitCode).toBe(1);
    }
  });

  it.each(manifest.captures)('$id keeps every blank line of the expected/received values', capture => {
    const text = read(capture.filename) + read(capture.stderrFilename);
    const diff = valueDiff(text);
    expect(diff.split('\n').filter(line => line === '').length).toBeGreaterThanOrEqual(4);
    const result = reduceOutput({ text, exitCode: capture.exitCode, mode: 'balanced', artifactId: 'executed:capture' });
    expect(result.reducerId).toBe(capture.format);
    expect(result.preservation.valid).toBe(true);
    expect(result.output).toContain(diff);
    expect(emptyLines(result.output)).toBe(emptyLines(text));
    expect(result.status).toBe('failure');
  });

  it('groups verbose passing test lines while keeping the skipped and failed results', () => {
    const capture = manifest.captures.find(item => item.id === 'vitest-5-verbose-blank-line-diff')!;
    const text = read(capture.filename) + read(capture.stderrFilename);
    const result = reduceOutput({ text, exitCode: 1, mode: 'balanced', artifactId: 'executed:capture' });
    expect(result.applied).toBe(true);
    expect(result.output.split('\n')[0]).toBe('6 successful test/suite lines grouped.');
    expect(result.output).not.toContain('a-success-0.test.ts > successful case 0');
    for (const kept of ['↓ b-skipped.test.ts > is skipped', '× z-render.test.ts > renders the invoice with paragraph breaks', '1 skipped', 'z-render.test.ts:3:185']) expect(result.output).toContain(kept);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reduceOutput, reducers, type ReducerFormat } from './index.js';

interface Capture { id: string; format: ReducerFormat; filename: string; stderrFilename: string; toolVersion: string; exitCode: number; expectedEvidence: string[]; }
const directory = new URL('../../../tests/fixtures/reducers/captured/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as { stdoutStderrSeparate: boolean; captures: Capture[] };

describe('actual captured local tool output', () => {
  it('covers every supported reducer family with executed-command provenance', () => {
    expect(new Set(manifest.captures.map(capture => capture.format))).toEqual(new Set(['vitest', 'jest', 'tsc', 'eslint', 'git-status', 'git-diff', 'search', 'json', 'logs']));
    expect(manifest.captures).toHaveLength(9);
  });

  it.each(manifest.captures)('$id preserves all captured failure/status/location evidence', capture => {
    // Streams stay separate on disk. The reducer gets both streams in a documented replay concatenation.
    const stdout = readFileSync(new URL(capture.filename, directory), 'utf8');
    const stderr = readFileSync(new URL(capture.stderrFilename, directory), 'utf8');
    const text = stdout + stderr;
    const input = { text, exitCode: capture.exitCode, format: capture.format, artifactId: 'capture:retained', mode: 'balanced' as const };
    const result = reduceOutput(input);
    expect(manifest.stdoutStderrSeparate).toBe(true);
    expect(capture.toolVersion).toBeTruthy();
    expect(result.reducerId).toBe(capture.format);
    expect(result.exitCode).toBe(capture.exitCode);
    expect(result.status).toBe(capture.exitCode === 0 ? 'success' : 'failure');
    expect(result.preservation.valid).toBe(true);
    expect(result.reducedSize).toBeLessThanOrEqual(result.originalSize);
    for (const evidence of capture.expectedEvidence) expect(result.output).toContain(evidence);
    expect(reduceOutput(input)).toEqual(result);
    const reducer = reducers.find(item => item.id === capture.format)!;
    const parsed = reducer.parse(input)!;
    expect(reducer.validatePreservation(parsed, '').valid).toBe(false);
  });

  it.each([
    ['jest-actual', 'Expected: 401', 'Expected: 402'],
    ['json-actual', '"actual":200', '"actual":201'],
    ['logs-actual', '8 occurrences', '7 occurrences'],
  ])('rejects evidence mutation in %s rather than only empty output', (id, original, mutation) => {
    const capture = manifest.captures.find(item => item.id === id)!;
    const text = readFileSync(new URL(capture.filename, directory), 'utf8') + readFileSync(new URL(capture.stderrFilename, directory), 'utf8');
    const input = { text, exitCode: capture.exitCode, format: capture.format, artifactId: 'capture:retained', mode: 'balanced' as const };
    const result = reduceOutput(input);
    const changed = result.output.replaceAll(original!, mutation!);
    expect(changed).not.toBe(result.output);
    const reducer = reducers.find(item => item.id === capture.format)!;
    expect(reducer.validatePreservation(reducer.parse(input)!, changed).valid).toBe(false);
  });
});

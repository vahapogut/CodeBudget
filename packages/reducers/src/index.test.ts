import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reduceOutput, reducers, validateEvidence, type ReducerFormat } from './index.js';

const fixture = (name: string): string => readFileSync(new URL(`../../../tests/fixtures/reducers/${name}`, import.meta.url), 'utf8');

describe('conservative output reducers', () => {
  it.each<[string, ReducerFormat]>([
    ['vitest-3.2-failure.txt', 'vitest'], ['jest-29.7-failure.txt', 'jest'], ['tsc-5.9.txt', 'tsc'],
    ['eslint-9.json', 'eslint'], ['git-status-2.50.txt', 'git-status'], ['search-rg-14.txt', 'search'],
    ['json-response.json', 'json'], ['logs.txt', 'logs'],
  ])('recognizes and safely reduces %s', (name, format) => {
    const input = { text: fixture(name), exitCode: 1, artifactId: 'repo:session:artifact', mode: 'balanced' as const, format };
    const result = reduceOutput(input);
    expect(result.reducerId).toBe(format);
    expect(result.status).toBe('failure');
    expect(result.applied).toBe(true);
    expect(result.preservation.valid).toBe(true);
    expect(result.reducedSize).toBeLessThan(result.originalSize);
    expect(result.originalSize).toBe(Buffer.byteLength(input.text));
    expect(reduceOutput(input)).toEqual(result);
    expect(reduceOutput({ ...input, text: result.output, alreadyReduced: true }).output).toBe(result.output);
  });

  it('retains failure names, locations, values and skipped/cancelled counts', () => {
    const result = reduceOutput({ text: fixture('vitest-3.2-failure.txt'), exitCode: 7, mode: 'balanced', truncated: true });
    for (const evidence of ['rejects reused refresh token', 'Expected: 401', 'Received: 200', 'tests/auth.test.ts:42:19', 'src/auth.ts:89:7', '2 skipped', '1 cancelled']) expect(result.output).toContain(evidence);
    expect(result.exitCode).toBe(7);
    expect(result.truncated).toBe(true);
    expect(result.diagnostics.some(item => item.message.includes('incomplete'))).toBe(true);
  });

  it('preserves structured test reports including all assertion details', () => {
    const text = JSON.stringify({ numTotalTests: 2, numFailedTests: 1, numPendingTests: 1, testResults: [{ name: 'auth.ts', status: 'failed', assertionResults: [{ fullName: 'refresh rejects reuse', status: 'failed', failureMessages: ['Expected 401; Received 200; auth.ts:42'] }] }] }, null, 2);
    for (const format of ['vitest', 'jest'] as const) {
      const result = reduceOutput({ text, exitCode: 1, format, mode: 'balanced' });
      expect(JSON.parse(result.output)).toEqual(JSON.parse(text));
      expect(result.applied).toBe(true);
    }
  });

  it('never changes JSON large integer lexemes, -0, duplicate keys or whitespace in strings', () => {
    const text = String.raw`{ "id": 90071992547409931234, "id": -0, "escaped": "a \" b", "space": " a  b " }`;
    const result = reduceOutput({ text, exitCode: 0, mode: 'balanced' });
    expect(result.output).toBe(String.raw`{"id":90071992547409931234,"id":-0,"escaped":"a \" b","space":" a  b "}`);
  });

  it('defaults to observe and separates candidate gain from applied gain', () => {
    const text = fixture('logs.txt');
    const result = reduceOutput({ text, exitCode: null });
    expect(result.output).toBe(text);
    expect(result.status).toBe('unknown');
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('observe_only');
    expect(result.originalSize).toBe(result.reducedSize);
  });

  it('preserves unknown content, explicit unknown hints and machine-consumed JSON', () => {
    for (const input of [{ text: fixture('unknown.txt') }, { text: fixture('logs.txt'), format: 'unknown' as const }, { text: fixture('json-response.json'), consumer: 'machine' as const }]) {
      const result = reduceOutput({ ...input, exitCode: 0, mode: 'balanced' });
      expect(result.output).toBe(input.text);
      expect(result.applied).toBe(false);
    }
  });

  it('does not trust an explicit format hint for invalid text', () => {
    const result = reduceOutput({ text: 'future format; failure details', exitCode: 1, format: 'vitest', mode: 'balanced' });
    expect(result.reason).toBe('unknown_format');
    expect(result.output).toBe('future format; failure details');
  });

  it('does not mistake successful-looking lines inside a failure for success lines', () => {
    const text = ' RUN v3\n FAIL foo.test.ts\n Expected:\n ✓ sensitive result 10ms\n Tests 1 failed';
    expect(reduceOutput({ text, exitCode: 1, mode: 'balanced' }).output).toContain('✓ sensitive result 10ms');
  });

  it('measures UTF-8 bytes separately from estimated tokens', () => {
    const result = reduceOutput({ text: '你好🙂', exitCode: 0 });
    expect(result.originalSize).toBe(10);
    expect(result.sizeUnit).toBe('bytes');
    expect(result.estimatedTokens).toMatchObject({ original: 4, accuracy: 'estimated' });
  });

  it('retains exact log counts, timestamp bounds and every variable detail', () => {
    const result = reduceOutput({ text: fixture('logs.txt'), exitCode: 1, mode: 'balanced' });
    for (const text of ['7 occurrences', '12:00:00Z', '12:00:08Z', 'request 28', 'request 29', 'actual 503', 'actual 504']) expect(result.output).toContain(text);
  });

  it('refuses no-gain conversions', () => {
    const result = reduceOutput({ text: 'x\nx', exitCode: 0, mode: 'balanced' });
    expect(result.reason).toBe('no_gain');
    expect(result.output).toBe('x\nx');
  });

  it('requires an artifact and labels diff evidence as not a patch', () => {
    const text = Array.from({ length: 10 }, (_, index) => `diff --git a/${index}.ts b/${index}.ts\nindex aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa..bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 100644\n--- a/${index}.ts\n+++ b/${index}.ts\n@@ -1 +1 @@\n-old\n+new\n`).join('');
    expect(reduceOutput({ text, exitCode: 0, mode: 'balanced' }).output).toBe(text);
    const result = reduceOutput({ text, exitCode: 0, mode: 'balanced', artifactId: 'a' });
    expect(result.applied).toBe(true);
    expect(result.output).toContain('NOT AN APPLYABLE PATCH');
    expect(result.output.match(/\+new/g)).toHaveLength(10);
  });

  it('preserves search path-to-line associations including Windows paths', () => {
    const text = 'C:\\repo\\a-long-filename.ts:4:2:auth()\nC:\\repo\\a-long-filename.ts:7:2:refresh()\nC:\\repo\\other.ts:7:2:revoke()';
    const result = reduceOutput({ text, exitCode: 0, mode: 'balanced', format: 'search' });
    expect(result.preservation.valid).toBe(true);
    const reducer = reducers.find(item => item.id === 'search')!;
    const parsed = reducer.parse({ text, exitCode: 0 })!;
    expect(reducer.validatePreservation(parsed, result.output.replace('refresh()', 'revoke()')).valid).toBe(false);
  });

  it('controlled fault injection detects lost error evidence and wrong repetition counts', () => {
    expect(validateEvidence(['Expected: 401', 'Received: 200'], 'Expected: 401').valid).toBe(false);
    const reducer = reducers.find(item => item.id === 'logs')!;
    const input = { text: fixture('logs.txt'), exitCode: 1 };
    const parsed = reducer.parse(input)!;
    expect(reducer.validatePreservation(parsed, reducer.reduce(parsed, input).replace('7 occurrences', '6 occurrences')).valid).toBe(false);
    const jsonReducer = reducers.find(item => item.id === 'json')!;
    const jsonParsed = jsonReducer.parse({ text: '{ "id": 90071992547409931234 }', exitCode: 0 })!;
    expect(jsonReducer.validatePreservation(jsonParsed, '{"id":90071992547409930000}').valid).toBe(false);
  });

  it('retains original on failed preservation, proven with an injected broken reducer', () => {
    const reducer = reducers.find(item => item.id === 'tsc')!;
    const original = reducer.reduce;
    try {
      reducer.reduce = () => 'all passed';
      const input = { text: fixture('tsc-5.9.txt'), exitCode: 1, mode: 'balanced' as const };
      const result = reduceOutput(input);
      expect(result.output).toBe(input.text);
      expect(result.reason).toBe('preservation_failed');
      expect(result.status).toBe('failure');
    } finally { reducer.reduce = original; }
  });
});

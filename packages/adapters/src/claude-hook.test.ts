import { describe, expect, it, vi } from 'vitest';
import { DIFF_EVIDENCE_LABEL } from '../../reducers/src/index.js';
import { processClaudeHook, type ClaudeHookOptions } from './claude-hook.js';
import { inspectAdapters, isSupportedClaudeVersion } from './capabilities.js';

const failing = [' RUN v3.2.4', ...Array.from({ length: 100 }, (_, i) => ` ✓ test/case-${i}.test.ts (4 tests) 20ms`), ' FAIL test/failing.test.ts > preserves assertion', 'AssertionError: expected 1 to equal 2', ' Test Files 1 failed | 100 passed (101)'].join('\n');
const event = (response: Record<string, unknown>) => ({ hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: 'session', tool_use_id: 'tool-1', tool_response: response });
const options = (overrides: Partial<ClaudeHookOptions> = {}): ClaudeHookOptions => ({ clientVersion: '2.1.285', mode: 'balanced', redact: text => text.replaceAll('hunter2', '[REDACTED]'), archive: async () => 'evidence-42', ...overrides });
const replacement = (result: Awaited<ReturnType<typeof processClaudeHook>>) => (result.output?.hookSpecificOutput as Record<string, unknown>).updatedToolOutput as Record<string, unknown>;

describe('Claude hook version range and current response shapes', () => {
  it.each([['2.1.216', true], ['2.1.285', true], ['2.1.999', true], ['2.2.0', true], ['2.1.215', false], ['3.0.0', false], ['1.9.999', false], ['unknown', false], [null, false]] as const)('version %s supported=%s', (version, supported) => {
    expect(isSupportedClaudeVersion(version)).toBe(supported);
  });

  it('replaces output on current releases and explains refusals for others', async () => {
    const current = await processClaudeHook(event({ stdout: failing, stderr: '', interrupted: false, isImage: false }), options());
    expect(replacement(current).stdout).toContain('expected 1 to equal 2');
    const old = await processClaudeHook(event({ stdout: failing, stderr: '', interrupted: false, isImage: false }), options({ clientVersion: '2.1.100' }));
    expect(old.output).toBeNull(); expect(old.reason).toContain('outside the supported output contract');
  });

  it('keeps bashEditDiff (redacted), client annotations and a missing isImage field', async () => {
    const response = { stdout: failing, stderr: '', interrupted: false, noOutputExpected: false, returnCodeInterpretation: 'Tests failed', bashEditDiff: { changedFiles: ['/repo/a.ts'], files: [{ filePath: '/repo/a.ts', hunks: ['+password=hunter2'] }], moreFiles: 0 } };
    const result = replacement(await processClaudeHook(event(response), options()));
    expect(result).not.toHaveProperty('isImage');
    expect(result.returnCodeInterpretation).toBe('Tests failed'); expect(result.noOutputExpected).toBe(false);
    expect(JSON.stringify(result.bashEditDiff)).toContain('/repo/a.ts'); expect(JSON.stringify(result.bashEditDiff)).not.toContain('hunter2');
  });

  it('declines unknown textual fields but accepts unknown status flags', async () => {
    expect((await processClaudeHook(event({ stdout: failing, stderr: '', interrupted: false, futureText: 'uninspected output' }), options())).output).toBeNull();
    expect((await processClaudeHook(event({ stdout: failing, stderr: '', interrupted: false, futureFlag: true }), options())).output).not.toBeNull();
  });

  it('reduces git diffs in balanced mode with the real evidence reference', async () => {
    const diff = ['diff --git a/src/a.ts b/src/a.ts', 'index 1111111..2222222 100644', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,40 +1,40 @@', ...Array.from({ length: 40 }, (_, i) => ` context line ${i}`), '-old', '+new'].join('\n') + '\n';
    const archive = vi.fn(async () => 'evidence-diff-1');
    const result = await processClaudeHook(event({ stdout: diff.repeat(20), stderr: '', interrupted: false, isImage: false }), options({ archive }));
    expect(result.output).not.toBeNull();
    const stdout = String(replacement(result).stdout);
    expect(stdout).toContain(DIFF_EVIDENCE_LABEL); expect(stdout).not.toContain('index 1111111..2222222');
    expect(stdout).toContain('+new'); expect(stdout.match(/^diff --git /gm)).toHaveLength(20);
    expect(stdout).toContain('evidence-diff-1'); expect(stdout).not.toContain('00000000-0000-4000-8000-000000000000');
    expect(archive).toHaveBeenCalledOnce();
    expect(result.metrics?.reducedBytes).toBe(Buffer.byteLength(JSON.stringify(replacement(result))));
  });

  it('records a metric with its reason when nothing is replaced', async () => {
    const record = vi.fn();
    const result = await processClaudeHook(event({ stdout: 'ok\n', stderr: '', interrupted: false, isImage: false }), options({ record }));
    expect(result.output).toBeNull(); expect(record).toHaveBeenCalledOnce(); expect(record.mock.calls[0]![0]).toMatchObject({ applied: false });
  });

  it('reports lifecycle support independently of the output range', () => {
    const [claude] = inspectAdapters({ versions: { claude: '2.1.100' } });
    expect(claude!.capabilities.toolOutputReplacement.support).toBe('unknown');
    expect(claude!.capabilities.sessionLifecycle).toMatchObject({ support: 'supported', implementation: 'implemented' });
    expect(inspectAdapters({ versions: { claude: '2.1.285' } })[0]!.capabilities.toolOutputReplacement.support).toBe('supported');
  });
});

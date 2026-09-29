import { reduceOutput } from '../../reducers/src/index.js';
import { CLAUDE_CONTRACT_VERSIONS } from './capabilities.js';

type ObjectValue = Record<string, unknown>;
export interface HookMetrics {
  schemaVersion: 1;
  kind: 'hook-output';
  source: 'locally_estimated';
  scope: 'claude-post-tool-use-bash';
  clientVersion: string;
  sessionId: string | null;
  toolUseId: string | null;
  artifactId: string | null;
  originalBytes: number;
  reducedBytes: number;
  candidateReducedBytes: number | null;
  candidateSavingsBytes: number | null;
  candidateScope: 'estimated-with-placeholder-evidence-reference' | null;
  redactionChangedBytes: boolean;
  serialization: 'native-response-json';
  estimatedTokens: { original: number; reduced: number; method: 'utf8-bytes-div-3'; accuracy: 'estimated' };
  applied: boolean;
  providerUsage: null;
}
export interface ClaudeHookOptions {
  clientVersion: string | null;
  mode: 'observe' | 'balanced' | 'experimental';
  redact: (text: string) => string;
  archive: (text: string, metadata: Record<string, unknown>) => Promise<string>;
  record?: (metrics: HookMetrics) => void | Promise<void>;
  onLifecycle?: (event: 'SessionStart' | 'PreCompact' | 'PostCompact' | 'SessionEnd', sessionId: string | null) => void | Promise<void>;
  reentrant?: boolean;
  maxInputBytes?: number;
}
export interface HookResult { output: ObjectValue | null; reason: string; metrics?: HookMetrics }
const MARKER = '[CodeBudget evidence:';
function object(value: unknown): value is ObjectValue { return !!value && typeof value === 'object' && !Array.isArray(value); }
function responseEnvelope(response: ObjectValue): ObjectValue { return { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: response } }; }
const byteSize = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
function parseEvent(value: unknown, maximum: number): ObjectValue | null {
  try {
    if (typeof value === 'string') {
      if (Buffer.byteLength(value, 'utf8') > maximum) return null;
      value = JSON.parse(value);
    } else if (byteSize(value) > maximum) return null;
    return object(value) ? value : null;
  } catch { return null; }
}

/** Pure protocol adapter: never executes the observed command or grants permissions. */
export async function processClaudeHook(rawEvent: unknown, options: ClaudeHookOptions): Promise<HookResult> {
  const noop = (reason: string): HookResult => ({ output: null, reason });
  if (!options.clientVersion || !CLAUDE_CONTRACT_VERSIONS.includes(options.clientVersion)) return noop('Unknown client version; output replacement is disabled');
  if (options.reentrant) return noop('Reentrant hook ignored');
  const event = parseEvent(rawEvent, options.maxInputBytes ?? 2 * 1024 * 1024);
  if (!event) return noop('Malformed or oversized hook event');
  const sessionId = typeof event.session_id === 'string' ? event.session_id : null;
  if (event.hook_event_name === 'PostCompact') {
    if (!['manual', 'auto'].includes(String(event.trigger)) || typeof event.compact_summary !== 'string') return noop('Unrecognized PostCompact event shape');
    // The summary and transcript path are intentionally neither forwarded nor archived.
    await options.onLifecycle?.('PostCompact', sessionId);
    return noop('Post-compaction visibility reset without retaining conversation summary');
  }
  if (event.hook_event_name === 'SessionStart' || event.hook_event_name === 'PreCompact' || event.hook_event_name === 'SessionEnd') {
    await options.onLifecycle?.(event.hook_event_name, sessionId);
    return noop('Lifecycle observed without additional context');
  }
  if (event.hook_event_name !== 'PostToolUse' || event.tool_name !== 'Bash') return noop('No output-replacement contract for this event/tool');
  const native = event.tool_response;
  if (!object(native) || typeof native.stdout !== 'string' || typeof native.stderr !== 'string' || typeof native.interrupted !== 'boolean' || typeof native.isImage !== 'boolean') return noop('Unrecognized native Bash response shape');
  if (native.interrupted || native.isImage) return noop('Interrupted or image output is not optimized');
  if (native.stdout.includes(MARKER) || native.stderr.includes(MARKER)) return noop('Output already carries CodeBudget reduction metadata');
  // Preserve known native metadata fields, but do not forward uninspected textual extensions.
  const allowedFields = new Set(['stdout', 'stderr', 'interrupted', 'isImage', 'exitCode', 'exit_code', 'returnCode', 'truncated']);
  if (Object.keys(native).some((key) => !allowedFields.has(key))) return noop('Unknown native output fields; original result is left unchanged');
  if (['exitCode', 'exit_code', 'returnCode'].some(key => native[key] !== undefined && native[key] !== null && (typeof native[key] !== 'number' || !Number.isSafeInteger(native[key]))) || (native.truncated !== undefined && typeof native.truncated !== 'boolean')) return noop('Invalid native status metadata; original result is left unchanged');
  let stdout: string; let stderr: string;
  try {
    stdout = options.redact(native.stdout); stderr = options.redact(native.stderr);
    if (typeof stdout !== 'string' || typeof stderr !== 'string') throw new Error('Invalid redaction result');
  } catch {
    return { output: responseEnvelope({ ...native, stdout: 'CodeBudget withheld this tool result because its secret filter failed. Rerun only after the filter is repaired.', stderr: '' }), reason: 'Redaction failed closed; no original content returned' };
  }
  const masked = { ...native, stdout, stderr };
  const redactionChanged = native.stdout !== stdout || native.stderr !== stderr;
  const exit = [native.exitCode, native.exit_code, native.returnCode].find((value) => typeof value === 'number' && Number.isInteger(value));
  const exitCode = typeof exit === 'number' ? exit : null;
  // Observe runs candidate analysis without changing semantic output or archiving it.
  if (options.mode === 'observe') {
    const placeholder = '00000000-0000-4000-8000-000000000000';
    const candidate = reduceOutput({ text: stdout, exitCode, mode: 'balanced', consumer: 'agent', artifactId: placeholder, truncated: native.truncated === true });
    const hypothetical = { ...masked, stdout: `${candidate.output}\n${MARKER} ${placeholder}; retrieve with read_evidence; reducer ${candidate.reducerId}@${candidate.reducerVersion}]` };
    const originalBytes = byteSize(masked);
    const candidateReducedBytes = candidate.applied && candidate.preservation.valid ? Math.min(originalBytes, byteSize(hypothetical)) : originalBytes;
    const metrics: HookMetrics = {
      schemaVersion: 1, kind: 'hook-output', source: 'locally_estimated', scope: 'claude-post-tool-use-bash', clientVersion: options.clientVersion,
      sessionId, toolUseId: typeof event.tool_use_id === 'string' ? event.tool_use_id : null, artifactId: null,
      originalBytes, reducedBytes: originalBytes, candidateReducedBytes, candidateSavingsBytes: originalBytes - candidateReducedBytes, candidateScope: 'estimated-with-placeholder-evidence-reference',
      redactionChangedBytes: redactionChanged, serialization: 'native-response-json',
      estimatedTokens: { original: Math.ceil(originalBytes / 3), reduced: Math.ceil(originalBytes / 3), method: 'utf8-bytes-div-3', accuracy: 'estimated' }, applied: false, providerUsage: null,
    };
    let reason = 'Observe mode: candidate gain estimated; semantic optimization is disabled';
    try { await options.record?.(metrics); } catch { reason += '; metrics persistence unavailable'; }
    return { output: redactionChanged ? responseEnvelope(masked) : null, reason, metrics };
  }
  const candidate = reduceOutput({ text: stdout, exitCode, mode: options.mode, consumer: 'agent', truncated: native.truncated === true });
  if (!candidate.applied || !candidate.preservation.valid) return { output: redactionChanged ? responseEnvelope(masked) : null, reason: candidate.reason };
  let artifactId: string;
  try {
    artifactId = await options.archive(JSON.stringify({ stdout, stderr, exitCode, interrupted: native.interrupted, truncated: native.truncated === true }), { source: 'claude-hook', sessionId, toolUseId: typeof event.tool_use_id === 'string' ? event.tool_use_id : null, clientVersion: options.clientVersion, redacted: true });
    if (!artifactId || !/^[a-zA-Z0-9:_-]{1,200}$/.test(artifactId)) throw new Error('Invalid artifact reference');
  } catch { return { output: redactionChanged ? responseEnvelope(masked) : null, reason: 'Evidence archive unavailable; semantic reduction skipped' }; }
  const reduced = reduceOutput({ text: stdout, exitCode, mode: options.mode, consumer: 'agent', artifactId, truncated: native.truncated === true });
  const output = { ...masked, stdout: `${reduced.output}\n${MARKER} ${artifactId}; retrieve with read_evidence; reducer ${reduced.reducerId}@${reduced.reducerVersion}]` };
  const originalBytes = byteSize(masked); const reducedBytes = byteSize(output);
  const applied = reduced.applied && reduced.preservation.valid && reducedBytes < originalBytes;
  const metrics: HookMetrics = {
    schemaVersion: 1, kind: 'hook-output', source: 'locally_estimated', scope: 'claude-post-tool-use-bash', clientVersion: options.clientVersion,
    sessionId, toolUseId: typeof event.tool_use_id === 'string' ? event.tool_use_id : null, artifactId, originalBytes, reducedBytes: applied ? reducedBytes : originalBytes,
    redactionChangedBytes: redactionChanged, serialization: 'native-response-json',
    candidateReducedBytes: null, candidateSavingsBytes: null, candidateScope: null,
    estimatedTokens: { original: Math.ceil(originalBytes / 3), reduced: Math.ceil((applied ? reducedBytes : originalBytes) / 3), method: 'utf8-bytes-div-3', accuracy: 'estimated' }, applied, providerUsage: null,
  };
  let reason = applied ? 'Supported native Bash result replaced after evidence archival' : 'No net gain after evidence-reference and native-response overhead';
  try { await options.record?.(metrics); } catch { reason += '; metrics persistence unavailable'; }
  return { output: applied ? responseEnvelope(output) : redactionChanged ? responseEnvelope(masked) : null, reason, metrics };
}

/** Measures only CodeBudget-controlled static instruction content, never hidden IDE prompts. */
export function measurePluginOverhead(skillText: string) {
  const bytes = Buffer.byteLength(skillText, 'utf8');
  return { bytes, estimatedTokens: Math.ceil(bytes / 3), method: 'utf8-bytes-div-3' as const, accuracy: 'estimated' as const, scope: 'complete-skill-file-if-loaded', additionalHookContextBytes: 0 };
}

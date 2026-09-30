import { EVIDENCE_MARKER, reduceOutput } from '../../reducers/src/index.js';
import { CLAUDE_MAX_CONTRACT_MAJOR, CLAUDE_MIN_CONTRACT_VERSION, isSupportedClaudeVersion } from './capabilities.js';

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
const MARKER = EVIDENCE_MARKER;
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

const PLACEHOLDER_ARTIFACT = '00000000-0000-4000-8000-000000000000';
/** Known Bash response fields besides stdout/stderr: status metadata and client-generated annotations. */
const STATUS_FIELDS = ['exitCode', 'exit_code', 'returnCode'] as const;
/** Documented structured field (Claude Code >=2.1.269): changed files and diffs, redacted string by string. */
const STRUCTURED_FIELDS = ['bashEditDiff'] as const;
function redactDeep(value: unknown, redact: (text: string) => string): unknown {
  if (typeof value === 'string') { const masked = redact(value); if (typeof masked !== 'string') throw new Error('Invalid redaction result'); return masked; }
  if (Array.isArray(value)) return value.map(item => redactDeep(item, redact));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, redact)]));
  return value;
}
/** Shape check for a Bash response; returns a refusal reason or null. */
function unsupportedShape(native: ObjectValue): string | null {
  if (typeof native.stdout !== 'string' || typeof native.stderr !== 'string' || typeof native.interrupted !== 'boolean') return 'Unrecognized native Bash response shape';
  if (native.isImage !== undefined && typeof native.isImage !== 'boolean') return 'Unrecognized native Bash response shape';
  for (const [key, value] of Object.entries(native)) {
    if (['stdout', 'stderr', 'interrupted', 'isImage'].includes(key) || (STRUCTURED_FIELDS as readonly string[]).includes(key)) continue;
    if ((STATUS_FIELDS as readonly string[]).includes(key)) {
      if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value))) return 'Invalid native status metadata; original result is left unchanged';
    } else if (key === 'truncated' || key === 'noOutputExpected') {
      if (value !== undefined && typeof value !== 'boolean') return 'Invalid native status metadata; original result is left unchanged';
    } else if (key === 'returnCodeInterpretation') {
      // Client-generated annotation of the exit status (for example "No matches found"), not command output.
      if (value !== undefined && value !== null && typeof value !== 'string') return 'Invalid native status metadata; original result is left unchanged';
    } else if (value !== null && typeof value !== 'boolean' && typeof value !== 'number') {
      // Unknown text or structures could carry uninspected output; unknown primitives are status flags.
      return 'Unknown native output fields; original result is left unchanged';
    }
  }
  return null;
}

/** Pure protocol adapter: never executes the observed command or grants permissions. */
export async function processClaudeHook(rawEvent: unknown, options: ClaudeHookOptions): Promise<HookResult> {
  const noop = (reason: string): HookResult => ({ output: null, reason });
  if (options.reentrant) return noop('Reentrant hook ignored');
  const event = parseEvent(rawEvent, options.maxInputBytes ?? 2 * 1024 * 1024);
  if (!event) return noop('Malformed or oversized hook event');
  const sessionId = typeof event.session_id === 'string' ? event.session_id : null;
  // Lifecycle handling only resets local visibility assumptions; it does not depend on the output contract version.
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
  if (!isSupportedClaudeVersion(options.clientVersion)) return noop(`Client version ${options.clientVersion ?? 'unknown'} is outside the supported output contract (>=${CLAUDE_MIN_CONTRACT_VERSION} <${CLAUDE_MAX_CONTRACT_MAJOR + 1}.0.0); output replacement is disabled`);
  const native = event.tool_response;
  if (!object(native)) return noop('Unrecognized native Bash response shape');
  const shape = unsupportedShape(native);
  if (shape) return noop(shape);
  if (native.interrupted || native.isImage === true) return noop('Interrupted or image output is not optimized');
  if ((native.stdout as string).includes(MARKER) || (native.stderr as string).includes(MARKER)) return noop('Output already carries CodeBudget reduction metadata');
  let stdout: string; let stderr: string; let structured: ObjectValue;
  try {
    stdout = options.redact(native.stdout as string); stderr = options.redact(native.stderr as string);
    if (typeof stdout !== 'string' || typeof stderr !== 'string') throw new Error('Invalid redaction result');
    structured = Object.fromEntries(STRUCTURED_FIELDS.filter(key => native[key] !== undefined).map(key => [key, redactDeep(native[key], options.redact)]));
  } catch {
    const withheld: ObjectValue = { stdout: 'CodeBudget withheld this tool result because its secret filter failed. Rerun only after the filter is repaired.', stderr: '', interrupted: native.interrupted };
    if (native.isImage !== undefined) withheld.isImage = native.isImage;
    for (const key of STATUS_FIELDS) if (native[key] !== undefined) withheld[key] = native[key];
    return { output: responseEnvelope(withheld), reason: 'Redaction failed closed; no original content returned' };
  }
  const masked: ObjectValue = { ...native, ...structured, stdout, stderr };
  const redactionChanged = JSON.stringify(masked) !== JSON.stringify(native);
  const exit = [native.exitCode, native.exit_code, native.returnCode].find((value) => typeof value === 'number' && Number.isInteger(value));
  const exitCode = typeof exit === 'number' ? exit : null;
  const toolUseId = typeof event.tool_use_id === 'string' ? event.tool_use_id : null;
  const originalBytes = byteSize(masked);
  const metrics = (fields: Partial<HookMetrics> & Pick<HookMetrics, 'artifactId' | 'reducedBytes' | 'applied'>): HookMetrics => ({
    schemaVersion: 1, kind: 'hook-output', source: 'locally_estimated', scope: 'claude-post-tool-use-bash', clientVersion: options.clientVersion ?? 'unknown',
    sessionId, toolUseId, originalBytes, candidateReducedBytes: null, candidateSavingsBytes: null, candidateScope: null,
    redactionChangedBytes: redactionChanged, serialization: 'native-response-json',
    estimatedTokens: { original: Math.ceil(originalBytes / 3), reduced: Math.ceil(fields.reducedBytes / 3), method: 'utf8-bytes-div-3', accuracy: 'estimated' }, providerUsage: null, ...fields,
  });
  const record = async (value: HookMetrics, reason: string): Promise<{ reason: string; metrics: HookMetrics }> => {
    try { await options.record?.(value); return { reason, metrics: value }; } catch { return { reason: `${reason}; metrics persistence unavailable`, metrics: value }; }
  };
  // One candidate pass with a placeholder reference; the real evidence ID is substituted after archival.
  const candidate = reduceOutput({ text: stdout, exitCode, mode: options.mode === 'observe' ? 'balanced' : options.mode, consumer: 'agent', artifactId: PLACEHOLDER_ARTIFACT, truncated: native.truncated === true });
  const withReference = (text: string, artifactId: string): ObjectValue => ({ ...masked, stdout: `${text}\n${MARKER} ${artifactId}; retrieve with read_evidence; reducer ${candidate.reducerId}@${candidate.reducerVersion}]` });
  const candidateBytes = candidate.applied && candidate.preservation.valid ? byteSize(withReference(candidate.output, PLACEHOLDER_ARTIFACT)) : originalBytes;
  // Observe runs candidate analysis without changing semantic output or archiving it.
  if (options.mode === 'observe') {
    const candidateReducedBytes = Math.min(originalBytes, candidateBytes);
    const recorded = await record(metrics({ artifactId: null, reducedBytes: originalBytes, applied: false, candidateReducedBytes, candidateSavingsBytes: originalBytes - candidateReducedBytes, candidateScope: 'estimated-with-placeholder-evidence-reference' }), 'Observe mode: candidate gain estimated; semantic optimization is disabled');
    return { output: redactionChanged ? responseEnvelope(masked) : null, ...recorded };
  }
  if (candidateBytes >= originalBytes) {
    const recorded = await record(metrics({ artifactId: null, reducedBytes: originalBytes, applied: false }), candidate.applied && candidate.preservation.valid ? 'No net gain after evidence-reference and native-response overhead' : candidate.reason);
    return { output: redactionChanged ? responseEnvelope(masked) : null, ...recorded };
  }
  let artifactId: string;
  try {
    artifactId = await options.archive(JSON.stringify({ ...structured, stdout, stderr, exitCode, interrupted: native.interrupted, truncated: native.truncated === true }), { source: 'claude-hook', sessionId, toolUseId, clientVersion: options.clientVersion, redacted: true });
    if (!artifactId || !/^[a-zA-Z0-9:_-]{1,200}$/.test(artifactId)) throw new Error('Invalid artifact reference');
  } catch { return { output: redactionChanged ? responseEnvelope(masked) : null, reason: 'Evidence archive unavailable; semantic reduction skipped' }; }
  const output = withReference(candidate.output.replaceAll(PLACEHOLDER_ARTIFACT, artifactId), artifactId);
  const reducedBytes = byteSize(output);
  const applied = reducedBytes < originalBytes;
  const recorded = await record(metrics({ artifactId, reducedBytes: applied ? reducedBytes : originalBytes, applied }), applied ? 'Supported native Bash result replaced after evidence archival' : 'No net gain after evidence-reference and native-response overhead');
  return { output: applied ? responseEnvelope(output) : redactionChanged ? responseEnvelope(masked) : null, ...recorded };
}

/** Measures only CodeBudget-controlled static instruction content, never hidden IDE prompts. */
export function measurePluginOverhead(skillText: string) {
  const bytes = Buffer.byteLength(skillText, 'utf8');
  return { bytes, estimatedTokens: Math.ceil(bytes / 3), method: 'utf8-bytes-div-3' as const, accuracy: 'estimated' as const, scope: 'complete-skill-file-if-loaded', additionalHookContextBytes: 0 };
}

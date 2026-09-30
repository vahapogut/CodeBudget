export type ClientId = 'claude' | 'codex' | 'cursor' | 'antigravity';
export type CapabilityName = 'mcpRegistration' | 'commandRouting' | 'toolOutputReplacement' | 'usageImport' | 'sessionLifecycle' | 'safeInstallUninstall';
export interface Capability {
  support: 'supported' | 'unsupported' | 'unknown';
  implementation: 'implemented' | 'disabled' | 'not-implemented';
  verification: 'contract-tested' | 'documented-only' | 'verified-in-client' | 'unverified';
  source: string;
  notes: string;
}
/** Claude Code releases whose hook contract was exercised locally with protocol fixtures (no model session). */
export const CLAUDE_CONTRACT_VERSIONS: readonly string[] = ['2.1.216', '2.1.285'];
/**
 * Output replacement is enabled from the first locally tested release up to (excluding) the next
 * major version. updatedToolOutput exists since 2.1.121; strict response-shape validation still
 * declines unknown output formats, so newer 2.x releases fall back to the original result safely.
 */
export const CLAUDE_MIN_CONTRACT_VERSION = '2.1.216';
export const CLAUDE_MAX_CONTRACT_MAJOR = 2;
const versionParts = (version: string): [number, number, number] | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};
export function isSupportedClaudeVersion(version: string | null | undefined): boolean {
  const current = version ? versionParts(version) : null; const minimum = versionParts(CLAUDE_MIN_CONTRACT_VERSION)!;
  if (!current || current[0] !== CLAUDE_MAX_CONTRACT_MAJOR) return false;
  return current[1] > minimum[1] || (current[1] === minimum[1] && current[2] >= minimum[2]);
}
export const ADAPTER_SOURCES = {
  claude: 'https://code.claude.com/docs/en/hooks',
  codex: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
  cursor: 'https://cursor.com/docs/mcp',
  antigravity: 'https://antigravity.google/docs/mcp',
} as const;
export function inspectAdapters(options: { versions?: Partial<Record<ClientId, string | null>> } = {}) {
  return (['claude', 'codex', 'cursor', 'antigravity'] as const).map((client) => {
    const version = options.versions?.[client] ?? null;
    const knownClaude = client === 'claude' && isSupportedClaudeVersion(version);
    const cap = (support: Capability['support'], implementation: Capability['implementation'], verification: Capability['verification'], notes: string, source: string = ADAPTER_SOURCES[client]): Capability => ({ support, implementation, verification, source, notes });
    const capabilities: Record<CapabilityName, Capability> = {
      mcpRegistration: cap('supported', 'implemented', 'contract-tested', 'Project-local stdio configuration. Client connection acceptance has not been tested.'),
      commandRouting: cap('unsupported', 'disabled', 'documented-only', 'Automatic shell rewriting is disabled because approval equivalence is unverified. Explicit codebudget run remains available.'),
      toolOutputReplacement: client === 'claude'
        ? cap(knownClaude ? 'supported' : 'unknown', knownClaude ? 'implemented' : 'disabled', knownClaude ? 'contract-tested' : 'unverified', `Only PostToolUse Bash native output objects on Claude Code >=${CLAUDE_MIN_CONTRACT_VERSION} <${CLAUDE_MAX_CONTRACT_MAJOR + 1}.0.0 (contract fixtures exercised on ${CLAUDE_CONTRACT_VERSIONS.join(', ')}). Other versions and unrecognized shapes keep the original result; the reason is recorded locally. No model session has verified replacement.`)
        : cap('unknown', 'disabled', 'unverified', 'MCP registration does not intercept built-in terminal or file results. No native output replacement is implemented.'),
      usageImport: cap(client === 'claude' || client === 'codex' ? 'supported' : 'unknown', client === 'claude' || client === 'codex' ? 'implemented' : 'not-implemented', client === 'claude' || client === 'codex' ? 'contract-tested' : 'unverified', 'Explicit user-supplied Claude OTLP JSON (2.1.216) and Codex exec JSONL (0.139.0). No account or transcript scraping; no real client export collected.', client === 'claude' ? 'https://code.claude.com/docs/en/monitoring-usage' : client === 'codex' ? 'https://learn.chatgpt.com/docs/non-interactive-mode' : ADAPTER_SOURCES[client]),
      sessionLifecycle: cap(client === 'claude' || client === 'cursor' ? 'supported' : 'unknown', client === 'claude' ? 'implemented' : 'not-implemented', client === 'claude' ? 'contract-tested' : 'documented-only', client === 'claude' ? 'SessionStart, PreCompact and PostCompact clear local visibility assumptions; SessionEnd closes the session. Lifecycle handling does not depend on the output-replacement version range. Epochs count resets, not compactions. No conversation summary is retained and hooks add no context.' : 'No assumption that a previously sent source remains visible.', client === 'cursor' ? 'https://cursor.com/docs/hooks' : ADAPTER_SOURCES[client]),
      safeInstallUninstall: cap('supported', 'implemented', 'contract-tested', 'Project-only, backed up, atomic, ownership receipts; modified CodeBudget entries are preserved as conflicts.'),
    };
    return { schemaVersion: 1 as const, matrixVersion: '2026-09-30.1', checkedAt: '2026-09-30', client, clientVersion: version, capabilities };
  });
}

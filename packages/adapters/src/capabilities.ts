export type ClientId = 'claude' | 'codex' | 'cursor' | 'antigravity';
export type CapabilityName = 'mcpRegistration' | 'commandRouting' | 'toolOutputReplacement' | 'usageImport' | 'sessionLifecycle' | 'safeInstallUninstall';
export interface Capability {
  support: 'supported' | 'unsupported' | 'unknown';
  implementation: 'implemented' | 'disabled' | 'not-implemented';
  verification: 'contract-tested' | 'documented-only' | 'verified-in-client' | 'unverified';
  source: string;
  notes: string;
}
export const CLAUDE_CONTRACT_VERSIONS: readonly string[] = ['2.1.216'];
export const ADAPTER_SOURCES = {
  claude: 'https://code.claude.com/docs/en/hooks',
  codex: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
  cursor: 'https://cursor.com/docs/mcp',
  antigravity: 'https://antigravity.google/docs/mcp',
} as const;
export function inspectAdapters(options: { versions?: Partial<Record<ClientId, string | null>> } = {}) {
  return (['claude', 'codex', 'cursor', 'antigravity'] as const).map((client) => {
    const version = options.versions?.[client] ?? null;
    const knownClaude = client === 'claude' && version !== null && CLAUDE_CONTRACT_VERSIONS.includes(version);
    const cap = (support: Capability['support'], implementation: Capability['implementation'], verification: Capability['verification'], notes: string, source: string = ADAPTER_SOURCES[client]): Capability => ({ support, implementation, verification, source, notes });
    const capabilities: Record<CapabilityName, Capability> = {
      mcpRegistration: cap('supported', 'implemented', 'contract-tested', 'Project-local stdio configuration. Client connection acceptance has not been tested.'),
      commandRouting: cap('unsupported', 'disabled', 'documented-only', 'Automatic shell rewriting is disabled because approval equivalence is unverified. Explicit codebudget run remains available.'),
      toolOutputReplacement: client === 'claude'
        ? cap(knownClaude ? 'supported' : 'unknown', knownClaude ? 'implemented' : 'disabled', knownClaude ? 'contract-tested' : 'unverified', 'Only PostToolUse Bash native output objects on the exact contract version. Unknown versions and unsupported shapes are silent no-ops. No model session has verified replacement.')
        : cap('unknown', 'disabled', 'unverified', 'MCP registration does not intercept built-in terminal or file results. No native output replacement is implemented.'),
      usageImport: cap(client === 'claude' || client === 'codex' ? 'supported' : 'unknown', client === 'claude' || client === 'codex' ? 'implemented' : 'not-implemented', client === 'claude' || client === 'codex' ? 'contract-tested' : 'unverified', 'Explicit user-supplied Claude OTLP JSON (2.1.216) and Codex exec JSONL (0.139.0). No account or transcript scraping; no real client export collected.', client === 'claude' ? 'https://code.claude.com/docs/en/monitoring-usage' : client === 'codex' ? 'https://learn.chatgpt.com/docs/non-interactive-mode' : ADAPTER_SOURCES[client]),
      sessionLifecycle: cap(client === 'claude' || client === 'cursor' ? 'supported' : 'unknown', client === 'claude' ? 'implemented' : 'not-implemented', client === 'claude' ? 'contract-tested' : 'documented-only', client === 'claude' ? 'SessionStart, PreCompact and PostCompact clear local visibility assumptions; SessionEnd closes the session. Epochs count resets, not compactions. No conversation summary is retained and hooks add no context.' : 'No assumption that a previously sent source remains visible.', client === 'cursor' ? 'https://cursor.com/docs/hooks' : ADAPTER_SOURCES[client]),
      safeInstallUninstall: cap('supported', 'implemented', 'contract-tested', 'Project-only, backed up, atomic, ownership receipts; modified CodeBudget entries are preserved as conflicts.'),
    };
    return { schemaVersion: 1 as const, matrixVersion: '2026-09-29.2', checkedAt: '2026-09-29', client, clientVersion: version, capabilities };
  });
}

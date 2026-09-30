import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, Store, redact, bytes, SECURITY_VERSION } from '../../../packages/core/src/index.js';
import { processClaudeHook, measurePluginOverhead } from '../../../packages/adapters/src/index.js';
import { initializedProjectRoot } from './project-root.js';

export function detectVersion(client: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!['claude', 'codex', 'cursor', 'antigravity'].includes(client)) return null;
  const probe = spawnSync(client, ['--version'], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 2500, maxBuffer: 8192, env });
  return probe.status === 0 ? probe.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null : null;
}

export async function readStdin(maxBytes = 2 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > maxBytes) throw new Error('Input exceeds limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const LIFECYCLE_EVENTS = new Set(['SessionStart', 'PreCompact', 'PostCompact', 'SessionEnd']);
/** Parse first, so unhandled events never open the store or probe the client binary. */
function handledEvent(raw: string): { name: string; sessionId: string | null } | null {
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return null; }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>; const name = String(value.hook_event_name ?? '');
  if (!LIFECYCLE_EVENTS.has(name) && !(name === 'PostToolUse' && value.tool_name === 'Bash')) return null;
  return { name, sessionId: typeof value.session_id === 'string' ? value.session_id : null };
}

export async function runHook(raw: string, cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): Promise<Record<string, unknown> | null> {
  const handled = handledEvent(raw);
  if (!handled) return null;
  const root = initializedProjectRoot(cwd, env);
  if (!root) return null;
  const config = loadConfig(root, {}, env);
  const store = new Store(root, config);
  try {
    const externalSession = handled.sessionId;
    let session = externalSession ? store.activeSessionForExternal(externalSession) : undefined;
    // The client version is probed once per client session and reused by its later events.
    const clientVersion = typeof session?.state.clientVersion === 'string' ? session.state.clientVersion : detectVersion('claude', env);
    const getSession = () => {
      if (!externalSession) return undefined;
      session ??= store.activeSessionForExternal(externalSession) ?? store.startSession('Claude Code session', { externalSessionId: externalSession, source: 'claude-plugin', clientVersion });
      return session;
    };
    const result = await processClaudeHook(raw, {
      clientVersion, mode: config.mode, redact,
      archive: async (text, metadata) => {
        const artifact = store.putText(text, { kind: 'claude-hook', sessionId: getSession()?.id, metadata });
        if (!artifact.complete) throw new Error('Archive incomplete; keep original output');
        return artifact.id;
      },
      record: metrics => { store.recordEvent('hook', { ...metrics, codebudgetSessionId: getSession()?.id ?? null, timestamp: new Date().toISOString() }); },
      onLifecycle: (event) => {
        const current = getSession(); if (!current) return;
        if (event === 'SessionEnd') store.closeSession(current.id);
        else store.checkpoint(current.id, { lastLifecycle: event, visibilityAssumption: 'reset' }, true);
        if (event === 'SessionStart') {
          const base = dirname(fileURLToPath(import.meta.url));
          const candidates = [resolve(base, '../skills/evidence/SKILL.md'), resolve(base, '../plugins/claude-codebudget/skills/evidence/SKILL.md'), resolve(base, '../../../plugins/claude-codebudget/skills/evidence/SKILL.md')];
          const skill = candidates.find(existsSync);
          store.recordEvent('plugin-overhead', { sessionId: current.id, securityPolicy: SECURITY_VERSION, ...(skill ? measurePluginOverhead(readFileSync(skill, 'utf8')) : { bytes: null, estimatedTokens: null, scope: 'skill-file-unavailable' }), hookContextBytes: 0 });
        }
      },
    });
    // A Bash result that produced no metric (unsupported version or shape, reentrancy, archive failure) still records why.
    if (handled.name === 'PostToolUse' && !result.metrics) store.recordEvent('hook', { schemaVersion: 1, kind: 'hook-noop', applied: false, clientVersion, reason: result.reason, codebudgetSessionId: getSession()?.id ?? null, timestamp: new Date().toISOString() });
    if (result.output && bytes(JSON.stringify(result.output)) > 2 * 1024 * 1024) return null;
    return result.output;
  } finally { store.close(); }
}

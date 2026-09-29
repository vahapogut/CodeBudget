import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, Store, redact, bytes, SECURITY_VERSION } from '../../../packages/core/src/index.js';
import { processClaudeHook, measurePluginOverhead } from '../../../packages/adapters/src/index.js';
import { initializedProjectRoot } from './project-root.js';

export function detectVersion(client: string): string | null {
  if (!['claude', 'codex', 'cursor', 'antigravity'].includes(client)) return null;
  const probe = spawnSync(client, ['--version'], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 2500, maxBuffer: 8192 });
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

export async function runHook(raw: string, cwd = process.cwd()): Promise<Record<string, unknown> | null> {
  const root = initializedProjectRoot(cwd);
  if (!root) return null;
  const config = loadConfig(root);
  const clientVersion = detectVersion('claude');
  const store = new Store(root, config);
  try {
    let externalSession: string | null = null;
    try { const input = JSON.parse(raw) as Record<string, unknown>; externalSession = typeof input.session_id === 'string' ? input.session_id : null; } catch { return null; }
    const getSession = () => {
      if (!externalSession) return undefined;
      return store.sessions().find(s => s.state.externalSessionId === externalSession && s.status === 'active')
        ?? store.startSession('Claude Code session', { externalSessionId: externalSession, source: 'claude-plugin', clientVersion });
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
        const session = getSession(); if (!session) return;
        if (event === 'SessionEnd') store.closeSession(session.id);
        else store.checkpoint(session.id, { lastLifecycle: event, visibilityAssumption: 'reset' }, true);
        if (event === 'SessionStart') {
          const base = dirname(fileURLToPath(import.meta.url));
          const candidates = [resolve(base, '../skills/evidence/SKILL.md'), resolve(base, '../plugins/claude-codebudget/skills/evidence/SKILL.md'), resolve(base, '../../../plugins/claude-codebudget/skills/evidence/SKILL.md')];
          const skill = candidates.find(existsSync);
          store.recordEvent('plugin-overhead', { sessionId: session.id, securityPolicy: SECURITY_VERSION, ...(skill ? measurePluginOverhead(readFileSync(skill, 'utf8')) : { bytes: null, estimatedTokens: null, scope: 'skill-file-unavailable' }), hookContextBytes: 0 });
        }
      },
    });
    if (result.output && bytes(JSON.stringify(result.output)) > 2 * 1024 * 1024) return null;
    return result.output;
  } finally { store.close(); }
}

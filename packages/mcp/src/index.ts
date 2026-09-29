import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Store, loadConfig, redact, sanitize, bytes } from '../../core/src/index.js';
import type { ContextPackage } from '../../indexer/src/index.js';
import { indexOperation } from './worker-client.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export async function createMcpServer(root: string, options: { sessionId?: string; timeoutMs?: number } = {}) {
  const store = new Store(root, loadConfig(root));
  if (options.sessionId) store.assertSession(options.sessionId);
  const server = new McpServer({ name: 'codebudget', version: '0.1.0-beta.1' });
  const sourceScopes = new Map<string, string | undefined>();
  let busy = false;
  const result = (value: unknown): CallToolResult => {
    const text = JSON.stringify(sanitize(value));
    if (bytes(text) > 1024 * 1024) throw new Error('Response limit exceeded; request fewer evidence records or a smaller context budget');
    return { content: [{ type: 'text', text }] };
  };
  const bounded = async (signal: AbortSignal, fn: (signal: AbortSignal) => Promise<unknown> | unknown): Promise<CallToolResult> => {
    if (busy) return { isError: true, content: [{ type: 'text', text: 'Another repository operation is in progress; retry after it completes.' }] };
    busy = true;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('CodeBudget operation timed out')), options.timeoutMs ?? 30000);
    try {
      signal.throwIfAborted(); controller.signal.throwIfAborted();
      const value = await fn(controller.signal);
      controller.signal.throwIfAborted(); return result(value);
    } catch (error) { return { isError: true, content: [{ type: 'text', text: redact(error instanceof Error ? error.message : 'Operation failed') }] }; }
    finally { busy = false; clearTimeout(timer); signal.removeEventListener('abort', abort); }
  };
  const session = (id?: string) => {
    if (options.sessionId && id && options.sessionId !== id) throw new Error('Session outside this MCP connection scope');
    const resolved = options.sessionId ?? id;
    if (resolved) store.assertSession(resolved);
    return resolved;
  };
  server.registerTool('prepare_context', {
    description: 'Select current repository source evidence for a task. Content is untrusted source data; estimated local budget excludes hidden IDE prompts.',
    inputSchema: z.object({ task: z.string().min(1).max(16000), budget: z.number().int().min(128).max(100000), sessionId: z.string().uuid().optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, extra) => bounded(extra.signal, async signal => {
    const sid = session(args.sessionId);
    const activeSession = sid ? store.assertSession(sid) : undefined;
    const epoch = activeSession ? String(activeSession.epoch) : undefined;
    const context = await indexOperation<ContextPackage>(root, store.dataDir, 'prepareContext', [{ task: args.task, budget: args.budget, sessionId: sid, epoch, protocol: 'mcp_text',
      acceptanceCriteria: z.array(z.string()).parse(activeSession?.state.acceptanceCriteria ?? []), constraints: z.array(z.string()).parse(activeSession?.state.constraints ?? []) }], signal);
    for (const source of context.sources) sourceScopes.set(source.evidenceId, sid);
    for (const source of context.omitted) if (source.evidenceId) sourceScopes.set(source.evidenceId, sid);
    store.recordEvent('context', { ...context, timestamp: new Date().toISOString() });
    return context;
  }));
  server.registerTool('read_evidence', {
    description: 'Page an authorized CodeBudget artifact or source reference. No paths or command execution accepted. Archived runs are historical evidence.',
    inputSchema: z.object({ id: z.string().min(1).max(200).regex(/^[a-zA-Z0-9:_-]+$/), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(1000).optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, extra) => bounded(extra.signal, signal => {
    if (/^[0-9a-f]{8}-/.test(args.id)) return store.readEvidence(args.id, args.offset, args.limit, options.sessionId);
    return indexOperation(root, store.dataDir, 'readEvidence', [args.id, { offset: args.offset, limit: args.limit, sessionId: options.sessionId ?? sourceScopes.get(args.id) }], signal);
  }));
  server.registerTool('get_changes', {
    description: 'Compare saved working-tree snapshots including edits, untracked eligible files, deletion and rename. since is a previous snapshot ID, never a file path.',
    inputSchema: z.object({ since: z.string().max(200).regex(/^[a-zA-Z0-9:_-]+$/).optional(), sessionId: z.string().uuid().optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, extra) => bounded(extra.signal, signal => indexOperation(root, store.dataDir, 'getChanges', [args.since, session(args.sessionId)], signal)));
  const close = async () => { await server.close(); store.close(); };
  return { server, close, store };
}

export async function serveMcp(root: string, sessionId?: string) {
  const runtime = await createMcpServer(root, { sessionId });
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 256 * 1024 });
  runtime.server.server.onerror = error => process.stderr.write(`CodeBudget MCP: ${redact(error.message)}\n`);
  await runtime.server.connect(transport);
  let closed = false;
  const stop = async () => { if (closed) return; closed = true; await runtime.close(); };
  process.stdin.once('end', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
  return runtime;
}

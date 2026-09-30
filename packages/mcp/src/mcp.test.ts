import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpServer } from './index.js';
import { indexOperation } from './worker-client.js';
import { createLocalTokenizer, type ContextPackage } from '../../indexer/src/index.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function connected() {
  const root = mkdtempSync(join(tmpdir(), 'cb-mcp-')); writeFileSync(join(root, 'auth.ts'), 'export function rotateToken() { return "new-token"; }');
  const runtime = await createMcpServer(root); const client = new Client({ name: 'contract', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await runtime.server.connect(serverTransport); await client.connect(clientTransport);
  cleanup.push(async () => { await client.close(); await runtime.close(); rmSync(root, { recursive: true, force: true }); });
  return { client, runtime };
}
it('exposes exactly three tools and returns actual current source through official SDK', async () => {
  const { client } = await connected(); expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(['get_changes', 'prepare_context', 'read_evidence']);
  const result = await client.callTool({ name: 'prepare_context', arguments: { task: 'rotateToken auth', budget: 8000 } });
  expect(result.isError).not.toBe(true); expect(JSON.stringify(result)).toContain('rotateToken');
  expect(JSON.stringify(result)).toContain('estimated');
});
it('rejects arbitrary paths, extra parameters, oversized budgets and foreign sessions', async () => {
  const { client } = await connected();
  for (const request of [
    { name: 'read_evidence', arguments: { id: '../../secret' } },
    { name: 'get_changes', arguments: { since: 'main', path: '/etc/passwd' } },
    { name: 'prepare_context', arguments: { task: 'auth', budget: 99999999 } },
    { name: 'prepare_context', arguments: { task: 'auth', budget: 8000, sessionId: '00000000-0000-4000-8000-000000000000' } },
  ]) expect((await client.callTool(request)).isError).toBe(true);
});
it('does not expose unredacted artifacts and treats evidence as historical', async () => {
  const { client, runtime } = await connected(); const artifact = runtime.store.putText('password=hidden\nerror at app.ts:8');
  const result = await client.callTool({ name: 'read_evidence', arguments: { id: artifact.id } });
  expect(JSON.stringify(result)).not.toContain('hidden'); expect(JSON.stringify(result)).toContain('historicalEvidence');
});
it('terminates index work on timeout/cancellation without exposing a partial successful result', async () => {
  const { runtime } = await connected();
  const controller = new AbortController();
  const work = indexOperation(runtime.store.root, runtime.store.dataDir, 'prepareContext', [{ task: 'auth', budget: 8000 }], controller.signal);
  controller.abort(new Error('test cancellation'));
  await expect(work).rejects.toThrow('test cancellation');
});
it('session-scoped context references remain readable on the same connection', async () => {
  const { runtime, client } = await connected(); const session = runtime.store.startSession('auth');
  const context = await client.callTool({ name: 'prepare_context', arguments: { task: 'rotateToken auth', budget: 8000, sessionId: session.id } });
  const content = context.content as { type: string; text: string }[];
  const pkg = JSON.parse(content[0]!.text) as { sources: { evidenceId: string }[] };
  expect(pkg.sources.length).toBeGreaterThan(0);
  const evidence = await client.callTool({ name: 'read_evidence', arguments: { id: pkg.sources[0]!.evidenceId } });
  expect(evidence.isError).not.toBe(true); expect(JSON.stringify(evidence)).toContain('rotateToken');
});

it('retains the complete MCP context package for dashboard inspection, including overflow evidence', async () => {
  const { runtime, client } = await connected();
  const acceptanceCriteria = ['Reject refresh token reuse'];
  const constraints = ['Preserve the public function signature'];
  const session = runtime.store.startSession('auth.ts', { acceptanceCriteria, constraints });
  const result = await client.callTool({ name: 'prepare_context', arguments: { task: 'auth.ts', budget: 128, sessionId: session.id } });
  expect(result.isError).not.toBe(true);
  const content = result.content as { type: string; text: string }[];
  const context = JSON.parse(content[0]!.text) as ContextPackage;
  expect(context.status).toBe('budget_exceeded');
  expect(context.minimumRequiredTokens).toBeGreaterThan(context.budget);
  // The report lists a bounded summary; the complete package stays available on demand.
  expect(runtime.store.report().contextPackages[0]).toMatchObject({ id: context.id, purpose: 'auth.ts', status: 'budget_exceeded', detail: 'summary' });
  const stored = runtime.store.contextPackage(context.id) as ContextPackage & { timestamp: string };
  const { timestamp, ...retainedPackage } = stored;
  expect(Date.parse(timestamp)).not.toBeNaN();
  expect(retainedPackage).toEqual(context);
  expect(retainedPackage.purpose).toBe('auth.ts');
  expect(retainedPackage.acceptanceCriteria).toEqual(acceptanceCriteria);
  expect(retainedPackage.constraints).toEqual(constraints);
  expect(retainedPackage).toHaveProperty('omitted');
  expect(retainedPackage).toHaveProperty('expansion');
});

it('rejects non-string session task criteria before producing or persisting context', async () => {
  const { runtime, client } = await connected();
  const session = runtime.store.startSession('auth', { acceptanceCriteria: [123] });
  const result = await client.callTool({ name: 'prepare_context', arguments: { task: 'auth', budget: 8000, sessionId: session.id } });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).toContain('expected string');
  expect(runtime.store.report().contextPackages).toEqual([]);
});

it('MCP worker applies offline tokenizer and dependency config to its complete measured envelope', async () => {
  const { runtime, client } = await connected();
  writeFileSync(join(runtime.store.root, '.codebudget.json'), JSON.stringify({ contextDependencies: { maxDepth: 3, maxFiles: 4 }, contextTokenizer: { encoding: 'o200k_base', model: 'gpt-4o' } }));
  writeFileSync(join(runtime.store.root, 'auth.ts'), 'import { helper } from "./helper"; export const rotateToken = helper;');
  writeFileSync(join(runtime.store.root, 'helper.ts'), 'export { final as helper } from "./final";');
  writeFileSync(join(runtime.store.root, 'final.ts'), 'export const final = "日本語";');
  const result = await client.callTool({ name: 'prepare_context', arguments: { task: 'auth.ts', budget: 8000 } });
  expect(result.isError).not.toBe(true);
  const content = result.content as { type: string; text: string }[];
  const context = JSON.parse(content[0]!.text) as ContextPackage;
  const tokenizer = await createLocalTokenizer({ encoding: 'o200k_base', model: 'gpt-4o' });
  expect(context.tokenMeasurement).toMatchObject({ accuracy: 'exact_local', encoding: 'o200k_base', modelMapping: 'verified' });
  expect(context.tokenMeasurement.tokens).toBe(tokenizer.count(JSON.stringify({ content })));
  expect(context.sources.find(source => source.path === 'final.ts')?.dependency).toMatchObject({ depth: 2, path: ['auth.ts', 'helper.ts', 'final.ts'] });
  expect(context.dependencyExpansion).toMatchObject({ maxDepth: 3, maxFiles: 4, expandedFiles: 2 });
  expect(runtime.store.contextPackage(context.id)).toMatchObject(context);
}, 15000);

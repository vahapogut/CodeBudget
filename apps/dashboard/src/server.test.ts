import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { Store } from '../../../packages/core/src/store.js';
import { defaults } from '../../../packages/core/src/config.js';
import { startDashboard, type DashboardHandle } from './server.js';

const fixtures: { directory: string; store: Store; server: DashboardHandle }[] = [];
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'codebudget-dashboard-'));
  const assetsDir = join(directory, 'assets'); mkdirSync(assetsDir);
  writeFileSync(join(assetsDir, 'index.html'), '<!doctype html><title>CodeBudget</title><div id="root"></div>');
  const store = new Store(directory, defaults());
  const server = await startDashboard({ store, assetsDir });
  fixtures.push({ directory, store, server });
  const bootstrap = new URLSearchParams(new URL(server.url).hash.slice(1)).get('token')!;
  const exchange = await fetch(`${server.origin}/api/session`, { headers: { Authorization: `Bearer ${bootstrap}`, Origin: server.origin } });
  const { token } = await exchange.json() as { token: string };
  return { directory, store, server, bootstrap, headers: { Authorization: `Bearer ${token}`, Origin: server.origin } };
}
afterEach(async () => {
  for (const { directory, store, server } of fixtures.splice(0)) { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

describe('secure local dashboard API', () => {
  it('serves real SQLite records with unknown usage instead of invented savings', async () => {
    const { store, server, headers } = await fixture();
    const session = store.startSession('Fix token reuse');
    store.recordRun({ id: 'test-run', sessionId: session.id, status: 'failure', originalSize: 1000, reducedSize: 300, exitCode: 1 });
    const response = await fetch(`${server.origin}/api/report`, { headers });
    expect(response.status).toBe(200);
    const report = await response.json() as Record<string, unknown>;
    expect(report.localOutput).toMatchObject({ savedBytes: 700, unit: 'utf8_bytes' });
    expect(report.observedUsage).toMatchObject({ total: null, cost: null, subscriptionQuota: null });
    expect(report.netTaskSavings).toBeNull();
    expect(report.sessions).toMatchObject([{ task: 'Fix token reuse' }]);
    expect(report.adapters).toHaveLength(4);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('requires a bearer token and rejects cross-origin, cross-site and mutation requests', async () => {
    const { server, headers } = await fixture();
    expect((await fetch(`${server.origin}/api/report`)).status).toBe(401);
    expect((await fetch(`${server.origin}/api/report`, { headers: { ...headers, Origin: 'https://attacker.example' } })).status).toBe(403);
    expect((await fetch(`${server.origin}/api/report`, { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await fetch(`${server.origin}/api/report`, { method: 'POST', headers })).status).toBe(405);
    expect((await fetch(`${server.origin}/api/report`, { method: 'OPTIONS', headers })).status).toBe(405);
    expect((await fetch(`${server.origin}/api/report`, { headers: { Cookie: headers.Authorization } })).status).toBe(401);
  });

  it('rejects rebinding Host headers even when a valid authorization token is present', async () => {
    const { server, headers } = await fixture();
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${server.origin}/api/report`, { headers: { ...headers, Host: 'attacker.example' } }, (response) => { response.resume(); resolve(response.statusCode ?? 0); });
      req.on('error', reject); req.end();
    });
    expect(status).toBe(403);
  });

  it('protects JSON/CSV exports, enforces session scope and returns paged redacted evidence', async () => {
    const { store, server, headers } = await fixture();
    const session = store.startSession('First task');
    const other = store.startSession('Second task');
    const artifact = store.putText('Authorization: Bearer abcdefghijklmnopqrst\nsecond line\n', { sessionId: session.id });
    store.recordRun({ id: '=1+1', sessionId: session.id, executable: '=HYPERLINK("https://attacker.example")', originalSize: 2, reducedSize: 2 });
    const csv = await (await fetch(`${server.origin}/api/export?format=csv`, { headers })).text();
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"\'=HYPERLINK');
    const evidence = await (await fetch(`${server.origin}/api/evidence/${artifact.id}?session=${session.id}&limit=1`, { headers })).json() as { chunks: { text: string }[]; nextOffset: number };
    expect(evidence.chunks).toHaveLength(1);
    expect(evidence.nextOffset).toBe(1);
    expect(evidence.chunks[0]?.text).not.toContain('abcdefghijklmnopqrst');
    expect((await fetch(`${server.origin}/api/evidence/${artifact.id}?session=${other.id}`, { headers })).status).toBe(400);
    expect((await fetch(`${server.origin}/api/evidence/${artifact.id}?limit=9999`, { headers })).status).toBe(400);
    expect((await fetch(`${server.origin}/api/evidence/..%2fsecret`, { headers })).status).toBe(400);
  });

  it('serves only local static assets with strict CSP and no framing or CORS permission', async () => {
    const { server } = await fixture();
    const response = await fetch(server.origin);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('CodeBudget');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('content-security-policy')).not.toContain('unsafe-inline');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(`${server.origin}/%2e%2e%5cstate.sqlite`)).status).toBe(400);
  });

  it('treats the printed link as a single-use secret that cannot read data itself', async () => {
    const { server, bootstrap } = await fixture();
    const auth = { Authorization: `Bearer ${bootstrap}`, Origin: server.origin };
    expect((await fetch(`${server.origin}/api/session`, { headers: auth })).status).toBe(401);
    expect((await fetch(`${server.origin}/api/report`, { headers: auth })).status).toBe(401);
  });

  it('keeps reports small, serves run and context details on demand and hides local paths', async () => {
    const { store, server, headers } = await fixture();
    for (let index = 0; index < 150; index++) store.recordRun({ id: `run-${index}`, status: 'success', originalSize: 60000, reducedSize: 60000, output: 'x'.repeat(60000) });
    store.recordEvent('context', { id: 'pkg-1', purpose: 'Fix auth', status: 'ready', sources: [{ path: 'a.ts', code: 'y'.repeat(200000) }] });
    const report = await fetch(`${server.origin}/api/report`, { headers });
    expect(report.status).toBe(200);
    const body = await report.json() as { runs: unknown[]; runCount: number; limits: { retainedRuns: number } };
    expect(body.runCount).toBe(150); expect(body.limits.retainedRuns).toBe(150); expect(JSON.stringify(body)).not.toContain('xxxxxxxxxx');
    expect(((await (await fetch(`${server.origin}/api/run/run-3`, { headers })).json()) as { output: string }).output).toContain('xxxx');
    expect(JSON.stringify(await (await fetch(`${server.origin}/api/context/pkg-1`, { headers })).json())).toContain('yyyy');
    expect((await fetch(`${server.origin}/api/export?format=json`, { headers })).status).toBe(200);
    const missing = await fetch(`${server.origin}/nope.js`);
    expect(missing.status).toBe(404); expect(await missing.text()).toBe('{"error":"Not found"}');
  });

  it('does not count dashboard evidence views as agent retrievals', async () => {
    const { store, server, headers } = await fixture();
    const artifact = store.putText('line\n');
    expect((await fetch(`${server.origin}/api/evidence/${artifact.id}`, { headers })).status).toBe(200);
    expect(store.events('retrieval')).toHaveLength(0);
  });
});

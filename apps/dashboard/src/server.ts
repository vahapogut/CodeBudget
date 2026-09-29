import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Store } from '../../../packages/core/src/store.js';
import { csvCell, redact, safeJson, safePath } from '../../../packages/core/src/security.js';
import { inspectAdapters, type ClientId } from '../../../packages/adapters/src/capabilities.js';

export interface DashboardOptions {
  store: Store;
  port?: number;
  host?: '127.0.0.1';
  assetsDir?: string;
  clientVersions?: Partial<Record<ClientId, string | null>>;
}

export interface DashboardHandle { url: string; origin: string; close(): Promise<void>; }
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

export async function startDashboard(options: DashboardOptions): Promise<DashboardHandle> {
  if (options.host && options.host !== '127.0.0.1') throw new Error('Dashboard binds only to 127.0.0.1');
  const { store } = options;
  const token = randomBytes(32).toString('hex');
  const assetsDir = options.assetsDir ?? fileURLToPath(new URL('./dashboard/', import.meta.url));
  let origin = '';
  let expectedHost = '';
  const send = (response: ServerResponse, status: number, body: unknown, contentType = 'application/json; charset=utf-8'): void => {
    const serialized = typeof body === 'string' ? body : safeJson(body);
    if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) {
      response.writeHead(413, { 'Content-Type': 'application/json' }); response.end('{"error":"Response exceeds 8 MiB; use the CLI for scoped retrieval"}'); return;
    }
    response.writeHead(status, { 'Content-Type': contentType }); response.end(serialized);
  };
  const authenticated = (request: IncomingMessage): boolean => {
    const authorization = request.headers.authorization ?? '';
    const expected = `Bearer ${token}`;
    return Buffer.byteLength(authorization) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(authorization), Buffer.from(expected));
  };
  const server = createServer((request, response) => {
    response.setHeader('Content-Security-Policy', CSP);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    try {
      if (request.headers.host !== expectedHost) { send(response, 403, { error: 'Host rejected' }); return; }
      if (request.headers.origin && request.headers.origin !== origin) { send(response, 403, { error: 'Origin rejected' }); return; }
      const fetchSite = request.headers['sec-fetch-site'];
      if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') { send(response, 403, { error: 'Cross-site request rejected' }); return; }
      if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); send(response, 405, { error: 'Read-only dashboard; only GET is allowed' }); return; }
      const url = new URL(request.url ?? '/', origin);
      if (url.pathname.startsWith('/api/')) {
        if (!authenticated(request)) { send(response, 401, { error: 'Dashboard authorization required; reopen the URL printed by codebudget dashboard' }); return; }
        const sessionId = url.searchParams.get('session') ?? undefined;
        if (sessionId) store.assertSession(sessionId);
        if (url.pathname === '/api/report') {
          const report = store.report(sessionId);
          send(response, 200, { ...report, mode: store.config.mode, generatedAt: new Date().toISOString(), adapters: inspectAdapters({ versions: options.clientVersions }), limits: { retainedRuns: report.runs.length, visibleRuns: Math.min(report.runs.length, 200), visibleEvents: 100 }, runs: report.runs.slice(0, 200), contextPackages: report.contextPackages.slice(0, 100), benchmark: report.benchmark.slice(0, 100), retrievals: report.retrievals.slice(0, 100), hookMetrics: report.hookMetrics.slice(0, 100) }); return;
        }
        if (url.pathname.startsWith('/api/evidence/')) {
          const id = decodeURIComponent(url.pathname.slice('/api/evidence/'.length));
          if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) { send(response, 400, { error: 'Invalid evidence identifier' }); return; }
          const offset = Number(url.searchParams.get('offset') ?? 0);
          const limit = Number(url.searchParams.get('limit') ?? 200);
          send(response, 200, store.readEvidence(id, offset, limit, sessionId)); return;
        }
        if (url.pathname === '/api/export') {
          const report = store.report(sessionId);
          const format = url.searchParams.get('format') ?? 'json';
          if (format === 'json') {
            response.setHeader('Content-Disposition', 'attachment; filename="codebudget-report.json"');
            send(response, 200, report); return;
          }
          if (format === 'csv') {
            const columns = ['id', 'sessionId', 'executable', 'status', 'exitCode', 'originalSize', 'reducedSize', 'durationMs', 'reducerId'];
            const csv = [columns.map(csvCell).join(','), ...report.runs.map((run) => columns.map((column) => csvCell(run[column])).join(','))].join('\r\n');
            response.setHeader('Content-Disposition', 'attachment; filename="codebudget-runs.csv"');
            send(response, 200, csv, 'text/csv; charset=utf-8'); return;
          }
          send(response, 400, { error: 'Export format must be json or csv' }); return;
        }
        send(response, 404, { error: 'Unknown API route' }); return;
      }
      const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      if (requested.includes('\\') || requested.includes('\0')) { send(response, 400, { error: 'Invalid asset path' }); return; }
      const asset = safePath(assetsDir, requested.slice(1));
      if (!statSync(asset).isFile() || !mime[extname(asset)]) { send(response, 404, { error: 'Asset not found' }); return; }
      response.writeHead(200, { 'Content-Type': mime[extname(asset)]! }); response.end(readFileSync(asset));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      const notFound = /ENOENT|Unknown evidence/.test(message);
      send(response, notFound ? 404 : 400, { error: redact(message) });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 32;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Dashboard did not acquire a TCP port');
  expectedHost = `127.0.0.1:${address.port}`;
  origin = `http://${expectedHost}`;
  return { url: `${origin}/#token=${token}`, origin, close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()); }) };
}

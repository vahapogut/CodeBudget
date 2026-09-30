import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { bytes, hash, redact, safePath, SECURITY_VERSION, sanitize, safeJson, splitUtf8 } from './security.js';
import { summarizeUsageCoverage } from './usage.js';

export interface Session {
  id: string; repositoryId: string; task: string; status: 'active' | 'closed'; epoch: number;
  createdAt: string; updatedAt: string; state: Record<string, unknown>;
}
export interface Artifact {
  id: string; repositoryId: string; sessionId: string | null; createdAt: string;
  kind: string; redacted: true; truncated: boolean; complete: boolean; sizeBytes: number;
  hash: string | null; metadata: Record<string, unknown>; expiresAt: string;
}
export interface UsageEvent {
  eventId: string; schemaVersion: 1; timestamp: string; repositoryId: string;
  sessionId: string | null; taskId: string | null; correlationId: string;
  source: 'provider_reported' | 'client_reported' | 'locally_estimated';
  scope: string; model: string | null; input: number | null; cachedInput: number | null;
  cacheWrite: number | null; output: number | null; reasoning: number | null;
  total: number | null; counter: 'delta' | 'cumulative'; agent: string | null;
  /** Stable identity of a cumulative counter series (for example a hashed client thread), never raw content. */
  series?: string | null;
}

export class Store {
  readonly db: DatabaseSync;
  readonly repositoryId: string;
  readonly root: string;
  readonly dataDir: string;
  constructor(root: string, readonly config: Config) {
    this.root = realpathSync(root);
    this.repositoryId = hash(process.platform === 'win32' ? this.root.toLowerCase() : this.root);
    this.dataDir = safePath(this.root, config.dataDir);
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const dbFile = safePath(this.root, join(config.dataDir, 'state.sqlite'));
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(dbFile + suffix) && lstatSync(dbFile + suffix).isSymbolicLink()) throw new Error('Symlink database denied');
    this.db = new DatabaseSync(dbFile, { timeout: 5000 });
    try {
      chmodSync(dbFile, 0o600);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;');
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
      if (version > 2) throw new Error('Database created by newer CodeBudget; refusing downgrade');
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, repo TEXT NOT NULL, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, repo TEXT NOT NULL, session TEXT REFERENCES sessions(id), json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS chunks(artifact TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, seq INTEGER NOT NULL, stream TEXT NOT NULL, time TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(artifact,seq));
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, repo TEXT NOT NULL, session TEXT REFERENCES sessions(id), created TEXT NOT NULL, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS usage(event TEXT NOT NULL, repo TEXT NOT NULL, correlation TEXT NOT NULL, source TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(repo,event), UNIQUE(repo,correlation));
        CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, repo TEXT NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS private_raw(artifact TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, seq INTEGER NOT NULL, stream TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(artifact,seq));
        PRAGMA user_version=2;
        COMMIT;`);
      // The index database reserves the remaining quarter of the configured page budget.
      // WAL files are transient and can exceed this total while readers hold snapshots.
      const pageSize = Number(this.db.prepare('PRAGMA page_size').get()?.page_size ?? 4096);
      this.db.exec(`PRAGMA max_page_count=${Math.floor(config.diskBudgetBytes * 0.75 / pageSize)}; PRAGMA journal_size_limit=1048576; PRAGMA wal_autocheckpoint=128;`);
    } catch (error) { this.db.close(); throw error; }
  }
  close(): void { this.db.close(); }
  assertSession(id: string): Session {
    const row = this.db.prepare('SELECT json FROM sessions WHERE id=? AND repo=?').get(id, this.repositoryId);
    if (!row) throw new Error('Unknown session in this repository');
    return JSON.parse(String(row.json)) as Session;
  }
  startSession(task: string, state: Record<string, unknown> = {}): Session {
    const now = new Date().toISOString();
    const session: Session = { id: randomUUID(), repositoryId: this.repositoryId, task: redact(task), status: 'active', epoch: 0, createdAt: now, updatedAt: now,
      state: { acceptanceCriteria: [], outOfScope: [], constraints: [], findings: [], assumptions: [], changedFiles: [], testEvidence: [], openQuestions: [], nextStep: null, ...sanitize(state) } };
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(session.id, this.repositoryId, JSON.stringify(session));
    return session;
  }
  checkpoint(id: string, state: Record<string, unknown> = {}, resetEpoch = true): Session {
    const session = this.assertSession(id);
    if (session.status === 'closed') throw new Error('Session already closed');
    session.state = { ...session.state, ...sanitize(state) };
    session.updatedAt = new Date().toISOString();
    if (resetEpoch) session.epoch++;
    this.db.prepare('UPDATE sessions SET json=? WHERE id=? AND repo=?').run(JSON.stringify(session), id, this.repositoryId);
    return session;
  }
  closeSession(id: string): Session {
    const session = this.assertSession(id);
    session.status = 'closed'; session.updatedAt = new Date().toISOString(); session.epoch++;
    this.db.prepare('UPDATE sessions SET json=? WHERE id=? AND repo=?').run(JSON.stringify(session), id, this.repositoryId);
    return session;
  }
  sessions(): Session[] { return this.db.prepare('SELECT json FROM sessions WHERE repo=? ORDER BY rowid DESC').all(this.repositoryId).map(r => JSON.parse(String(r.json)) as Session); }
  createArtifact(options: { sessionId?: string; kind?: string; metadata?: Record<string, unknown> } = {}): Artifact {
    if (options.sessionId) this.assertSession(options.sessionId);
    const artifact: Artifact = { id: randomUUID(), repositoryId: this.repositoryId, sessionId: options.sessionId ?? null, kind: options.kind ?? 'command', createdAt: new Date().toISOString(),
      redacted: true, truncated: false, complete: false, sizeBytes: 0, hash: null,
      metadata: sanitize({ ...options.metadata, securityVersion: SECURITY_VERSION }), expiresAt: new Date(Date.now() + this.config.artifactRetentionDays * 86400000).toISOString() };
    this.db.prepare('INSERT INTO artifacts VALUES (?,?,?,?)').run(artifact.id, this.repositoryId, artifact.sessionId, JSON.stringify(artifact));
    return artifact;
  }
  getArtifact(id: string, sessionId?: string): Artifact {
    const row = this.db.prepare('SELECT json FROM artifacts WHERE id=? AND repo=?').get(id, this.repositoryId);
    if (!row) throw new Error('Unknown evidence in this repository');
    const artifact = JSON.parse(String(row.json)) as Artifact;
    if (sessionId && artifact.sessionId !== sessionId) throw new Error('Evidence belongs to another session');
    if (Date.parse(artifact.expiresAt) < Date.now()) throw new Error('Evidence expired; prune or rerun explicitly');
    return artifact;
  }
  append(id: string, stream: 'stdout' | 'stderr' | 'text', text: string): boolean {
    const masked = redact(text);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const artifact = this.getArtifact(id);
      artifact.complete = false; artifact.hash = null;
      const used = this.logicalArtifactBytes();
      const available = Math.max(0, Math.min(this.config.outputMaxBytes - artifact.sizeBytes, Math.floor(this.config.diskBudgetBytes * 0.6) - used));
      const encoded = Buffer.from(masked, 'utf8'); let end = Math.min(encoded.length, available);
      while (end < encoded.length && end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
      const retained = encoded.subarray(0, end).toString('utf8');
      const complete = end === encoded.length;
      artifact.truncated ||= !complete;
      let seq = Number(this.db.prepare('SELECT COALESCE(MAX(seq),-1)+1 AS n FROM chunks WHERE artifact=?').get(id)?.n ?? 0);
      const time = new Date().toISOString();
      const insert = this.db.prepare('INSERT INTO chunks VALUES (?,?,?,?,?)');
      for (const line of retained.match(/[^\n]*\n|[^\n]+$/g) ?? []) for (const part of splitUtf8(line)) insert.run(id, seq++, stream, time, part);
      artifact.sizeBytes += end; this.updateArtifact(artifact);
      this.db.exec('COMMIT'); return complete;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private logicalArtifactBytes(): number {
    return Number(this.db.prepare('SELECT (SELECT COALESCE(SUM(length(CAST(text AS BLOB))),0) FROM chunks) + (SELECT COALESCE(SUM(length(bytes)),0) FROM private_raw) AS n').get()?.n ?? 0);
  }
  /** Explicit local raw opt-in only. No read/export method is exposed to MCP/dashboard. */
  appendPrivateRaw(id: string, stream: 'stdout' | 'stderr', value: Buffer): boolean {
    if (!this.config.rawArchive) throw new Error('Private raw archive is disabled');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const artifact = this.getArtifact(id);
      const ownBytes = Number(this.db.prepare('SELECT COALESCE(SUM(length(bytes)),0) AS n FROM private_raw WHERE artifact=?').get(id)?.n ?? 0);
      const rawBytes = Number(this.db.prepare('SELECT COALESCE(SUM(length(bytes)),0) AS n FROM private_raw').get()?.n ?? 0);
      const remaining = Math.max(0, Math.min(this.config.outputMaxBytes - ownBytes, Math.floor(this.config.diskBudgetBytes * 0.2) - rawBytes, Math.floor(this.config.diskBudgetBytes * 0.6) - this.logicalArtifactBytes()));
      const retained = value.subarray(0, remaining);
      if (retained.length) {
        const seq = Number(this.db.prepare('SELECT COALESCE(MAX(seq),-1)+1 AS n FROM private_raw WHERE artifact=?').get(id)?.n ?? 0);
        this.db.prepare('INSERT INTO private_raw VALUES (?,?,?,?)').run(id, seq, stream, retained);
      }
      const complete = retained.length === value.length;
      artifact.metadata = { ...artifact.metadata, rawOptIn: true, rawArchiveBytes: ownBytes + retained.length, rawArchiveTruncated: artifact.metadata.rawArchiveTruncated === true || !complete };
      this.updateArtifact(artifact); this.db.exec('COMMIT'); return complete;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private updateArtifact(artifact: Artifact): void { this.db.prepare('UPDATE artifacts SET json=? WHERE id=? AND repo=?').run(JSON.stringify(artifact), artifact.id, this.repositoryId); }
  finishArtifact(id: string, options: { truncated?: boolean; metadata?: Record<string, unknown> } = {}): Artifact {
    const artifact = this.getArtifact(id);
    artifact.truncated ||= options.truncated ?? false;
    artifact.complete = !artifact.truncated;
    artifact.hash = hash(this.artifactText(id, artifact.sizeBytes));
    artifact.metadata = { ...artifact.metadata, ...sanitize(options.metadata ?? {}) };
    this.updateArtifact(artifact); this.db.exec('PRAGMA wal_checkpoint(PASSIVE)'); return artifact;
  }
  putText(text: string, options: { sessionId?: string; kind?: string; metadata?: Record<string, unknown> } = {}): Artifact {
    const artifact = this.createArtifact(options);
    const masked = redact(text);
    this.append(artifact.id, 'text', masked);
    return this.finishArtifact(artifact.id);
  }
  artifactText(id: string, maxBytes = this.config.outputMaxBytes): string {
    this.getArtifact(id);
    let result = ''; let size = 0;
    for (const row of this.db.prepare('SELECT text FROM chunks WHERE artifact=? ORDER BY seq').iterate(id)) {
      const text = String(row.text); if (size + bytes(text) > maxBytes) break;
      result += text; size += bytes(text);
    }
    return result;
  }
  readEvidence(id: string, offset = 0, limit = 200, sessionId?: string) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Evidence offset >=0; limit 1..1000 records');
    const artifact = this.getArtifact(id, sessionId);
    const rows = this.db.prepare('SELECT seq,stream,time,text FROM chunks WHERE artifact=? AND seq>=? ORDER BY seq LIMIT ?').all(id, offset, limit);
    const chunks: typeof rows = []; let size = 0;
    for (const row of rows) { if (size + bytes(String(row.text)) > 128 * 1024) break; chunks.push(row); size += bytes(String(row.text)); }
    const nextOffset = chunks.length ? Number(chunks[chunks.length - 1]?.seq) + 1 : offset;
    const more = Boolean(this.db.prepare('SELECT 1 FROM chunks WHERE artifact=? AND seq>=? LIMIT 1').get(id, nextOffset));
    this.recordEvent('retrieval', { id, sessionId: artifact.sessionId, offset, limit, returnedBytes: size, timestamp: new Date().toISOString() });
    return { artifact, offset, chunks, nextOffset: more ? nextOffset : null, historicalEvidence: true };
  }
  recordRun(run: Record<string, unknown> & { id: string; sessionId?: string | null }): void {
    if (run.sessionId) this.assertSession(run.sessionId);
    this.db.prepare('INSERT INTO runs VALUES (?,?,?,?,?)').run(run.id, this.repositoryId, run.sessionId ?? null, new Date().toISOString(), safeJson(run));
  }
  runs(sessionId?: string): Record<string, unknown>[] {
    if (sessionId) this.assertSession(sessionId);
    const rows = sessionId ? this.db.prepare('SELECT json FROM runs WHERE repo=? AND session=? ORDER BY created DESC').all(this.repositoryId, sessionId) : this.db.prepare('SELECT json FROM runs WHERE repo=? ORDER BY created DESC').all(this.repositoryId);
    return rows.map(r => JSON.parse(String(r.json)) as Record<string, unknown>);
  }
  recordEvent(kind: string, data: unknown): void { this.db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(randomUUID(), this.repositoryId, kind, safeJson(data)); }
  events(kind: string): unknown[] { return this.db.prepare('SELECT json FROM events WHERE repo=? AND kind=? ORDER BY rowid DESC').all(this.repositoryId, kind).map(r => JSON.parse(String(r.json)) as unknown); }
  addUsage(event: UsageEvent): boolean {
    if (event.repositoryId !== this.repositoryId) throw new Error('Usage repository mismatch');
    if (event.sessionId) this.assertSession(event.sessionId);
    for (const value of [event.input, event.cachedInput, event.cacheWrite, event.output, event.reasoning, event.total]) if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error('Invalid usage count');
    return Number(this.db.prepare('INSERT OR IGNORE INTO usage VALUES (?,?,?,?,?)').run(event.eventId, this.repositoryId, event.correlationId, event.source, safeJson(event)).changes) > 0;
  }
  usage(): UsageEvent[] { return this.db.prepare('SELECT json FROM usage WHERE repo=?').all(this.repositoryId).map(r => JSON.parse(String(r.json)) as UsageEvent); }
  report(sessionId?: string) {
    const runs = this.runs(sessionId);
    const usage = this.usage().filter(e => !sessionId || e.sessionId === sessionId);
    const local = runs.reduce<{ originalBytes: number; reducedBytes: number }>((sum, run) => ({ originalBytes: sum.originalBytes + Number(run.originalSize ?? 0), reducedBytes: sum.reducedBytes + Number(run.reducedSize ?? 0) }), { originalBytes: 0, reducedBytes: 0 });
    const deltas = usage.filter(e => e.counter === 'delta' && (e.source === 'client_reported' || e.source === 'provider_reported') && e.scope !== 'claude-otel-token-metric');
    const observedTotal = deltas.reduce<number | null>((sum, event) => {
      if (sum === null || event.total === null || !Number.isSafeInteger(event.total) || event.total < 0) return null;
      const next = sum + event.total;
      return Number.isSafeInteger(next) ? next : null;
    }, deltas.length ? 0 : null);
    const scopedEvents = (kind: string) => this.events(kind).filter(value => !sessionId || (value !== null && typeof value === 'object' && ['sessionId', 'codebudgetSessionId'].some(key => (value as Record<string, unknown>)[key] === sessionId)));
    return { schemaVersion: 1, repositoryId: this.repositoryId, session: sessionId ? this.assertSession(sessionId) : null, sessions: sessionId ? [this.assertSession(sessionId)] : this.sessions(), runs,
      localOutput: { ...local, savedBytes: local.originalBytes - local.reducedBytes, scope: 'CodeBudget observed calls only, after redaction', unit: 'utf8_bytes' },
      observedUsage: { events: usage, total: observedTotal, scope: 'Imported delta events; no invisible IDE calls counted', cost: null, subscriptionQuota: null, coverage: summarizeUsageCoverage(usage) },
      retrievals: scopedEvents('retrieval'), hookMetrics: scopedEvents('hook'), pluginOverhead: scopedEvents('plugin-overhead'), contextPackages: scopedEvents('context'),
      benchmark: scopedEvents('benchmark'), netTaskSavings: null,
      limitations: ['Local estimates are not billing or subscription quota.', 'Historical command evidence is not a fresh test.', 'Real task benchmark has not run.'] };
  }
  prune(dryRun = true) {
    const all = this.db.prepare('SELECT json FROM artifacts WHERE repo=? ORDER BY rowid').all(this.repositoryId).map(r => JSON.parse(String(r.json)) as Artifact);
    let used = this.logicalArtifactBytes();
    const candidates: Artifact[] = [];
    for (const artifact of all) if (Date.parse(artifact.expiresAt) < Date.now() || used > this.config.diskBudgetBytes * 0.6) { candidates.push(artifact); used -= artifact.sizeBytes + Number(artifact.metadata.rawArchiveBytes ?? 0); }
    if (!dryRun) {
      this.db.exec('BEGIN IMMEDIATE');
      try { for (const artifact of candidates) this.db.prepare('DELETE FROM artifacts WHERE id=? AND repo=?').run(artifact.id, this.repositoryId); this.db.exec('COMMIT'); }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    }
    return { dryRun, artifacts: candidates.map(a => ({ id: a.id, sizeBytes: a.sizeBytes, privateRawBytes: Number(a.metadata.rawArchiveBytes ?? 0) })), sourceFilesAffected: 0 };
  }
}

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, realpathSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { bytes, ensurePrivateDirectory, hash, redact, safePath, SECURITY_VERSION, sanitize, safeJson, splitUtf8 } from './security.js';
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
/** Evidence pages carry this header; bulky timing detail stays in the run record. */
export interface ArtifactHeader {
  id: string; repositoryId: string; sessionId: string | null; kind: string; createdAt: string; expiresAt: string;
  redacted: true; truncated: boolean; complete: boolean; sizeBytes: number; hash: string | null; [detail: string]: unknown;
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
export interface ReclaimResult { artifacts: number; runs: number; events: number; bytesBefore: number; bytesAfter: number }

const SCHEMA_VERSION = 3;
/** Evidence is paged by record (a line, or a 64 KiB part of a longer line) but stored in compact blocks. */
const RECORD_BYTES = 64 * 1024;
const BLOCK_BYTES = 16 * 1024;
/** Default evidence page: well below the 25k-token default MCP result limit of current clients. */
export const EVIDENCE_PAGE_BYTES = 60 * 1024;
const RUN_OUTPUT_BYTES = 16 * 1024;
const RUN_CHUNK_ORDER_ENTRIES = 512;
const RUN_SUMMARY_FIELDS = ['id', 'sessionId', 'createdAt', 'executable', 'args', 'cwd', 'status', 'exitCode', 'childExitCode', 'signal', 'timedOut', 'cancelled', 'durationMs', 'originalSize', 'reducedSize', 'displayedSize',
  'reducerId', 'reducerVersion', 'reason', 'applied', 'truncated', 'artifactId', 'repeatedFailure', 'wrapperError', 'archiveError', 'commandStarted', 'summary'] as const;
const CONTEXT_SUMMARY_FIELDS = ['id', 'purpose', 'status', 'budget', 'sessionId', 'epoch', 'timestamp', 'protocol', 'tokenMeasurement', 'minimumBudget'] as const;

const isStorageFull = (error: unknown): boolean => /SQLITE_FULL|database or disk is full/i.test(error instanceof Error ? error.message : String(error));
const recordsOf = (text: string): string[] => (text.match(/[^\n]*\n|[^\n]+$/g) ?? []).flatMap(line => bytes(line) > RECORD_BYTES ? splitUtf8(line, RECORD_BYTES) : [line]);
function truncateUtf8(text: string, maxBytes: number): string {
  const encoded = Buffer.from(text, 'utf8'); if (encoded.length <= maxBytes) return text;
  let end = maxBytes; while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
  return encoded.subarray(0, end).toString('utf8');
}
const pick = (value: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));

/** Bound what a run record stores; the complete masked output remains in its evidence artifact. */
function compactRun(run: Record<string, unknown>): Record<string, unknown> {
  const compact = { ...run };
  if (typeof compact.output === 'string' && bytes(compact.output) > RUN_OUTPUT_BYTES) {
    compact.outputStoredBytes = RUN_OUTPUT_BYTES; compact.outputStoredTruncated = true; compact.output = truncateUtf8(compact.output, RUN_OUTPUT_BYTES);
  }
  if (Array.isArray(compact.chunkOrder) && compact.chunkOrder.length > RUN_CHUNK_ORDER_ENTRIES) {
    compact.chunkOrderStored = RUN_CHUNK_ORDER_ENTRIES; compact.chunkOrderTruncated = true; compact.chunkOrder = compact.chunkOrder.slice(0, RUN_CHUNK_ORDER_ENTRIES);
  }
  return compact;
}
function summarizeContext(value: unknown): Record<string, unknown> {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const count = (key: string) => Array.isArray(item[key]) ? (item[key] as unknown[]).length : undefined;
  return { ...pick(item, CONTEXT_SUMMARY_FIELDS), task: typeof item.task === 'string' ? truncateUtf8(item.task, 300) : undefined, sourceCount: count('sources'), omittedCount: count('omitted'), detail: 'summary' };
}

export class Store {
  readonly db: DatabaseSync;
  readonly repositoryId: string;
  readonly root: string;
  readonly dataDir: string;
  private readonly pageSize: number;
  constructor(root: string, readonly config: Config) {
    this.root = realpathSync(root);
    this.repositoryId = hash(process.platform === 'win32' ? this.root.toLowerCase() : this.root);
    this.dataDir = safePath(this.root, config.dataDir);
    ensurePrivateDirectory(this.dataDir);
    const dbFile = safePath(this.root, join(config.dataDir, 'state.sqlite'));
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(dbFile + suffix) && lstatSync(dbFile + suffix).isSymbolicLink()) throw new Error('Symlink database denied');
    this.db = new DatabaseSync(dbFile, { timeout: 5000 });
    try {
      chmodSync(dbFile, 0o600);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;');
      this.migrate();
      // The index database reserves the remaining quarter of the configured page budget.
      // WAL files are transient and can exceed this total while readers hold snapshots.
      this.pageSize = Number(this.db.prepare('PRAGMA page_size').get()?.page_size ?? 4096);
      this.db.exec(`PRAGMA max_page_count=${Math.floor(config.diskBudgetBytes * 0.75 / this.pageSize)}; PRAGMA journal_size_limit=1048576; PRAGMA wal_autocheckpoint=128;`);
    } catch (error) { this.db.close(); throw error; }
  }
  /** v3 adds block storage for evidence records and timestamps for event retention. */
  private migrate(): void {
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
    if (version > SCHEMA_VERSION) throw new Error('Database created by newer CodeBudget; refusing downgrade');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(`CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, repo TEXT NOT NULL, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, repo TEXT NOT NULL, session TEXT REFERENCES sessions(id), json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS chunks(artifact TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, seq INTEGER NOT NULL, stream TEXT NOT NULL, time TEXT NOT NULL, text TEXT NOT NULL, first_line INTEGER, line_count INTEGER, PRIMARY KEY(artifact,seq));
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, repo TEXT NOT NULL, session TEXT REFERENCES sessions(id), created TEXT NOT NULL, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS usage(event TEXT NOT NULL, repo TEXT NOT NULL, correlation TEXT NOT NULL, source TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(repo,event), UNIQUE(repo,correlation));
        CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, repo TEXT NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL, created TEXT);
        CREATE TABLE IF NOT EXISTS private_raw(artifact TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, seq INTEGER NOT NULL, stream TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(artifact,seq));`);
      if (version < 3) {
        const columns = (table: string) => new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name)));
        if (!columns('chunks').has('first_line')) this.db.exec('ALTER TABLE chunks ADD COLUMN first_line INTEGER; ALTER TABLE chunks ADD COLUMN line_count INTEGER;');
        // Schema v2 stored exactly one evidence record per row.
        this.db.exec('UPDATE chunks SET first_line=seq, line_count=1 WHERE first_line IS NULL');
        if (!columns('events').has('created')) this.db.exec('ALTER TABLE events ADD COLUMN created TEXT');
        this.db.prepare("UPDATE events SET created=COALESCE(json_extract(json,'$.timestamp'), ?) WHERE created IS NULL").run(new Date().toISOString());
      }
      this.db.exec(`CREATE INDEX IF NOT EXISTS chunks_lines ON chunks(artifact, first_line);
        CREATE INDEX IF NOT EXISTS runs_created ON runs(repo, created);
        CREATE INDEX IF NOT EXISTS events_kind_created ON events(repo, kind, created);
        PRAGMA user_version=${SCHEMA_VERSION};`);
      this.db.exec('COMMIT');
    } catch (error) { this.rollback(); throw error; }
  }
  close(): void { this.db.close(); }
  /** SQLite may already have rolled back (for example after SQLITE_FULL); keep the original error. */
  private rollback(): void { try { this.db.exec('ROLLBACK'); } catch { /* no active transaction */ } }
  /** One write transaction; when storage is full, reclaim expired or oldest data once and retry. */
  private transaction<T>(fn: () => T, protect: readonly string[] = []): T {
    for (let attempt = 0; ; attempt++) {
      this.db.exec('BEGIN IMMEDIATE');
      try { const value = fn(); this.db.exec('COMMIT'); return value; }
      catch (error) {
        this.rollback();
        if (attempt === 0 && isStorageFull(error)) {
          const reclaimed = this.reclaim({ protect });
          if (reclaimed.artifacts + reclaimed.runs + reclaimed.events > 0) continue;
        }
        throw error;
      }
    }
  }
  /** Allocated database pages, not an estimate of text length: row and index overhead counts. */
  physicalBytes(): number {
    const pages = Number(this.db.prepare('PRAGMA page_count').get()?.page_count ?? 0);
    const free = Number(this.db.prepare('PRAGMA freelist_count').get()?.freelist_count ?? 0);
    return (pages - free) * this.pageSize;
  }
  assertSession(id: string): Session {
    const row = this.db.prepare('SELECT json FROM sessions WHERE id=? AND repo=?').get(id, this.repositoryId);
    if (!row) throw new Error('Unknown session in this repository');
    return JSON.parse(String(row.json)) as Session;
  }
  startSession(task: string, state: Record<string, unknown> = {}): Session {
    const now = new Date().toISOString();
    const session: Session = { id: randomUUID(), repositoryId: this.repositoryId, task: redact(task), status: 'active', epoch: 0, createdAt: now, updatedAt: now,
      state: { acceptanceCriteria: [], outOfScope: [], constraints: [], findings: [], assumptions: [], changedFiles: [], testEvidence: [], openQuestions: [], nextStep: null, ...sanitize(state) } };
    this.transaction(() => { this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(session.id, this.repositoryId, JSON.stringify(session)); });
    return session;
  }
  checkpoint(id: string, state: Record<string, unknown> = {}, resetEpoch = true): Session {
    const session = this.assertSession(id);
    if (session.status === 'closed') throw new Error('Session already closed');
    session.state = { ...session.state, ...sanitize(state) };
    session.updatedAt = new Date().toISOString();
    if (resetEpoch) session.epoch++;
    this.transaction(() => { this.db.prepare('UPDATE sessions SET json=? WHERE id=? AND repo=?').run(JSON.stringify(session), id, this.repositoryId); });
    return session;
  }
  closeSession(id: string): Session {
    const session = this.assertSession(id);
    session.status = 'closed'; session.updatedAt = new Date().toISOString(); session.epoch++;
    this.transaction(() => { this.db.prepare('UPDATE sessions SET json=? WHERE id=? AND repo=?').run(JSON.stringify(session), id, this.repositoryId); });
    return session;
  }
  /** Latest active session opened for a client session identifier (for example a Claude session). */
  activeSessionForExternal(externalId: string): Session | undefined {
    const row = this.db.prepare("SELECT json FROM sessions WHERE repo=? AND json_extract(json,'$.state.externalSessionId')=? AND json_extract(json,'$.status')='active' ORDER BY rowid DESC LIMIT 1").get(this.repositoryId, externalId);
    return row ? JSON.parse(String(row.json)) as Session : undefined;
  }
  sessions(): Session[] { return this.db.prepare('SELECT json FROM sessions WHERE repo=? ORDER BY rowid DESC').all(this.repositoryId).map(r => JSON.parse(String(r.json)) as Session); }
  createArtifact(options: { sessionId?: string; kind?: string; metadata?: Record<string, unknown> } = {}): Artifact {
    if (options.sessionId) this.assertSession(options.sessionId);
    // Keep headroom for new evidence: expired and then oldest records go first.
    if (this.physicalBytes() > this.config.diskBudgetBytes * 0.5) this.reclaim();
    const artifact: Artifact = { id: randomUUID(), repositoryId: this.repositoryId, sessionId: options.sessionId ?? null, kind: options.kind ?? 'command', createdAt: new Date().toISOString(),
      redacted: true, truncated: false, complete: false, sizeBytes: 0, hash: null,
      metadata: sanitize({ ...options.metadata, securityVersion: SECURITY_VERSION }), expiresAt: new Date(Date.now() + this.config.artifactRetentionDays * 86400000).toISOString() };
    this.transaction(() => { this.db.prepare('INSERT INTO artifacts VALUES (?,?,?,?)').run(artifact.id, this.repositoryId, artifact.sessionId, JSON.stringify(artifact)); });
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
    return this.transaction(() => {
      const artifact = this.getArtifact(id);
      artifact.complete = false; artifact.hash = null;
      const available = Math.max(0, Math.min(this.config.outputMaxBytes - artifact.sizeBytes, Math.floor(this.config.diskBudgetBytes * 0.6) - this.physicalBytes()));
      const encoded = Buffer.from(masked, 'utf8'); let end = Math.min(encoded.length, available);
      while (end < encoded.length && end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
      const retained = encoded.subarray(0, end).toString('utf8');
      const complete = end === encoded.length;
      artifact.truncated ||= !complete;
      const position = this.db.prepare('SELECT COALESCE(MAX(seq),-1)+1 AS seq, COALESCE(MAX(first_line+line_count),0) AS line FROM chunks WHERE artifact=?').get(id);
      let seq = Number(position?.seq ?? 0); let line = Number(position?.line ?? 0);
      const time = new Date().toISOString();
      const insert = this.db.prepare('INSERT INTO chunks(artifact,seq,stream,time,text,first_line,line_count) VALUES (?,?,?,?,?,?,?)');
      let block: string[] = []; let blockBytes = 0;
      const flush = (): void => { if (!block.length) return; insert.run(id, seq++, stream, time, block.join(''), line, block.length); line += block.length; block = []; blockBytes = 0; };
      for (const record of recordsOf(retained)) {
        const size = bytes(record);
        if (blockBytes + size > BLOCK_BYTES) flush();
        block.push(record); blockBytes += size;
      }
      flush();
      artifact.sizeBytes += end; this.updateArtifact(artifact);
      return complete;
    }, [id]);
  }
  /** Explicit local raw opt-in only. No read/export method is exposed to MCP/dashboard. */
  appendPrivateRaw(id: string, stream: 'stdout' | 'stderr', value: Buffer): boolean {
    if (!this.config.rawArchive) throw new Error('Private raw archive is disabled');
    return this.transaction(() => {
      const artifact = this.getArtifact(id);
      const ownBytes = Number(this.db.prepare('SELECT COALESCE(SUM(length(bytes)),0) AS n FROM private_raw WHERE artifact=?').get(id)?.n ?? 0);
      const rawBytes = Number(this.db.prepare('SELECT COALESCE(SUM(length(bytes)),0) AS n FROM private_raw').get()?.n ?? 0);
      const remaining = Math.max(0, Math.min(this.config.outputMaxBytes - ownBytes, Math.floor(this.config.diskBudgetBytes * 0.2) - rawBytes, Math.floor(this.config.diskBudgetBytes * 0.6) - this.physicalBytes()));
      const retained = value.subarray(0, remaining);
      if (retained.length) {
        const seq = Number(this.db.prepare('SELECT COALESCE(MAX(seq),-1)+1 AS n FROM private_raw WHERE artifact=?').get(id)?.n ?? 0);
        this.db.prepare('INSERT INTO private_raw VALUES (?,?,?,?)').run(id, seq, stream, retained);
      }
      const complete = retained.length === value.length;
      artifact.metadata = { ...artifact.metadata, rawOptIn: true, rawArchiveBytes: ownBytes + retained.length, rawArchiveTruncated: artifact.metadata.rawArchiveTruncated === true || !complete };
      this.updateArtifact(artifact); return complete;
    }, [id]);
  }
  private updateArtifact(artifact: Artifact): void { this.db.prepare('UPDATE artifacts SET json=? WHERE id=? AND repo=?').run(JSON.stringify(artifact), artifact.id, this.repositoryId); }
  finishArtifact(id: string, options: { truncated?: boolean; metadata?: Record<string, unknown> } = {}): Artifact {
    const artifact = this.getArtifact(id);
    artifact.truncated ||= options.truncated ?? false;
    artifact.complete = !artifact.truncated;
    artifact.hash = hash(this.artifactText(id, artifact.sizeBytes));
    artifact.metadata = { ...artifact.metadata, ...sanitize(options.metadata ?? {}) };
    this.transaction(() => this.updateArtifact(artifact), [id]); this.db.exec('PRAGMA wal_checkpoint(PASSIVE)'); return artifact;
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
      const text = String(row.text); const length = bytes(text);
      if (size + length > maxBytes) { result += truncateUtf8(text, maxBytes - size); break; }
      result += text; size += length;
    }
    return result;
  }
  private header(artifact: Artifact): ArtifactHeader {
    const detail = pick(artifact.metadata, ['exitCode', 'signal', 'timedOut', 'cancelled', 'securityVersion', 'source', 'toolUseId', 'chunkSummary']);
    return { id: artifact.id, repositoryId: artifact.repositoryId, sessionId: artifact.sessionId, kind: artifact.kind, createdAt: artifact.createdAt, expiresAt: artifact.expiresAt,
      redacted: true, truncated: artifact.truncated, complete: artifact.complete, sizeBytes: artifact.sizeBytes, hash: artifact.hash, ...detail };
  }
  /** Pages records (lines, or 64 KiB parts of longer lines). Every page returns at least one record. */
  readEvidence(id: string, offset = 0, limit = 200, sessionId?: string, options: { maxBytes?: number; record?: boolean; source?: string } = {}) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Evidence offset >=0; limit 1..1000 records');
    const maxBytes = options.maxBytes ?? EVIDENCE_PAGE_BYTES;
    if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new Error('Evidence page limit must be at least 1024 bytes');
    const artifact = this.getArtifact(id, sessionId);
    const start = this.db.prepare('SELECT seq FROM chunks WHERE artifact=? AND first_line<=? ORDER BY first_line DESC LIMIT 1').get(id, offset);
    const chunks: { seq: number; stream: string; time: string; text: string }[] = []; let size = 0; let nextOffset: number | null = null;
    rows: for (const row of this.db.prepare('SELECT stream,time,text,first_line,line_count FROM chunks WHERE artifact=? AND seq>=? ORDER BY seq').iterate(id, Number(start?.seq ?? 0))) {
      const first = Number(row.first_line); const count = Number(row.line_count);
      if (first + count <= offset) continue;
      const records = count === 1 ? [String(row.text)] : recordsOf(String(row.text));
      for (let index = Math.max(0, offset - first); index < records.length; index++) {
        const chunk = { seq: first + index, stream: String(row.stream), time: String(row.time), text: records[index]! };
        // Count the serialized record, not only its text: short lines are dominated by JSON overhead.
        const length = bytes(JSON.stringify(chunk));
        if (chunks.length >= limit || (chunks.length > 0 && size + length > maxBytes)) { nextOffset = first + index; break rows; }
        chunks.push(chunk); size += length;
      }
    }
    if (options.record !== false) this.recordEvent('retrieval', { id, sessionId: artifact.sessionId, offset, limit, returnedBytes: size, source: options.source ?? 'cli', timestamp: new Date().toISOString() });
    return { id, offset, chunks, nextOffset, artifact: this.header(artifact), historicalEvidence: true as const };
  }
  recordRun(run: Record<string, unknown> & { id: string; sessionId?: string | null }): void {
    if (run.sessionId) this.assertSession(run.sessionId);
    const created = new Date().toISOString();
    this.transaction(() => { this.db.prepare('INSERT INTO runs VALUES (?,?,?,?,?)').run(run.id, this.repositoryId, run.sessionId ?? null, created, safeJson({ ...compactRun(run), createdAt: created })); });
  }
  runs(sessionId?: string, options: { limit?: number; offset?: number } = {}): Record<string, unknown>[] {
    if (sessionId) this.assertSession(sessionId);
    const limit = options.limit ?? -1; const offset = options.offset ?? 0;
    const rows = sessionId ? this.db.prepare('SELECT json FROM runs WHERE repo=? AND session=? ORDER BY created DESC, rowid DESC LIMIT ? OFFSET ?').all(this.repositoryId, sessionId, limit, offset)
      : this.db.prepare('SELECT json FROM runs WHERE repo=? ORDER BY created DESC, rowid DESC LIMIT ? OFFSET ?').all(this.repositoryId, limit, offset);
    return rows.map(r => JSON.parse(String(r.json)) as Record<string, unknown>);
  }
  run(id: string): Record<string, unknown> {
    const row = this.db.prepare('SELECT json FROM runs WHERE id=? AND repo=?').get(id, this.repositoryId);
    if (!row) throw new Error('Unknown run in this repository');
    return JSON.parse(String(row.json)) as Record<string, unknown>;
  }
  /** Repeat detection without loading every run: same argv/cwd, source fingerprint and normalized failure. */
  hasMatchingFailure(match: { sessionId?: string; commandKey: string; sourceFingerprint: string; errorSignature: string }): boolean {
    const scope = match.sessionId ? ' AND session=?' : '';
    const values = [this.repositoryId, ...(match.sessionId ? [match.sessionId] : []), match.commandKey, match.sourceFingerprint, match.errorSignature];
    return Boolean(this.db.prepare(`SELECT 1 FROM runs WHERE repo=?${scope} AND json_extract(json,'$.commandKey')=? AND json_extract(json,'$.sourceFingerprint')=? AND json_extract(json,'$.errorSignature')=? AND COALESCE(json_extract(json,'$.childExitCode'),-1)<>0 LIMIT 1`).get(...values));
  }
  recordEvent(kind: string, data: unknown): void {
    const created = new Date().toISOString();
    this.transaction(() => { this.db.prepare('INSERT INTO events(id,repo,kind,json,created) VALUES (?,?,?,?,?)').run(randomUUID(), this.repositoryId, kind, safeJson(data), created); });
  }
  events(kind: string, options: { sessionId?: string; limit?: number } = {}): unknown[] {
    const scope = options.sessionId ? " AND (json_extract(json,'$.sessionId')=? OR json_extract(json,'$.codebudgetSessionId')=?)" : '';
    const values = [this.repositoryId, kind, ...(options.sessionId ? [options.sessionId, options.sessionId] : []), options.limit ?? -1];
    return this.db.prepare(`SELECT json FROM events WHERE repo=? AND kind=?${scope} ORDER BY rowid DESC LIMIT ?`).all(...values).map(r => JSON.parse(String(r.json)) as unknown);
  }
  /** Complete stored context package by its package ID, for on-demand inspection. */
  contextPackage(id: string): unknown {
    const row = this.db.prepare("SELECT json FROM events WHERE repo=? AND kind='context' AND json_extract(json,'$.id')=? ORDER BY rowid DESC LIMIT 1").get(this.repositoryId, id);
    if (!row) throw new Error('Unknown context package in this repository');
    return JSON.parse(String(row.json)) as unknown;
  }
  addUsage(event: UsageEvent): boolean {
    if (event.repositoryId !== this.repositoryId) throw new Error('Usage repository mismatch');
    if (event.sessionId) this.assertSession(event.sessionId);
    for (const value of [event.input, event.cachedInput, event.cacheWrite, event.output, event.reasoning, event.total]) if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error('Invalid usage count');
    return this.transaction(() => Number(this.db.prepare('INSERT OR IGNORE INTO usage VALUES (?,?,?,?,?)').run(event.eventId, this.repositoryId, event.correlationId, event.source, safeJson(event)).changes) > 0);
  }
  usage(): UsageEvent[] { return this.db.prepare('SELECT json FROM usage WHERE repo=?').all(this.repositoryId).map(r => JSON.parse(String(r.json)) as UsageEvent); }
  /**
   * Bounded report: run and context entries are summaries (see run()/contextPackage() for detail);
   * byte totals still cover every retained run in scope.
   */
  report(sessionId?: string, options: { runLimit?: number; runOffset?: number; eventLimit?: number } = {}) {
    const session = sessionId ? this.assertSession(sessionId) : null;
    const runLimit = options.runLimit ?? 200; const eventLimit = options.eventLimit ?? 100;
    const runs = this.runs(sessionId, { limit: runLimit, offset: options.runOffset ?? 0 }).map(run => pick(run, RUN_SUMMARY_FIELDS));
    const totals = this.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(json_extract(json,'$.originalSize')),0) AS original, COALESCE(SUM(json_extract(json,'$.reducedSize')),0) AS reduced FROM runs WHERE repo=?${sessionId ? ' AND session=?' : ''}`)
      .get(...[this.repositoryId, ...(sessionId ? [sessionId] : [])]);
    const local = { originalBytes: Number(totals?.original ?? 0), reducedBytes: Number(totals?.reduced ?? 0) };
    const usage = this.usage().filter(e => !sessionId || e.sessionId === sessionId);
    const deltas = usage.filter(e => e.counter === 'delta' && (e.source === 'client_reported' || e.source === 'provider_reported') && e.scope !== 'claude-otel-token-metric');
    const observedTotal = deltas.reduce<number | null>((sum, event) => {
      if (sum === null || event.total === null || !Number.isSafeInteger(event.total) || event.total < 0) return null;
      const next = sum + event.total;
      return Number.isSafeInteger(next) ? next : null;
    }, deltas.length ? 0 : null);
    const scopedEvents = (kind: string) => this.events(kind, { sessionId, limit: eventLimit });
    return { schemaVersion: 1, repositoryId: this.repositoryId, session, sessions: session ? [session] : this.sessions(),
      runCount: Number(totals?.n ?? 0), runLimit, runOffset: options.runOffset ?? 0, runs,
      localOutput: { ...local, savedBytes: local.originalBytes - local.reducedBytes, scope: 'CodeBudget observed calls only, after redaction', unit: 'utf8_bytes' },
      observedUsage: { events: usage, total: observedTotal, scope: 'Imported delta events; no invisible IDE calls counted', cost: null, subscriptionQuota: null, coverage: summarizeUsageCoverage(usage) },
      retrievals: scopedEvents('retrieval'), hookMetrics: scopedEvents('hook'), pluginOverhead: scopedEvents('plugin-overhead'), contextPackages: scopedEvents('context').map(summarizeContext),
      benchmark: scopedEvents('benchmark'), netTaskSavings: null, storage: { physicalBytes: this.physicalBytes(), diskBudgetBytes: this.config.diskBudgetBytes },
      limitations: ['Local estimates are not billing or subscription quota.', 'Historical command evidence is not a fresh test.', 'Real task benchmark has not run.'] };
  }
  /**
   * Retention and quota policy shared by explicit prune and automatic reclaim: expired evidence,
   * runs/events older than the retention period, then oldest evidence until physical usage fits.
   */
  private reclaimPlan(targetBytes: number, protect: ReadonlySet<string>) {
    const now = Date.now(); const cutoff = new Date(now - this.config.artifactRetentionDays * 86400000).toISOString();
    const artifacts = this.db.prepare('SELECT id, json FROM artifacts WHERE repo=? ORDER BY rowid').all(this.repositoryId).map(r => JSON.parse(String(r.json)) as Artifact).filter(a => !protect.has(a.id));
    const expired = artifacts.filter(a => Date.parse(a.expiresAt) < now);
    let remaining = this.physicalBytes();
    const selected = new Set(expired.map(a => a.id));
    for (const artifact of expired) remaining -= artifact.sizeBytes + Number(artifact.metadata.rawArchiveBytes ?? 0);
    for (const artifact of artifacts) {
      if (remaining <= targetBytes) break;
      if (selected.has(artifact.id)) continue;
      selected.add(artifact.id); remaining -= artifact.sizeBytes + Number(artifact.metadata.rawArchiveBytes ?? 0);
    }
    const oldRuns = Number(this.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE repo=? AND created<?').get(this.repositoryId, cutoff)?.n ?? 0);
    const oldEvents = Number(this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE repo=? AND COALESCE(created,?)<?').get(this.repositoryId, cutoff, cutoff)?.n ?? 0);
    return { artifacts: artifacts.filter(a => selected.has(a.id)), candidates: artifacts, cutoff, oldRuns, oldEvents };
  }
  private deleteReclaimed(plan: ReturnType<Store['reclaimPlan']>, targetBytes: number): { artifacts: number; runs: number; events: number } {
    let runs = 0; let events = 0; let evicted = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const deleteArtifact = this.db.prepare('DELETE FROM artifacts WHERE id=? AND repo=?');
      for (const artifact of plan.artifacts) deleteArtifact.run(artifact.id, this.repositoryId);
      runs += Number(this.db.prepare('DELETE FROM runs WHERE repo=? AND created<?').run(this.repositoryId, plan.cutoff).changes);
      events += Number(this.db.prepare('DELETE FROM events WHERE repo=? AND COALESCE(created,?)<?').run(this.repositoryId, plan.cutoff, plan.cutoff).changes);
      // Size estimates can undercount older rows: measure pages and keep evicting oldest evidence first.
      const planned = new Set(plan.artifacts.map(a => a.id));
      for (const artifact of plan.candidates) {
        if (this.physicalBytes() <= targetBytes) break;
        if (!planned.has(artifact.id)) { deleteArtifact.run(artifact.id, this.repositoryId); evicted++; }
      }
      // Still above target: drop the oldest run and event records in bounded batches.
      for (let batch = 0; batch < 64 && this.physicalBytes() > targetBytes; batch++) {
        const removedRuns = Number(this.db.prepare('DELETE FROM runs WHERE rowid IN (SELECT rowid FROM runs WHERE repo=? ORDER BY created, rowid LIMIT 100)').run(this.repositoryId).changes);
        const removedEvents = Number(this.db.prepare('DELETE FROM events WHERE rowid IN (SELECT rowid FROM events WHERE repo=? ORDER BY rowid LIMIT 400)').run(this.repositoryId).changes);
        runs += removedRuns; events += removedEvents;
        if (!removedRuns && !removedEvents) break;
      }
      this.db.exec('COMMIT');
    } catch (error) { this.rollback(); throw error; }
    return { artifacts: plan.artifacts.length + evicted, runs, events };
  }
  /** Automatic quota reclamation; returns what was removed. Never touches source files. */
  reclaim(options: { protect?: readonly string[]; targetBytes?: number } = {}): ReclaimResult {
    const targetBytes = options.targetBytes ?? Math.floor(this.config.diskBudgetBytes * 0.4);
    const bytesBefore = this.physicalBytes();
    const plan = this.reclaimPlan(targetBytes, new Set(options.protect ?? []));
    const removed = plan.artifacts.length || plan.oldRuns || plan.oldEvents || bytesBefore > targetBytes ? this.deleteReclaimed(plan, targetBytes) : { artifacts: 0, runs: 0, events: 0 };
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return { ...removed, bytesBefore, bytesAfter: this.physicalBytes() };
  }
  prune(dryRun = true) {
    const targetBytes = Math.floor(this.config.diskBudgetBytes * 0.6);
    const plan = this.reclaimPlan(targetBytes, new Set());
    const result = { dryRun, artifacts: plan.artifacts.map(a => ({ id: a.id, sizeBytes: a.sizeBytes, privateRawBytes: Number(a.metadata.rawArchiveBytes ?? 0) })), runs: plan.oldRuns, events: plan.oldEvents,
      physicalBytes: this.physicalBytes(), sourceFilesAffected: 0 };
    if (!dryRun) {
      const removed = this.deleteReclaimed(plan, targetBytes);
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      return { ...result, removedArtifacts: removed.artifacts, runs: removed.runs, events: removed.events, physicalBytes: this.physicalBytes() };
    }
    return result;
  }
}

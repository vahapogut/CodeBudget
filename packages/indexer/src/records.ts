import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { languageFor } from './parser.js';
import { hash } from './security.js';
import type { ContextPackage, ImportReference, IndexedFile, SourceSymbol } from './types.js';

/** Stored symbol metadata. Bodies are read from disk (hash-verified) when a context is prepared. */
export interface SymbolRecord { name: string; kind: string; startLine: number; endLine: number; start: number; end: number; bytes: number; exported: boolean; refs: number[] }
export interface FileRecord { id: number; path: string; hash: string; language: IndexedFile['language']; parseErrors: boolean; test: boolean; lines: number; bytes: number; symbols: SymbolRecord[]; imports: ImportReference[] }
export type ParsedSymbol = SourceSymbol & { start: number; end: number };

export const TYPE_KINDS = new Set(['interface_declaration', 'type_alias_declaration', 'enum_declaration']);
const KINDS: Record<string, string> = { function_declaration: 'f', generator_function_declaration: 'g', class_declaration: 'c', abstract_class_declaration: 'a', interface_declaration: 'i', type_alias_declaration: 't', enum_declaration: 'e', lexical_declaration: 'l', variable_declaration: 'v' };
const KIND_NAMES: Record<string, string> = Object.fromEntries(Object.entries(KINDS).map(([name, code]) => [code, name]));
export const testFile = (path: string): boolean => /(?:^|\/)(?:__tests__|tests?)(?:\/|$)|[.-](?:test|spec)\.[^.]+$/i.test(path);

/** Same-file interface/type/enum declarations each symbol names, found by identifier tokens. */
export function typeReferences(source: string, symbols: readonly { name: string; kind: string; start: number; end: number }[]): number[][] {
  const types = new Map<string, number[]>();
  symbols.forEach((symbol, index) => { if (!TYPE_KINDS.has(symbol.kind)) return; const list = types.get(symbol.name); if (list) list.push(index); else types.set(symbol.name, [index]); });
  if (!types.size) return symbols.map(() => []);
  return symbols.map((symbol, index) => {
    const found = new Set<number>();
    for (const [identifier] of source.slice(symbol.start, symbol.end).matchAll(/[\p{L}\p{N}_$]+/gu)) for (const target of types.get(identifier) ?? []) if (target !== index) found.add(target);
    return [...found].sort((a, b) => a - b);
  });
}

/** Transitive same-file type references of one symbol, in declaration order. */
export function typeClosure(file: FileRecord, index: number): number[] {
  if (!file.symbols[index]?.refs.length) return [];
  const seen = new Set<number>([index]);
  const pending = [...(file.symbols[index]?.refs ?? [])];
  while (pending.length) {
    const next = pending.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    pending.push(...(file.symbols[next]?.refs ?? []));
  }
  seen.delete(index);
  return [...seen].sort((a, b) => a - b);
}

export function encodeFile(file: Pick<FileRecord, 'language' | 'parseErrors' | 'lines' | 'bytes' | 'symbols' | 'imports'>): string {
  return JSON.stringify({
    l: file.language, e: file.parseErrors ? 1 : 0, n: file.lines, b: file.bytes,
    s: file.symbols.map((symbol) => [symbol.name, KINDS[symbol.kind] ?? symbol.kind, symbol.startLine, symbol.endLine, symbol.start, symbol.end, symbol.bytes, symbol.exported ? 1 : 0, ...(symbol.refs.length ? [symbol.refs] : [])]),
    i: file.imports.map((reference) => [reference.source, reference.statement, reference.dynamic ? 1 : 0]),
  });
}

type EncodedFile = { l: IndexedFile['language']; e: number; n: number; b: number; s: [string, string, number, number, number, number, number, number, number[]?][]; i: [string, string, number][] };
/** Rows migrated from an older schema carry no metadata until the next index reparses them. */
export function decodeFile(id: number, path: string, fileHash: string, value: string): FileRecord {
  const base = { id, path, hash: fileHash, test: testFile(path) };
  if (!value) return { ...base, language: languageFor(path), parseErrors: false, lines: 0, bytes: 0, symbols: [], imports: [] };
  const encoded = JSON.parse(value) as EncodedFile;
  return {
    ...base, language: encoded.l, parseErrors: encoded.e === 1, lines: encoded.n, bytes: encoded.b,
    symbols: encoded.s.map(([name, kind, startLine, endLine, start, end, bytes, exported, refs]) => ({ name, kind: KIND_NAMES[kind] ?? kind, startLine, endLine, start, end, bytes, exported: exported === 1, refs: refs ?? [] })),
    imports: encoded.i.map(([source, statement, dynamic]) => ({ source, statement, dynamic: dynamic === 1, confidence: dynamic === 1 ? 'heuristic' : 'syntax' })),
  };
}

/** Snapshots store sorted path/hash-prefix pairs; identical contents share one compressed row. */
const SNAPSHOT_HASH = 32;
export function encodeSnapshot(entries: Iterable<[string, string]>): { key: string; value: Buffer } {
  const json = JSON.stringify([...entries].map(([path, value]) => [path, value.slice(0, SNAPSHOT_HASH)]).sort((a, b) => a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
  return { key: hash(json), value: deflateRawSync(json) };
}
export function decodeSnapshot(value: Uint8Array): Map<string, string> {
  return new Map(JSON.parse(inflateRawSync(value).toString('utf8')) as [string, string][]);
}
export const sameContent = (stored: string, current: string): boolean => stored.slice(0, SNAPSHOT_HASH) === current.slice(0, SNAPSHOT_HASH);

/** Retained package metadata: expansion accounting and evidence references, never source text. */
export interface StoredPackage { tokenMeasurement: Pick<ContextPackage['tokenMeasurement'], 'tokens' | 'tokenizerId' | 'model' | 'encoding' | 'accuracy'>; expansion: ContextPackage['expansion']; status: ContextPackage['status']; evidence: string[] }
export function compactPackage(pkg: Pick<ContextPackage, 'tokenMeasurement' | 'expansion' | 'status' | 'sources' | 'omitted'>): StoredPackage {
  const { tokens, tokenizerId, model, encoding, accuracy } = pkg.tokenMeasurement;
  return { tokenMeasurement: { tokens, tokenizerId, model, encoding: encoding ?? null, accuracy }, expansion: pkg.expansion, status: pkg.status, evidence: [...new Set([...pkg.sources, ...pkg.omitted].map((source) => source.evidenceId).filter((id) => typeof id === 'string'))] };
}

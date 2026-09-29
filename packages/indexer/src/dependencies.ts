import { posix } from 'node:path';
import type { DependencyIssue, DependencyPolicy, DependencyProvenance, DependencySummary, IndexedFile } from './types.js';

const extensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const relativeSpecifier = (specifier: string): boolean => specifier.startsWith('./') || specifier.startsWith('../');

/** Resolve only indexed local syntax imports. Do not impersonate Node/TypeScript resolution. */
function resolveReference(importer: string, specifier: string, files: Map<string, IndexedFile>): { path: string } | DependencyIssue {
  const issue = (reason: DependencyIssue['reason'], candidates?: string[]): DependencyIssue => ({ importer, specifier, reason, ...(candidates ? { candidates } : {}) });
  if (/[\\\0?#]/.test(specifier)) return issue('unsupported_specifier');
  const base = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (base === '..' || base.startsWith('../') || posix.isAbsolute(base)) return issue('outside_repository');
  const ext = posix.extname(base);
  // Explicit filenames win; .js/.mjs/.cjs may point at a sole corresponding TS source.
  if (ext && extensions.includes(ext) && files.has(base)) return { path: base };
  const alternatives = ext === '.js' ? ['.ts', '.tsx'] : ext === '.jsx' ? ['.tsx'] : ext === '.mjs' ? ['.mts'] : ext === '.cjs' ? ['.cts'] : [];
  const possible = ext ? alternatives.map(extension => base.slice(0, -ext.length) + extension)
    : extensions.flatMap(extension => [base + extension, base + '/index' + extension]);
  const candidates = possible.filter(path => files.has(path)).sort(compare);
  if (candidates.length === 1) return { path: candidates[0]! };
  return issue(candidates.length > 1 ? 'ambiguous' : 'unresolved', candidates.length > 1 ? candidates : undefined);
}

export function expandDependencies(files: Map<string, IndexedFile>, roots: string[], policy: DependencyPolicy): { provenance: Map<string, DependencyProvenance>; summary: DependencySummary } {
  const seeds = [...new Set(roots)].sort(compare);
  const seen = new Set(seeds);
  const provenance = new Map<string, DependencyProvenance>();
  const pending = seeds.map(root => ({ root, path: [root], depth: 0 }));
  const summary: DependencySummary = { ...policy, roots: seeds.length, expandedFiles: 0, issues: [], omittedIssues: 0 };
  const note = (issue: DependencyIssue): void => { if (summary.issues.length < 20) summary.issues.push(issue); else summary.omittedIssues++; };
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const current = pending[cursor]!;
    const importer = current.path.at(-1)!;
    const file = files.get(importer);
    if (!file) continue;
    if (file.parseErrors) { if (file.imports.length) note({ importer, specifier: '', reason: 'parse_error' }); continue; }
    const unique = new Map(file.imports.map(reference => [reference.source + ':' + reference.dynamic, reference]));
    for (const reference of [...unique.values()].sort((a, b) => compare(a.source, b.source))) {
      if (reference.dynamic) { note({ importer, specifier: reference.source, reason: 'dynamic' }); continue; }
      if (!relativeSpecifier(reference.source)) continue;
      const resolved = resolveReference(importer, reference.source, files);
      if (!('path' in resolved)) { note(resolved); continue; }
      if (seen.has(resolved.path)) continue; // Cycles and repeated imports never inflate rank.
      if (current.depth >= policy.maxDepth) { note({ importer, specifier: reference.source, reason: 'depth_limit' }); continue; }
      if (provenance.size >= policy.maxFiles) { note({ importer, specifier: reference.source, reason: 'file_limit' }); continue; }
      const next = { root: current.root, path: [...current.path, resolved.path], depth: current.depth + 1, resolution: 'relative_static_heuristic' as const };
      seen.add(resolved.path);
      provenance.set(resolved.path, next);
      pending.push(next);
    }
  }
  summary.expandedFiles = provenance.size;
  return { provenance, summary };
}

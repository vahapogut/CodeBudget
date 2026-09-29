export interface SourceSymbol {
  name: string;
  kind: string;
  signature: string;
  body: string;
  startLine: number;
  endLine: number;
  exported: boolean;
}

export interface ImportReference {
  source: string;
  statement: string;
  dynamic: boolean;
  confidence: 'syntax' | 'heuristic';
}

export interface IndexedFile {
  path: string;
  hash: string;
  language: 'typescript' | 'tsx' | 'javascript' | 'text';
  content: string;
  symbols: SourceSymbol[];
  imports: ImportReference[];
  parseErrors: boolean;
  test: boolean;
  redacted: boolean;
  lines: number;
}

export interface Tokenizer {
  id: string;
  model: string | null;
  method: string;
  accuracy: 'exact_local' | 'estimated';
  encoding?: string | null;
  modelMapping?: 'verified' | 'unknown' | 'unspecified';
  fallbackReason?: string | null;
  count(text: string): number;
}

export interface LocalTokenizerConfig {
  encoding: 'estimated' | 'o200k_base' | 'cl100k_base';
  model?: string | null;
}

export interface DependencyPolicy { maxDepth: number; maxFiles: number }
export interface DependencyProvenance { root: string; path: string[]; depth: number; resolution: 'relative_static_heuristic' }
export interface DependencyIssue {
  importer: string;
  specifier: string;
  reason: 'ambiguous' | 'unresolved' | 'dynamic' | 'outside_repository' | 'depth_limit' | 'file_limit' | 'parse_error' | 'unsupported_specifier';
  candidates?: string[];
}
export interface DependencySummary extends DependencyPolicy {
  roots: number;
  expandedFiles: number;
  issues: DependencyIssue[];
  omittedIssues: number;
}

export interface IndexerOptions {
  maxFileBytes?: number;
  maxFiles?: number;
  maxTotalBytes?: number;
  diskBudgetBytes?: number;
  retentionDays?: number;
  maxSnapshots?: number;
  maxPackages?: number;
  maxEvidence?: number;
  redact?: (text: string) => string;
  securityPolicyId?: string;
  tokenizer?: Tokenizer;
  tokenizerConfig?: LocalTokenizerConfig;
  dependencies?: Partial<DependencyPolicy>;
  weights?: Partial<{ name: number; text: number; location: number; dependency: number; test: number }>;
}

export interface PrepareContextOptions {
  task: string;
  budget: number;
  sessionId?: string;
  epoch?: string;
  requiredPaths?: string[];
  acceptanceCriteria?: string[];
  constraints?: string[];
  previousPackageId?: string;
  protocol?: 'json' | 'mcp_text';
}

export interface ContextSource {
  evidenceId: string;
  path: string;
  hash: string;
  symbol: string | null;
  startLine: number;
  endLine: number;
  code: string;
  imports: string[];
  types: string[];
  reason: string[];
  score: number;
  mandatory: boolean;
  complete: boolean;
  redacted: boolean;
  parseErrors: boolean;
  support: 'syntax' | 'text_fallback';
  dependency: DependencyProvenance | null;
}

export interface ContextPackage {
  schemaVersion: 1;
  id: string;
  repositoryId: string;
  sessionId: string | null;
  epoch: string | null;
  purpose: string;
  acceptanceCriteria: string[];
  constraints: string[];
  sources: ContextSource[];
  omitted: { path: string; symbol: string | null; evidenceId: string; reason: string }[];
  omittedCount: number;
  missingRequired: string[];
  status: 'ready' | 'budget_exceeded' | 'missing_required' | 'snapshot_inconsistent';
  budget: number;
  minimumRequiredTokens: number;
  tokenMeasurement: { tokens: number; method: string; tokenizerId: string; model: string | null; encoding: string | null; modelMapping: 'verified' | 'unknown' | 'unspecified'; fallbackReason: string | null; accuracy: 'exact_local' | 'estimated'; scope: string; guaranteed: boolean };
  dependencyExpansion: DependencySummary;
  expansion: { count: number; cumulativeTokens: number; previousPackageId: string | null };
  warnings: string[];
}

export interface IndexResult {
  repositoryId: string;
  indexed: number;
  unchanged: number;
  deleted: number;
  files: number;
  symbols: number;
  skipped: { path: string; reason: string }[];
  snapshotId: string;
}

export interface ChangePackage {
  schemaVersion: 1;
  repositoryId: string;
  since: string | null;
  snapshotId: string;
  sessionId: string | null;
  changes: { type: 'added' | 'modified' | 'deleted' | 'renamed'; path: string; previousPath?: string; hash: string | null }[];
  scope: string;
}

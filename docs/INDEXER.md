# Repository index and context packages

`packages/indexer` is an offline TypeScript/JavaScript syntax index, FTS5 search engine, working-tree snapshot service and context budget selector. It does not execute repository scripts or resolve a TypeScript type graph.

```ts
const indexer = await createIndexer(root, dataDir, {
  redact: coreRedactor,
  securityPolicyId: 'core-redaction-v1',
  dependencies: { maxDepth: 2, maxFiles: 64 },
  tokenizerConfig: { encoding: 'o200k_base', model: 'gpt-4o' },
});
await indexer.index();
const context = await indexer.prepareContext({
  task: 'Fix refresh token rotation', budget: 8000,
  sessionId: 'session-id', epoch: 'context-epoch',
  requiredPaths: ['src/auth.ts'],
  acceptanceCriteria: ['The existing refresh-token regression test passes'],
  constraints: ['Preserve the public API'],
});
indexer.readEvidence(context.sources[0].evidenceId, { sessionId: 'session-id', offset: 0, limit: 200 });
const before = indexer.getChanges(undefined, 'session-id');
const after = indexer.getChanges(before.snapshotId, 'session-id');
indexer.close();
```

`since` accepts a snapshot ID returned by this service, not an arbitrary Git ref. Snapshots compare saved, eligible working-tree file hashes and include untracked files. Identical-content moves are inferred as renames; modified moves are an addition and a deletion. Unsaved editor buffers are unavailable. The real repository/worktree path identifies the database. Snapshots, evidence and expansion chains reject another session's identifier.

The database is `index-<legacy-cache-id>.sqlite` inside the configured data directory. Its filename retains the original 24-character cache identity. Public repository IDs use the same full normalized-root SHA-256 as core; existing caches survive the identity fix. It uses WAL, a five-second busy timeout, prepared statements and transaction commits. Schema 2 migrates schema 1 with retention timestamps. Concurrent instances in one process serialize indexing; SQLite arbitrates separate processes. The opened source inode is checked with bigint identities. Windows `lstat.dev` can be zero, so a zero device field is not compared against `fstat`'s volume serial. Corrupt databases and unsupported future schema versions fail explicitly; no automatic destructive recovery is attempted. This is a rebuildable index, not the authoritative source of code. Linked data directories and database files are rejected.

## Source boundary

Root and nested `.gitignore`/`.codebudgetignore` rules apply. Hard exclusions for `.git`, `.codebudget`, dependency/build directories, environment files, private keys, credentials and database archives cannot be negated. The configured data directory is also excluded. Symlinks and directory junctions are skipped; every read validates repository containment and refuses linked path components. Traversal and absolute POSIX/Windows/UNC paths are rejected. Only supported text extensions are read, with fatal UTF-8 decoding and binary detection. Defaults are 1 MiB per file, 64 MiB total source bytes and 20,000 files. Skipped sources and reasons are visible.

The index persists redacted source, symbols, imports and full original content hashes. A custom security policy ID participates in invalidation. An unversioned injected redactor forces reparsing to avoid reuse under an unknown policy. Redaction failures abort delivery. Detectors are defense in depth, not a promise that every secret is recognized. Evidence reads validate the current source hash and apply full-source redaction before pagination; multiline redaction that changes line layout returns a safe explanatory placeholder rather than a misleading page.

## Parsing and ranking

Runtime: `web-tree-sitter@0.27.0`; official grammar packages: `tree-sitter-javascript@0.25.0`, `tree-sitter-typescript@0.23.2`. Their shipped WASM files support JS, JSX, TS and TSX with no runtime network. On 2026-09-29, a direct Node 22.16.0 parse of all three grammars passed. `tree-sitter-wasms@0.1.13` failed the current loader's dynamic-link format and was replaced, not silently treated as semantic support.

Official references checked: [Tree-sitter WebAssembly binding instructions](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md), [Node SQLite](https://nodejs.org/api/sqlite.html), [SQLite FTS5](https://www.sqlite.org/fts5.html). The FTS5 website fetch was unavailable during this session; an actual SQLite 3.49.1 FTS5 create/query smoke test validated runtime availability. Registry versions and package WASM contents were checked with `npm view` and `npm pack --dry-run`.

Stored top-level functions, classes, variables and type declarations retain actual bodies and source lines. Imports/exports have syntax-level references; relative import resolution, dynamic calls and associated tests are explicitly heuristic. Incomplete syntax is retained with `parseErrors`; other supported text files have `text_fallback`. No semantic support is claimed for other languages.

Selection combines symbol/file tokens, explicit locations, FTS5 matches, bounded transitive imports and related test candidates. Defaults: name 12, text 4, location 30, dependency 6, test 5. These are configurable ranking weights, not calibrated probabilities. File extensions alone never seed relevance. Optional sources sort by score/token cost with stable path/line tie-breaking. Local type declarations and imports accompany selected bodies. Explicit required paths, and known paths mentioned in a task, are mandatory. Required missing/ignored sources are reported.

Static relative imports and re-exports expand breadth-first from explicit/name-matched sources, default depth 2 and at most 64 additional files. Each selected dependency carries a root, the complete file path chain, depth and `relative_static_heuristic` label. Shortest paths win; ties use stable path ordering. A file receives the dependency weight once, divided by depth. Cycles cannot inflate scores. `contextDependencies` in `.codebudget.json` controls `maxDepth` (0–8) and `maxFiles` (0–512); zero disables expansion. Roots remain separately eligible for ordinary selection. Expansion makes dependencies candidates, not mandatory inclusions.

Resolution uses only safely indexed files. An existing explicit code filename wins. A missing `.js`/`.jsx`/`.mjs`/`.cjs` filename may map to its sole corresponding TS/TSX/MTS/CTS source; extensionless imports check supported code extensions and directory `index` files. Multiple candidates are reported as ambiguous and never guessed. Dynamic import/require, malformed importer syntax, unresolved paths, unsupported query/escaped specifiers, root escapes and depth/file limits appear in `dependencyExpansion.issues` (20 details plus omitted count). Bare package names and aliases are excluded; there is no tsconfig, package-exports, bundler, runtime or type resolver. Final validation checks every included chain's intermediate hashes, even when an intermediate body was omitted for budget. Changed paths withhold the whole stale package.

## Budget and expansion

The entire serialized package is measured, including paths, reasons, warnings, dependency provenance, omitted references, constraints and token metadata. `protocol: 'mcp_text'` includes the controlled MCP content/text result envelope and JSON escaping; JSON-RPC transport framing and hidden client/provider context remain outside this measurement. The default UTF-8-byte/2 estimator identifies itself as estimated, model unknown, without a provider budget guarantee.

`js-tiktoken@1.0.21` provides opt-in **exact local** BPE with shipped `o200k_base` and `cl100k_base` rank tables. Only the lite encoder and those two tables are bundled; encoding/counting makes no model or network call. Configure `.codebudget.json` with `"contextTokenizer": { "encoding": "o200k_base", "model": "gpt-4o" }`, or use `codebudget context --task "Fix auth" --tokenizer o200k_base --model gpt-4o`. Omitting `model` counts the chosen encoding exactly without asserting a model mapping. Both CLI and MCP workers apply project configuration. The async library factory accepts `tokenizerConfig`; direct constructor callers can inject a ready `Tokenizer` instead.

The explicit model-label allowlist is `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-5`, `o1`, `o3`, `o4-mini` for `o200k_base`, and `gpt-4`, `gpt-3.5-turbo` for `cl100k_base`. A contradictory known pair fails. Unverified labels, including unlisted dated/future aliases, fall back to the byte estimate with `modelMapping: unknown` and a visible `fallbackReason`; there is no prefix guessing. Metadata identifies encoding, model, tokenizer version, method and `exact_local`/`estimated` accuracy. `guaranteed: true` refers only to the exact stated serialized-text scope, never provider usage, conversation framing, quotas or billing. Source strings such as `<|endoftext|>` count as ordinary text, not special tokens. Imported provider usage remains separate.

The finite model mapping was checked against [OpenAI's tiktoken mapping](https://github.com/openai/tiktoken/blob/main/tiktoken/model.py). English, arithmetic and Japanese regression counts use the [official token-counting cookbook](https://developers.openai.com/cookbook/examples/how_to_count_tokens_with_tiktoken). Local loading follows the [js-tiktoken lite API](https://github.com/dqbd/tiktoken/blob/main/js/README.md). Tables are cached per process and source token costs are computed once per selection; whole-envelope counts are still required as selection changes. Count metadata converges by recounting the final serialization, up to 20 iterations. A tokenizer whose self-referential count does not converge raises an error rather than returning a false exact count.

Mandatory source bodies are never silently cut. If required content or the minimum metadata envelope is too large, status is `budget_exceeded` with `minimumRequiredTokens`, retained mandatory content and an expansion warning. Optional omissions have bounded detail references when those references fit. A changed source during final validation produces `snapshot_inconsistent` and withholds stale excerpts.

Pass `previousPackageId` to track expansion count and cumulative package tokens. Session/epoch or tokenizer identity changes reject the chain to prevent adding incompatible units. A new epoch or tokenizer starts a new chain. Selection policy, weights, dependency limits and tokenizer identity participate in package IDs. Every package resends chosen sources: the service never assumes that the client still remembers an earlier package.

## Verification

Focused indexer and tokenizer tests cover real WASM parsing, FTS5 selection, ignored/sensitive files, damaged syntax, Unicode paths, symlink junctions, traversal, source mutation, deletion/rename, concurrent connections, repository/session isolation, epoch resets, redaction/cache invalidation, envelope accounting, mandatory overflow, size limits, metadata retention and SQLite disk quota rollback. Import-graph tests cover transitive re-exports, JS-to-TS paths, cycles, ambiguity, depth/file bounds, deterministic provenance and changed intermediate files. Tokenizer tests check official golden counts, literal special-looking strings, model fallback, exact JSON/MCP envelope accounting and incompatible expansion rejection. Separate CLI, MCP-worker and config tests verify the public configuration paths. Public repository identity is verified against core, while the legacy cache file remains readable.

Synchronous scanning and `node:sqlite` work should run in a worker when a caller requires enforceable timeout/cancellation. Cancellation cannot interrupt a synchronous filesystem operation in the same event loop. No claims of live IDE verification or task-level savings follow from these tests.

## Retention and disk limits

`IndexerOptions` accepts `retentionDays` (default 14), `maxSnapshots` (1000), `maxPackages` (500), `maxEvidence` (10000), and `diskBudgetBytes` (32 MiB). Snapshot and package admission automatically prunes expired/oldest metadata. Evidence referenced by retained packages is preserved; if the evidence count would exceed the cap, older packages are evicted with their orphan references. A single package larger than the evidence-reference cap is rejected explicitly. A reference from an evicted package is no longer valid. `prune(true)` previews IDs and row counts; `prune(false)` removes only snapshot/package/evidence metadata and truncates the WAL when SQLite permits. Neither operation deletes source files or indexed source rows.

SQLite `max_page_count` bounds main-database growth and full-disk errors roll back the index transaction. Deleting rows makes pages reusable; it does not promise immediate physical database shrinkage. Automatic checkpoints and `journal_size_limit` bound normal retained journal size, but an active transaction or another reader can temporarily retain WAL pages above that target. Thus `diskBudgetBytes` is a main-database page quota, not a strict aggregate filesystem hard cap. The caller should allocate this index quota separately from the artifact store. No claim is made that metadata pruning can reclaim an oversized source index; increasing its budget or rebuilding the derived index is then required.

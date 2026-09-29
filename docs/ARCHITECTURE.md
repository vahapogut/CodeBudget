# Architecture

CodeBudget is a local TypeScript workspace with one distributable CLI and a native Claude Code plugin. The CLI runs on demand. MCP and the dashboard are opt-in long-running processes. No hosted account, background daemon, vector database or model call is required for the core.

```mermaid
flowchart LR
  CLI[CLI] --> Core[Core and SQLite]
  Claude[Claude plugin] --> Hook[Validated hook adapter]
  Hook --> Core
  Hook --> Reducers[Deterministic reducers]
  CLI --> Runner[Executable and argv runner]
  Runner --> Redaction[Bounded redaction]
  Redaction --> Core
  Redaction --> Reducers
  MCP[Stdio MCP] --> Core
  MCP --> Indexer[Tree-sitter and FTS5]
  Indexer --> Context[Budgeted source packages]
  Dashboard[Local dashboard] --> Core
  Benchmarks[Replay and task harness] --> Reducers
```

## Boundaries

| Area | Responsibility |
| --- | --- |
| `apps/cli` | Parse commands, enforce explicit action boundaries, present local evidence. |
| `apps/dashboard` | Accessible local views backed by stored records. |
| `packages/core` | Versioned config, paths/redaction, SQLite, artifacts, sessions, usage and command runner. |
| `packages/reducers` | Format detection, parsing, deterministic transformation and separate evidence validation. |
| `packages/indexer` | Repository scanning, packaged grammars, symbols/imports, FTS5, source freshness, context selection. |
| `packages/mcp` | Three bounded tools, stdio transport and repository-scoped evidence references. |
| `packages/adapters` | Per-client capability matrix, reversible project settings, validated Claude hook events. |
| `packages/benchmarks` | Replay fixtures, thirty-task corpus, hidden evaluators and opt-in task runner contract. |

Core does not depend on a particular IDE. A client's documented capability, implementation and verification level are independent fields. `supported` never implies a real-client acceptance test passed.

## Data flow

A command is represented as an executable plus argv. The runner observes stdout/stderr chunks, decodes UTF-8 across boundaries, applies masking and writes bounded evidence. Failure, cancellation, timeout, wrapper failure and output truncation remain distinct. It never executes a command twice to measure reduction. The safe original archive is historical evidence, not a substitute for running tests again.

Reducers receive masked content. The original and reduced content-byte totals therefore share a security boundary. Reduction candidates must preserve protected evidence and offer a content gain. Observe mode reports candidate opportunities without replacing text. Machine consumers retain their required original/structured shape. Diff summaries are labeled as evidence rather than applicable patches. Envelope overhead and retrieval calls belong in task-level consumption accounting.

The indexer reads saved working-tree files with ignore rules, sensitive-path exclusions, symlink checks and size limits. Tree-sitter provides syntax structure for JS/TS/JSX/TSX, not a full type resolver or exact call graph. Other languages have labeled text fallback. Stable ranking combines task terms, source locations, names, dependencies and related tests. Context includes actual code, hashes, ranges, reasons, omissions and explicit completeness. Final serialized controlled envelopes are included in token estimates.

`prepare_context(task,budget,sessionId?)`, `read_evidence(id,offset?,limit?)` and `get_changes(since,sessionId?)` form the MCP surface. IDs resolve authorized source/artifact references; arbitrary filesystem paths and generic shell tools are not exposed. Protocol stdout is reserved for MCP messages and logs use stderr.

## Local state

Project configuration is `.codebudget.json`. The default `.codebudget/` directory contains local SQLite state and artifacts, excluded from Git. SQLite uses prepared statements, foreign keys, WAL and a busy timeout. Repository identity derives from the canonical root; worktrees with different roots are isolated. Artifact IDs are checked against repository and optional session scope, expiry and page limits.

Sessions store task purpose, acceptance criteria, constraints, findings, assumptions, changed files, evidence, questions and next step. Compaction/session events reset visibility assumptions when observable. Where lifecycle events are unavailable, the system cannot assume a model still sees prior context. Saved source hashes govern freshness; unsaved editor buffers are outside visibility.

Usage events retain provenance (`provider_reported`, `client_reported`, `locally_estimated`) and unknown fields. Stable correlation IDs deduplicate observations. Imported cumulative metric samples are not summed as independent requests. Cache and reasoning subfields retain provider-specific relationships. Bills and quotas remain unknown without validated information.

## Experimental boundary

Experimental model functions are off by default and independently flagged. A configured local endpoint or authorized API runner is a separate workflow, with limits, cancellation and evidence requirements. It does not change an IDE subscription's endpoint or account. See [experimental module](EXPERIMENTAL.md).

## Packaging and verification

The build bundles the CLI, plugin entry points, local dashboard assets, Tree-sitter runtime and grammars. Package smoke tests install a generated archive into a temporary project and exercise its commands. Dependency acquisition can require the network; packaged core use does not. Cross-platform CI is not evidence that all platforms have already run successfully; the execution record belongs in [verification](VERIFICATION.md).

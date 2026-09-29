# Verification record

Date: 2026-09-29. Product: 0.1.0-beta.1. Only executed checks are reported as passed. The real Claude model-visible acceptance gate remains open.

## Roadmap completion follow-up

The local roadmap improvements are implemented: nine captured reducer families, bounded transitive relative imports with provenance/freshness checks, two offline tokenizers with explicit model mapping, usage-gap/cumulative-series diagnostics and Claude2.1.216 PostCompact handling. The README now includes both dashboard themes and a concise native-plugin quickstart. The tokenizers remain opt-in; exact local encoding does not establish provider billing.

The final pnpm verify passed lint, strict types, **14 Vitest files / 244 tests**, production build and **2 browser tests**. The updated frozen lockfile installs across all nine workspace projects. The refreshed dependency audit reports zero known advisories. There are 107 production/runtime license records, including a SHA-256-checked MIT text from the exact js-tiktoken npm gitHead because its npm archive omits that text.

The actual installed Codex0.139.0 app-server also connected to CodeBudget and discovered all three MCP tool schemas using an isolated temporary home and project. Only initialize, initialized and mcpServerStatus/list were sent: zero threads, turns, model or account requests. The final-build rerun passed; see [client smoke](CLIENT_SMOKE.md) and [result](client-smoke-result.json). This is client handshake evidence, not a model acceptance test.

## Cross-platform CI

The authorized initial push507f96f ran [all six OS/Node jobs](https://github.com/vahapogut/CodeBudget/actions/runs/36618600353). Both Ubuntu jobs passed the full verification and installed-package checks. Both macOS jobs exposed a real path-alias issue: canonical /private/var roots were compared with lexical /var targets. Both Windows jobs exposed adapter-test expectations comparing 8.3 temporary paths with canonical names. The first run is retained in [ci-results.json](ci-results.json), including failures.

The fix resolves only a verified repository-root alias, then checks every descendant for links. It continues rejecting outside paths, linked descendants, self-links and dangling links. Indexer data-directory resolution uses the same boundary, and adapter tests compare canonical roots. New regression tests cover these cases. The corrected local pnpm verify passed all244 tests in14 files,2 browser tests, lint/types/build; the22-check clean package install and actual Codex handshake also passed again. The corrected CI run will be recorded after completion.

The optional [Claude no-model health probe](CLAUDE_CLIENT_PROBE.md) did not establish the requested configuration isolation and was stopped. It does not count as a successful client connection. No prompt or model request was submitted.

## Dashboard redesign follow-up

The interface was replaced with a compact neutral developer workspace, command/session search, result filters, collapsible adapter details and a persisted light/dark toggle. The existing authenticated server and data model were retained. Evidence selection now clears the previous archive and rejects late responses. Timeout/cancelled filters use their actual stored flags; moving from a searched session into Outputs clears the session query.

The redesign passed pnpm verify (201 unit/integration tests, lint/typecheck/build and 2 browser tests). After the subsequent theme and filter refinements, targeted ESLint, repository typecheck, Vite production build and both expanded browser tests passed again. They exercise theme switching and persistence after reload, command search/reset, success/failure/timeout/cancelled filters, session-search navigation, keyboard focus, safe evidence rendering, exports, unauthorized access, no external requests and 390px overflow checks. An initial mobile overflow failure exposed an absolutely positioned hidden table heading; containing it within the table fixed the cause, and the repeated browser checks passed. Desktop/light/dark/mobile screenshots were inspected. The already-open local dashboard was refreshed and its actual records rendered with the new theme.

## Environment and initial probes

- Initial checkout contained the supplied master prompt. git ls-remote against the supplied GitHub remote succeeded with no refs. Local main/origin were initialized; no remote write occurred.
- Windows, Node v22.16.0, pnpm10.33.2, Claude Code2.1.216, Codex CLI0.139.0.
- Actual node:sqlite FTS5 create/insert/select passed; SQLite3.49.1. This runtime emits the experimental SQLite warning.
- Real web-tree-sitter0.27 parsing passed with official JavaScript0.25 and TypeScript/TSX0.23.2 WASMs. An initially probed older grammar bundle was incompatible and replaced.
- npm registry version/engine queries and official sources informed exact dependency pins. pnpm-lock.yaml records the graph.

## Final local gates

| Executed command | Actual result |
|---|---|
| pnpm verify | Passed after roadmap integration: lint, strict TypeScript, 14 Vitest files / 244 tests, production build, 2 Chromium Playwright tests. No model calls. |
| pnpm install --frozen-lockfile | Passed for all 9 workspace projects after final manifests. |
| pnpm build | Passed after standalone plugin license/assets packaging updates. |
| pnpm smoke:package | 22 installed-package checks passed on Windows Node22.16.0; see [package-smoke-result.json](package-smoke-result.json). |
| pnpm smoke:clients | Passed with installed Codex0.139.0: actual project-local MCP handshake and three tool schemas, zero model calls; [result](client-smoke-result.json). |
| claude plugin validate --strict ./plugins/claude-codebudget | Passed locally and against installed package with Claude2.1.216. No model invoked. |
| pnpm audit --json | Zero known advisories at audit time; [dependency-audit.json](dependency-audit.json). Not proof of no vulnerabilities. |
| node dist/cli.js benchmark replay --corpus all | All preservation checks passed; [replay-final.json](replay-final.json). |
| node dist/cli.js data prune --dry-run | Scoped artifact/index metadata preview; no source deletion. |

Tests include injected failures, reducer preservation, real task evaluators, protocol and browser flows. Temporary roots and local/mock transports are used; a real model is never connected by these checks.

The final review added regressions for exact CLI context serialization, complete MCP dashboard records and validated persisted task constraints/acceptance criteria. A focused parallel run initially hit two process-startup timeouts; sequential focused checks then passed, and the final unmodified four-worker pnpm verify passed all201 tests. Timeout thresholds were not increased. If startup timeouts recur on a loaded machine, retain the failure evidence and investigate contention rather than suppressing them.

## Installed-package evidence

The smoke script produces the release archive, installs it into a clean temporary project with lifecycle scripts disabled, and executes installed files. It checks:

- Observe-default init, offline source index/context, argv execution/session report and artifact retrieval.
- Four offline WASMs, both packaged BPE encodings, unknown-model estimate fallback, official SDK stdio schemas and actual source retrieval through the bundled worker.
- Dashboard assets, authentication refusal and actual SQLite report.
- Strict native Claude manifest, static plugin-overhead measurement without added context, standalone hook reduction preserving diagnostic/exit/stderr, and masked original archive retrieval.
- Plugin MCP launched from a subdirectory finds the same initialized project as the hook; PreCompact/PostCompact reset visibility without storing conversation summaries.

This is a real local hook process with protocol input, **not a Claude model session**. The record explicitly reports modelCalls=0 and globalChanges=false. Both CLI archive and standalone plugin include license notices, inventory and original license texts.

Release command: pnpm pack:release. Artifact: dist/codebudget-0.1.0-beta.1.tgz. Plain pnpm pack is not the release workflow; no npm publication occurred. Build timestamps mean independent archives need not have identical hashes.

## Replay measurements

| Corpus | Cases | Input UTF-8 bytes | Reduced content bytes | Weighted reduction | Preservation |
|---|---:|---:|---:|---:|---|
| Original synthetic, deliberately noisy | 10 | 22,881 | 3,695 | 83.85% | All passed |
| Actual executed-command captures | 9 | 6,819 | 5,786 | 15.1488% | All passed |

Actual captures: Vitest5.0.2, Jest30.5.2, TypeScript5.9.3, ESLint9.39.2, Git2.49.0.windows.1 status/diff, ripgrep15.2.0, and original JSON/log fixture programs executed with Node22.16.0. [Capture metadata](../tests/fixtures/reducers/captured/manifest.json) records argv/versions/exit states/normalization and source hashes. These are deliberately authored coverage fixtures, not representative production traffic.

The actual set did **not** meet the 50% hypothesis. No blended percentage is reported. Captured result JSON envelopes total 10,369 bytes, exceeding the 6,819 original content bytes; equivalent baseline/client envelope remains unmeasured, so content reduction does not establish net prompt reduction. Heap deltas are point samples, not peak memory.

Bytes are local measurements; replay tokens are local estimates; context may use explicit exact local encodings; imported usage is client-reported. Provider cost, consumption per successful real task and quota savings are unknown. Thirty task reference solutions passed their evaluators, but those and the 270-run plan are not model experiments.

## Adapter boundary

| Client | Observed version | Executed checks | Not executed |
|---|---|---|---|
| Claude Code | 2.1.216 | 44 adapter/hook tests, strict manifest, installed standalone hook/MCP/archive smoke | Real model-facing replacement/consumption acceptance |
| Codex CLI | 0.139.0 | Actual app-server MCP handshake/discovery, config contracts and usage importer tests | Tool use through a model session, real usage capture and quality |
| Cursor | Unknown | Project-config contracts | Version/client launch/live MCP |
| Antigravity | Unknown | Project-config contracts | Version/client launch/live MCP |

Unknown native hook versions decline semantic replacement. MCP does not intercept all built-in client tools. See [ADAPTERS.md](ADAPTERS.md) and [official-source research](RESEARCH_ADAPTERS.md).

## Remaining limits

- R22 blocked_external: model invocation needs separate explicit authorization in the user's request. Manifest/process tests do not satisfy that gate.
- No paid task benchmark, billing/quota experiment or real experimental summarizer/BYOK quality test.
- First CI run: Ubuntu22/24 passed; macOS/Windows path mismatches are being corrected and reverified. See the cross-platform section and exact run evidence.
- SQLite API is experimental on this runtime. Quotas limit main pages; active WAL transactions may transiently use additional disk. Prune excludes source files.
- Redaction is imperfect defense in depth. Explicit run --raw forwards original unmasked machine bytes while archives stay masked. Unsupported native responses are not a universal secret filter.
- Context ranking is syntactic/heuristic, not complete type/call resolution. Explicit local BPE counts cover only the controlled text; default estimates and hidden provider overhead are not exact provider counts. Unsaved editor buffers are invisible.
- GitHub push is explicitly authorized. No account linking, global IDE mutation, npm publication, deployment or package-name ownership claim.

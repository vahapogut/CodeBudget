# Verification record

Date: 2026-09-30. Current product: 0.1.0-beta.3 (unreleased). Only executed checks are reported as passed. The real Claude model-visible acceptance gate remains open.

## Roadmap follow-up: real client connections

On 2026-09-30 (Linux, Node v22.22.2) both no-model client checks ran against the built CLI:

| Executed command | Actual result |
|---|---|
| `pnpm smoke:clients` with Codex CLI 0.139.0 installed from the npm registry into a temporary directory | Passed: the Codex app-server initialized CodeBudget `0.1.0-beta.3` and discovered all three tool schemas. The registration was an explicit launch without `--root`, so the server found the project from the working directory Codex chose. Outbound methods were only `initialize`, `initialized` and `mcpServerStatus/list`; [client-smoke-result.json](client-smoke-result.json). |
| `pnpm smoke:claude-mcp --record` with Claude Code 2.1.286 | Passed: in an empty temporary configuration and home, the client listed only the temporary CodeBudget registration and reported it as connected; [claude-client-smoke-result.json](claude-client-smoke-result.json). A manual run of the same procedure showed the MCP log entry for the stdio connection with server identity `codebudget 0.1.0-beta.3` and tool capability. |

Neither check submitted a prompt, login, approval choice or model request, and both removed their temporary files. The Claude check covers the client health handshake, not tool calls inside a model session. Cursor and Antigravity are desktop applications that are not installed in this environment and remain unverified. `npm view codebudget` returned 404: no package of that name existed in the registry at that time.

## Review follow-up: 0.1.0-beta.3

A full review found defects in storage bounds, the command runner, redaction, the native hook's version gate, MCP and dashboard limits, reducers and their validator, the indexer, adapter installs and Codex usage imports. The fixes and their user-visible effects are listed in the [changelog](../CHANGELOG.md); each area gained regression tests that fail on the previous code where the defect was observable.

Environment: Linux container, Node v22.22.2, pnpm 10.33.2, Claude Code 2.1.285 on `PATH`, Claude Code 2.1.286 installed from the npm registry into a temporary directory. No login, API key or model request was used.

| Executed command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed. |
| `pnpm lint` | Exit 0. |
| `pnpm typecheck` | Exit 0. |
| `pnpm test` | 28 Vitest files, 522 tests passed: 26 functional files (494 tests) in parallel, then the 2 `performance.test.ts` files (28 tests) one at a time. |
| `pnpm build` | Passed; a rebuild leaves the committed plugin bundles unchanged. |
| `pnpm test:e2e` | 2 Chromium tests passed, using a temporary Playwright configuration that points at the container's preinstalled Chromium because Playwright's own browser build is not installed here. CI runs the repository configuration. |
| `pnpm smoke:package --record` | 26 installed-package checks passed with Claude Code 2.1.285; [package-smoke-result.json](package-smoke-result.json). |
| `pnpm smoke:package` with 2.1.286 first on `PATH` | 26 checks passed; none unavailable. |
| `claude plugin validate --strict ./plugins/claude-codebudget` | Passed with 2.1.285 and 2.1.286. |
| `pnpm audit --json` | Zero known advisories, 624 dependencies; identical to [dependency-audit.json](dependency-audit.json). |
| `git diff --check` | Clean. |

Replay figures now use automatic format detection, as the runner and the hook do; hinted figures are identical for this corpus and are reported separately in [replay-final.json](replay-final.json). Synthetic: 22,881 → 3,696 content bytes (83.8469%), envelopes 8,819 bytes. Captured: 6,819 → 5,809 (14.8116%), envelopes 10,420 bytes. All 19 preservation checks passed. Five captures that previously "gained" only through blank-line, CRLF or final-newline removal now report no gain.

The Codex usage correction was checked against pinned 0.139.0 source: the exec JSON processor fills `turn.completed.usage` from the thread's running total (`usage_from_last_total`), `TokenUsageInfo.append_last_usage` accumulates it, and resume/fork reconstruction seeds it from the last rollout `TokenCount` event. Claude Code's MCP documentation states that spawned servers receive `CLAUDE_PROJECT_DIR`; whether Codex, Cursor and Antigravity start servers inside the project was not verified.

Remote CI on `proje-kontrolu-eksiklikler` (each run: `pnpm verify`, the clean-tree check after the build and `pnpm smoke:package` on Linux, macOS and Windows with Node 22 and 24, plus the `plugin-contract` job against the newest published client):

| Run | Commit | Result |
| --- | --- | --- |
| [36772598643](https://github.com/vahapogut/CodeBudget/actions/runs/36772598643) | 3e7346c, every change except the indexer rewrite | All seven jobs passed. |
| [36773067626](https://github.com/vahapogut/CodeBudget/actions/runs/36773067626) | b9f8768, indexer rewrite | Both Windows jobs failed: two tests derived the index database name from the unmodified root while Windows names it from the lower-cased root, and two file-heavy tests exceeded the 15 s default. |
| [36774062777](https://github.com/vahapogut/CodeBudget/actions/runs/36774062777) | a19f4be, portable test names and time limits | Windows passed; macOS with Node 24 measured a 10.35x growth ratio for linear search reduction (the small run fell near the 10 ms floor while garbage collection lengthened the large run). |
| [36775099943](https://github.com/vahapogut/CodeBudget/actions/runs/36775099943) | ceb5150, fastest of five runs and a 25 ms floor | macOS passed; Windows with Node 24 was starved: one storage regression test took 102 s in the parallel suite and unrelated process-spawning tests timed out. |
| [36776235535](https://github.com/vahapogut/CodeBudget/actions/runs/36776235535) | 5722501, performance suites run separately and sequentially | All seven jobs passed. |
| [36776296924](https://github.com/vahapogut/CodeBudget/actions/runs/36776296924) | e3c420d, documentation only | Both Windows jobs failed on a real defect: the source fingerprint hashed file contents only within two seconds of a change, so two runs of the same failing command that started on either side of that window compared different fingerprints and missed the repeat. |
| [36777610061](https://github.com/vahapogut/CodeBudget/actions/runs/36777610061) | 140cc15, time-independent fingerprint with a regression test that fails on the previous code | All seven jobs passed. |
| [36777761681](https://github.com/vahapogut/CodeBudget/actions/runs/36777761681) | bd2c946, changelog | All seven jobs passed. |
| [36778688776](https://github.com/vahapogut/CodeBudget/actions/runs/36778688776) | 9405025, CI history and test counts | All seven jobs passed. |
| [36784798018](https://github.com/vahapogut/CodeBudget/actions/runs/36784798018) | cbe2be3, client health checks | Six jobs passed, including the new Claude Code health check in `plugin-contract`. Windows with Node 24 failed the index maintenance measurement: 5.71x for 8x the files against a limit of 4. The ratio compared whole index calls, and each call also stats every file and snapshots the state, which grows linearly with repository size by design; file metadata calls are comparatively slow on Windows. In five local runs the same 200 changes cost 0.64x to 1.10x as much in the large repository as in the small one, while the unchanged walk grew 5.4x to 6.7x; the test now subtracts the unchanged walk before comparing. |

A Windows run earlier in this work also failed because a test emitted 3,000 lines from a zero-delay interval, which runs at the OS timer resolution there, and every evidence batch paid a full sync; both causes were fixed before the runs above. Beta.2 commits b4f7833 ([run 36623125432](https://github.com/vahapogut/CodeBudget/actions/runs/36623125432)) and 8a9c7df ([run 36656398283](https://github.com/vahapogut/CodeBudget/actions/runs/36656398283)) also passed CI.


## Local instruction file exclusion

The 2026-09-30 owner correction keeps AGENTS.md files local. The root file and Codex example were removed from Git tracking without changing their contents; before/after SHA-256 comparisons passed. Case-insensitive ignore rules cover root/nested paths and take precedence over the standalone bundle inclusion rule. Release copying also excludes these files regardless of Git ignore behavior. Contributor documentation no longer requires a file absent from fresh clones. Previous commits were not rewritten.

Executed on Windows Node22.16.0: `git ls-files` found no tracked AGENTS.md; `git check-ignore --no-index` covered uppercase/lowercase/mixed-case names and the plugin bundle path. `pnpm verify` passed lint, typecheck, 14 Vitest files / 244 tests, build and 2 Chromium tests. `pnpm smoke:package` passed all 25 checks while the ignored local instruction files remained present, including an installed archive scan for AGENTS.md at every depth. No model calls or global configuration changes occurred. The [package result](package-smoke-result.json) records this run; prior sections describe earlier verification.

## Free-use license follow-up: beta.2

The owner requested free use and prior written permission for commercial products. New first-party material uses CodeBudget Free Use License 1.0; personal/internal business use remains free. Prior Apache grants, explicitly licensed fixtures and all third-party licenses are preserved. `LEGACY_LICENSE` and the former published root license have the same Git blob hash, `d645695673349e3947e8e5ae42332d0ac3164cd7`. This is packaging/policy verification, not a legal enforceability opinion; [LICENSING.md](../LICENSING.md) records the scope and history.

Actual Windows Node22.16.0 / pnpm10.33.2 results:

- `pnpm install --frozen-lockfile`: all nine workspace projects passed.
- `pnpm verify`: lint, strict typecheck, 14 Vitest files / **244 tests**, production build and **2 Chromium tests** passed.
- `pnpm smoke:package`: **24 installed-package checks** passed, including current/legacy license text parity at root and in the standalone plugin, manifest/build/CLI/MCP version consistency and strict Claude2.1.216 plugin validation.
- `git diff --check`: passed. No third-party license texts or inventories changed.

The installed archive is `dist/codebudget-0.1.0-beta.2.tgz`; [package evidence](package-smoke-result.json) records this run. No model call, global setting change, account link or npm publication was performed. Actual Codex/Claude model-client acceptance was not rerun for this license-only follow-up. Remote beta.2 CI is not yet recorded here; the six successful jobs below belong to the beta.1 code checkpoint.

## Historical beta.1 verification

The following sections retain the previously executed 0.1.0-beta.1 evidence and its boundaries.

## Roadmap completion follow-up

The local roadmap improvements are implemented: nine captured reducer families, bounded transitive relative imports with provenance/freshness checks, two offline tokenizers with explicit model mapping, usage-gap/cumulative-series diagnostics and Claude2.1.216 PostCompact handling. The README now includes both dashboard themes and a concise native-plugin quickstart. The tokenizers remain opt-in; exact local encoding does not establish provider billing.

The final pnpm verify passed lint, strict types, **14 Vitest files / 244 tests**, production build and **2 browser tests**. The updated frozen lockfile installs across all nine workspace projects. The refreshed dependency audit reports zero known advisories. There are 107 production/runtime license records, including a SHA-256-checked MIT text from the exact js-tiktoken npm gitHead because its npm archive omits that text.

The actual installed Codex0.139.0 app-server also connected to CodeBudget and discovered all three MCP tool schemas using an isolated temporary home and project. Only initialize, initialized and mcpServerStatus/list were sent: zero threads, turns, model or account requests. The final-build rerun passed; see [client smoke](CLIENT_SMOKE.md) and [result](client-smoke-result.json). This is client handshake evidence, not a model acceptance test.

## Cross-platform CI

The authorized initial push 507f96f ran [all six OS/Node jobs](https://github.com/vahapogut/CodeBudget/actions/runs/36618600353). Both Ubuntu jobs passed the full verification and installed-package checks. Both macOS jobs exposed a real path-alias issue: canonical /private/var roots were compared with lexical /var targets. Both Windows jobs exposed adapter-test expectations comparing 8.3 temporary paths with canonical names. The first run is retained in [ci-results.json](ci-results.json), including failures.

The fix resolves only a verified repository-root alias, then checks every descendant for links. It continues rejecting outside paths, linked descendants, self-links and dangling links. Indexer data-directory resolution uses the same boundary, and adapter tests compare canonical roots. New regression tests cover these cases. The corrected local pnpm verify passed all 244 tests in 14 files, 2 browser tests, lint/types/build; the 22-check clean package install and actual Codex handshake also passed again. [The corrected CI run](https://github.com/vahapogut/CodeBudget/actions/runs/36619601746) passed **all six jobs** on code commit 1948b6d. The table below comes from actual job logs, including each runtime.

| Runner | Actual Node runtime | Unit/integration tests | Browser tests | Installed-package checks |
| --- | --- | ---: | ---: | ---: |
| windows-latest, 22 | v22.23.3 | 244 | 2 | 16 |
| ubuntu-latest, 24 | v24.21.0 | 244 | 2 | 16 |
| macos-latest, 22 | v22.23.2 | 244 | 2 | 16 |
| macos-latest, 24 | v24.20.0 | 244 | 2 | 16 |
| windows-latest, 24 | v24.21.0 | 244 | 2 | 16 |
| ubuntu-latest, 22 | v22.23.2 | 244 | 2 | 16 |

Each job also passed lint, typecheck, production build and archive installation. Claude CLI is absent on the hosted runners: its strict manifest check is explicitly unavailable and the five dependent native-client process checks are skipped there. All 22 installed-package checks, including those six Claude-dependent checks, passed separately on the local Windows Node22.16.0 host with Claude2.1.216. The CI result does not claim a real Claude model session.

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

An earlier review added regressions for exact CLI context serialization, complete MCP dashboard records and validated persisted task constraints/acceptance criteria. A focused parallel run initially hit two process-startup timeouts; sequential focused checks then passed, and the then-current unmodified four-worker pnpm verify passed all 201 tests. Timeout thresholds were not increased. If startup timeouts recur on a loaded machine, retain the failure evidence and investigate contention rather than suppressing them.

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
| Claude Code | 2.1.216, 2.1.285, 2.1.286 | 109 adapter, hook and installer tests, strict manifest, installed standalone hook/MCP/archive smoke with 2.1.285 and 2.1.286 | Real model-facing replacement/consumption acceptance |
| Codex CLI | 0.139.0 | Actual app-server MCP handshake/discovery, config contracts and usage importer tests | Tool use through a model session, real usage capture and quality |
| Cursor | Unknown | Project-config contracts | Version/client launch/live MCP |
| Antigravity | Unknown | Project-config contracts | Version/client launch/live MCP |

Output replacement accepts 2.1.216 and later 2.x releases; other versions and unrecognized response shapes decline semantic replacement and record the reason. MCP does not intercept all built-in client tools. See [ADAPTERS.md](ADAPTERS.md) and [official-source research](RESEARCH_ADAPTERS.md).

## Remaining limits

- R22 blocked_external: model invocation needs separate explicit authorization in the user's request. Manifest/process tests do not satisfy that gate.
- No paid task benchmark, billing/quota experiment or real experimental summarizer/BYOK quality test.
- The six-job OS/Node matrix passed on commit 1948b6d. Hosted runners lack Claude CLI; native-client process checks remain limited to the separate local Windows run.
- SQLite API is experimental on this runtime. Quotas limit main pages; active WAL transactions may transiently use additional disk. Prune excludes source files.
- Redaction is imperfect defense in depth. Explicit run --raw forwards original unmasked machine bytes while archives stay masked. Unsupported native responses are not a universal secret filter.
- Context ranking is syntactic/heuristic, not complete type/call resolution. Explicit local BPE counts cover only the controlled text; default estimates and hidden provider overhead are not exact provider counts. Unsaved editor buffers are invisible.
- GitHub push is explicitly authorized. No account linking, global IDE mutation, npm publication, deployment or package-name ownership claim.

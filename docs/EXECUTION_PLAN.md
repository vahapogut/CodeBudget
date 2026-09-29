# Execution plan

Checkpoint: 2026-09-29. Status vocabulary: pending, in_progress, verified, blocked_external, deferred_experimental. Verification describes the tested local implementation, not universal correctness or production certification. External acceptance is listed separately.

The local delivery is a beta native Claude plugin, offline CLI/core, context/MCP server, and secondary dashboard. Commands and limits are in [VERIFICATION.md](VERIFICATION.md); remaining actions are in [STATUS.md](STATUS.md).

| Phase | State | Evidence |
|---|---|---|
| 0 Inspection and runtime probes | verified | Official-source research, SQLite/FTS5, actual WASM parsing, SDK stdio and frozen lockfile |
| 1 Core | verified | Config/store/security/argv/CLI tests and installed-package smoke |
| 2 Reducers | verified | Nine families, preservation fault injection, synthetic and actual captured replays |
| 3 Index/context | verified | Actual bodies, FTS5, freshness, serialized budgets, isolation and retention |
| 4 MCP/native plugin | verified | SDK, installed worker/WASM, strict manifest, standalone hook process and retrieval |
| 4 Real Claude model acceptance | blocked_external | R22 needs separately authorized model session; fixtures do not satisfy it |
| 5 Other adapters/continuity | verified | Config/rollback contracts, epochs, identity and repeat-failure warnings; live boundaries below |
| 6 Reporting/benchmark harness | verified | SQLite dashboard, imports/exports, browser checks and 30-task evaluator |
| 6 Real task experiments | blocked_external | No model calls or spending authorization |
| 7 Experimental contracts | verified | Default-off flags, isolated mock transports and budget/cancellation tests |
| 7 Model quality | deferred_experimental | Real summarizer/provider quality untested |
| 8 Local hardening/package | verified | Full verify, clean archive install, audit, licenses and documentation |
| 8 Other platforms/source publication | verified | GitHub main pushed; all six Linux/macOS/Windows × Node22/24 jobs passed on 1948b6d; npm publication remains separate |

## Requirement evidence

Paths are repository-relative. Test evidence comes from actual runs in VERIFICATION. Split rows separate implemented contracts from unexecuted external experiments.

| ID | State | Implementation / evidence / boundary |
|---|---|---|
| R01 | verified | Offline installed CLI/MCP; distinct estimated/client-reported/unknown metrics; English docs and Turkish quickstart. Savings remain hypotheses. |
| R02 | verified | Initial inspection, short AGENTS and persistent docs; original prompt preserved; no paid/global action; later GitHub source push explicitly authorized. |
| R03 | verified | RESEARCH, RESEARCH_ADAPTERS and RESEARCH_COMPARISON cite dated primary sources and versions; no upstream code copied. |
| R04 | verified | Strict tsconfig, nine workspace manifests and lockfile; real SQLite/FTS5 and official grammar execution; four installed offline WASMs. |
| R05 | verified | CLI/dashboard plus six packages; no mandatory daemon/account/key/cloud. |
| R06 | verified | CLI integration and config tests; init/doctor/run/context/artifact/session/report/adapters/MCP/dashboard/benchmark/prune/import; strict precedence and observe default. |
| R07 | verified | adapters.test.ts: merge, ownership, preview, backup, rollback fault injection, concurrent edits and selective uninstall in temporary roots. |
| R08 | verified | runner.ts/core.test.ts: argv-only, single execution, literal shell markers, exit/spawn/timeout/cancellation and bounded chunk-order records. |
| R09 | verified | Huge/malformed/partial-line output and blocked-sink tests; explicit truncation; machine passthrough documented. No TTY optimizer. |
| R10 | verified | Store/security tests: scoped masked evidence, hashes, UTF-8 pages, private raw opt-in, TTL/quota/prune. Redactor is not perfect. |
| R11 | verified | Reducer and capture tests: all families, no-gain/unknown/reentry fallbacks, diagnostic preservation and fault injection. |
| R12 | verified | Versioned reduction envelope; lossless JSON lexemes; diff evidence is not an applicable patch; repeat counts and masking boundary. |
| R13 | verified | Actual TS/JS/JSX/TSX bodies/imports/ranges/hashes; ignored/sensitive/untracked files and text fallback in indexer tests. |
| R14 | verified | Containment, symlink, Windows/Unicode, concurrent writes, edits/renames/deletions, syntax recovery, stale refs and quotas tested. |
| R15 | verified | FTS5/name/location/dependency/test ranking; bounded static relative-import traversal with path/depth provenance and stale-chain guards; required bodies and omissions. |
| R16 | verified | Final serialized package/MCP text-envelope budgets, required overflow and incremental expansion; default estimate or explicitly configured offline o200k/cl100k encoding/model mapping; hidden client overhead unknown. |
| R17 | verified | Repository identity, parser/security/config invalidation, hashes, checkpoints/epochs/task fields and saved-change snapshots; output remains historical. |
| R18 | verified | Repeat-failure test invalidates on source change; warnings only; bypassed calls unobserved. |
| R19 | verified | Official SDK MCP tests and installed smoke: three tools, schemas/limits, cancellable worker, scoped evidence and full context persistence. |
| R20 | verified | ADAPTERS separates documentation, implementation and verification for four clients. Actual Codex0.139.0 app-server MCP discovery passed without a model; other real clients remain unverified. |
| R21 | verified | Native bundles/hooks/skill/MCP; 44 adapter/hook tests and installed process smoke; exact Claude2.1.216 gate, preserved permissions, measured overhead. R22 is separate. |
| R22 | blocked_external | Actual Claude model session not invoked. Need captured model-facing replacement, retained diagnostics and retrieval. |
| R23 | verified | Observe/balanced/experimental separation; candidate gains distinct from actual delivered bytes; unknown/no-gain fallback. |
| R24 | verified | usage.test.ts: explicit official file formats, versions/correlation, inclusive fields, missing-field coverage, cumulative-series diagnostics, unknown subagent identity, overflow and dedup conflicts. |
| R25 | verified | Reports/benchmarks distinguish bytes, estimates, client usage and unknown prices/quota; no fictional counterfactual. |
| R26 | verified | Actual SQLite overview/session/detail/output/context/benchmark/adapter views, safe exports and empty/unknown states. |
| R27 | verified | API/browser tests: loopback token, Host/Origin/fetch-site/GET restrictions, CSP, safe text, no external requests, desktop/mobile navigation. |
| R28 | verified | Ten synthetic and nine captured replays; time/heap observations; 30 original tasks and hidden evaluators. Heap samples are not peak measurements. |
| R29 harness | verified | Three seeded repeated conditions, equal starting state, opt-in budgets, failures/unknowns and paired bootstrap/inconclusive analysis. |
| R29 real experiment | blocked_external | No model runner used; 270 planned runs are not executed runs. Real consumption per success unknown. |
| R30 | verified | Core/indexer/MCP/adapter security and fault tests; parameterized transactional SQLite, FKs, busy/concurrent connections, corrupt-file preservation and safe paths. |
| R31 local | verified | Locked dependencies, zero known advisories, 107 license records/texts and clean Windows CLI/MCP/dashboard/plugin/WASM smoke. |
| R31 other platforms | verified | All six Node22/24 × Linux/macOS/Windows CI jobs passed: 244 tests, 2 browser tests and 16 installed-package checks each; hosted Claude CLI checks unavailable. See ci-results.json. |
| R32 contracts | verified | Separate default-off flags, allowlist/BYOK authorization, request limits, cancellation/concurrency/budgets and no silent retry tested with mocks. |
| R32 quality | deferred_experimental | Real summarizer/provider quality and cost unknown; no closed-IDE subscription routing claim. |
| R33 | verified | pnpm verify, clean archive, required English docs, Turkish quickstart, Apache-2.0 and standalone notices. |
| R34 | verified | ROADMAP separates SaaS/accounts/payments/marketplace; npm identity unresolved; author vahapogut; GitHub source push completed; npm publication remains separate. |

After separate authorization, execute R22 against pinned Claude2.1.216 before broadening support or claiming user-facing acceptance. Paid benchmarks, additional clients, experimental model quality and npm publication remain separate gates. GitHub source push and its CI matrix are authorized.

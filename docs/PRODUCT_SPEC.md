# CodeBudget product requirements

Authoritative user input: the user's pasted development request and native Claude plugin delivery clarification. CODEBUDGET_MASTER_PROMPT.md is preserved as reference material. This English register preserves the requested scope. Implementation status and evidence belong in EXECUTION_PLAN.md. Every semicolon-separated obligation below is part of the identified requirement, not an optional example.

**Superseding user decision, 2026-09-29:** CodeBudget must be free to use; offering it as a commercial product or service requires the owner's prior written permission. Starting with 0.1.0-beta.2, new first-party material uses the CodeBudget Free Use License 1.0. This supersedes R33's original Apache-only selection and excludes paid tiers/billing from R34's future scope. The original request below and master prompt are preserved as historical input. Prior Apache-2.0 grants and third-party licenses remain effective; see [license policy](../LICENSING.md).

| ID | Requirement |
|---|---|
| R01 | Local-first offline core; minimize consumption per correctly completed task; distinguish bytes, tokens, API cost and subscription quota; Turkish user communication and quickstart, English code/docs. |
| R02 | Preserve existing work; inspect Git/toolchain; short AGENTS and persistent execution/research/decisions/status/verification docs; explicit authority for paid calls, accounts, global settings, publication and destructive operations. |
| R03 | Verify official IDE/MCP/SDK/runtime APIs and versions; compare RTK, Serena, Aider, Context Mode and licenses; no invented hooks, metrics or success claims. |
| R04 | Strict TypeScript, supported Node LTS, pnpm workspace and lockfile; actual SQLite/FTS5 and Tree-sitter WASM probes; no runtime grammar downloads; native/package limits explicit. |
| R05 | Logical CLI/dashboard/core/reducers/indexer/MCP/adapters/benchmarks boundaries; no required daemon, account, Docker, GPU, cloud or provider key. |
| R06 | Working init/doctor/index/run/context/artifact/session/report/adapters/MCP/dashboard/benchmark/prune CLI; help, stdin/file input, separate output/context/retention/disk policies; observe default and strict config precedence. |
| R07 | Safe preview/apply installs with backups, structural merge, atomic writes, rollback, idempotency and selective uninstall preserving subsequent edits; temporary-home tests. |
| R08 | Executable + argv runner, no implicit shell/eval/rewrite/reexecution; exit/signal/timeout/cwd/duration and stream/chunk order preserved; child-tree cleanup; wrapper errors distinct. |
| R09 | Bounded streaming/backpressure, disk/UTF8/ANSI/partial-line/huge-output tests; explicit truncation; no TTY optimization or machine-stream corruption. |
| R10 | Redacted complete evidence by default; raw storage explicit opt-in and private; repository/session scoped IDs, hash, pagination, retention/quota/prune; fail-closed redaction. |
| R11 | Real Vitest/Jest, TypeScript, ESLint, Git status/diff, search, JSON, log reducers; supports/parse/reduce/validate; deterministic, preserve failures/locations/expected/actual/skipped/stacks/truncation; no-gain/double-reduction/unknown fallbacks. |
| R12 | Versioned reduction schema and common security boundary; consistent size units/tokenizer; preserve machine JSON/patch semantics; repeated-log counts and detail access. |
| R13 | TS/JS/JSX/TSX files/symbols/signatures/bodies/imports/exports/ranges/tests/hashes; text fallback; gitignore and codebudgetignore; hard sensitive exclusions; working-tree and untracked changes. |
| R14 | Root containment, symlinks, traversal, Unicode/Windows paths, rename/deletion/worktrees/concurrent indexing; broken syntax, current hashes and doctor support/staleness. |
| R15 | Deterministic FTS5/name/error/dependency/test context ranking; actual editable bodies and required contracts; provenance, omissions, uncertainty/dynamic refs; no claim of full type/call resolution. |
| R16 | Serialized context/protocol budget; explicit tokenizer accuracy and overhead; required-content overflow/minimum budget; incremental expansion accounting; stale snapshot detection. |
| R17 | Repository/worktree/content/parser/reducer/security/config cache identity; historical test evidence distinct; stable rules; task findings/assumptions/evidence/questions/state and epoch reset; current change packages. |
| R18 | Repeat-failure detection by normalized argv, source hash and error signature; observe warnings only; no invisible-agent usage assumptions. |
| R19 | Official SDK stdio MCP with exactly prepare_context/read_evidence/get_changes; stdout hygiene; strict schemas, limits, timeout/cancellation, repo/session isolation, no arbitrary path/shell/fetch. |
| R20 | Separate Claude/Codex/Cursor/Antigravity capabilities and sources/version/testing matrix for registration/routing/replacement/usage/lifecycle/install; unsupported and unknown explicit. |
| R21 | Native Claude plugin with core, hooks, short skill and MCP; enable only after capability checks; auto-reduce supported native tool results with permission semantics intact; no-op unknown versions, reentrancy/rollback/protocol tests; measure plugin overhead. |
| R22 | Real Claude model-visible acceptance test with preserved diagnostic and smaller result; installed manifest validation alone is insufficient. |
| R23 | Observe/balanced/experimental separation; no hidden experimental or weakened security; visible and bypassed measurement scope. |
| R24 | Versioned usage sources/events/correlation/scope/model; null unknowns; inclusive token fields defined, dedup and cumulative/delta separation; official file importers; never scrape accounts. |
| R25 | Verified price/date/currency only, else unknown; output shrinking vs observed usage vs net task difference; retrieval/overhead/retries/subagents included; no fictional counterfactual savings. |
| R26 | Real SQLite React/Vite dashboard: overview/sessions/detail/output/context/benchmarks/adapters; empty/unknown states, source/scope/quality/duration; redacted JSON/CSV formula-safe export. |
| R27 | Loopback plus local token, Host/Origin/CSRF/rebinding protections; CSP and accessible safe text; no CDN/fonts/analytics/outbound requests; browser security/E2E tests. |
| R28 | Replay measurements with preservation/time/memory and explicit limited scope; 30 redistributable tasks across five categories with hidden evaluators; distinct model-task harness. |
| R29 | Three fair baseline conditions, seeded randomization/repeats/version/cache/permission settings; real evaluator success; failures counted, consumption/success, paired intervals/distributions/inconclusive results; optional competitor; explicit paid-run budget. |
| R30 | Security fixtures and fault injection; parameterized transactional SQLite/migrations/FKs/busy/concurrent/corrupt recovery; restricted permissions; no untrusted script execution during indexing or external plugin code. |
| R31 | Dependency pins/licenses/security audit; offline and clean-package CLI/MCP/dashboard/native/WASM/static-asset smoke; Linux/macOS/Windows CI with honest actually-run platform reporting. |
| R32 | Optional isolated feature-flag local summarizer and authorized BYOK routing; endpoint allowlist, timeout/cancellation/concurrency/retry/run budget, source evidence and cost limits; mock tests separate from actual model quality. |
| R33 | pnpm verify: lint/typecheck/unit/integration/critical browser E2E/build; README/QUICKSTART/ARCHITECTURE/SECURITY/PRIVACY/TROUBLESHOOTING/CONTRIBUTING/compatibility/benchmark docs; Apache-2.0 and third-party notices. |
| R34 | SaaS/payments/accounts/multitenant cloud/marketplace out of local v1; separate roadmap; unresolved publication identity; no unauthorized push/publish/deploy; author vahapogut only. |

Performance hypotheses (not results): ≥50% on selected noisy replay output; ≥20% consumption improvement per successful real task while preserving measured quality. Neither a replay nor contract test proves the latter.

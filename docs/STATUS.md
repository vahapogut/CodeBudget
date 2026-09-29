# Status

Checkpoint: 2026-09-29. Local beta 0.1.0-beta.1 is implemented, verified, packaged and pushed to GitHub. Primary delivery is the native Claude plugin, offline CLI/core and three MCP tools; the dashboard is a local companion. Real Claude model-visible acceptance remains **unverified**.

## Delivered

- Observe-default CLI, masked SQLite evidence, argv-only runner, sessions/checkpoints/epochs and repeat-failure warnings.
- Nine reducer families with actual captured-command fixtures, provenance and preservation fault injection.
- Offline JS/TS/JSX/TSX Tree-sitter/FTS5 context with bounded transitive relative imports, path/depth provenance and stale-chain protection.
- Optional local o200k_base/cl100k_base tokenizers with explicit model mapping; default estimates and unknown-model fallback stay labeled.
- Claude Code 2.1.216 hook contracts, including PostCompact; reversible project adapters for Claude/Codex/Cursor/Antigravity. Actual Codex 0.139.0 MCP handshake/discovery passed without a model.
- Usage imports with missing-field coverage, cumulative-series diagnostics, unknown unique subagent identity and safe overflow handling.
- Neutral dashboard with search, result filters, race-safe evidence inspection, saved light/dark theme and mobile layout. README includes both themes and a shorter quickstart.
- Thirty-task evaluator/experiment harness; experimental model transports remain default-off and locally mock-tested.
- Apache-2.0, 107 runtime dependency license records/texts, standalone plugin notices, English docs and Turkish quickstart.

## Executed verification

- pnpm verify: **244 tests in 14 Vitest files, 2 Chromium browser tests**, lint/typecheck/build all passed after portability fixes.
- pnpm install --frozen-lockfile: all nine workspace projects passed.
- pnpm smoke:package: **22 local installed-package checks** passed on Windows Node22.16.0 with Claude2.1.216, including both offline encodings, unknown-model fallback, MCP worker, compaction lifecycle, hook/archive and standalone licenses.
- pnpm smoke:clients: installed Codex0.139.0 connected and discovered all three tools; temporary home/project removed; no thread/turn/model/account requests.
- **All six GitHub CI jobs passed** on code commit 1948b6d: Linux/macOS/Windows × Node22/24. Every job passed 244 tests, 2 browser tests and 16 installed-package checks. Hosted runners lack Claude CLI, so its six dependent checks remain covered by the separate local run. Exact runtimes and job links are in [CI evidence](ci-results.json).
- pnpm audit --json: zero known advisories at the recorded audit time.
- Synthetic replay: 22,881→3,695 content bytes (83.85%); captured corpus: 6,819→5,786 (15.1488%). All 19 preservation checks passed. Captured envelopes total 10,369 bytes; task/provider/quota savings remain unknown. The captured corpus does not meet the 50% hypothesis.

Evidence: [verification](VERIFICATION.md), [package smoke](package-smoke-result.json), [client smoke](client-smoke-result.json), [replay](replay-final.json), [audit](dependency-audit.json). The initial CI path-alias failures are preserved alongside the corrected successful run. A separate [Claude health probe](CLAUDE_CLIENT_PROBE.md) failed to establish isolation and was stopped; it is not counted as a successful connection.

## Git and authority

Source is pushed to https://github.com/vahapogut/CodeBudget.git on main. Code commit 1948b6d passed the complete CI matrix; subsequent documentation records those results. All commits use vahapogut <110431024+vahapogut@users.noreply.github.com>, with no co-author trailers. The user explicitly authorized GitHub push on 2026-09-29. Local data and temporary outputs are ignored; plugin bundles are distributable files.

No model request, global IDE change, account connection, npm publication or deployment was submitted.

## Remaining external gates and separate scope

1. Execute an explicitly authorized real Claude model session for R22: actual model-facing replacement, retained diagnostics and evidence retrieval. Local protocol fixtures do not satisfy it.
2. Supply a faithful runner and explicit budget before real task/model-quality experiments. The 270-run plan is not executed evidence.
3. Verify other real clients/versions independently. Claude's attempted no-model health probe remains inconclusive; Cursor/Antigravity clients were not run.
4. Resolve npm package identity before npm publication. SaaS, accounts, billing, multi-tenant storage and marketplace remain separate future product decisions, outside local v1.

The local roadmap improvements and the cross-platform distribution gate are complete. [Execution plan](EXECUTION_PLAN.md) maps every requirement; [roadmap](../ROADMAP.md) separates completed work from external evidence and future products.

# Status

Checkpoint: 2026-09-30. Local beta 0.1.0-beta.3 (unreleased) is implemented and locally verified on Linux; it follows a full project review whose fixes are listed in the [changelog](../CHANGELOG.md). Beta.2 introduced the free-use/commercial-permission license policy; the previously pushed beta.1 is the Apache-2.0 legacy boundary. Primary delivery is the native Claude plugin, offline CLI/core and three MCP tools; the dashboard is a local companion. Real Claude model-visible acceptance remains **unverified**.

## Delivered

- Observe-default CLI, masked SQLite evidence, argv-only runner, sessions/checkpoints/epochs and repeat-failure warnings.
- Nine reducer families with actual captured-command fixtures, provenance and preservation fault injection.
- Offline JS/TS/JSX/TSX Tree-sitter/FTS5 context with bounded transitive relative imports, path/depth provenance and stale-chain protection.
- Optional local o200k_base/cl100k_base tokenizers with explicit model mapping; default estimates and unknown-model fallback stay labeled.
- Claude Code hook contracts for 2.1.216 and later 2.x releases (fixtures on 2.1.216 and 2.1.285), including PostCompact, with recorded no-op reasons; format-preserving, journaled and reversible project adapters for Claude/Codex/Cursor/Antigravity with a portable default registration. Actual Codex 0.139.0 MCP handshake/discovery passed without a model.
- Usage imports with missing-field coverage, cumulative-series diagnostics, Codex thread running totals, OTLP JSON Lines, unknown unique subagent identity and safe overflow handling.
- Neutral dashboard with search, result filters, race-safe evidence inspection, saved light/dark theme and mobile layout. README includes both themes and a shorter quickstart.
- Thirty-task evaluator/experiment harness; experimental model transports remain default-off and locally mock-tested.
- CodeBudget Free Use License 1.0 for new first-party material: free personal/internal business use, commercial offerings require prior written permission from vahapogut. Prior Apache-2.0 grants remain intact. All 107 dependency license records/texts, standalone plugin notices, English docs and Turkish quickstart are preserved.

## Executed verification

Review follow-up, 2026-09-30 (0.1.0-beta.3, Linux container, Node v22.22.2, pnpm 10.33.2, Claude Code 2.1.285 on `PATH` and 2.1.286 from the npm registry):

- `pnpm install --frozen-lockfile`: passed.
- `pnpm lint` and `pnpm typecheck`: exit 0.
- `pnpm test`: **28 Vitest files, 521 tests passed** (functional suite in parallel, then the performance suites one at a time).
- `pnpm build`: passed; the committed plugin bundles match a fresh build.
- `pnpm test:e2e`: **2 Chromium tests passed**. This container lacks Playwright's own browser build, so the run used a temporary configuration pointing at the preinstalled Chromium; CI runs the repository configuration unmodified.
- `pnpm smoke:package`: **26 installed-package checks passed** with Claude Code 2.1.285 (recorded in [package smoke](package-smoke-result.json)) and again with 2.1.286; nothing reported unavailable.
- `claude plugin validate --strict ./plugins/claude-codebudget`: passed with 2.1.285 and 2.1.286.
- `pnpm audit --json`: zero known advisories across 624 dependencies, identical to the recorded [audit](dependency-audit.json).
- `git diff --check`: clean.
- Replay with automatic detection: synthetic 22,881 → 3,696 content bytes (83.8469%), captured 6,819 → 5,809 (14.8116%); all 19 preservation checks passed; envelopes 8,819 and 10,420 bytes. The captured corpus still does not meet the 50% hypothesis.

Remote CI [run 36776235535](https://github.com/vahapogut/CodeBudget/actions/runs/36776235535) passed all seven jobs (Linux, macOS and Windows on Node 22 and 24, plus the newest-client plugin contract); the failed intermediate runs and their fixes are listed in [verification](VERIFICATION.md). No model call, account link, global IDE change, npm publication or deployment took place.


Repository hygiene follow-up, 2026-09-30: local agent instruction files are excluded from Git and release archives. Both existing local copies were preserved with unchanged SHA-256 hashes. `git ls-files` returns no tracked AGENTS.md; case-insensitive ignore checks passed, including nested paths under the bundled plugin. `pnpm verify` passed (244 tests, 2 Chromium tests, lint/types/build); `pnpm smoke:package` passed all 25 checks, including archive exclusion. This changes the current tree and future packaging; previous Git commits remain intact.

Beta.2 follow-up: `pnpm install --frozen-lockfile`, `pnpm verify` (244 tests in 14 files, 2 Chromium tests, lint/types/build) and `pnpm smoke:package` (24 installed checks) passed on Windows Node22.16.0. The package checks validate version metadata, exact root/plugin license document parity and the preserved Apache license. `git diff --check` passed. The new remote CI run is not yet recorded; the six-platform-job result below is historical beta.1 evidence.

Earlier beta.1 records:

- pnpm verify: **244 tests in 14 Vitest files, 2 Chromium browser tests**, lint/typecheck/build all passed after portability fixes.
- pnpm install --frozen-lockfile: all nine workspace projects passed.
- pnpm smoke:package: **22 local installed-package checks** passed on Windows Node22.16.0 with Claude2.1.216, including both offline encodings, unknown-model fallback, MCP worker, compaction lifecycle, hook/archive and standalone licenses.
- pnpm smoke:clients: installed Codex0.139.0 connected and discovered all three tools; temporary home/project removed; no thread/turn/model/account requests.
- **All six GitHub CI jobs passed** on code commit 1948b6d: Linux/macOS/Windows × Node22/24. Every job passed 244 tests, 2 browser tests and 16 installed-package checks. Hosted runners lack Claude CLI, so its six dependent checks remain covered by the separate local run. Exact runtimes and job links are in [CI evidence](ci-results.json).
- pnpm audit --json: zero known advisories at the recorded audit time.
- Synthetic replay (beta.1 reducers, format hints): 22,881→3,695 content bytes (83.85%); captured corpus: 6,819→5,786 (15.1488%). All 19 preservation checks passed. Captured envelopes total 10,369 bytes; task/provider/quota savings remain unknown. The captured corpus does not meet the 50% hypothesis. Current figures are in the review follow-up above.

Evidence: [verification](VERIFICATION.md), [package smoke](package-smoke-result.json), [client smoke](client-smoke-result.json), [replay](replay-final.json), [audit](dependency-audit.json). The initial CI path-alias failures are preserved alongside the corrected successful run. A separate [Claude health probe](CLAUDE_CLIENT_PROBE.md) failed to establish isolation and was stopped; it is not counted as a successful connection.

## Git and authority

Source is pushed to https://github.com/vahapogut/CodeBudget.git on main. Code commit 1948b6d passed the complete CI matrix; beta.2 commits b4f7833 and 8a9c7df also passed CI. The review follow-up is on the branch `proje-kontrolu-eksiklikler`; no pull request was opened. All commits use vahapogut <110431024+vahapogut@users.noreply.github.com> as author and committer, with no co-author trailers. The user explicitly authorized GitHub push on 2026-09-29 and for this branch. Local data and temporary outputs are ignored; agent instruction files are ignored and excluded from archives; plugin bundles are distributable files.

No model request, global IDE change, account connection, npm publication or deployment was submitted.

## Remaining external gates and separate scope

1. Execute an explicitly authorized real Claude model session for R22: actual model-facing replacement, retained diagnostics and evidence retrieval. Local protocol fixtures do not satisfy it.
2. Supply a faithful runner and explicit budget before real task/model-quality experiments. The 270-run plan is not executed evidence.
3. Verify other real clients/versions independently. Claude's attempted no-model health probe remains inconclusive; Cursor/Antigravity clients were not run.
4. Confirm that Codex, Cursor and Antigravity start project MCP servers inside the project for the portable default registration (Claude Code documents `CLAUDE_PROJECT_DIR`); otherwise register an explicit launch with `--root`.
5. Resolve npm package identity before npm publication. Team/cloud/accounts/marketplace features remain separate future decisions outside local v1, subject to the free-product policy. Paid tiers, billing and license-key paywalls are excluded from the roadmap.

The local roadmap improvements and the cross-platform distribution gate are complete. [Execution plan](EXECUTION_PLAN.md) maps every requirement; [roadmap](../ROADMAP.md) separates completed work from external evidence and future products.

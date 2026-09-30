# Roadmap

CodeBudget is a local beta. The local product improvements below are implemented; engineering checks and real-model acceptance remain separate. [Verification](docs/VERIFICATION.md) records executed checks, and the [execution plan](docs/EXECUTION_PLAN.md) maps the full specification.

## Delivered in this beta

| Work | Result | Details |
| --- | --- | --- |
| Native Claude plugin and offline CLI | Scoped evidence, preserved diagnostics, sessions, checkpoints, three MCP tools and reversible project adapters | [Plugin guide](plugins/claude-codebudget/README.md) |
| Dashboard redesign | Compact command workspace, evidence comparison, search, filters, responsive layout and saved light/dark preference | [README preview](README.md) |
| Captured output corpus | Actual executed-command fixtures for all nine reducer families, with versions, provenance and preservation fault injection | [Benchmarks](docs/BENCHMARKS.md) |
| Source dependencies | Bounded traversal of unambiguous static relative imports, source path/depth provenance, cycle handling and explicit unresolved/ambiguous limits | [Indexer](docs/INDEXER.md) |
| Local tokenizers | Offline `o200k_base` and `cl100k_base`, explicit model mapping, unknown-model fallback and serialized-package budgets | [Indexer](docs/INDEXER.md) |
| Usage coverage | Missing dimensions, source/scope groups, cumulative snapshots, reset observations and explicit unknown subagent identity | [Usage coverage](docs/USAGE_COVERAGE.md) |
| Client lifecycle | Claude `PostCompact` support alongside existing events; visibility resets without storing compacted conversation summaries | [Adapters](docs/ADAPTERS.md) |
| Current Claude releases | Output replacement for 2.1.216 and later 2.x releases with strict shape checks, recorded no-op reasons and a CI job against the newest published client | [Plugin guide](plugins/claude-codebudget/README.md) |
| Bounded local storage | Automatic eviction within `diskBudgetBytes`, recovery from a full database, bounded reports and evidence pages | [Privacy](PRIVACY.md) |
| Release preparation | Clean archive install, bundled WASMs/tokenizers, original dependency licenses, improved English README and Turkish quickstart | [Verification](docs/VERIFICATION.md) |

These items replace the previous open-ended local product-improvement list. Further changes should begin with a reproducible issue or a specific user workflow.

## Evidence gates

| Gate | Completion criterion | Current boundary |
| --- | --- | --- |
| Real Claude model-visible acceptance | A supported noisy command reaches an actual model with smaller output, preserved diagnostics and retrievable evidence | Requires a separately authorized model call; local hook fixtures are insufficient |
| Real client MCP connection | Launch the pinned client, connect to CodeBudget and discover its tools; record client/version and limitations | Codex 0.139.0 discovered all three tools (Windows and Linux, the latter with the portable registration); Claude Code 2.1.286 connected in an isolated health check that CI repeats against the newest client. Cursor and Antigravity are desktop applications and remain unverified |
| Cross-platform distribution | Pass the installed archive, WASM, worker and browser checks on Node 22/24 across Linux, macOS and Windows | Completed: all six jobs passed on 1948b6d; actual runtimes and unavailable Claude CLI checks are recorded in verification |
| Thirty-task pilot | Run randomized repeated native, optimized and CodeBudget conditions with faithful baselines, usage coverage and hidden evaluators | 270 planned runs are not completed runs; a model runner and explicit spending budget are required |
| Human review | Review the tasks requiring judgment and assess broader behavior equivalence | Automated evaluator passes do not establish universal quality |

## Experimental quality work

Local summaries and BYOK routing already have independent, default-off contracts, cancellation and budget checks. Their real model quality, retries and total cost need separately authorized evaluation before promotion. Closed IDE subscriptions and permission policies are not transparently replaced.

## Free-product policy and future scope

CodeBudget is free to use, including internally at companies. Paid tiers, subscription billing and license-key paywalls are not on the roadmap. Commercial redistribution, bundling or hosted offerings require the owner's prior written permission under the [license policy](LICENSING.md); previously published Apache material retains its existing rights.

Optional team collaboration, accounts, multi-tenant cloud storage and a marketplace remain outside local v1. Any future proposal must preserve the free-product policy and define hosting resources, minimal data collection, retention/export boundaries, repository-scoped policies, self-hosting and auditability before implementation. No account or payment flow is included. External IDE/model services retain their own costs and terms.

An npm registry release also requires a confirmed package name and ownership. GitHub source publication and local release archives do not imply npm publication.

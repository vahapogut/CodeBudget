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
| Client lifecycle | Claude 2.1.216 `PostCompact` support alongside existing events; visibility resets without storing compacted conversation summaries | [Adapters](docs/ADAPTERS.md) |
| Release preparation | Clean archive install, bundled WASMs/tokenizers, original dependency licenses, improved English README and Turkish quickstart | [Verification](docs/VERIFICATION.md) |

These items replace the previous open-ended local product-improvement list. Further changes should begin with a reproducible issue or a specific user workflow.

## Evidence gates

| Gate | Completion criterion | Current boundary |
| --- | --- | --- |
| Real Claude model-visible acceptance | A supported noisy command reaches an actual model with smaller output, preserved diagnostics and retrievable evidence | Requires a separately authorized model call; local hook fixtures are insufficient |
| Real client MCP connection | Launch the pinned client, connect to CodeBudget and discover its tools; record client/version and limitations | Codex0.139.0 handshake passed; Claude health isolation was not established, and Cursor/Antigravity remain unverified |
| Cross-platform distribution | Pass the installed archive, WASM, worker and browser checks on Node 22/24 across Linux, macOS and Windows | Completed: all six jobs passed on 1948b6d; actual runtimes and unavailable Claude CLI checks are recorded in verification |
| Thirty-task pilot | Run randomized repeated native, optimized and CodeBudget conditions with faithful baselines, usage coverage and hidden evaluators | 270 planned runs are not completed runs; a model runner and explicit spending budget are required |
| Human review | Review the tasks requiring judgment and assess broader behavior equivalence | Automated evaluator passes do not establish universal quality |

## Experimental quality work

Local summaries and BYOK routing already have independent, default-off contracts, cancellation and budget checks. Their real model quality, retries and total cost need separately authorized evaluation before promotion. Closed IDE subscriptions and permission policies are not transparently replaced.

## Separate future products

Managed team services, accounts, billing, multi-tenant cloud storage and a marketplace are outside local v1. They need a separate product decision, account/provider choices and operating constraints before implementation. No partially configured account or payment flow is included in this local release. An organization edition should start with minimal data collection, explicit retention/export boundaries, repository-scoped policies, self-hosting options and auditability.

An npm registry release also requires a confirmed package name and ownership. GitHub source publication and local release archives do not imply npm publication.

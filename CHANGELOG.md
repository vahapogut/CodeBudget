# Changelog

All notable changes to CodeBudget are recorded here. Versions follow the package manifests; no version has been published to a package registry.

## 0.1.0-beta.3 (unreleased)

### Claude Code plugin

- Output replacement is enabled for Claude Code 2.1.216 and later 2.x releases instead of one exact version. Contract fixtures run on 2.1.216 and 2.1.285, and a new CI job validates the installed plugin against the newest published client.
- Lifecycle events (SessionStart, PreCompact, PostCompact, SessionEnd) are handled for every client version.
- The hook accepts the documented `bashEditDiff` field (redacted string by string), native status fields and client annotations; unknown text or structured fields still keep the original result.
- Every declined replacement records a `hook-noop` reason; `codebudget doctor` reports it together with observe mode and unsupported client versions under `warnings`.
- Hook and MCP server resolve the same project from `CLAUDE_PROJECT_DIR` or the working directory.
- Launchers check for Node.js 22.16+ before loading the bundles; the hook leaves tool results unchanged on an older runtime.

### Storage and command runner

- Evidence storage stays within `diskBudgetBytes`: expired and then the oldest artifacts are evicted once the state passes half of the budget, and a full database is reclaimed once before a write is retried.
- State schema 3 stores evidence in 16 KiB blocks and pages it by record; `read_evidence` pages are capped at 60 KiB with a slim artifact header.
- A failed rollback no longer hides the original storage error.
- An archive failure is reported as `archiveError` and never kills the running command.
- Timeouts send SIGTERM and then SIGKILL after two seconds.
- Piped stdin is forwarded to the command; `run --no-stdin` closes it.
- Balanced previews keep the head, numbered diagnostic lines and the tail.
- Repeat-failure detection normalizes timestamps, durations, addresses, process IDs and temporary paths, and computes the source fingerprint only after a failure; an incomplete fingerprint makes no repeat claim. The fingerprint uses size and nanosecond timestamps (with content hashes for whole-second timestamps) and no longer depends on the current time, so repeats are also recognized when runs start seconds apart.
- Reports are bounded (newest 200 runs by default) while totals cover every retained run; `report --limit/--offset/--run/--context` read more.

### Security and configuration

- Redaction covers more token formats (Anthropic, Stripe, Slack, Google, GitLab, npm, AWS session keys, SendGrid, Hugging Face, DigitalOcean, Shopify, PyPI), JWTs, URL credentials for any scheme, `Authorization` headers, PGP private keys and credential-like key names such as `apiKey` or `DB_PASSWORD`.
- One shared repository path policy classifies secrets, dependencies, local state and generated output for the indexer and fingerprinting.
- `rawArchive` and `experimental` are honored only from the ignored `.codebudget/local.json`, `CODEBUDGET_RAW_ARCHIVE` or explicit overrides; a committed `.codebudget.json` cannot enable them.
- Invalid environment values and configuration files produce readable errors; `config mode` keeps other fields and file modes.
- Atomic writes preserve existing file modes, write private files as 0600 and sync the directory.

### MCP server and dashboard

- MCP operations are queued (at most eight), cancellable while queued and time out after `mcpTimeoutMs` (default 30 s, `mcp serve --timeout`).
- Large tool results declare `anthropic/maxResultSizeChars`; results stay below 480,000 bytes.
- The evidence worker's stdout is routed to stderr, and an oversized request line ends the server with an error instead of hanging the client.
- Dashboard links are single-use; the page exchanges them for a session token.
- Dashboard reports are summaries with on-demand run and context details, exports allow up to 64 MiB, dashboard evidence views are not counted as agent retrievals, and unknown paths return a generic 404.

### Client adapters and usage imports

- Adapter installs splice only the CodeBudget entry into project files and keep every other byte, formatting, line endings and permissions; install followed by uninstall restores the original file, and files or directories CodeBudget created are removed again.
- Plans show only the CodeBudget entry, file paths and content hashes; parse errors never quote file content.
- Applies are locked, journaled and rolled back on failure, SIGINT or SIGTERM; an interrupted change is recovered by the next adapter command. Backups are private (0600), bounded to five per file and never edit the project `.gitignore`.
- Registrations default to a portable `codebudget mcp serve`; `--command` and repeated `--arg` register an explicit launch. `mcp serve` without `--root` serves the nearest initialized project from `CLAUDE_PROJECT_DIR` or its working directory and refuses an uninitialized directory.
- Codex 0.139.0 `turn.completed.usage` is imported as the thread's running total (cumulative per hashed thread) instead of a per-turn delta, so resumed threads, repeated lines and re-imports are no longer over-counted; all-zero usage is unknown. Report totals use `observedUsageTotal`.
- Claude OTLP captures may be JSON Lines with one export batch per line.

### Reducers and benchmarks

- Preservation is validated in one linear, ordered pass over whole lines; reducers declare which lines they may remove or add. Sorted, relocated, merged or forged candidates are rejected.
- Detection routes diff-shaped text only to the diff reducer, requires the full line grammar for tsc, ESLint and git status (porcelain v1/v2 and long format) and keeps timestamped logs out of search results.
- Test-runner output keeps blank lines and annotated pass lines; CRLF and final newlines are preserved, and normalization alone is never counted as a reduction.
- Replay headline figures use automatic detection, as the runner and the hook do; format-hinted figures are reported separately. The captured corpus now reduces 6,819 to 5,809 bytes (14.81%), down from the previously published 15.15%.
- Task evaluators require a per-run completion token, check refactor constraints on the syntax tree, verify the workspace written to disk and report a missing TypeScript installation clearly.

### Build, packaging and CI

- `pnpm smoke:claude-mcp` health-checks the MCP server through the installed Claude Code client in an isolated temporary configuration, without a prompt, login or model request; the `plugin-contract` CI job runs it against the newest client. The Codex handshake was repeated on Linux with a launch without `--root`.

- The CLI bundle is code-split (the entry chunk shrank from about 5.3 MB to 128 KB), and plugin bundles stay self-contained.
- Packaged WASM assets and notices are written with a fixed 0644 mode.
- The release package lists TypeScript as an optional peer dependency.
- `pnpm smoke:package` records failures honestly, reports unavailable Claude checks with a reason and writes its result to `dist/` unless `--record` is given.
- CI fails when a build changes committed files, uploads the smoke result and adds Dependabot updates for npm and GitHub Actions.
- `pnpm test` runs the functional suite first (two workers on Windows) and then the `performance.test.ts` files one at a time, so growth measurements neither starve nor are disturbed by parallel tests. The index maintenance measurement subtracts the per-call file walk, which is linear in repository size by design, before comparing the cost of the same changes.
- The agent-instruction exclusion now matches case-insensitively and also covers `CLAUDE.local.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `copilot-instructions.md` and the local `.claude/` directory, both in Git and in release archives. Client examples use neutral `project-instruction.md` names.

## 0.1.0-beta.2

- Adopted the CodeBudget Free Use License 1.0; material published earlier under Apache-2.0 keeps its original grant.
- Kept local agent instruction files out of Git and release archives.

## 0.1.0-beta.1

- First local beta: CLI, native Claude Code plugin, three MCP tools, reducers, indexer, dashboard, usage imports and benchmark harnesses.

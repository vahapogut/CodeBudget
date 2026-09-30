# Quickstart

## Build from this checkout

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm pack:release
node dist/cli.js --help
```

Use Node 22.16+ on the supported 22 line or the supported Node 24 line, as specified in `package.json`. The lockfile pins dependencies. Network access is needed to acquire dependencies; core workflows use local packaged assets after installation.

For the following examples, `codebudget` means the locally installed CLI or `node /absolute/path/to/codebudget/dist/cli.js`.

## Initialize a project

```sh
codebudget --root /absolute/path/to/project init
codebudget --root /absolute/path/to/project doctor
cd /absolute/path/to/project
```

Configuration lives in `.codebudget.json`. Local data defaults to `.codebudget/`, which `init` adds to `.gitignore`. Never commit the data directory. The default mode is `observe`; masking still applies because security redaction is separate from optimization.

Precedence is explicit CLI overrides, then the supported environment variables `CODEBUDGET_MODE`, `CODEBUDGET_CONTEXT_BUDGET` and `CODEBUDGET_RAW_ARCHIVE`, then the ignored `.codebudget/local.json`, then project configuration, then defaults. Invalid environment values are rejected with a message instead of being ignored. The versioned schema rejects unknown fields. `rawArchive` and `experimental` are local-only: a committed `.codebudget.json` cannot enable them, and `doctor` warns when it tries. `contextBudget`, `outputMaxBytes`, `outputPreviewBytes`, `diskBudgetBytes`, `artifactRetentionDays`, `commandTimeoutMs` and `mcpTimeoutMs` are independent limits. The 8,000-token starting budget is an example, not a universal optimum. Do not place secrets in configuration.

## Record one execution

```sh
codebudget run -- node -e "console.log('example output')"
codebudget report --format json
```

The wrapper runs an executable plus argv without a shell. Use a real executable on Windows; script shims and shell syntax require explicit handling and may be refused. Do not pass a pipeline as one command string. Piped input is forwarded to the command's stdin; add `--no-stdin` to close it instead. A command is executed once, never rerun for a comparison, and `run` exits with the command's own exit code (124 after a timeout, 130 when cancelled, 125 for a wrapper error). On timeout the child receives SIGTERM and, two seconds later, SIGKILL. The result records its exit/signal/timeout state and the original evidence reference. If archiving fails (for example on a full disk) the command still completes and `run` prints a warning. Read evidence with `codebudget artifact read <id> --offset 0 --limit 200`.

Enable balanced reductions when desired:

```sh
codebudget config mode balanced
```

Unknown formats, non-beneficial transformations and failed preservation checks retain masked original agent output. For a machine pipeline use `run --raw -- executable args`: this forwards ORIGINAL UNMASKED stdout/stderr bytes; its retained archive is still masked. A truncated artifact is marked incomplete. `rawArchive` is a separate explicit local opt-in to private raw storage, set in `.codebudget/local.json` (`{ "rawArchive": true }`) or with `CODEBUDGET_RAW_ARCHIVE=1`; it is never automatically served through MCP or the dashboard.

`contextWeights` configures name/text/location/dependency/test ranking weights; they are scores, not confidence probabilities. `diskBudgetBytes` (minimum 4 MiB) reserves 75% of SQLite main pages for state and 25% for the derived index. Once stored state passes half of the budget, expired and then the oldest evidence is evicted until it is back near 40%; a full database is reclaimed the same way and the write retried once. Active WAL transactions can temporarily consume additional space; disk-full conditions that remain are reported. Retention pruning removes evidence and old index metadata, never project source files.

## Request context and checkpoint work

```sh
codebudget index
codebudget session start --task "Fix refresh token rotation"
# Replace <id> below with the returned session ID.
codebudget context --task "Fix refresh token rotation" --budget 8000 --session <id>
codebudget session checkpoint --session <id>
codebudget report --session <id>
codebudget session close --session <id>
```

An index reads saved files; it cannot see unsaved editor buffers. `.gitignore`, `.codebudgetignore`, sensitive-path exclusions and repository boundaries apply. Context uses real source bodies. Check `status`, `missingRequired`, token-estimate method and warnings before relying on a package.

For an offline count with a supported local encoding:

```sh
codebudget context --task "Fix refresh token rotation" --budget 8000 --tokenizer o200k_base --model gpt-4o
```

Persist these options by merging the following fields into `.codebudget.json`:

```json
{
  "contextTokenizer": { "encoding": "o200k_base", "model": "gpt-4o" },
  "contextDependencies": { "maxDepth": 2, "maxFiles": 64 }
}
```

Tokenizer choices are `estimated` (the default), `o200k_base` and `cl100k_base`. Packaged encodings work offline and count the controlled serialized text, not hidden prompts or billing. Unknown model mappings explicitly fall back to the byte estimate; a known model/encoding mismatch is rejected. No Claude-specific encoding is claimed. Dependency expansion defaults to depth 2 and 64 files, with configurable bounds of 0–8 and 0–512; these limits are separate from the context token budget. See [indexing and context](INDEXER.md).

## Connect a client

```sh
codebudget adapters inspect
codebudget adapters install codex --dry-run
codebudget adapters install codex --apply
codebudget adapters uninstall codex --dry-run
```

Installation previews and changes project-local settings. Apply only after reviewing the preview. Existing configuration is backed up and structurally merged. Uninstall removes only owned entries; conflicting later user edits are preserved. Global IDE configuration is outside these commands' scope.

Claude's native plugin can instead be loaded with `claude --plugin-dir /absolute/path/to/plugins/claude-codebudget` after building. Its supported client range (2.1.216 and later 2.x releases) and unverified live-session status are documented in the plugin guide. Do not register both plugin and project MCP copies.

## Review and retain data

```sh
codebudget dashboard
codebudget benchmark replay
codebudget benchmark tasks --dry-run
codebudget data prune --dry-run
```

Open the dashboard URL printed by the CLI. The link is single-use: the page exchanges it for a session token, and reloading that tab keeps working. Run `codebudget dashboard` again for a new link. Data stays local, but a running dashboard grants access: do not paste its link into public issues. `codebudget report` is bounded to the newest 200 runs; use `--limit`, `--offset`, `--run <id>` and `--context <id>` for more detail. Prune is limited to CodeBudget artifacts and retention policy; inspect its preview before applying changes.

## Import an explicit usage export

```sh
codebudget usage import --file capture.jsonl --format codex-jsonl --client-version 0.139.0 --import-id my-capture-001
codebudget usage import --file otlp.json --format claude-otel --client-version 2.1.216
```

These importers accept user-provided files; they do not generate an export or inspect an account. Reuse the same Codex `--import-id` when importing the same capture again. `--file -` reads stdin. An optional `--session <id>` explicitly links usage to a local session; absent that mapping the importer does not invent task attribution. Cached input/reasoning relationships and cumulative versus delta counters remain distinct. Missing prices and unobserved calls stay unknown.

Run `codebudget report --format json` to inspect `observedUsage.coverage`: missing fields, measurement sources, cumulative snapshots and limited subagent attribution. Unseen call counts and complete coverage remain unknown. See [usage coverage](USAGE_COVERAGE.md).

No API key is required. Model experiments, paid calls, global IDE changes and npm publication require explicit authorization. [Benchmark methodology](BENCHMARKS.md) explains what the free checks establish.

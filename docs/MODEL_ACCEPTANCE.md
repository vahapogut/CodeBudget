# Real model acceptance (R22)

R22 asks for a real Claude model session in which a noisy command reaches the model smaller, with its diagnostics preserved and the omitted detail retrievable. Plugin validation and hook fixtures cannot show that; only a session with a model can.

## Procedure

`pnpm accept:claude-model --confirm-model-calls` runs one headless session (`claude -p`) and records what the model actually received:

- The client runs with an empty temporary configuration directory and home, so no user settings, plugins, hooks or MCP servers take part. `--use-login` keeps the normal configuration when the login lives there.
- The plugin is loaded from this repository with `--plugin-dir` for that session only. Nothing is installed and no global configuration changes.
- The session may use only `Bash(npm test)` and the plugin's `read_evidence` tool, in the `dontAsk` permission mode: anything else is denied, and no approval bypass flag is used.
- The temporary project is initialized in balanced mode. Its Vitest suite prints 120 passing tests one per line (`--reporter=verbose`). The 60th test name carries a random marker that the reducer groups away with the other passing lines.
- `--scenario passing` (the default) adds a passing test that prints a deprecation warning, so the run exits 0. `--scenario failing` adds a failing assertion instead, so it exits 1.
- The model is asked to run `npm test` once, quote the diagnostics, and fetch the marker through `read_evidence`.
- A free preflight runs first, without the model. It checks that the suite behaves as designed, that the reducer keeps the diagnostics and omits the marker, and that the client is logged in. `--preflight-only` stops after it.

The checks read the stream the client emits (`--output-format stream-json --include-hook-events`) and the project's local CodeBudget report. `--record` writes the result to `docs/claude-model-acceptance-<scenario>-<client version>.json`. A normalized transcript stays in `dist/` for inspecting a failed run.

## Results

On 2026-09-30 (Linux, Node v22.22.2), the three sessions below were run with the client's default model. The cost figures are the values the client reported, not provider invoices.

| Scenario | Client | Model | Model requests | Reported cost | Result |
|---|---|---|---|---|---|
| passing, exit 0 | 2.1.286 | claude-sonnet-5-5 | 3 | $0.0369 | All seven checks passed. [Record](claude-model-acceptance-passing-2.1.286.json) |
| failing, exit 1 | 2.1.286 | claude-sonnet-5-5 | 2 | $0.0449 | The hook did not run; the model received the full output. [Record](claude-model-acceptance-failing-2.1.286.json) |
| failing, exit 1 | 2.1.216 | claude-sonnet-5 | 2 | $0.1408 | Same as 2.1.286. [Record](claude-model-acceptance-failing-2.1.216.json) |

The first failing record was written before the runner had its `--scenario` option, so it has no `scenario` field; its fixture is the one `--scenario failing` still produces.

### Successful command

- The client ran the plugin's PostToolUse hook, which reported success.
- The model received a 633-byte Bash result. The preflight's direct Vitest run of the same suite, without npm, printed 9,363 bytes (stdout and stderr).
- The hook measured the native response at 9,687 bytes and its replacement at 736 bytes.
- The result named its evidence reference and still contained the deprecation warning and `Tests  121 passed (121)`. The marker line was not in it.
- The model called `read_evidence` with that reference and a limit of 1,000 records. It received 10,543 bytes containing the marker.
- The model's answer quoted the warning, the count of 121 and the marker.
- The local report showed the applied replacement and one MCP retrieval of the same evidence.

The prompt required the omitted line, so this session paid for a full retrieval on top of the reduced result. Whether a real task saves context depends on how often the model needs the omitted detail. One session does not measure that.

### Failing command

In both client versions, `npm test` exiting with status 1 was reported as a failed tool call: `is_error` was true and the result text began with `Exit code 1`.

- The stream contained no PostToolUse hook event, only SessionStart.
- The model received 10,066 bytes: the complete output.
- Both models answered correctly from that output. The 2.1.216 session also noted that the output carried no evidence reference, so it did not call `read_evidence`.

This matches the client documentation (checked on 2026-09-30): PostToolUse runs after a tool call succeeds. A failed call runs PostToolUseFailure instead. That event receives only the error message, can add context and cannot replace the tool result.

## Consequences

- Native replacement works for Bash calls that succeed; this is verified with Claude Code 2.1.286.
- A Bash command that exits non-zero reaches the model unchanged in 2.1.216 and 2.1.286. Typical examples are a failing test, build or lint run. The plugin cannot shorten it, whatever the mode. `codebudget run -- <command>` reduces output with an evidence reference regardless of the exit code.
- One synthetic project and one command shape were used. The sessions show whether the mechanism works end to end, not how often or how much it helps.

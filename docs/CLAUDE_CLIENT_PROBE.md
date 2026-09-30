# Claude MCP health probe

**Current result: passed.** On 2026-09-30 the reproducible check `pnpm smoke:claude-mcp` connected Claude Code 2.1.286 to the CodeBudget MCP server on Linux in an isolated temporary configuration, with no prompt, login or model request. The method and limits are described in [client smoke](CLIENT_SMOKE.md#claude-code-health-check), and the record is [claude-client-smoke-result.json](claude-client-smoke-result.json).

The difference from the earlier attempt below is how the server was supplied: it is registered in the local scope of an empty temporary `CLAUDE_CONFIG_DIR` (with a temporary home) instead of through `--mcp-config` and `--setting-sources`, and the check requires that the client lists exactly one server.

## Earlier attempt (2026-09-29, not verified)

An optional no-model health probe on Windows used Claude Code 2.1.216 with Node 22.16.0. It supplied one temporary stdio MCP configuration for CodeBudget, a temporary `CLAUDE_CONFIG_DIR`, a temporary project working directory, and only operating-system environment variables, and ran:

```text
claude --bare --strict-mcp-config --mcp-config <temporary>/mcp.json --setting-sources project mcp list
```

The process exited successfully but displayed an unrelated server with `Pending approval` instead of the explicitly supplied CodeBudget server, so that probe failed its connection assertion: these options did not isolate the `mcp list` subcommand in that build. No prompt, login, model request, approval choice or global configuration change was submitted, and temporary files were removed.

# Claude MCP health probe: not verified

An optional no-model health probe on Windows used Claude Code 2.1.216 with Node 22.16.0. The installed help documented `--bare`, `--strict-mcp-config`, `--mcp-config`, `--setting-sources`, and the `mcp list` health-check command. The probe supplied one temporary stdio MCP configuration for CodeBudget, a temporary `CLAUDE_CONFIG_DIR`, a temporary project working directory, and only operating-system environment variables.

The attempted command was:

```text
claude --bare --strict-mcp-config --mcp-config <temporary>/mcp.json --setting-sources project mcp list
```

The process exited successfully but displayed an unrelated server with `Pending approval`, instead of the explicitly supplied CodeBudget server. The probe therefore **failed** its connection assertion. This observation means these options did not establish the expected isolation for this subcommand in this installed build; it does not establish why, or prove a general Claude client defect. The unrelated entry's identity and command are omitted from the shared record.

No prompt, login, model request, approval choice or global configuration change was submitted. Temporary files were removed. The probe stopped without retries or permission-bypass options. No reusable health script is provided because the attempted isolation was not demonstrated. [The failure record](claude-client-smoke-result.json) remains explicit evidence of this limit. The actual Claude MCP health gate stays unverified; the separate passing Codex handshake and Claude plugin manifest/SDK contract checks are unaffected.

# CodeBudget for Claude Code

Native beta plugin with a small skill, three bounded MCP tools, and a PostToolUse Bash output filter. The build places local runtime bundles in `dist/`; no API key is required by CodeBudget. Run the repository's build before loading this directory.

Free for personal and internal business use under the [CodeBudget Free Use License 1.0](LICENSE). Commercial products, commercial bundles, rebranded sales and commercial hosted offerings require prior written permission from vahapogut. Prior Apache-2.0 grants and third-party licenses remain intact. See [licensing examples and history](LICENSING.md); the standalone plugin includes all applicable notices.

```sh
codebudget init
claude --plugin-dir /absolute/path/to/plugins/claude-codebudget
```

The CLI's project config defaults to `observe`. Set its `mode` to `balanced` to enable contract-tested reducers. Keep Claude's usual permission policy. Loading this plugin does not require changing global Claude settings. Stop loading `--plugin-dir` to remove its hooks and MCP tools. Project MCP registration through `codebudget adapters install claude` is an alternative to the plugin's MCP registration; avoid registering both copies.

Output replacement is enabled for Claude Code 2.1.216 and later 2.x releases. Hook-contract fixtures run on 2.1.216 and 2.1.285, and CI validates the installed plugin against the newest published client. The official hook contract supports `updatedToolOutput`; a replacement must retain the structured Bash output shape. The hook preserves stderr, native status fields and client annotations, redacts the documented `bashEditDiff` structure, archives masked evidence before reduction, and accounts for its evidence-reference overhead. It never emits `permissionDecision` or rewrites the executable. Other major versions, images, interruptions, unknown text or structured fields, malformed input and reentrancy receive no semantic transformation; the reason is recorded locally and `codebudget doctor` shows the latest one.

The bundled launchers need Node.js 22.16 or newer on `PATH`. With an older Node the hook exits without changing the tool result and prints the reason to stderr. The hook and MCP server resolve the project from `CLAUDE_PROJECT_DIR` (or the working directory) up to the nearest `.codebudget.json`, so both write to the same local database.

Native model-visible replacement has **not** been verified in a real Claude model session. Plugin validation and protocol fixtures do not prove model-visible behavior. That final acceptance requires an explicitly authorized model run; no such run is included in free local verification. The plugin measures controlled bytes and estimated tokens, not provider billing or subscription quota.

The hook cannot sanitize output from unsupported tools or versions, nor remove data already captured by the client before the hook. It is not a client-wide data-loss-prevention boundary. Instructions and full evidence are local; the existing IDE still decides what to send to its provider.

SessionStart, PreCompact and PostCompact reset local context-visibility assumptions; SessionEnd closes the local session. Pre/post events each advance the visibility epoch, so it is not a compaction count. The hook drops the post-compaction conversation summary and transcript path. Live lifecycle delivery remains unverified.

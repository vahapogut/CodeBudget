# Research

Checked 2026-09-29; the Claude Code hook and MCP rows were re-read on 2026-09-30. Capabilities are documentation evidence, not proof of a live client session.

| Source | Version / conclusion | Limit |
|---|---|---|
| https://nodejs.org/en/about/previous-releases | Node 22 and 24 listed LTS; host 22.16.0 | Other OS versions untested |
| https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html | DatabaseSync, prepared statements, busy timeout | Built-in API experimental on host |
| https://www.sqlite.org/fts5.html | FTS5; real local create/query verified | Browser fetch failed; runtime smoke supplies capability evidence |
| https://tree-sitter.github.io/tree-sitter/using-parsers/ | Concrete syntax parsing, not type checking | Actual web-tree-sitter0.27 + official JS0.25/TS0.23.2 grammar execution and installed offline smoke passed |
| https://modelcontextprotocol.io/docs/2026-07-28/develop/build-server | Official MCP SDK and stdio server | @modelcontextprotocol/sdk1.31.0 contract tests and installed worker/stdio smoke passed; actual Codex0.139.0 client MCP discovery also passed; real model sessions remain unverified |
| https://code.claude.com/docs/en/hooks | PostToolUse `updatedToolOutput` replaces any tool's result and must match the tool's output shape; Bash results may carry `bashEditDiff` (v2.1.269+); PostCompact carries `trigger` and `compact_summary` | Contract fixtures on Claude Code 2.1.216 and 2.1.285; replacement enabled for >=2.1.216 <3.0.0. See RESEARCH_ADAPTERS.md |
| https://code.claude.com/docs/en/mcp | Output warning above 10,000 tokens, default limit 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`); a tool's `tools/list` entry may declare `_meta["anthropic/maxResultSizeChars"]` up to 500,000 characters | Declared for `prepare_context` and `get_changes`, covered by an SDK `listTools` test; not observed in a model session |

Exact npm versions were read from registry metadata (not guessed). See lockfile for the resulting dependency graph.

Detailed official client/version/schema evidence is in [RESEARCH_ADAPTERS.md](RESEARCH_ADAPTERS.md), including Claude Code 2.1.216 and 2.1.285, Codex0.139.0 and the unverified Cursor/Antigravity boundaries. [RESEARCH_COMPARISON.md](RESEARCH_COMPARISON.md) records primary-source RTK, Serena, Aider and Context Mode licensing and technical comparisons. No implementation was copied from these tools. [VERIFICATION.md](VERIFICATION.md) records execution evidence separately from documentation claims.

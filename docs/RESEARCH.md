# Research

Checked 2026-09-29. Capabilities are documentation evidence, not proof of a live client session.

| Source | Version / conclusion | Limit |
|---|---|---|
| https://nodejs.org/en/about/previous-releases | Node 22 and 24 listed LTS; host 22.16.0 | Other OS versions untested |
| https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html | DatabaseSync, prepared statements, busy timeout | Built-in API experimental on host |
| https://www.sqlite.org/fts5.html | FTS5; real local create/query verified | Browser fetch failed; runtime smoke supplies capability evidence |
| https://tree-sitter.github.io/tree-sitter/using-parsers/ | Concrete syntax parsing, not type checking | Actual web-tree-sitter0.27 + official JS0.25/TS0.23.2 grammar execution and installed offline smoke passed |
| https://modelcontextprotocol.io/docs/2026-07-28/develop/build-server | Official MCP SDK and stdio server | @modelcontextprotocol/sdk1.31.0 contract tests and installed worker/stdio smoke passed; actual Codex0.139.0 client MCP discovery also passed; real model sessions remain unverified |
| https://code.claude.com/docs/en/hooks | PostToolUse schemas and restrictions | See RESEARCH_ADAPTERS.md for exact client/version evidence |

Exact npm versions were read from registry metadata (not guessed). See lockfile for the resulting dependency graph.

Detailed official client/version/schema evidence is in [RESEARCH_ADAPTERS.md](RESEARCH_ADAPTERS.md), including Claude2.1.216, Codex0.139.0 and the unverified Cursor/Antigravity boundaries. [RESEARCH_COMPARISON.md](RESEARCH_COMPARISON.md) records primary-source RTK, Serena, Aider and Context Mode licensing and technical comparisons. No implementation was copied from these tools. [VERIFICATION.md](VERIFICATION.md) records execution evidence separately from documentation claims.

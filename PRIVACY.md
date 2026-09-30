# Privacy

CodeBudget's core runs locally and has no external telemetry backend. It does not need an account or API key. Dependency installation and an explicitly requested documentation lookup or optional model workflow can use the network; ordinary indexing, replay, context selection, evidence reads and reports do not send repository data to a CodeBudget service.

## Data stored locally

The default `.codebudget/` directory holds SQLite records for sessions, command metadata, masked output chunks, evidence references, index/context records, usage imports and benchmark results. A task description, file path, code range or error message can still be sensitive after obvious secrets have been masked. Keep the directory out of Git and protect access with local filesystem permissions.

Masked output is the default archive. Raw unmasked retention requires an explicit local opt-in: `rawArchive` and `experimental` settings are honored only from the ignored `.codebudget/local.json`, `CODEBUDGET_RAW_ARCHIVE=1` or an explicit override, never from a committed `.codebudget.json`, so cloning a repository cannot switch them on. `codebudget doctor` warns while raw archiving is active. Such data is not automatically returned through MCP or dashboard exports. Redaction is heuristic and does not guarantee anonymity or removal of every secret. Source exclusions and repository boundaries also reduce exposure.

Artifacts have retention and disk limits. When stored evidence passes half of `diskBudgetBytes`, CodeBudget first removes expired artifacts and then the oldest ones until usage is back near 40 percent; a full database is reclaimed the same way before a write is retried. `codebudget data prune --dry-run` previews affected CodeBudget artifacts; applying prune removes only the selected local records. Pruning logical records is not a secure erasure guarantee for disk snapshots, backups, cloud-synced folders or SQLite storage pages. Your operating system and backup policies govern those copies.

## What an IDE sees

CodeBudget returns selected source and evidence to the client that requested it. Your existing IDE may send that content, built-in tool output or other workspace information to its own provider under its settings. Local-first CodeBudget does not prevent that transmission. MCP registration controls CodeBudget's tools only; calls that bypass them remain unobserved.

Usage imports accept explicit local export files. The importer does not discover or scrape accounts, browser sessions or private provider dashboards. Unknown usage, prices and quota remain unknown. Provider/client totals and local estimates have distinct provenance.

The dashboard has no remote analytics, fonts or CDN assets. The printed link carries a single-use secret in the URL fragment, which is never sent to the server as a path or query; the page exchanges it for a session token kept in the tab's session storage. Treat a running dashboard as a credential holder, close the process when finished, and do not expose it through a public tunnel. Optional experimental endpoints are disabled by default; enabling them changes the data flow and requires reviewing their configured destination and permitted scope.

See [security](SECURITY.md), [configuration quickstart](docs/QUICKSTART.md) and [current limitations](docs/STATUS.md).

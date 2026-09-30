# Security

CodeBudget is a beta local developer tool. Its security boundary is the configured repository and the operations the user explicitly invokes. Source files, comments, logs, README text and MCP results are untrusted data; their instructions do not become system policy.

## Reporting a vulnerability

Do not put tokens, raw private artifacts or an exploitable private-repository disclosure into a public issue. Use a private security advisory on the repository if available; otherwise ask the maintainer for a private reporting channel with only a non-sensitive summary. There is no guaranteed response SLA at this stage. Include the version, platform, minimal redacted reproduction, expected boundary and actual result.

## Controls and limits

- Commands use an explicit executable and argv with shell evaluation disabled by default. Automatic command rewriting is disabled when original permission semantics cannot be preserved.
- Artifact content is masked before model-facing output and storage by default. Pattern matching can miss secrets; sensitive-file exclusion and scoped retrieval are additional controls, not proof of complete detection.
- Credential-like assignments and keys (including names that end in `key`, `token`, `secret`, `password` or `credentials`), common token formats (OpenAI, Anthropic, Stripe, Slack, Google, GitHub, GitLab, npm, AWS, SendGrid, Hugging Face, DigitalOcean, Shopify, PyPI), JWTs, URL user-info credentials for any scheme, `Authorization` headers, private-key and PGP private-key blocks, ANSI controls and oversized lines have dedicated handling. A redaction failure must withhold content instead of exposing it.
- Source scanning excludes sensitive paths, dependencies, build products and local archives; ignore rules cannot override the sensitive-path boundary. Escaping paths and symlink traversal are rejected.
- SQLite uses parameterized queries and repository/session scopes. Artifacts carry completeness, truncation, hash, retention and size information. Pruning is confined to the tool's own data.
- MCP exposes three bounded tools. It has no arbitrary shell, arbitrary file read or external URL-fetch endpoint. Unknown client versions and hook shapes do not enable output replacement.
- Dashboard access requires local authentication as well as loopback binding. The printed link is single-use and lives in the URL fragment; unknown paths return a generic 404. Host/Origin validation, mutation protection and safe text rendering defend against another website using the local service. The runtime test record is in `docs/VERIFICATION.md`.
- Exports are redacted. CSV cells beginning with formula characters are neutralized. Raw opt-in archives are not automatically exported through MCP or the dashboard.

Privacy-sensitive switches (`rawArchive`, `experimental`) are ignored in the committed project file and accepted only from local sources. POSIX permission modes are requested for local files: the data directory is 0700, its private files 0600, and rewritten project files keep their existing mode. Windows ACL inheritance is not equivalent to POSIX modes. Protect the repository and data directory with the operating system's access controls. CodeBudget does not encrypt local SQLite contents at rest.

Child processes execute with the user's normal privileges. A benchmark evaluator also executes candidate code and is not an adversarial-code sandbox. Do not use these facilities to run an untrusted repository script merely to index a repository. Runtime/network behavior of explicitly invoked external commands remains that command's behavior.

The hook cannot remove content a client has already captured, sanitize unsupported tools, or prevent an IDE from sending its own data to a provider. Native plugin registration is not a universal data-loss-prevention control.

## Dependencies and release gates

Dependencies are locked. Local verification includes preservation failures, false-success protection, scope/secret boundaries, config rollback and protocol checks; consult the current test record rather than assuming every threat has been proven absent. Dependency audits are point-in-time checks, not a warranty. Keep the generated package's license notices and packaged grammar assets intact.

No TLS interception, account scraping, cookie extraction, quota bypass or hidden provider endpoint is part of this product. Model spending, account linking, global configuration changes and publication require explicit user authorization.

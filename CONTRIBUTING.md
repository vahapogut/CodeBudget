# Contributing

Read `docs/STATUS.md` and `docs/EXECUTION_PLAN.md` before continuing implementation. Local agent instruction files are private workspace configuration and must not be committed or included in release archives. Keep source, APIs and primary documentation in English; maintain the Turkish quickstart. Small changes should include a precise description of behavior, relevant validation and known limitations.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm smoke:package
```

Use the Node/pnpm versions and lockfile declared in the repository. Test focused changes first, then run the release gates. Do not count a mock, fixture or dry-run as real client or model acceptance. Record only checks actually run. Platform CI entries are not proof of a successful remote run.

Reducer changes need fixtures and evidence-preservation assertions, including unknown-format and no-gain behavior. An optimization must retain failure names, messages, expected/actual values, source locations and truncation state. Fault injection should demonstrate that at least one guard rejects broken output. JSON and patch consumers must retain their own machine-readable contract.

Adapters need current official sources, versioned event/config fixtures, rollback coverage and an explicit distinction between documented support, implementation, contract tests and live-client verification. Never introduce permission-bypassing command rewrites. Keep stdout clean for MCP and hook protocols.

Storage and indexing changes must respect canonical-root scope, sensitive paths, dirty files, freshness, session isolation and Windows path behavior. Test with temporary homes and projects; do not alter a contributor's global IDE settings or execute repository scripts during indexing.

Performance claims require reproducible evidence. Keep bytes, estimates, reported usage and monetary cost separate. Include failures, retries, retrieval, model summaries and subagents in experiments. Paid model calls and publication do not belong in the default test suite.

Keep dependencies pinned and update third-party notices when changing the distribution. New original contributions are accepted under the [CodeBudget Free Use License 1.0](LICENSE), unless a separate written agreement says otherwise. Submit only material you own or are authorized to contribute under these terms. You retain copyright; submission does not assign ownership or automatically authorize the owner to relicense your work. Prior Apache grants and separately licensed fixtures/dependencies remain intact; see [license history](LICENSING.md). Do not add code under incompatible terms or copy competitor output benchmarks as CodeBudget results. Do not add co-author trailers automatically. Publishing, pushing or deploying requires the repository owner's explicit instruction.

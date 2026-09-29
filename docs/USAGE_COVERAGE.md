# Usage record coverage

`codebudget report --format json` includes `observedUsage.coverage`. The core API is `summarizeUsageCoverage(events, { maxEvents?, maxGroups? })`. This is a diagnostic report about supplied records; an export cannot reveal calls that never reached it. `coverageRatio`, `unobservedCalls`, unique `subagentIdentityCoverage`, cost and subscription quota remain null.

## Bounds and gaps

The default analysis covers at most 10,000 input records, 32 source/scope groups and 32 metric series. Allowed ceilings are 50,000 records and 128 groups. `scannedRecords`, `analyzedRecords`, omissions and `truncated` expose the limit. Truncated event scans suppress group token totals. Input files remain bounded separately by the importer's byte limit. The report itself does not load transcripts or make network requests.

`missing` counts analyzed records lacking each token dimension, model, local session/task mapping, client timestamp or agent information. It does not count unseen calls or estimate missing token amounts. Missing cache/reasoning fields can reflect the export's schema, rather than collection failure. Codex timestamps are explicitly import-observation times. Duplicate correlations are counted once; conflicting correlations are excluded. Mixed repository inputs are rejected. The Store passes already session-filtered records for a session report.

## Counters and measurement sources

`groups` separates source and scope. `recordedDeltaTokens` is available only when every eligible reported delta has a valid known total and the scan is not truncated or conflicted. It describes those records, not complete task consumption. Overflow returns null with `totalOverflow`, independently of missing-field counts. The coverage report does not add groups together: independent client/provider captures can overlap.

`counters` separates reported request deltas, metric deltas, cumulative samples and local estimates. Metric dimensions and cumulative samples are never added to request totals. `metricSeries` exposes bounded first/last sample times, last value, missing interval starts and observed resets/decreases. Its `total` always remains null; CodeBudget does not turn two snapshots into invented per-request usage. Series keys are opaque hashes; resource identity attributes are not exposed. Legacy metric records without interval metadata are counted as `legacyMetricRecords`.

## Attribution boundaries

Importer 1.1.0 retains sanitized `querySource` and `agentType` separately. A reported `main`, `subagent` or `auxiliary` category is preserved. A reported agent type identifies a subagent category; `repl_main_thread` identifies the main subsystem. Other subsystem strings remain unknown. A type such as `custom` never identifies a unique running agent. `agentIdentity` stays null for both supported exports. Codex turn exports have no verified subagent attribution fields; optional lookalike fields are not imported.

Old importer records remain immutable and ambiguous legacy `agent` values are not reinterpreted. Re-import uses existing correlation IDs; it does not silently rewrite previous attribution or fill historical metadata. Changing an explicit local session/task association conflicts rather than duplicating the same usage.

Supported import formats and exact client gates remain Claude OTLP JSON 2.1.216 and Codex `exec --json` 0.139.0. The official [Claude monitoring reference](https://code.claude.com/docs/en/monitoring-usage) and [pinned Codex event schema](https://raw.githubusercontent.com/openai/codex/rust-v0.139.0/codex-rs/exec/src/exec_events.rs) informed the contract fixtures. Real client captures and end-to-end usage completeness remain external verification gates.

# Usage record coverage

`codebudget report --format json` includes `observedUsage.coverage`. The core API is `summarizeUsageCoverage(events, { maxEvents?, maxGroups? })`. This is a diagnostic report about supplied records; an export cannot reveal calls that never reached it. `coverageRatio`, `unobservedCalls`, unique `subagentIdentityCoverage`, cost and subscription quota remain null.

## Bounds and gaps

The default analysis covers at most 10,000 input records, 32 source/scope groups and 32 metric series. Allowed ceilings are 50,000 records and 128 groups. `scannedRecords`, `analyzedRecords`, omissions and `truncated` expose the limit. Truncated event scans suppress group token totals. Input files remain bounded separately by the importer's byte limit. The report itself does not load transcripts or make network requests.

`missing` counts analyzed records lacking each token dimension, model, local session/task mapping, client timestamp or agent information. It does not count unseen calls or estimate missing token amounts. Missing cache/reasoning fields can reflect the export's schema, rather than collection failure. Codex timestamps are explicitly import-observation times. Duplicate correlations are counted once; conflicting correlations, including a changed cumulative series, are excluded. Mixed repository inputs are rejected. The Store passes already session-filtered records for a session report.

## Counters and measurement sources

`groups` separates source and scope. `recordedDeltaTokens` is available only when every eligible reported delta has a valid known total and the scan is not truncated or conflicted. It describes those records, not complete task consumption. Overflow returns null with `totalOverflow`, independently of missing-field counts. The coverage report does not add groups together: independent client/provider captures can overlap.

Each group also has `runningTotals` for cumulative records that name a counter series (`series`, for example a hashed Codex thread): `seriesCount`, `attributedRecords`, `unattributableRecords`, `missingTotalRecords`, `restartedSeries`, `totalOverflow` and `recordedTokens`. `recordedTokens` is the sum over series of each series' largest observed running total; it is null when any attributed record lacks a valid total, when a series restarted, when the sum overflows, when the scan is truncated or conflicted, or when no series exists. Samples of one series are never added to each other. `restartedSeries` counts series whose samples cross (one is larger in some field and smaller in another), which a single running counter cannot produce.

`counters` separates reported request deltas, metric deltas, cumulative samples (`unattributableCumulativeRecords` counts reported cumulative records without a series), legacy running totals and local estimates. Metric dimensions and cumulative samples are never added to request totals. `metricSeries` exposes bounded first/last sample times, last value, missing interval starts and observed resets/decreases. Its `total` always remains null; CodeBudget does not turn two snapshots into invented per-request usage. Series keys are opaque hashes; resource identity attributes are not exposed. Legacy metric records without interval metadata are counted as `legacyMetricRecords`.

## Report total

`observedUsage.total` comes from `observedUsageTotal(events)`: the sum of reported (`client_reported` or `provider_reported`) delta totals plus, for each cumulative series (source, scope and `series`), its largest observed running total. Excluded are Claude metric dimensions, local estimates, unknown sources, cumulative records without a series (they appear only in coverage as unattributable) and legacy Codex records. The total is null when nothing qualifies, when any qualifying total is missing, unsafe or negative, when the samples of a series cross, when one correlation carries conflicting totals, or when the sum overflows. It is an observation of the supplied records, not billing, quota or complete task consumption.

The report lists at most the newest 100 usage records (`eventCount` gives the number in scope; the JSON export lists up to 1,000); the total and coverage always use every record in scope.

## Codex running totals

In Codex 0.139.0, `codex exec --json` fills `turn.completed.usage` from the thread's running `ThreadTokenUsage.total`, which a resumed thread carries over from its rollout; it emits all zeros (`Usage::default()`) when it received no token count. Importer 1.2.0 therefore stores each `turn.completed` as a `cumulative` observation (scope `codex-exec-thread-total`) whose `series` is a hash of the preceding `thread.started` thread ID. The correlation ID is derived from the series and the four counts, so a duplicated line or a re-import under another `importId` cannot add usage twice. All-zero usage is recorded as unknown (null counts), not as a measured zero, and makes the report total unknown. A turn with no preceding `thread.started` line keeps an `importId`-based identity, has no series and is excluded from totals as unattributable.

Codex adds each model response to the running total, so the largest observation is normally the thread's latest total. When Codex reports the context window full it replaces the running total with a context-window figure whose per-field counts are zero (`fill_to_context_window`); later per-field totals restart from there, and usage before the restart is not observable in the export. A sample in one capture that is smaller than an earlier sample of the same thread is therefore recorded with an unknown total, and samples of one thread from different captures that cross in some field make the total unknown (`restartedSeries`). A restart between captures that leaves every later field smaller than an earlier one cannot be told apart from an older observation, because the export carries no event time; the thread's largest observation then understates its usage. A thread forked in another Codex surface starts from its parent's running total, and the exec export does not name the parent, so the maxima of a parent and its fork can overlap. `codex exec` 0.139.0 itself only starts or resumes threads.

Importer 1.1.0 stored the same running totals as per-turn deltas (scope `codex-exec-turn`). Those stored records stay unchanged but are counted as `legacyRunningTotalRecords` and excluded from every total; re-import the original capture to attribute it to a thread series. The new correlation IDs do not conflict with the legacy ones.

## Claude OTLP captures

A Claude capture may be one OTLP JSON document or JSON Lines as written by OpenTelemetry file exporters and the Collector `fileexporter`: one `resourceLogs` or `resourceMetrics` export batch per line. Batches are merged; a request repeated across batches keeps one correlation ID. The byte limit applies to the whole capture, a leading byte-order mark is ignored, and errors name at most a line number, never input content.

## Attribution boundaries

Importer 1.2.0 retains sanitized `querySource` and `agentType` separately, as 1.1.0 did. A reported `main`, `subagent` or `auxiliary` category is preserved. A reported agent type identifies a subagent category; `repl_main_thread` identifies the main subsystem. Other subsystem strings remain unknown. A type such as `custom` never identifies a unique running agent. `agentIdentity` stays null for both supported exports. Codex turn exports have no verified subagent attribution fields; optional lookalike fields are not imported.

Old importer records remain immutable and ambiguous legacy `agent` values are not reinterpreted. Re-import uses existing correlation IDs; it does not silently rewrite previous attribution or fill historical metadata. Changing an explicit local session/task association conflicts rather than duplicating the same usage.

Supported import formats and exact client gates remain Claude OTLP JSON 2.1.216 and Codex `exec --json` 0.139.0. The official [Claude monitoring reference](https://code.claude.com/docs/en/monitoring-usage), the [pinned Codex event schema](https://raw.githubusercontent.com/openai/codex/rust-v0.139.0/codex-rs/exec/src/exec_events.rs) and the pinned 0.139.0 JSON event processor (`usage_from_last_total`, which reads `ThreadTokenUsage.total`) informed the contract fixtures. Real client captures and end-to-end usage completeness remain external verification gates.

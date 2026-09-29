# Benchmark methodology

CodeBudget measures output reduction separately from task completion, provider usage, price and subscription quota. The product hypotheses are at least 50% reduction on selected noisy outputs and at least 20% lower total consumption per successful task without quality loss. These are targets, not established product claims.

## Replay: local output evidence

Run `pnpm dev benchmark replay` or, after building, `node dist/cli.js benchmark replay`. The CLI defaults to `--corpus all`, showing synthetic and actual captured datasets separately. Use `--corpus captured` or `--corpus synthetic` to select one. A mixed-corpus report deliberately has no blended reduction percentage. The programmatic `replayBenchmark()` default remains the synthetic corpus for compatibility. Regenerate the synthetic repository evidence with `pnpm exec tsx packages/benchmarks/scripts/record-replay.ts`.

The ten original synthetic cases cover Vitest, Jest, TypeScript, ESLint, Git status/diff, search, JSON, exact repeated logs, and an unknown format. Version labels identify the grammar represented; they do not mean the named tool was run to capture that text. The original fixtures and pilot tasks retain their Apache-2.0 license independently of the current application license; see [legacy license](../LEGACY_LICENSE) and [license policy](../LICENSING.md).

The latest CLI replay evidence is [replay-final.json](replay-final.json). Its two corpora remain separate:

| Corpus | Cases | Input content bytes | Reduced content bytes | Content reduction | Serialized reduced-envelope bytes | Evidence checks |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Original synthetic, deliberately noisy | 10 | 22,881 | 3,695 | 83.8512% | 8,815 | 10/10 passed |
| Actually captured local command output | 9 | 6,819 | 5,786 | 15.1488% | 10,369 | 9/9 passed |

Percentages use a ratio of total content bytes within each corpus, not an average of case percentages. Across all 19 cases the report has 29,700 input and 9,481 reduced content bytes; its combined percentage is deliberately `null`. These are not estimates of task, billing or quota savings. The nine captured reduced envelopes total **more bytes than their 6,819-byte original content**; this demonstrates why a content gain alone does not establish a net prompt gain. An equivalent baseline envelope and the complete client workflow have not been measured.

The replay records summed reducer-call durations for each corpus. These single-run, machine-specific observations exclude original command execution, process startup, retrieval and end-to-end client latency; timings vary each time the report is regenerated. Heap deltas can be negative after garbage collection and are not a memory-savings claim.

The actual capture set covers installed Vitest 5.0.2, Jest 30.5.2, TypeScript 5.9.3, ESLint 9.39.2, Git 2.49.0.windows.1 (status and diff), ripgrep 15.2.0, and two original JSON/log emitter programs executed by Node 22.16.0 on Windows. The JSON emitter produces a structured failure with Unicode and expected/actual values; the log emitter uses fixed fixture timestamps, eight exact repeats and two distinct errors. These are actual executed-command captures of deliberately authored coverage fixtures, **not representative production traffic**. The capture set does **not** achieve the 50% content-reduction target. ESLint JSON is already compact and conservative failure handling may leave most real output unchanged.

The prior six-capture result (5,000 → 4,497 content bytes, 10.06%) remains in `packages/benchmarks/results/replay.before-corpus-expansion.json`. The new 15.1488% figure is not a measured performance improvement over that result: the corpus changed. Synthetic and current captured records remain in `packages/benchmarks/results/replay.local.json` and `packages/benchmarks/results/replay.captured.json`; their content counts agree with the current CLI replay, while timings naturally differ.

Regenerate actual captures with `pnpm exec tsx scripts/capture-fixtures.mjs` after installing the locked development dependencies, including Jest. The script never installs packages itself. It runs only original coverage fixtures in a temporary workspace, without commits or global settings changes. Version/argv/exit/platform metadata, new emitter/test source hashes and separately masked stdout/stderr are in `tests/fixtures/reducers/captured/manifest.json`. It also generates `packages/benchmarks/src/captured.ts` so the same actual data is available in a bundled installation without executing the tools again. Absolute temporary/repository paths are normalized and documented. Replay concatenates stdout then stderr; it does not claim to reconstruct the original cross-stream chunk order. Nine per-capture tests verify evidence and reject a deliberately empty candidate. Three additional fault injections alter a Jest expected value, a JSON actual value and a log repeat count; each must fail preservation. Separate tests enforce all nine format families, distinct provenance labels and unblended percentages.

Original and reduced sizes use the same already-redacted boundary. JSON-envelope bytes are reported separately and can exceed the content gain for small outputs. Token values use a conservative UTF-8-byte estimate and are labeled `estimated`; no provider tokenizer or billing total is inferred. Heap samples before and after each reducer are not peak-memory measurements or a bounded-memory guarantee. The runner bounds accepted output upstream.

Every reducer has `supports`, `parse`, `reduce` and `validatePreservation`. Unknown formats, machine-consumed output, observe mode, preservation failures, repeated reduction metadata and candidates with no content gain retain their input. Diff evidence is explicitly labeled as not an applicable patch. JSON whitespace compaction preserves numeric lexemes, duplicate keys and string escapes. Exact log grouping preserves repeat counts and ordering; variable messages and timestamps stay verbatim. Failure evidence, expected/actual values, locations, skipped/cancelled counts, exit codes and truncation metadata have independent tests.

## Task pilot: harness ready, model experiments not run

`pnpm dev benchmark tasks --dry-run` generates a plan; it does not call a model. The corpus contains 30 distinct original TypeScript tasks: six bug fixes, six type errors, six regression-test tasks, six bounded refactors and six log diagnoses. Reference solutions only verify the evaluator; they are not model-generated completions and do not count as task-performance evidence.

The default seed is 42 and the default is three repeats of each task in each of three conditions, totaling 270 planned runs. A deterministic shuffle randomizes run order. Every task-condition pair starts from identical files, verified by an initial-file SHA-256. The conditions are:

1. Native baseline: native client defaults and the full task files.
2. Optimized baseline: the same model and permissions with reasonable documented native search, targeted reads and output options.
3. CodeBudget: the same settings with CodeBudget context selection and reducers, including retrieval overhead.

A runner must implement these conditions faithfully; this repository does not fabricate a baseline agent. A separate comparable-tool condition may be added in a preregistered experiment. No competitor's reported results are CodeBudget results.

The saved `packages/benchmarks/results/task-plan.local.json` confirms `status: not_run`, `dryRun: true`, 30 tasks, 270 planned runs, seed 42, three repeats and **zero model calls**. Its cache state is `uncontrolled/unknown`. There are no observed real-model success rates, consumption-per-success ratios, billed costs, quota measurements or real-task uncertainty intervals. The 20% task-consumption target and quality-preservation hypothesis therefore remain unverified.

An independent [actual Codex client smoke](CLIENT_SMOKE.md) verifies project-local registration and live MCP tool discovery without starting a thread or turn. Its passing inventory handshake is integration evidence only; it contributes no model task outcomes, consumption measurements or success-rate samples to this pilot.

Programmatic `runTaskBenchmark` requires explicit opt-in, pinned model/client versions, settings, permission policy, cache state, timeout, run count and spending limit. A run defaults to one permitted attempt; `maxAttempts` changes the recorded limit explicitly. Concurrency is one. Cache should remain `uncontrolled/unknown` unless the runner can verify it. There is no built-in paid provider connector. The callback receives only task files and public acceptance criteria; evaluator source and reference solutions are kept outside its workspace. Hidden evaluators execute strict TypeScript checks and task-specific assertions. This separation is not a security sandbox against an actively hostile candidate program.

The spend gate limits admission to further runs. It is not a provider-guaranteed hard cap; cancellation cannot retract already billed requests. Unknown or incompatible spending stops a model experiment. Costs require a source URL, verification date, usage class and currency. A runner must include retries, retrieval, summaries and subagent usage in its total, or report the total unknown. It must honor cancellation and avoid untracked background work.

## Analysis and uncertainty

Aggregation includes failed attempts and uses total observed consumption divided by successful tasks. A claimed success is rejected unless its strict typecheck and hidden evaluator both passed and it has no recorded error. With zero successful tasks or incomplete consumption coverage, that ratio is `null`/N/A. Unknown usage is never zero. Provider, client and local estimates remain distinct; mixed measurement sources are not totaled as though comparable.

Paired comparisons match task and repeat, average repeated differences within each task, and report the distribution plus a seeded 2,000-resample paired-task bootstrap interval. Differences are CodeBudget minus baseline, including both failed and successful outcomes. This implementation does not cherry-pick a common-success subset. Any future analysis restricted to successful subsets must label the selection bias.

The pilot conclusion remains `inconclusive`: thirty small tasks do not establish universal quality or a narrow non-inferiority margin. Refactor and log tasks retain a human-review flag. Passing hidden tests does not prove general behavioral equivalence.

## Reproducible local checks

```sh
pnpm exec vitest run packages/reducers/src/index.test.ts packages/benchmarks/src/index.test.ts
pnpm exec vitest run packages/reducers/src/captured.test.ts
pnpm exec eslint packages/reducers packages/benchmarks
pnpm exec tsc --noEmit
pnpm exec tsx packages/benchmarks/scripts/record-replay.ts
```

The capture expansion and outcome-consistency guard passed 45 focused tests across three files, including reducer preservation, all nine captured formats, targeted fault injection, provenance separation and the relevant task-harness accounting/admission checks; 36 unchanged evaluator cases were not rerun in that focused command. ESLint and the project typecheck also passed. Refer to `docs/VERIFICATION.md` for the final whole-project verification and earlier reference-solution/evaluator checks. CI runs only free local tests. No real-model task benchmark, provider bill comparison or subscription-quota experiment has been performed.

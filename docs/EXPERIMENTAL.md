# Optional model experiments

`packages/core/src/experimental.ts` is isolated from the default core. `localSummary` and `apiRouting` are both false in the versioned project config. Selecting experimental mode alone does not enable either function. The current implementation is a TypeScript API with mock contract tests; no real model quality, price, or throughput has been measured.

```ts
const engine = createExperimentalEngine({
  flags: { localSummary: true, localEndpoint: 'http://127.0.0.1:11435/summarize' },
  limits: { maxRequests: 2, maxEstimatedTokens: 8000, timeoutMs: 10000 },
});
const result = await engine.summarize([{ id: 'repo:source:1', kind: 'code', text: sourceBody }]);
```

The configured URL is the complete allowlist. Only literal `127.0.0.1` or `[::1]` HTTP(S) endpoints are accepted. DNS names, URL credentials, fragments, and redirects are refused. A local service must implement the **CodeBudget-specific** JSON contract: POST `{schemaVersion:1, operation:"summarize-evidence", instructions, evidence, maxOutputTokens}`; respond with `{summary:string, usage?:{inputTokens:number,outputTokens:number}}`. This is not represented as an Ollama/OpenAI endpoint contract.

Evidence is redacted before transmission and retained in full in the result. Code bodies are not replaced by summaries. Summaries are labeled `unverified-model-output`, with local duration, additional estimated tokens, and optional separately labeled reported counts. CodeBudget does not promote a generated assertion to a verified finding. The call returns no cost or subscription-quota estimate.

Each engine is a bounded run: default 4 requests, one concurrent request, 16,000 reserved estimated tokens, 24 KiB input, 12 KiB response, 1,024 requested output tokens, and a ten-second timeout. Request serialization is included in input estimation. Failures consume admissions/reservations. AbortSignal cancellation is forwarded. A provider ignoring cancellation retains its concurrency slot until it settles. There are no automatic retries or fallback calls. Token reservations are local admission controls, not a guaranteed provider monetary cap; a provider may ignore max-output hints or bill work already started.

For a separately authorized BYOK workflow, enable `apiRouting`, inject an `ApiProvider` whose credential handling remains external to this module, and call `routeApi` with `authorization:'separate-api-workflow'`. The policy routes `simple` tasks to the explicitly chosen `smallTaskModel`, otherwise to `complexTaskModel`. Model names are policy choices; their prices are not assumed. Requests, evidence, extra usage, cancellation, and limits follow the same boundaries. This module does not change the model, provider, endpoint, permission checks, or billing of any IDE subscription.

Tests use injected local fetch/provider mocks only. Network and paid provider tests remain an explicit external acceptance step. Disable the flags or omit this module to return to the offline deterministic core.

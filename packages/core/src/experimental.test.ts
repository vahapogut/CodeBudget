import { describe, expect, it, vi } from 'vitest';
import { createExperimentalEngine, type ExperimentalEvidence } from './experimental.js';

const evidence: ExperimentalEvidence[] = [{ id: 'repo:source:1', kind: 'code', text: 'export function originalBody() { return 42; }' }];
const flags = { localSummary: true, localEndpoint: 'http://127.0.0.1:11435/summarize' };
const reply = () => Promise.resolve(new Response(JSON.stringify({ summary: 'Source returns 42.', usage: { inputTokens: 90, outputTokens: 5 } })));

describe('experimental isolation and bounded contracts', () => {
  it('is disabled by default and never calls the network', async () => {
    const fetch = vi.fn(reply); const engine = createExperimentalEngine({}, { fetch });
    await expect(engine.summarize(evidence)).rejects.toThrow('disabled'); expect(fetch).not.toHaveBeenCalled(); expect(engine.usage().requests).toBe(0);
  });
  it('preserves real source bodies and labels model claims unverified', async () => {
    const fetch = vi.fn(reply); const engine = createExperimentalEngine({ flags }, { fetch });
    const result = await engine.summarize(evidence);
    expect(result.evidence[0]!.text).toBe(evidence[0]!.text); expect(result.status).toBe('unverified-model-output'); expect(result.providerUsage.source).toBe('client_reported');
    expect(result.cost).toBeNull(); expect(result.subscriptionQuota).toBeNull(); expect(result.additionalEstimatedTokens.input).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith(flags.localEndpoint, expect.objectContaining({ redirect: 'manual', method: 'POST' }));
  });
  it.each(['https://example.com/summary', 'http://localhost/summary', 'http://127.0.0.1.evil/summary', 'http://user:secret@127.0.0.1/summary', 'file:///tmp/model', 'http://127.0.0.1/summary#fragment'])('rejects endpoint %s', async (localEndpoint) => {
    const fetch = vi.fn(reply); await expect(createExperimentalEngine({ flags: { ...flags, localEndpoint } }, { fetch }).summarize(evidence)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not follow local-server redirects to another URL', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.com' } }));
    await expect(createExperimentalEngine({ flags }, { fetch }).summarize(evidence)).rejects.toThrow('redirects'); expect(fetch).toHaveBeenCalledOnce();
  });
  it('masks inputs and returned output without losing evidence references', async () => {
    const fetch = vi.fn(async (_url, init) => { expect(init?.body).not.toContain('sk-abcdefghijklmnopqrst'); return new Response('{"summary":"token sk-abcdefghijklmnopqrst"}'); }) as unknown as typeof globalThis.fetch;
    const result = await createExperimentalEngine({ flags }, { fetch }).summarize([{ id: 'evidence', kind: 'log', text: 'sk-abcdefghijklmnopqrst' }]);
    expect(result.summary).not.toContain('sk-abcdefghijklmnopqrst'); expect(result.evidence[0]!.id).toBe('evidence');
  });
  it('enforces input and response byte limits', async () => {
    await expect(createExperimentalEngine({ flags, limits: { maxInputBytes: 3 } }, { fetch: reply }).summarize(evidence)).rejects.toThrow('input');
    await expect(createExperimentalEngine({ flags, limits: { maxOutputBytes: 4 } }, { fetch: reply }).summarize(evidence)).rejects.toThrow('response');
  });
  it('enforces per-run requests and token reservations including failures', async () => {
    const engine = createExperimentalEngine({ flags, limits: { maxRequests: 1 } }, { fetch: async () => new Response('failure', { status: 503 }) });
    await expect(engine.summarize(evidence)).rejects.toThrow('503');
    await expect(engine.summarize(evidence)).rejects.toThrow('budget');
    expect(engine.usage().requests).toBe(1); expect(engine.usage().reservedEstimatedTokens).toBeGreaterThan(0);
    await expect(createExperimentalEngine({ flags, limits: { maxEstimatedTokens: 1 } }, { fetch: reply }).summarize(evidence)).rejects.toThrow('budget');
  });
  it('propagates timeout cancellation and holds concurrency until ignored calls settle', async () => {
    let finish: ((response: Response) => void) | undefined; let signal: AbortSignal | null = null;
    const fetch: typeof globalThis.fetch = async (_url, init) => { signal = init?.signal ?? null; return new Promise(resolve => { finish = resolve; }); };
    const engine = createExperimentalEngine({ flags, limits: { timeoutMs: 10 } }, { fetch });
    await expect(engine.summarize(evidence)).rejects.toThrow('timed out'); expect(signal!.aborted).toBe(true);
    expect(engine.usage().active).toBe(1); await expect(engine.summarize(evidence)).rejects.toThrow('concurrency');
    finish!(new Response('{"summary":"late"}')); await new Promise(resolve => setTimeout(resolve, 5)); expect(engine.usage().active).toBe(0);
  });
  it('honors caller cancellation without consuming a pre-cancelled request budget', async () => {
    const controller = new AbortController(); controller.abort(); const engine = createExperimentalEngine({ flags }, { fetch: reply });
    await expect(engine.summarize(evidence, { signal: controller.signal })).rejects.toThrow('cancelled'); expect(engine.usage().requests).toBe(0);
  });
  it('routes a separately authorized simple task through the explicitly configured model', async () => {
    const generate = vi.fn(async () => ({ text: 'unverified suggestion', inputTokens: 40, outputTokens: 10 }));
    const engine = createExperimentalEngine({ flags: { apiRouting: true } }, { apiProvider: { generate } });
    const result = await engine.routeApi(evidence, { authorization: 'separate-api-workflow', complexity: 'simple', smallTaskModel: 'chosen-small', complexTaskModel: 'chosen-large' });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'chosen-small' })); expect(result.providerUsage.source).toBe('provider_reported');
    expect(result.evidence).toEqual(evidence); expect(result.cost).toBeNull();
  });
  it('never calls an API provider unless its independent flag is enabled', async () => {
    const generate = vi.fn(); const engine = createExperimentalEngine({ flags }, { apiProvider: { generate } });
    await expect(engine.routeApi(evidence, { authorization: 'separate-api-workflow', complexity: 'complex', smallTaskModel: 'small', complexTaskModel: 'large' })).rejects.toThrow('authorization');
    expect(generate).not.toHaveBeenCalled();
  });
  it('does not silently retry or fall back after provider errors', async () => {
    const generate = vi.fn(async () => { throw new Error('provider down'); }); const engine = createExperimentalEngine({ flags: { apiRouting: true } }, { apiProvider: { generate } });
    await expect(engine.routeApi(evidence, { authorization: 'separate-api-workflow', complexity: 'complex', smallTaskModel: 'small', complexTaskModel: 'large' })).rejects.toThrow('provider down');
    expect(generate).toHaveBeenCalledOnce(); expect(engine.usage().requests).toBe(1);
  });
});

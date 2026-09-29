import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalTokenizer, estimatedTokenizer } from './tokenizer.js';

afterEach(() => vi.unstubAllGlobals());
describe('offline exact local BPE', () => {
  it.each(['cl100k_base', 'o200k_base'] as const)('matches published OpenAI cookbook counts for %s without runtime network', async encoding => {
    vi.stubGlobal('fetch', () => { throw new Error('Unexpected network request'); });
    const tokenizer = await createLocalTokenizer({ encoding });
    // https://developers.openai.com/cookbook/examples/how_to_count_tokens_with_tiktoken
    expect(tokenizer.count('antidisestablishmentarianism')).toBe(6);
    expect(tokenizer.count('2 + 2 = 4')).toBe(7);
    expect(tokenizer.count('お誕生日おめでとう')).toBe(encoding === 'cl100k_base' ? 9 : 8);
    expect(tokenizer.count('')).toBe(0);
    expect(tokenizer.accuracy).toBe('exact_local');
    expect(tokenizer.encoding).toBe(encoding);
    expect(tokenizer.model).toBeNull();
    expect(tokenizer.modelMapping).toBe('unspecified');
  });
  it('encodes special-looking source literally and identifies verified model/encoding pairs', async () => {
    const tokenizer = await createLocalTokenizer({ encoding: 'cl100k_base', model: 'gpt-4' });
    expect(tokenizer.count('<|endoftext|>')).toBe(7); // Ordinary text, not the single special token.
    expect(tokenizer.modelMapping).toBe('verified');
    expect(tokenizer.id).toContain('js-tiktoken@1.0.21:cl100k_base');
    await expect(createLocalTokenizer({ encoding: 'cl100k_base', model: 'gpt-4o' })).rejects.toThrow('maps to o200k_base');
  });
  it('falls back explicitly for unverified model labels and rejects invalid options', async () => {
    const tokenizer = await createLocalTokenizer({ encoding: 'o200k_base', model: 'future-model' });
    expect(tokenizer.accuracy).toBe('estimated');
    expect(tokenizer.encoding).toBeNull();
    expect(tokenizer.modelMapping).toBe('unknown');
    expect(tokenizer.model).toBe('future-model');
    expect(tokenizer.fallbackReason).toContain('No verified local encoding mapping');
    expect(tokenizer.count('source: 日本語')).toBe(estimatedTokenizer.count('source: 日本語'));
    expect((await createLocalTokenizer({ encoding: 'o200k_base', model: 'constructor' })).modelMapping).toBe('unknown');
    await expect(createLocalTokenizer({ encoding: 'o200k_base', model: 'bad model\n' })).rejects.toThrow('model identifier');
  });
});

import type { LocalTokenizerConfig, Tokenizer } from './types.js';

export const estimatedTokenizer: Tokenizer = {
  id: 'codebudget:utf8-bytes-per-2:v1', model: null, encoding: null, modelMapping: 'unspecified', fallbackReason: null,
  method: 'ceil(UTF-8 bytes / 2)', accuracy: 'estimated', count: text => Math.ceil(Buffer.byteLength(text, 'utf8') / 2),
};

// Deliberately finite labels, checked against OpenAI tiktoken/model.py. No prefix guess for future releases.
const modelEncodings: Readonly<Record<string, 'o200k_base' | 'cl100k_base'>> = {
  'gpt-4o': 'o200k_base', 'gpt-4o-mini': 'o200k_base', 'gpt-4.1': 'o200k_base', 'gpt-5': 'o200k_base',
  o1: 'o200k_base', o3: 'o200k_base', 'o4-mini': 'o200k_base',
  'gpt-4': 'cl100k_base', 'gpt-3.5-turbo': 'cl100k_base',
};
const counters = new Map<string, Promise<(text: string) => number>>();
async function localCounter(encoding: 'o200k_base' | 'cl100k_base'): Promise<(text: string) => number> {
  let pending = counters.get(encoding);
  if (!pending) {
    pending = (async () => {
      const { Tiktoken } = await import('js-tiktoken/lite');
      const ranks = encoding === 'o200k_base' ? await import('js-tiktoken/ranks/o200k_base') : await import('js-tiktoken/ranks/cl100k_base');
      const tokenizer = new Tiktoken(ranks.default);
      // Code can contain token-looking strings; count those as ordinary text, never special instructions.
      return (text: string): number => tokenizer.encode(text, [], []).length;
    })();
    counters.set(encoding, pending);
    pending.catch(() => counters.delete(encoding));
  }
  return pending;
}

export async function createLocalTokenizer(config: LocalTokenizerConfig = { encoding: 'estimated' }): Promise<Tokenizer> {
  if (!['estimated', 'o200k_base', 'cl100k_base'].includes(config.encoding)) throw new Error('Unsupported local tokenizer encoding');
  const model = config.model ?? null;
  if (model !== null && (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(model))) throw new Error('Tokenizer model must be a short model identifier');
  const verifiedEncoding = model !== null && Object.hasOwn(modelEncodings, model) ? modelEncodings[model] : undefined;
  const modelMapping = model === null ? 'unspecified' : verifiedEncoding ? 'verified' : 'unknown';
  if (config.encoding === 'estimated') return { ...estimatedTokenizer, model, modelMapping };
  if (model && !verifiedEncoding) return { ...estimatedTokenizer, model, modelMapping, fallbackReason: `No verified local encoding mapping for model ${model}; using the byte estimate instead of ${config.encoding}.` };
  if (verifiedEncoding && verifiedEncoding !== config.encoding) throw new Error(`Model ${model} maps to ${verifiedEncoding}, not ${config.encoding}`);
  return { id: `js-tiktoken@1.0.21:${config.encoding}:ordinary-text`, model, encoding: config.encoding, modelMapping, fallbackReason: null,
    method: 'BPE over the exact serialized text; special-looking strings encoded as ordinary text', accuracy: 'exact_local', count: await localCounter(config.encoding) };
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'fix', 'with', 'from', 'this', 'that', 'should']);
/** Extension-only words would seed every TS/JS file when a task names entry.ts. */
export const CODE_EXTENSION_WORDS = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']);

/** NFC-normalized lowercase words of at least two letters/digits; camelCase, digits and '_' split words. */
export function words(text: string): string[] {
  // eslint-disable-next-line no-control-regex -- ASCII detection selects the equivalent fast path
  if (/^[\x00-\x7f]*$/.test(text)) return asciiWords(text);
  const split = text.normalize('NFC').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/(\p{L}\p{M}*)(\p{N})/gu, '$1 $2').replaceAll('_', ' ').toLowerCase();
  return [...new Set(split.match(/(?:[\p{L}\p{N}]\p{M}*){2,}/gu) ?? [])].filter((word) => !STOP_WORDS.has(word));
}
/** Same result as the Unicode path for ASCII text, without regex passes (symbol names are mostly ASCII). */
function asciiWords(text: string): string[] {
  const found = new Set<string>();
  let current = '';
  const flush = (): void => { if (current.length >= 2 && !STOP_WORDS.has(current)) found.add(current); current = ''; };
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    const lower = code >= 97 && code <= 122;
    const upper = code >= 65 && code <= 90;
    const digit = code >= 48 && code <= 57;
    if (!lower && !upper && !digit) { flush(); continue; }
    const previous = index ? text.charCodeAt(index - 1) : 0;
    const previousLower = previous >= 97 && previous <= 122;
    if ((upper && previousLower) || (digit && (previousLower || (previous >= 65 && previous <= 90)))) flush();
    current += upper ? String.fromCharCode(code + 32) : text[index]!;
  }
  flush();
  return [...found];
}

const stem = (name: string): string => name.replace(/\.[^.]+$/, '');
const MODULE_ENTRY = new Set(['index', 'main', 'mod', '__init__']);
/** Words of a file name; directory names never seed, except the directory of a module entry file (src/auth/index.ts). */
export function stemWords(path: string): string[] {
  const parts = path.split('/');
  const name = stem(parts.at(-1) ?? '');
  return words(MODULE_ENTRY.has(name.toLowerCase()) && parts.length > 1 ? `${name} ${parts.at(-2)!}` : name);
}
/** Name words come from the file name and symbol names. */
export function fileNameWords(path: string, symbols: readonly string[]): Set<string> {
  return new Set([...stemWords(path), ...symbols.flatMap((symbol) => words(symbol))]);
}

/** Test stem: file name without extension and without a .test/.spec suffix. */
export const testStem = (path: string): string => stem(path.split('/').at(-1) ?? '').replace(/[._-](?:test|spec)$/i, '');

// Characters that continue a file name. '@' (an IDE file mention) and '#' (a line anchor) delimit paths.
const CONTINUES_NAME = /[\p{L}\p{N}\p{M}_\-/$~+]/u;
function characterBefore(text: string, index: number): string {
  if (index <= 0) return '';
  const low = text.charCodeAt(index - 1);
  return low >= 0xdc00 && low <= 0xdfff && index >= 2 ? text.slice(index - 2, index) : text[index - 1]!;
}
function boundaryBefore(text: string, index: number): boolean {
  const before = characterBefore(text, index);
  if (!before) return true;
  // "./src/app.ts" names src/app.ts; "x.src/app.ts" and "lib/src/app.ts" do not.
  if (before === '/' && text[index - 2] === '.' && (index - 2 === 0 || boundaryBefore(text, index - 2) && text[index - 3] !== '.')) return true;
  return before !== '.' && !CONTINUES_NAME.test(before);
}
function boundaryAfter(text: string, index: number): boolean {
  let position = index;
  // Sentence punctuation may follow a path ("see src/app.ts."), a longer file name may not ("app.ts.bak").
  while (text[position] === '.') position++;
  const next = text.codePointAt(position);
  return next === undefined || !CONTINUES_NAME.test(String.fromCodePoint(next));
}

/**
 * Known repository paths mentioned in text as whole paths at token boundaries. Both sides are NFC and use
 * '/' separators, so "data.ts" does not mention "a.ts" and "docs/README.md" does not mention "README.md".
 */
export function mentionedPaths(text: string, paths: Iterable<string>): string[] {
  const task = text.normalize('NFC').replaceAll('\\', '/');
  const extensions = new Set(task.match(/\.[\p{L}\p{N}]{1,16}/gu) ?? []);
  const found: string[] = [];
  for (const path of paths) {
    const candidate = path.normalize('NFC').replaceAll('\\', '/');
    const dot = candidate.lastIndexOf('.');
    const extension = dot > candidate.lastIndexOf('/') ? candidate.slice(dot) : '';
    if (extension ? !extensions.has(extension) : !task.includes(candidate)) continue;
    for (let index = task.indexOf(candidate); index !== -1; index = task.indexOf(candidate, index + 1)) {
      if (boundaryBefore(task, index) && boundaryAfter(task, index + candidate.length)) { found.push(path); break; }
    }
  }
  return found;
}

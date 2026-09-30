import { describe, expect, it } from 'vitest';
import { fileNameWords, mentionedPaths, testStem, words } from './matching.js';

describe('task path mentions', () => {
  const paths = ['a.ts', 'src/app.ts', 'src/index.ts', 'index.ts', 'README.md', 'docs/README.md', 'src/data.ts', 'Dockerfile', 'app/[id]/page.tsx'];
  const mentioned = (task: string): string[] => mentionedPaths(task, paths).sort();
  it.each([
    ['Fix the crash in src/index.ts when src/data.ts returns nothing; see docs/README.md.', ['docs/README.md', 'src/data.ts', 'src/index.ts']],
    ['look at ./src/app.ts and @src/index.ts', ['src/app.ts', 'src/index.ts']],
    ['stack: src/app.ts:42:7 (src/data.ts#L3)', ['src/app.ts', 'src/data.ts']],
    ['Windows form src\\app.ts', ['src/app.ts']],
    ['"a.ts", `index.ts` and (README.md)', ['README.md', 'a.ts', 'index.ts']],
    ['data.ts, lib/src/app.ts, src/app.ts.bak, x.src/app.ts, ../src/app.ts, a.tsx', []],
    ['update the Dockerfile and app/[id]/page.tsx', ['Dockerfile', 'app/[id]/page.tsx']],
  ])('%s', (task, expected) => expect(mentioned(task)).toEqual(expected));
  it('compares NFC forms and returns the indexed spelling', () => {
    const nfd = 'dizin/şifre.ts'.normalize('NFD');
    expect(mentionedPaths(`fix ${'dizin/şifre.ts'.normalize('NFC')}`, [nfd])).toEqual([nfd]);
  });
});

describe('name words', () => {
  it('splits camelCase, digits and underscores, lowercases and drops stop words', () => {
    // Letters split from following digits, not digits from following letters (unchanged ranking semantics).
    expect(words('rotateRefreshToken handler42Step3 snake_case_name Fix the XMLHttpRequest')).toEqual(['rotate', 'refresh', 'token', 'handler', '42step', 'snake', 'case', 'name', 'xmlhttp', 'request']);
    expect(words('şifre modülü düzelt')).toEqual(['şifre', 'modülü', 'düzelt']);
    expect(words('é'.normalize('NFD') + 'x')).toEqual(['éx']);
  });
  it('never seeds names from directories except for module entry files', () => {
    expect([...fileNameWords('src/auth/token.ts', ['rotateToken'])].sort()).toEqual(['rotate', 'token']);
    expect([...fileNameWords('src/auth/index.ts', [])].sort()).toEqual(['auth', 'index']);
    expect(testStem('test/auth.test.ts')).toBe('auth');
    expect(testStem('src/auth-spec.ts')).toBe('auth');
    expect(testStem('test/database.test.ts')).not.toBe('data');
  });
});

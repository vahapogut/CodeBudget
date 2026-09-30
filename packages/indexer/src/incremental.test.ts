import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as security from './security.js';
import { createIndexer, type RepositoryIndexer } from './index.js';

// Count source reads without changing behavior: the real implementation runs behind a spy.
vi.mock('./security.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./security.js')>();
  return { ...actual, readSourceFile: vi.fn(actual.readSourceFile) };
});
const reads = vi.mocked(security.readSourceFile);
const readPaths = (): string[] => reads.mock.calls.map((call) => call[1]).sort();

const temporary: string[] = [];
const open: RepositoryIndexer[] = [];
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'codebudget-incremental-'));
  temporary.push(root);
  return root;
}
function file(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
afterEach(() => {
  for (const entry of open.splice(0)) entry.close();
  for (const root of temporary.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('stat-identity change detection', () => {
  it('re-reads only files whose size, mtime, ctime or inode changed, after the racy window', async () => {
    const root = project();
    for (let i = 0; i < 30; i++) file(root, `src/c${String(i).padStart(2, '0')}.ts`, `export const c${i} = ${i};\n`);
    const subject = await createIndexer(root, join(root, '.codebudget'));
    open.push(subject);
    await subject.index();
    reads.mockClear();
    // Within 3 s of a modification a matching stat is not trusted (timestamp granularity), so content is re-read.
    expect(await subject.index()).toMatchObject({ indexed: 0, unchanged: 30 });
    expect(reads).toHaveBeenCalledTimes(30);
    await new Promise((resolve) => setTimeout(resolve, 3100));
    await subject.index();
    reads.mockClear();
    expect(await subject.index()).toMatchObject({ indexed: 0, unchanged: 30 });
    expect(subject.doctor().current).toBe(true);
    subject.getChanges();
    expect(reads).not.toHaveBeenCalled();
    file(root, 'src/c07.ts', 'export const c7 = 700;\n');
    // Same size and restored mtime: the ctime still changes, so the edit is detected.
    const same = join(root, 'src/c08.ts');
    const before = statSync(same);
    writeFileSync(same, 'export const c8 = 9;\n');
    utimesSync(same, before.atime, before.mtime);
    reads.mockClear();
    expect(await subject.index()).toMatchObject({ indexed: 2, unchanged: 28 });
    expect(readPaths()).toEqual(['src/c07.ts', 'src/c08.ts']);
  }, 30_000);
});

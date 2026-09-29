import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safePath } from './security.js';
import { defaults } from './config.js';
import { Store } from './store.js';
import { runCommand } from './runner.js';

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'cb-root-alias-')); temporary.push(directory);
  const physicalParent = join(directory, 'physical');
  const root = join(physicalParent, 'project');
  mkdirSync(join(root, 'sub'), { recursive: true });
  const outside = join(directory, 'outside'); mkdirSync(outside);
  const aliasParent = join(directory, 'alias');
  symlinkSync(physicalParent, aliasParent, process.platform === 'win32' ? 'junction' : 'dir');
  return { root, canonicalRoot: realpathSync(root), aliasRoot: join(aliasParent, 'project'), outside };
}

it('rebases an absolute alias of the repository root and supports new descendants', () => {
  const { root, canonicalRoot, aliasRoot } = fixture();
  for (const base of [root, canonicalRoot, aliasRoot]) {
    expect(safePath(base, aliasRoot)).toBe(canonicalRoot);
    expect(safePath(base, join(aliasRoot, 'sub'))).toBe(join(canonicalRoot, 'sub'));
    expect(safePath(base, join(aliasRoot, 'new', 'file.txt'))).toBe(join(canonicalRoot, 'new', 'file.txt'));
  }
});

it('still denies outside paths, linked descendants and self-links below an aliased root', () => {
  const { root, aliasRoot, outside } = fixture();
  const kind = process.platform === 'win32' ? 'junction' : 'dir';
  symlinkSync(outside, join(root, 'escape'), kind);
  symlinkSync(root, join(root, 'loop'), kind);
  symlinkSync(join(root, 'sub'), join(root, 'internal'), kind);
  symlinkSync(join(outside, 'missing'), join(root, 'dangling'), kind);
  for (const name of ['escape', 'loop', 'internal', 'dangling']) {
    expect(() => safePath(root, join(aliasRoot, name, 'new'))).toThrow('Symlink access denied');
    expect(() => safePath(aliasRoot, join(name, 'new'))).toThrow('Symlink access denied');
  }
  expect(() => safePath(aliasRoot, outside)).toThrow('escapes');
  expect(() => safePath(aliasRoot, '../outside')).toThrow('escapes');
});

it('runs with an aliased cwd under the canonical Store root without relaxing command boundaries', async () => {
  const { aliasRoot, canonicalRoot, outside } = fixture();
  const store = new Store(aliasRoot, defaults());
  try {
    const result = await runCommand(store, { executable: process.execPath, args: ['-e', 'process.stdout.write(process.cwd())'], cwd: join(aliasRoot, 'sub') });
    expect(result.exitCode).toBe(0);
    expect(result.cwd).toBe(join(canonicalRoot, 'sub'));
    expect(result.output).toBe(join(canonicalRoot, 'sub'));
    await expect(runCommand(store, { executable: process.execPath, args: [], cwd: outside })).rejects.toThrow('escapes');
  } finally { store.close(); }
});

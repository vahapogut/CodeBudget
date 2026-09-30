import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact } from '../../core/src/security.js';

// Run with: pnpm exec tsx packages/benchmarks/scripts/capture-test-runner-fixtures.ts
// Executes installed Vitest and Jest on original, deliberately failing fixture tests in a disposable directory.
// The expected/received values are multi-line strings whose blank lines are data, so reducers must keep them.
const require = createRequire(import.meta.url);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const destination = path.join(repository, 'tests', 'fixtures', 'reducers', 'executed');
const vitestCli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const jestCli = path.join(path.dirname(require.resolve('jest/package.json')), 'bin', 'jest.js');
const versionOf = async (name: string): Promise<string> => (JSON.parse(await readFile(require.resolve(`${name}/package.json`), 'utf8')) as { version: string }).version;
const workspace = await mkdtemp(path.join(tmpdir(), 'codebudget-capture-'));
const normalize = (text: string): string => redact(text).split(workspace).join('<fixture>').split(repository).join('<repository>');
const environment = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' };
const render = "const render = (rows) => rows.join('\\n\\n');\n";
const invoice = "['Invoice 2026-0042', 'Line item: consulting, 12 hours', 'Line item: travel at cost', 'Total due in thirty days']";
const expected = "'Invoice 2026-0042\\n\\nLine item: consulting, 12 hours\\n\\n\\nLine item: travel at cost\\n\\nTotal due in thirty days'";
const captures: Record<string, unknown>[] = [];

async function capture(id: string, format: 'vitest' | 'jest', args: string[], version: string, description: string, inputs: string[]): Promise<void> {
  const result = spawnSync(process.execPath, args, { cwd: workspace, env: environment, shell: false, windowsHide: true, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 1) throw new Error(`${id}: expected exit 1, got ${result.status}: ${result.stderr}`);
  const stdout = normalize(result.stdout ?? '');
  const stderr = normalize(result.stderr ?? '');
  await writeFile(path.join(destination, `${id}.stdout.txt`), stdout);
  await writeFile(path.join(destination, `${id}.stderr.txt`), stderr);
  const hashed = await Promise.all(inputs.map(async name => { const source = await readFile(path.join(workspace, name)); return { path: name, sha256: createHash('sha256').update(source).digest('hex'), bytes: source.byteLength }; }));
  captures.push({ id, format, filename: `${id}.stdout.txt`, stderrFilename: `${id}.stderr.txt`, toolVersion: version, executable: 'node', args: args.map(normalize), exitCode: result.status, signal: result.signal, description, inputs: hashed, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr) });
}

try {
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(workspace, 'package.json'), '{"private":true}\n');
  // Name-ordered execution keeps passing files before the failure, as in a typical multi-file run.
  await writeFile(path.join(workspace, 'vitest.config.mjs'), "export default { test: { include: ['*.test.ts'], fileParallelism: false, maxWorkers: 1, sequence: { sequencer: class { async sort(files) { return [...files].sort((a, b) => a.moduleId < b.moduleId ? -1 : 1); } async shard(files) { return files; } } } } };\n");
  const vitestFiles: string[] = [];
  for (let index = 0; index < 5; index += 1) { const name = `a-success-${index}.test.ts`; vitestFiles.push(name); await writeFile(path.join(workspace, name), `import { expect, it } from 'vitest';\nit('successful case ${index}', () => expect(${index} + 1).toBe(${index + 1}));\n`); }
  await writeFile(path.join(workspace, 'b-skipped.test.ts'), "import { expect, it } from 'vitest';\nit('runs', () => expect(1).toBe(1));\nit.skip('is skipped', () => {});\n");
  await writeFile(path.join(workspace, 'z-render.test.ts'), `import { expect, it } from 'vitest';\n${render.replace('(rows)', '(rows: string[])')}it('renders the invoice with paragraph breaks', () => expect(render(${invoice})).toBe(${expected}));\n`);
  vitestFiles.push('b-skipped.test.ts', 'z-render.test.ts', 'vitest.config.mjs');
  await capture('vitest-5-blank-line-diff', 'vitest', [vitestCli, 'run', '--config', path.join(workspace, 'vitest.config.mjs'), '--root', workspace, '--no-color'], await versionOf('vitest'), 'Default reporter: five passing files, one file with a skipped test, and a failed multi-line string comparison whose blank lines are part of both values.', vitestFiles);
  await capture('vitest-5-verbose-blank-line-diff', 'vitest', [vitestCli, 'run', '--config', path.join(workspace, 'vitest.config.mjs'), '--root', workspace, '--reporter', 'verbose', '--no-color'], await versionOf('vitest'), 'Verbose reporter over the same files: one line per passing test before the failure, a skipped test and the blank-line string comparison.', vitestFiles);

  await writeFile(path.join(workspace, 'jest.config.cjs'), 'module.exports = { testEnvironment: "node", testMatch: ["<rootDir>/jest-*.test.cjs"], cache: false, testSequencer: "<rootDir>/name-sequencer.cjs" };\n');
  await writeFile(path.join(workspace, 'name-sequencer.cjs'), 'module.exports = class { sort(tests) { return [...tests].sort((a, b) => a.path < b.path ? -1 : 1); } cacheResults() {} };\n');
  const jestFiles = ['jest.config.cjs', 'name-sequencer.cjs'];
  for (let index = 0; index < 4; index += 1) { const name = `jest-a-success-${index}.test.cjs`; jestFiles.push(name); await writeFile(path.join(workspace, name), `test('successful Jest case ${index}', () => expect(${index} + 1).toBe(${index + 1}));\n`); }
  await writeFile(path.join(workspace, 'jest-z-render.test.cjs'), `${render}test('renders the invoice with paragraph breaks', () => expect(render(${invoice})).toBe(${expected}));\n`);
  jestFiles.push('jest-z-render.test.cjs');
  await capture('jest-30-blank-line-diff', 'jest', [jestCli, '--config', path.join(workspace, 'jest.config.cjs'), '--runInBand', '--no-cache', '--ci'], await versionOf('jest'), 'Four passing suites (listed only in the totals by this run) and a failed multi-line string comparison whose blank lines are part of both values.', jestFiles);

  const manifest = { schemaVersion: 1, generator: 'packages/benchmarks/scripts/capture-test-runner-fixtures.ts', capturedAt: new Date().toISOString(), platform: process.platform, node: process.version, cwd: '<fixture>', redaction: 'CodeBudget core redact; temporary/repository absolute paths normalized. No other rewriting.', stdoutStderrSeparate: true, captures, license: 'CodeBudget Free Use License 1.0 (new first-party material; see LICENSING.md)', note:'Actual local runs of installed test runners on original, deliberately failing fixture tests. Coverage fixtures, not representative production traffic, model runs or provider usage.' };
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ captured: captures.length, versions: captures.map(item => [item.id, item.toolVersion]), modelCalls: 0 }) + '\n');
} finally {
  await cleanup();
}

async function cleanup(): Promise<void> {
  const resolved = path.resolve(workspace);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('codebudget-capture-')) throw new Error('Refusing cleanup outside capture temp root');
  await rm(resolved, { recursive: true, force: true });
}

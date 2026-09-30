import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact } from '../packages/core/src/security.ts';
import { replayBenchmark } from '../packages/benchmarks/src/index.ts';

// Run with: pnpm exec tsx scripts/capture-fixtures.mjs
// Only original, deliberately failing fixture code executes in a disposable directory.
const require = createRequire(import.meta.url);
// Resolve every dependency before touching recorded fixtures or creating a workspace.
const jestCli = path.join(path.dirname(require.resolve('jest/package.json')), 'bin', 'jest.js');
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(repository, 'tests', 'fixtures', 'reducers', 'captured');
const workspace = await mkdtemp(path.join(tmpdir(), 'codebudget-capture-'));
const versionOf = async name => JSON.parse(await readFile(require.resolve(`${name}/package.json`), 'utf8')).version;
const normalize = text => redact(text).split(workspace).join('<fixture>').split(workspace.replaceAll('\\', '/')).join('<fixture>').split(repository).join('<repository>').split(repository.replaceAll('\\', '/')).join('<repository>');
const environment = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(workspace, 'empty-gitconfig') };
const execute = (executable, args) => {
  const result = spawnSync(executable, args, { cwd: workspace, env: environment, shell: false, windowsHide: true, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { stdout: normalize(result.stdout ?? ''), stderr: normalize(result.stderr ?? ''), exitCode: result.status, signal: result.signal };
};
const captures = [];
async function cleanupFixture() {
  const resolved = path.resolve(workspace);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('codebudget-capture-')) throw new Error('Refusing cleanup outside capture temp root');
  await rm(resolved, { recursive: true, force: true });
}
async function capture(id, format, executable, args, version, expectedExit, expectedEvidence, description, sourceFiles = []) {
  const result = execute(executable, args);
  if (result.exitCode !== expectedExit) throw new Error(`${id}: expected exit ${expectedExit}; got ${result.exitCode}; ${result.stderr}`);
  const filename = `${id}.stdout.txt`;
  await writeFile(path.join(destination, filename), result.stdout);
  await writeFile(path.join(destination, `${id}.stderr.txt`), result.stderr);
  const inputs = await Promise.all(sourceFiles.map(async filename => {
    const source = await readFile(path.join(workspace, filename));
    return { path: filename, sha256: createHash('sha256').update(source).digest('hex'), bytes: source.byteLength };
  }));
  captures.push({ id, format, filename, stderrFilename: `${id}.stderr.txt`, toolVersion: version, executable: executable === process.execPath ? 'node' : executable, args: args.map(normalize), exitCode: result.exitCode, signal: result.signal, expectedEvidence, description, inputs, stdoutBytes: Buffer.byteLength(result.stdout), stderrBytes: Buffer.byteLength(result.stderr) });
}
try {
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(workspace, 'empty-gitconfig'), '');
  await writeFile(path.join(workspace, 'package.json'), '{"private":true,"type":"module"}\n');
  await writeFile(path.join(workspace, 'vitest.config.mjs'), 'export default { test: { globals: true, fileParallelism: false, maxWorkers: 1 } };\n');
  for (let index = 0; index < 8; index += 1) await writeFile(path.join(workspace, `success-${index}.test.ts`), `it('successful case ${index}', () => expect(${index} + 1).toBe(${index + 1}));\n`);
  await writeFile(path.join(workspace, 'failure.test.ts'), "it('rejects reused refresh token', () => expect(200).toBe(401));\nit.skip('keeps skipped count', () => {});\nit.todo('keeps todo count');\n");
  const vitestCli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  await capture('vitest-actual', 'vitest', process.execPath, [vitestCli, 'run', '--config', path.join(workspace, 'vitest.config.mjs'), '--root', workspace, '--reporter', 'verbose', '--no-color'], await versionOf('vitest'), 1, ['rejects reused refresh token', '401', '200', 'failure.test.ts:1', 'skipped', 'todo'], 'Eight passing files, one failed assertion, one skipped and one todo case; actually executed.');

  await writeFile(path.join(workspace, 'jest.config.cjs'), 'module.exports = { testEnvironment: "node", testMatch: ["<rootDir>/jest-*.test.cjs"], verbose: true, cache: false };\n');
  for (let index = 0; index < 3; index += 1) await writeFile(path.join(workspace, `jest-success-${index}.test.cjs`), `test('successful Jest case ${index}', () => expect(${index} + 1).toBe(${index + 1}));\n`);
  await writeFile(path.join(workspace, 'jest-failure.test.cjs'), "test('rejects reused refresh token', () => expect(200).toBe(401));\ntest.skip('retains skipped count', () => {});\ntest.todo('retains todo count');\n");
  await capture('jest-actual', 'jest', process.execPath, [jestCli, '--config', path.join(workspace, 'jest.config.cjs'), '--runInBand', '--no-cache', '--ci'], await versionOf('jest'), 1, ['rejects reused refresh token', 'Expected: 401', 'Received: 200', 'jest-failure.test.cjs:1', '1 skipped', '1 todo'], 'Actually executed Jest tests: three passing suites, one failed assertion, one skipped case and one todo. Original temporary test code; no application/model run.', ['jest.config.cjs', 'jest-failure.test.cjs', 'jest-success-0.test.cjs', 'jest-success-1.test.cjs', 'jest-success-2.test.cjs']);

  await writeFile(path.join(workspace, 'type-failure.ts'), 'export const retries: number = "three";\nexport const label: string = 9;\n');
  await capture('tsc-actual', 'tsc', process.execPath, [require.resolve('typescript/bin/tsc'), 'type-failure.ts', '--noEmit', '--strict', '--pretty', 'false', '--target', 'ES2022', '--skipLibCheck'], await versionOf('typescript'), 2, ['type-failure.ts(1,14)', 'TS2322', "Type 'string' is not assignable to type 'number'", 'type-failure.ts(2,14)'], 'Two genuine strict TypeScript assignment errors.');

  await writeFile(path.join(workspace, 'eslint.config.mjs'), 'export default [{ files: ["**/*.js"], rules: { "no-unused-vars": "error", "eqeqeq": "error" } }];\n');
  await writeFile(path.join(workspace, 'lint-failure.js'), 'const unused = 9;\nexport function same(left, right) { return left == right; }\n');
  const eslintCli = path.join(path.dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js');
  await capture('eslint-actual', 'eslint', process.execPath, [eslintCli, '--no-config-lookup', '--config', path.join(workspace, 'eslint.config.mjs'), '--format', 'json', 'lint-failure.js'], await versionOf('eslint'), 1, ['no-unused-vars', 'eqeqeq', 'lint-failure.js', '"errorCount":2'], 'Real ESLint JSON reporter output; original structured values retained.');

  const gitVersion = execute('git', ['--version']).stdout.trim();
  const initialized = execute('git', ['-c', 'init.defaultBranch=main', 'init']);
  if (initialized.exitCode !== 0) throw new Error('Temporary git init failed');
  for (let index = 0; index < 8; index += 1) await writeFile(path.join(workspace, `diff-${index}.ts`), `export const count${index} = 1;\n`);
  const added = execute('git', ['add', '--', ...Array.from({ length: 8 }, (_, index) => `diff-${index}.ts`)]);
  if (added.exitCode !== 0) throw new Error('Temporary git add failed');
  for (let index = 0; index < 8; index += 1) await writeFile(path.join(workspace, `diff-${index}.ts`), `export const count${index} = 2;\n`);
  await capture('git-status-actual', 'git-status', 'git', ['status', '--porcelain=v1', '--untracked-files=no'], gitVersion, 0, ['AM diff-0.ts', 'AM diff-7.ts'], 'Actual staged initial files with unstaged edits. No commit was created.');
  await capture('git-diff-actual', 'git-diff', 'git', ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--', ...Array.from({ length: 8 }, (_, index) => `diff-${index}.ts`)], gitVersion, 0, ['@@ -1 +1 @@', '-export const count0 = 1;', '+export const count0 = 2;', 'diff-7.ts'], 'Actual unstaged patch against the temporary index; no global Git settings changed.');

  await mkdir(path.join(workspace, 'search'), { recursive: true });
  await writeFile(path.join(workspace, 'search', 'refresh-token-service.ts'), Array.from({ length: 12 }, (_, index) => `export const refreshToken${index} = ${index};`).join('\n') + '\n');
  const rgVersion = execute('rg', ['--version']).stdout.split('\n')[0].trim();
  await capture('rg-actual', 'search', 'rg', ['--line-number', '--column', '--with-filename', '--no-heading', '--color', 'never', 'refresh', 'search/refresh-token-service.ts'], rgVersion, 0, ['refresh-token-service.ts', '1:14:export const refreshToken0', '12:14:export const refreshToken11'], 'Actual ripgrep line/column results from original fixture source.');

  await writeFile(path.join(workspace, 'json-output.mjs'), `const payload = {
  schemaVersion: 1,
  status: 'failure',
  message: 'Refresh session rejected',
  diagnostic: { expected: 401, actual: 200, file: 'src/auth.ts', line: 42 },
  cases: [{ name: 'rejects reused refresh token', status: 'failed' }, { name: 'expired session', status: 'skipped' }],
  skipped: 1,
  cancelled: 1,
  note: 'Preserve spaces: a  b; Unicode: İstanbul 🙂'
};
process.stdout.write(JSON.stringify(payload, null, 2) + '\\n');
process.exitCode = 1;
`);
  await capture('json-actual', 'json', process.execPath, ['json-output.mjs'], process.version, 1, ['"status":"failure"', 'Refresh session rejected', '"expected":401', '"actual":200', '"file":"src/auth.ts"', '"line":42', '"skipped":1', '"cancelled":1', 'İstanbul 🙂', 'a  b'], 'Actual Node stdout from an original JSON emitter. This is formatter/diagnostic coverage, not production application traffic.', ['json-output.mjs']);

  await writeFile(path.join(workspace, 'repeated-logs.mjs'), `process.stdout.write('2026-09-29T12:00:00Z INFO poll cycle begins\\n');
for (let attempt = 0; attempt < 8; attempt += 1) process.stdout.write('INFO queue poll for tenant alpha returned zero pending work items\\n');
process.stdout.write('2026-09-29T12:00:05Z ERROR request 28 expected 200 actual 503\\n');
process.stdout.write('2026-09-29T12:00:06Z ERROR request 29 expected 200 actual 504\\n');
process.stdout.write('2026-09-29T12:00:08Z INFO poll cycle ends\\n');
process.exitCode = 1;
`);
  await capture('logs-actual', 'logs', process.execPath, ['repeated-logs.mjs'], process.version, 1, ['8 occurrences', '12:00:00Z', '12:00:08Z', 'request 28 expected 200 actual 503', 'request 29 expected 200 actual 504'], 'Actual Node stdout from an original repeated-log emitter with fixed fixture timestamps, eight exact repeats and two distinct errors. Not a captured production incident or performance sample.', ['repeated-logs.mjs']);

  const manifest = { schemaVersion: 1, generatorVersion: '2', capturedAt: new Date().toISOString(), platform: process.platform, node: process.version, cwd: '<fixture>', redaction: 'CodeBudget core redact; temporary/repository absolute paths normalized. No other semantic rewriting.', stdoutStderrSeparate: true, captures, license: 'Apache-2.0', note: 'Actual local command output from deliberately authored coverage fixtures. JSON/log emitters use original fixture payloads and fixed timestamps. This curated set is not representative production traffic, model task runs or provider usage.' };
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const cases = await Promise.all(captures.map(async capture => ({ id: capture.id, format: capture.format, corpus: 'captured', toolVersion: capture.toolVersion, capturedAt: manifest.capturedAt, exitCode: capture.exitCode, expectedEvidence: capture.expectedEvidence, text: await readFile(path.join(destination, capture.filename), 'utf8') + await readFile(path.join(destination, capture.stderrFilename), 'utf8') })));
  const generated = `import type { ReplayCase } from './index.js';\n// Generated by scripts/capture-fixtures.mjs from actual executed, masked local tool output.\nexport const capturedReplayCases: readonly ReplayCase[] = ${JSON.stringify(cases, null, 2)};\n`;
  await writeFile(path.join(repository, 'packages', 'benchmarks', 'src', 'captured.ts'), generated);
  // Same record shape as packages/benchmarks/scripts/record-replay.ts, which replays these captures without re-running the tools.
  const replay = { recordedAt: new Date().toISOString(), platform: process.platform, node: process.version, source: 'Captured by scripts/capture-fixtures.mjs from freshly executed local tools.', ...replayBenchmark(cases), limitations: ['Actually executed local tool captures; stdout and stderr replayed as a documented concatenation, not an assertion about cross-stream order.', 'Primary figures use automatic format detection as the runner and Claude hook do; format-hinted figures are reported separately under `hinted`.', 'No model calls, task completion, billing or subscription quota measured.', 'Replay percentages are not end-to-end task savings.'] };
  await mkdir(path.join(repository, 'packages', 'benchmarks', 'results'), { recursive: true });
  await writeFile(path.join(repository, 'packages', 'benchmarks', 'results', 'replay.captured.json'), JSON.stringify(replay, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ captured: captures.length, versions: captures.map(item => [item.id, item.toolVersion]), originalBytes: replay.originalBytes, reducedBytes: replay.reducedBytes, preservationPassed: replay.preservationPassed, modelCalls: 0 }) + '\n');
} finally {
  await cleanupFixture();
}

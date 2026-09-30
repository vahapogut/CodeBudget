import { cp, mkdir, readFile, writeFile, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Local agent instruction files (AGENTS.md, CLAUDE.md and similar) never ship in a release. */
export const isAgentInstructionFile = file => /^(?:agents|claude|gemini)(?:\.local)?\.md$|^\.(?:cursor|windsurf)rules$|^copilot-instructions\.md$/i.test(path.basename(file));

export async function packRelease() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const staging = await mkdtemp(path.join(tmpdir(), 'codebudget-package-'));
  try {
    for (const name of ['dist', 'plugins', 'docs', 'examples']) await cp(path.join(root, name), path.join(staging, name), {
      recursive: true,
      // Local smoke results describe this machine's last run, not the packaged build.
      filter: source => !source.endsWith('.tgz') && path.resolve(source) !== path.join(root, 'dist', 'package-smoke-result.json') && !isAgentInstructionFile(source),
    });
    for (const name of ['README.md', 'LICENSE', 'LEGACY_LICENSE', 'LICENSING.md', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'PRIVACY.md', 'CONTRIBUTING.md', 'ROADMAP.md', 'CHANGELOG.md']) await copyFile(path.join(root, name), path.join(staging, name));
    await writeFile(path.join(staging, 'package.json'), JSON.stringify({
      name: manifest.name, version: manifest.version, description: manifest.description, type: 'module', license: manifest.license,
      author: 'vahapogut', repository: manifest.repository, engines: manifest.engines, bin: manifest.bin,
      exports: { './core': './dist/core.mjs', './benchmarks': './dist/benchmarks.mjs' },
      files: ['dist', 'plugins', 'docs', 'examples', '*.md', 'LICENSE', 'LEGACY_LICENSE', 'NOTICE'],
      // Only the optional task evaluators compile TypeScript; the CLI, MCP server and plugin never need it.
      peerDependencies: { typescript: manifest.devDependencies.typescript }, peerDependenciesMeta: { typescript: { optional: true } },
    }, null, 2) + '\n');
    await mkdir(path.join(root, 'dist'), { recursive: true });
    const pnpm = process.env.npm_execpath;
    if (!pnpm) throw new Error('Run through pnpm pack:release or pnpm smoke:package');
    const result = spawnSync(process.execPath, [pnpm, 'pack', '--pack-destination', path.join(root, 'dist')], { cwd: staging, encoding: 'utf8', shell: false, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'pack failed');
    return path.join(root, 'dist', `${manifest.name}-${manifest.version}.tgz`);
  } finally {
    const resolved = path.resolve(staging);
    if (path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('codebudget-package-')) await rm(resolved, { recursive: true, force: true });
    else process.stderr.write('Refused unsafe package cleanup path\n');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await packRelease());

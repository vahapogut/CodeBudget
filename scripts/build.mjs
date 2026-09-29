import { build } from 'tsup';
import { build as viteBuild } from 'vite';
import { mkdir, copyFile, chmod, readFile, writeFile, cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('dist', { recursive: true });
await build({
  entry: { cli: 'apps/cli/src/index.ts', 'evidence-worker': 'packages/mcp/src/worker.ts', hook: 'apps/cli/src/hook-entry.ts', mcp: 'apps/cli/src/mcp-entry.ts', core: 'packages/core/src/index.ts', benchmarks: 'packages/benchmarks/src/index.ts' },
  outDir: 'dist', format: ['esm'], target: 'node22', platform: 'node', splitting: false, sourcemap: true,
  clean: false, dts: false, noExternal: [/.*/], external: ['typescript'], removeNodeProtocol: false,
  banner: { js: 'import { createRequire as __cbCreateRequire } from "node:module"; const require = __cbCreateRequire(import.meta.url);' },
  outExtension({ format }) { return { js: format === 'esm' ? '.mjs' : '.js' }; },
});
await copyFile('dist/cli.mjs', 'dist/cli.js'); await chmod('dist/cli.js', 0o755);
await mkdir('dist/assets', { recursive: true });
const wasm = {
  'web-tree-sitter.wasm': 'web-tree-sitter/web-tree-sitter.wasm',
  'tree-sitter-javascript.wasm': 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  'tree-sitter-typescript.wasm': 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  'tree-sitter-tsx.wasm': 'tree-sitter-typescript/tree-sitter-tsx.wasm',
};
for (const [name, module] of Object.entries(wasm)) await copyFile(require.resolve(module), path.join('dist/assets', name));
const pluginDist = 'plugins/claude-codebudget/dist';
await mkdir(path.join(pluginDist, 'assets'), { recursive: true });
for (const file of ['hook.mjs', 'mcp.mjs', 'evidence-worker.mjs']) await copyFile(path.join('dist', file), path.join(pluginDist, file));
for (const name of Object.keys(wasm)) await copyFile(path.join('dist/assets', name), path.join(pluginDist, 'assets', name));
for (const name of ['LICENSE', 'LEGACY_LICENSE', 'LICENSING.md', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) await copyFile(name, path.join('plugins/claude-codebudget', name));
await cp('docs/third-party-licenses', path.join('plugins/claude-codebudget/docs/third-party-licenses'), { recursive: true });
await copyFile('docs/dependency-licenses.json', 'plugins/claude-codebudget/docs/dependency-licenses.json');
await viteBuild({ root: 'apps/dashboard', build: { outDir: path.resolve('dist/dashboard'), emptyOutDir: true }, base: '/' });
await writeFile('dist/build-manifest.json', JSON.stringify({ schemaVersion: 1, version: manifest.version, runtime: process.version, builtAt: new Date().toISOString(), offlineAssets: Object.keys(wasm), modelCalls: 0 }, null, 2) + '\n');

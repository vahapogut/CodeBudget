import { build } from 'tsup';
import { build as viteBuild } from 'vite';
import { mkdir, copyFile, chmod, readFile, writeFile, cp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('dist', { recursive: true });
for (const file of await readdir('dist')) if (/^chunk-.*\.mjs(?:\.map)?$/.test(file)) await rm(path.join('dist', file));
const common = {
  format: ['esm'], target: 'node22', platform: 'node', sourcemap: true, clean: false, dts: false, noExternal: [/.*/], external: ['typescript'], removeNodeProtocol: false,
  banner: { js: 'import { createRequire as __cbCreateRequire } from "node:module"; const require = __cbCreateRequire(import.meta.url);' },
  outExtension() { return { js: '.mjs' }; },
};
// The CLI is code-split so `run` and `--version` do not parse the indexer, tokenizer tables or MCP SDK.
await build({ ...common, entry: { cli: 'apps/cli/src/index.ts', core: 'packages/core/src/index.ts', benchmarks: 'packages/benchmarks/src/index.ts' }, outDir: 'dist', splitting: true });
// Plugin runtimes stay self-contained because the plugin directory is also distributed on its own.
await build({ ...common, entry: { 'evidence-worker': 'packages/mcp/src/worker.ts', 'hook-main': 'apps/cli/src/hook-entry.ts', 'mcp-main': 'apps/cli/src/mcp-entry.ts' }, outDir: 'dist', splitting: false });

/**
 * Tiny launchers: fail with a clear message on an unsupported Node.js runtime (node:sqlite needs
 * 22.16+) instead of an uncaught module error, and silence only the node:sqlite experimental notice.
 */
const launcher = (target, unsupported) => `// CodeBudget launcher: runtime check, then the bundled entry.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 16)) { ${unsupported} }
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => /SQLite is an experimental feature/.test(typeof warning === 'string' ? warning : warning?.message ?? '') ? undefined : emitWarning(warning, ...rest);
await import(${JSON.stringify(target)});
`;
await writeFile('dist/cli.js', '#!/usr/bin/env node\n' + launcher('./cli.mjs', 'process.stderr.write(`CodeBudget requires Node.js 22.16 or newer; found ${process.version}.\\n`); process.exit(1);'));
await writeFile('dist/hook.mjs', launcher('./hook-main.mjs', 'process.stderr.write(`CodeBudget hook needs Node.js 22.16 or newer on PATH (found ${process.version}); the tool result is left unchanged.\\n`); process.exit(0);'));
await writeFile('dist/mcp.mjs', launcher('./mcp-main.mjs', 'process.stderr.write(`CodeBudget MCP server needs Node.js 22.16 or newer on PATH (found ${process.version}).\\n`); process.exit(1);'));
await chmod('dist/cli.js', 0o755);
await mkdir('dist/assets', { recursive: true });
const wasm = {
  'web-tree-sitter.wasm': 'web-tree-sitter/web-tree-sitter.wasm',
  'tree-sitter-javascript.wasm': 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  'tree-sitter-typescript.wasm': 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  'tree-sitter-tsx.wasm': 'tree-sitter-typescript/tree-sitter-tsx.wasm',
};
// Copies keep a fixed 0644 mode: some upstream packages ship executable .wasm files, which would
// otherwise change the committed plugin files on every POSIX build.
const place = async (source, target) => { await copyFile(source, target); await chmod(target, 0o644); };
for (const [name, module] of Object.entries(wasm)) await place(require.resolve(module), path.join('dist/assets', name));
const pluginDist = 'plugins/claude-codebudget/dist';
await mkdir(path.join(pluginDist, 'assets'), { recursive: true });
for (const file of await readdir(pluginDist)) if (file.endsWith('.mjs') && !['hook.mjs', 'mcp.mjs', 'hook-main.mjs', 'mcp-main.mjs', 'evidence-worker.mjs'].includes(file)) await rm(path.join(pluginDist, file));
for (const file of ['hook.mjs', 'mcp.mjs', 'hook-main.mjs', 'mcp-main.mjs', 'evidence-worker.mjs']) await place(path.join('dist', file), path.join(pluginDist, file));
for (const name of Object.keys(wasm)) await place(path.join('dist/assets', name), path.join(pluginDist, 'assets', name));
for (const name of ['LICENSE', 'LEGACY_LICENSE', 'LICENSING.md', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) await place(name, path.join('plugins/claude-codebudget', name));
await cp('docs/third-party-licenses', path.join('plugins/claude-codebudget/docs/third-party-licenses'), { recursive: true });
await place('docs/dependency-licenses.json', 'plugins/claude-codebudget/docs/dependency-licenses.json');
await viteBuild({ root: 'apps/dashboard', build: { outDir: path.resolve('dist/dashboard'), emptyOutDir: true }, base: '/' });
await writeFile('dist/build-manifest.json', JSON.stringify({ schemaVersion: 1, version: manifest.version, runtime: process.version, builtAt: new Date().toISOString(), offlineAssets: Object.keys(wasm), modelCalls: 0 }, null, 2) + '\n');

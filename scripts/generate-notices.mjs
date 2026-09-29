import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

// pnpm licenses list --prod --json | node scripts/generate-notices.mjs
let input = '';
for await (const chunk of process.stdin) input += chunk;
const groups = JSON.parse(input);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// The staged release promotes the TypeScript evaluator compiler from dev to runtime.
const compilerDirectory = path.dirname(require.resolve('typescript/package.json'));
const compiler = JSON.parse(await readFile(path.join(compilerDirectory, 'package.json'), 'utf8'));
if (!Object.values(groups).flat().some(item => item.name === compiler.name)) {
  groups[compiler.license] ??= [];
  groups[compiler.license].push({ name: compiler.name, paths: [compilerDirectory], homepage: compiler.homepage ?? null });
}
const destination = path.join(root, 'docs', 'third-party-licenses');
await mkdir(destination, { recursive: true });
const entries = [];
// js-tiktoken's npm archive omits its root MIT text. Retain the exact
// license from the npm version's gitHead, with offline integrity checking.
const supplementalLicenses = {
  'js-tiktoken@1.0.21': {
    path: 'docs/third-party-licenses/js-tiktoken-1.0.21-LICENSE',
    source: 'https://github.com/dqbd/tiktoken/blob/4c8b748e07992c00386f3180af5c574b27b65139/LICENSE',
    sha256: '418cb499b436128d653d79941333a5437b7be2ea9213dcc2f04d15d5d2c51d86',
  },
};
for (const [license, packages] of Object.entries(groups)) {
  for (const item of packages) {
    for (const directory of item.paths) {
      const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      const notices = [];
      for (const filename of await readdir(directory)) {
        if (!/^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(filename)) continue;
        try {
          const content = await readFile(path.join(directory, filename), 'utf8');
          const outputName = `${manifest.name}-${manifest.version}-${filename}`.replace(/[^a-zA-Z0-9._-]/g, '_');
          await writeFile(path.join(destination, outputName), content);
          notices.push(`docs/third-party-licenses/${outputName}`);
        } catch (error) { if (error.code !== 'EISDIR') throw error; }
      }
      const supplemental = supplementalLicenses[`${manifest.name}@${manifest.version}`];
      if (!notices.length && supplemental) {
        const content = await readFile(path.join(root, supplemental.path));
        if (createHash('sha256').update(content).digest('hex') !== supplemental.sha256) throw new Error(`Supplemental license integrity mismatch: ${manifest.name}`);
        notices.push(supplemental.path);
      }
      entries.push({ name: manifest.name, version: manifest.version, license, homepage: item.homepage ?? null, author: manifest.author ?? null, notices, ...(supplemental ? { supplementalLicense: supplemental } : {}) });
    }
  }
}
entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const inventory = { schemaVersion: 1, generatedAt: new Date().toISOString(), source: 'pnpm licenses list --prod --json against the installed lockfile, plus the staged release TypeScript evaluator compiler', platform: process.platform, entries };
await writeFile(path.join(root, 'docs', 'dependency-licenses.json'), JSON.stringify(inventory, null, 2) + '\n');
const lines = [
  '# Third-party notices', '',
  'CodeBudget uses the packages below under their respective licenses. This inventory was generated from the installed production dependency graph plus TypeScript, which the staged release requires for local hidden-evaluator typechecks. Build and test dependencies can be inspected separately with `pnpm licenses list --json`. Platform-specific optional dependencies may differ in another installed graph. Original license and NOTICE texts are linked per entry and remain authoritative. The js-tiktoken archive omits its root license; its MIT text is preserved from the exact npm gitHead with source and SHA-256 recorded in the inventory.', '',
  'Generated inventory: [dependency-licenses.json](docs/dependency-licenses.json). Refresh after dependency changes using:', '',
  '```sh', 'pnpm licenses list --prod --json | node scripts/generate-notices.mjs', '```', '',
  'Node.js is supplied by the user and retains its own distribution licenses. SQLite is used through Node\'s built-in runtime. Tree-sitter runtime and grammar packages appear below. No RTK, Serena, Aider or Context Mode implementation was copied into this distribution.', '',
  '| Package | Version | License | Original text |', '| --- | --- | --- | --- |',
  ...entries.map(entry => `| ${entry.name} | ${entry.version} | ${entry.license} | ${entry.notices.length ? entry.notices.map((file, i) => `[text ${i + 1}](${file})`).join(', ') : 'No root license file shipped; inspect upstream package source before publication.'} |`), '',
];
await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
process.stdout.write(JSON.stringify({ packages: entries.length, missingRootLicense: entries.filter(item => !item.notices.length).map(item => item.name) }) + '\n');

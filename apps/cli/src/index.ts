#!/usr/bin/env node
import { Command } from 'commander';
import { z } from 'zod';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { initialize, loadConfig, setMode, Store, runCommand, redact, sanitize, csvCell, SECURITY_VERSION } from '../../../packages/core/src/index.js';
import { createIndexer, type LocalTokenizerConfig } from '../../../packages/indexer/src/index.js';
import { serveMcp } from '../../../packages/mcp/src/index.js';
import { inspectAdapters, planAdapterChange, applyAdapterPlan, type ClientId } from '../../../packages/adapters/src/index.js';
import { replayBenchmark, createTaskBenchmarkPlan, replayCases, capturedReplayCases } from '../../../packages/benchmarks/src/index.js';
import { importUsageIntoStore } from '../../../packages/core/src/usage.js';
import { readStdin, runHook, detectVersion } from './hook.js';

const program = new Command().name('codebudget').description('Local evidence, output reduction and task context. No provider calls required.').version('0.1.0-beta.1').enablePositionalOptions()
  .option('--root <path>', 'authorized repository root (default current directory)', process.cwd());
const root = () => resolve(program.opts<{ root: string }>().root);
const output = (value: unknown): void => { process.stdout.write(JSON.stringify(sanitize(value), null, 2) + '\n'); };
const openStore = () => new Store(root(), loadConfig(root()));
const indexOptions = (store: Store) => ({ redact, securityPolicyId: SECURITY_VERSION, weights: store.config.contextWeights, dependencies: store.config.contextDependencies, tokenizerConfig: store.config.contextTokenizer, diskBudgetBytes: Math.floor(store.config.diskBudgetBytes / 4), retentionDays: store.config.artifactRetentionDays });
async function withStore<T>(fn: (store: Store) => T | Promise<T>): Promise<T> { const store = openStore(); try { return await fn(store); } finally { store.close(); } }
const integer = (value: string) => { const result = Number(value); if (!Number.isSafeInteger(result)) throw new Error(`Expected integer: ${value}`); return result; };
async function taskInput(options: { task?: string; taskFile?: string }): Promise<string> {
  if (options.task && options.taskFile) throw new Error('Choose --task or --task-file');
  if (!options.task && !options.taskFile && process.stdin.isTTY) throw new Error('Provide --task, --task-file, or pipe task text on stdin');
  const task = options.task ?? (options.taskFile ? boundedFile(options.taskFile, 64000) : await readStdin(64000));
  if (!task.trim()) throw new Error('Provide --task, --task-file, or task text on stdin'); return task;
}
function boundedFile(file: string, maximum = 8 * 1024 * 1024): string {
  if (statSync(file).size > maximum) throw new Error('Input file exceeds limit'); return readFileSync(file, 'utf8');
}

program.command('init').description('Create project-local observe configuration and ignored data directory').action(() => output(initialize(root())));
program.command('doctor').description('Check runtime, SQLite, index freshness and documented adapter support').action(async () => withStore(async store => {
  const indexer = await createIndexer(root(), store.dataDir, indexOptions(store));
  try {
    output({ node: process.version, sqlite: store.db.prepare('SELECT sqlite_version() AS version').get(), integrity: store.db.prepare('PRAGMA quick_check').get(), mode: store.config.mode,
      index: indexer.doctor(), adapters: inspectAdapters({ versions: { claude: detectVersion('claude'), codex: detectVersion('codex') } }),
      limits: { unsavedEditorBuffers: 'unavailable', providerQuota: 'unknown', actualClientReplacement: 'not tested in a model session' } });
  } finally { indexer.close(); }
}));
program.command('index').description('Index saved eligible files with Tree-sitter and SQLite FTS5').action(async () => withStore(async store => {
  const indexer = await createIndexer(root(), store.dataDir, indexOptions(store)); try { output(await indexer.index()); } finally { indexer.close(); }
}));
program.command('run').description('Run explicit executable + argv once; -- separates CodeBudget options. Default emits agent text; --json emits metadata.').argument('<executable>').argument('[args...]')
  .option('--session <id>').option('--timeout <ms>', 'wall time limit', integer).option('--parser <format>', 'explicit known parser, e.g. vitest, tsc, logs')
  .option('--raw', 'preserve stdout/stderr bytes for a machine pipeline; optimization disabled').option('--json', 'emit complete result metadata instead of agent text')
  .passThroughOptions().action(async (executable: string, args: string[], options: { session?: string; timeout?: number; parser?: string; raw?: boolean; json?: boolean }) => {
    await withStore(async store => {
      const controller = new AbortController(); const abort = () => controller.abort(); process.once('SIGINT', abort); process.once('SIGTERM', abort);
      try {
        const run = await runCommand(store, { executable, args, sessionId: options.session, timeoutMs: options.timeout, signal: controller.signal,
          format: options.parser as Parameters<typeof runCommand>[1]['format'], consumer: options.raw ? 'machine' : 'agent', stdout: process.stdout, stderr: process.stderr });
        if (!options.raw) { if (options.json) output(run); else { process.stdout.write(run.output + (run.output.endsWith('\n') ? '' : '\n')); process.stderr.write(`CodeBudget evidence ${run.artifactId}; ${run.originalSize} → ${run.reducedSize} output bytes after masking; ${store.config.mode}.\n`); } }
        if (run.repeatedFailure) process.stderr.write('CodeBudget: repeated unchanged failure; consider new evidence before retrying.\n');
        if (run.wrapperError) process.stderr.write(`CodeBudget wrapper error: ${run.wrapperError}\n`);
        process.exitCode = run.wrapperError ? 125 : run.timedOut ? 124 : run.cancelled ? 130 : run.signal ? 128 : run.exitCode ?? 1;
      } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
    });
  });
program.command('context').description('Prepare actual source within a measured local serialized context budget').option('--task <text>').option('--task-file <file>').option('--budget <tokens>', 'local token budget', integer)
  .option('--session <id>').option('--required <paths...>', 'mandatory repository-relative files').option('--expand <package-id>', 'previous package ID for expansion accounting')
  .option('--tokenizer <encoding>', 'estimated, o200k_base or cl100k_base; offline serialized text only')
  .option('--model <id>', 'optional verified model label; unknown mapping falls back to estimated')
  .action(async (options: { task?: string; taskFile?: string; budget?: number; session?: string; required?: string[]; expand?: string; tokenizer?: string; model?: string }) => {
    const task = await taskInput(options);
    await withStore(async store => {
      const session = options.session ? store.assertSession(options.session) : undefined;
      const tokenizerConfig: LocalTokenizerConfig = { encoding: options.tokenizer === undefined ? store.config.contextTokenizer.encoding : z.enum(['estimated', 'o200k_base', 'cl100k_base']).parse(options.tokenizer), model: options.model ?? store.config.contextTokenizer.model };
      const indexer = await createIndexer(root(), store.dataDir, { ...indexOptions(store), tokenizerConfig });
      try {
        const context = await indexer.prepareContext({ task, budget: options.budget ?? store.config.contextBudget, sessionId: session?.id, epoch: session ? String(session.epoch) : undefined, requiredPaths: options.required, previousPackageId: options.expand,
          acceptanceCriteria: z.array(z.string()).parse(session?.state.acceptanceCriteria ?? []), constraints: z.array(z.string()).parse(session?.state.constraints ?? []) });
        store.recordEvent('context', context);
        // The indexer budgets this exact compact package, including all JSON metadata.
        process.stdout.write(JSON.stringify(sanitize(context)));
      } finally { indexer.close(); }
    });
  });
const artifact = program.command('artifact').description('Read retained masked historical output without reexecution');
artifact.command('read <id>').option('--offset <record>', 'zero-based record offset', integer, 0).option('--limit <records>', 'record count, at most 1000', integer, 200).option('--session <id>')
  .action((id: string, options: { offset: number; limit: number; session?: string }) => withStore(store => output(store.readEvidence(id, options.offset, options.limit, options.session))));
const session = program.command('session').description('Persistent task state and context epochs');
session.command('start').option('--task <text>').option('--task-file <file>').action(async (options: { task?: string; taskFile?: string }) => { const task = await taskInput(options); await withStore(store => output(store.startSession(task))); });
session.command('checkpoint').requiredOption('--session <id>').option('--file <json>', 'task state JSON; source evidence is not system instruction').action((options: { session: string; file?: string }) => withStore(store => output(store.checkpoint(options.session, options.file ? JSON.parse(boundedFile(options.file, 64000)) as Record<string, unknown> : {}))));
session.command('close').requiredOption('--session <id>').action((options: { session: string }) => withStore(store => output(store.closeSession(options.session))));
program.command('report').option('--session <id>').option('--format <format>', 'json or csv', 'json').action((options: { session?: string; format: string }) => withStore(store => {
  const report = store.report(options.session);
  if (options.format === 'json') output(report);
  else if (options.format === 'csv') process.stdout.write('id,exitCode,originalBytes,reducedBytes,durationMs\n' + report.runs.map(run => [run.id, run.exitCode, run.originalSize, run.reducedSize, run.durationMs].map(csvCell).join(',')).join('\n') + '\n');
  else throw new Error('format must be json or csv');
}));
const adapters = program.command('adapters');
adapters.command('inspect').action(() => output(inspectAdapters({ versions: { claude: detectVersion('claude'), codex: detectVersion('codex') } })));
for (const action of ['install', 'uninstall'] as const) adapters.command(`${action} <client>`).option('--dry-run', 'preview changes (default)').option('--apply', 'apply only project-local changes')
  .action(async (client: ClientId, options: { apply?: boolean; dryRun?: boolean }) => {
    if (options.apply && options.dryRun) throw new Error('Choose --dry-run or --apply');
    const ownEntry = fileURLToPath(import.meta.url);
    const runtimeArgs = ownEntry.endsWith('.ts') ? ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href] : [];
    const plan = await planAdapterChange({ client, action, projectRoot: root(), command: process.execPath, args: [...runtimeArgs, ownEntry, '--root', root(), 'mcp', 'serve'] });
    output(options.apply ? { plan, result: await applyAdapterPlan(plan) } : plan);
  });
program.command('mcp').command('serve').option('--session <id>', 'bind evidence access to an existing session').action(async (options: { session?: string }) => { await serveMcp(root(), options.session); });
program.command('hook').description('Native Claude plugin entry; reads one bounded hook event from stdin').action(async () => { const result = await runHook(await readStdin(), root()); if (result) process.stdout.write(JSON.stringify(result)); });
program.command('dashboard').option('--port <port>', 'loopback port, 0 selects a free port', integer, 0).action(async (options: { port: number }) => {
  const { startDashboard } = await import('../../dashboard/src/server.js'); const store = openStore();
  const base = dirname(fileURLToPath(import.meta.url)); const assetsDir = existsSync(join(base, 'dashboard/index.html')) ? join(base, 'dashboard') : resolve(base, '../../../dist/dashboard');
  const dashboard = await startDashboard({ store, port: options.port, assetsDir });
  process.stderr.write(`CodeBudget dashboard: ${dashboard.url}\n`);
  let closed = false; const stop = async () => { if (closed) return; closed = true; await dashboard.close(); store.close(); };
  process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
});
const benchmark = program.command('benchmark');
benchmark.command('replay').option('--corpus <corpus>', 'all, captured, or synthetic; results remain separated', 'all').action((options: { corpus: string }) => withStore(store => {
  if (!['all', 'captured', 'synthetic'].includes(options.corpus)) throw new Error('corpus must be all, captured, or synthetic');
  const result = replayBenchmark(options.corpus === 'captured' ? capturedReplayCases : options.corpus === 'synthetic' ? replayCases : [...replayCases, ...capturedReplayCases]);
  store.recordEvent('benchmark', result); output(result); if (!result.preservationPassed) process.exitCode = 1;
}));
benchmark.command('tasks').option('--dry-run', 'generate manifest only, no model calls').option('--seed <seed>', 'randomization seed', integer, 42).option('--repeats <count>', 'repeats per condition/task', integer, 3)
  .action((options: { seed: number; repeats: number }) => output(createTaskBenchmarkPlan(options)));
program.command('data').command('prune').option('--dry-run', 'preview retention/quota cleanup (default)').option('--apply', 'remove expired artifact and index metadata only').action(async (options: { apply?: boolean; dryRun?: boolean }) => {
  if (options.apply && options.dryRun) throw new Error('Choose --dry-run or --apply');
  await withStore(async store => {
    const indexer = await createIndexer(root(), store.dataDir, indexOptions(store));
    try { output({ artifacts: store.prune(!options.apply), indexMetadata: indexer.prune(!options.apply), sourceFilesAffected: 0 }); } finally { indexer.close(); }
  });
});
program.command('config').command('mode <mode>').description('Explicitly opt into observe, balanced or experimental project mode').action((mode: 'observe' | 'balanced' | 'experimental') => output(setMode(root(), mode)));
program.command('usage').command('import').requiredOption('--file <path>', 'user-provided export; - for stdin').requiredOption('--format <format>', 'codex-jsonl or claude-otel').requiredOption('--client-version <version>')
  .option('--import-id <id>', 'stable source capture identity, required for Codex').option('--session <id>').action(async (options: { file: string; format: 'codex-jsonl' | 'claude-otel'; clientVersion: string; importId?: string; session?: string }) => {
    const text = options.file === '-' ? await readStdin(8 * 1024 * 1024) : boundedFile(options.file);
    await withStore(store => output(importUsageIntoStore(store, text, { format: options.format, clientVersion: options.clientVersion, importId: options.importId, sessionId: options.session, observedAt: new Date().toISOString() })));
  });

try { await program.parseAsync(); }
catch (error) { process.stderr.write(`CodeBudget: ${redact(error instanceof Error ? error.message : String(error))}\n`); process.exitCode = 1; }

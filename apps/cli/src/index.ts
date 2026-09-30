#!/usr/bin/env node
import { Command } from 'commander';
import { z } from 'zod';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialize, loadConfig, setMode, configWarnings, Store, runCommand, redact, sanitize, csvCell, SECURITY_VERSION } from '../../../packages/core/src/index.js';
import type { LocalTokenizerConfig } from '../../../packages/indexer/src/index.js';
import type { ClientId } from '../../../packages/adapters/src/index.js';
import { readStdin } from './io.js';

// Heavy modules (indexer, tokenizers, MCP SDK, adapters, benchmarks) load only for the commands that use them.
const indexer = () => import('../../../packages/indexer/src/index.js');
const hook = () => import('./hook.js');
const program = new Command().name('codebudget').description('Local evidence, output reduction and task context. No provider calls required.').version('0.1.0-beta.3').enablePositionalOptions()
  .option('--root <path>', 'authorized repository root (default current directory)', process.cwd());
const root = () => resolve(program.opts<{ root: string }>().root);
const output = (value: unknown): void => { process.stdout.write(JSON.stringify(sanitize(value), null, 2) + '\n'); };
const openStore = () => new Store(root(), loadConfig(root()));
const indexOptions = (store: Store) => ({ redact, securityPolicyId: SECURITY_VERSION, weights: store.config.contextWeights, dependencies: store.config.contextDependencies, tokenizerConfig: store.config.contextTokenizer, diskBudgetBytes: Math.floor(store.config.diskBudgetBytes / 4), retentionDays: store.config.artifactRetentionDays });
async function withStore<T>(fn: (store: Store) => T | Promise<T>): Promise<T> { const store = openStore(); try { return await fn(store); } finally { store.close(); } }
const integer = (value: string) => { const result = Number(value); if (!/^-?\d+$/.test(value.trim()) || !Number.isSafeInteger(result)) throw new Error(`Expected integer: ${value}`); return result; };
const PARSERS = ['vitest', 'jest', 'tsc', 'eslint', 'git-status', 'git-diff', 'search', 'json', 'logs'] as const;
async function taskInput(options: { task?: string; taskFile?: string }): Promise<string> {
  if (options.task && options.taskFile) throw new Error('Choose --task or --task-file');
  if (!options.task && !options.taskFile && process.stdin.isTTY) throw new Error('Provide --task, --task-file, or pipe task text on stdin');
  const task = options.task ?? (options.taskFile ? boundedFile(options.taskFile, 64000) : await readStdin(64000));
  if (!task.trim()) throw new Error('Provide --task, --task-file, or task text on stdin'); return task;
}
function boundedFile(file: string, maximum = 8 * 1024 * 1024): string {
  if (statSync(file).size > maximum) throw new Error('Input file exceeds limit'); return readFileSync(file, 'utf8');
}
const warn = (message: string): void => { process.stderr.write(`CodeBudget: ${message}\n`); };

program.command('init').description('Create project-local observe configuration and ignored data directory').action(() => output(initialize(root())));
program.command('doctor').description('Check runtime, SQLite, index freshness, native plugin status and adapter support').action(async () => withStore(async store => {
  const { createIndexer } = await indexer(); const { detectVersion } = await hook();
  const { inspectAdapters, isSupportedClaudeVersion, CLAUDE_MIN_CONTRACT_VERSION, CLAUDE_MAX_CONTRACT_MAJOR } = await import('../../../packages/adapters/src/index.js');
  const index = await createIndexer(root(), store.dataDir, indexOptions(store));
  try {
    const claude = detectVersion('claude');
    const warnings = [...configWarnings(root())];
    if (store.config.mode === 'observe') warnings.push('Mode is observe: output is measured but never reduced. Run `codebudget config mode balanced` to enable reductions.');
    if (claude && !isSupportedClaudeVersion(claude)) warnings.push(`Claude Code ${claude} is outside the supported hook contract (>=${CLAUDE_MIN_CONTRACT_VERSION} <${CLAUDE_MAX_CONTRACT_MAJOR + 1}.0.0): the native plugin keeps original Bash results.`);
    const lastHook = store.events('hook', { limit: 1 })[0] as Record<string, unknown> | undefined;
    if (lastHook?.kind === 'hook-noop') warnings.push(`Last native hook result was left unchanged: ${String(lastHook.reason)}`);
    if (store.config.rawArchive) warnings.push('Unmasked raw archiving is enabled for this project (local setting).');
    const physicalBytes = store.physicalBytes();
    if (physicalBytes > store.config.diskBudgetBytes * 0.5) warnings.push(`Evidence storage uses ${physicalBytes} of ${store.config.diskBudgetBytes} budget bytes; older evidence is reclaimed automatically.`);
    output({ warnings, node: process.version, sqlite: store.db.prepare('SELECT sqlite_version() AS version').get(), integrity: store.db.prepare('PRAGMA quick_check').get(), mode: store.config.mode,
      storage: { physicalBytes, diskBudgetBytes: store.config.diskBudgetBytes }, index: index.doctor(), adapters: inspectAdapters({ versions: { claude, codex: detectVersion('codex') } }),
      limits: { unsavedEditorBuffers: 'unavailable', providerQuota: 'unknown', actualClientReplacement: 'not tested in a model session' } });
  } finally { index.close(); }
}));
program.command('index').description('Index saved eligible files with Tree-sitter and SQLite FTS5')
  .option('--rebuild', 'drop and recreate the derived index database first; earlier evidence IDs, snapshots and expansion chains become invalid')
  .action(async (options: { rebuild?: boolean }) => withStore(async store => {
    const { createIndexer } = await indexer();
    const index = await createIndexer(root(), store.dataDir, indexOptions(store)); try { output(options.rebuild ? await index.rebuild() : await index.index()); } finally { index.close(); }
  }));
program.command('run').description('Run explicit executable + argv once; -- separates CodeBudget options. Default emits agent text; --json emits metadata.').argument('<executable>').argument('[args...]')
  .option('--session <id>').option('--timeout <ms>', 'wall time limit', integer).option('--parser <format>', `explicit known parser: ${PARSERS.join(', ')}`)
  .option('--raw', 'preserve stdout/stderr bytes for a machine pipeline; optimization disabled').option('--json', 'emit complete result metadata instead of agent text')
  .option('--no-stdin', 'do not forward piped stdin to the command')
  .passThroughOptions().action(async (executable: string, args: string[], options: { session?: string; timeout?: number; parser?: string; raw?: boolean; json?: boolean; stdin: boolean }) => {
    if (options.parser !== undefined && !(PARSERS as readonly string[]).includes(options.parser)) throw new Error(`Unknown parser ${options.parser}; choose one of ${PARSERS.join(', ')}`);
    for (const message of configWarnings(root())) warn(message);
    await withStore(async store => {
      if (store.config.rawArchive) warn('unmasked raw archiving is enabled by a local setting; raw bytes are stored privately.');
      const controller = new AbortController(); const abort = () => controller.abort(); process.once('SIGINT', abort); process.once('SIGTERM', abort);
      // A piped (non-TTY) stdin is forwarded like a shell pipeline would; interactive terminals are not.
      const forwardStdin = options.stdin && !process.stdin.isTTY;
      try {
        const run = await runCommand(store, { executable, args, sessionId: options.session, timeoutMs: options.timeout, signal: controller.signal, stdin: forwardStdin ? process.stdin : undefined,
          format: options.parser as Parameters<typeof runCommand>[1]['format'], consumer: options.raw ? 'machine' : 'agent', stdout: process.stdout, stderr: process.stderr });
        if (!options.raw) { if (options.json) output(run); else { process.stdout.write(run.output + (run.output.endsWith('\n') ? '' : '\n')); process.stderr.write(`CodeBudget evidence ${run.artifactId}; ${run.originalSize} retained → ${run.displayedSize} displayed bytes after masking; ${store.config.mode}.\n`); } }
        if (run.repeatedFailure) warn('repeated unchanged failure; consider new evidence before retrying.');
        if (run.archiveError) warn(`evidence archive problem: ${run.archiveError}`);
        if (run.wrapperError) process.stderr.write(`CodeBudget wrapper error: ${run.wrapperError}\n`);
        process.exitCode = run.wrapperError ? 125 : run.timedOut ? 124 : run.cancelled ? 130 : run.signal ? 128 : run.childExitCode ?? 1;
      } finally {
        process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
        if (forwardStdin) process.stdin.destroy();
      }
    });
  });
program.command('context').description('Prepare actual source within a measured local serialized context budget').option('--task <text>').option('--task-file <file>').option('--budget <tokens>', 'local token budget', integer)
  .option('--session <id>').option('--required <paths...>', 'mandatory repository-relative files').option('--expand <package-id>', 'previous package ID for expansion accounting')
  .option('--tokenizer <encoding>', 'estimated, o200k_base or cl100k_base; offline serialized text only')
  .option('--model <id>', 'optional verified model label; unknown mapping falls back to estimated')
  .action(async (options: { task?: string; taskFile?: string; budget?: number; session?: string; required?: string[]; expand?: string; tokenizer?: string; model?: string }) => {
    const task = await taskInput(options);
    const { createIndexer } = await indexer();
    await withStore(async store => {
      const session = options.session ? store.assertSession(options.session) : undefined;
      const tokenizerConfig: LocalTokenizerConfig = { encoding: options.tokenizer === undefined ? store.config.contextTokenizer.encoding : z.enum(['estimated', 'o200k_base', 'cl100k_base']).parse(options.tokenizer), model: options.model ?? store.config.contextTokenizer.model };
      const index = await createIndexer(root(), store.dataDir, { ...indexOptions(store), tokenizerConfig });
      try {
        const context = await index.prepareContext({ task, budget: options.budget ?? store.config.contextBudget, sessionId: session?.id, epoch: session ? String(session.epoch) : undefined, requiredPaths: options.required, previousPackageId: options.expand,
          acceptanceCriteria: z.array(z.string()).parse(session?.state.acceptanceCriteria ?? []), constraints: z.array(z.string()).parse(session?.state.constraints ?? []) });
        store.recordEvent('context', context);
        // The indexer budgets this exact compact package, including all JSON metadata.
        process.stdout.write(JSON.stringify(sanitize(context)));
      } finally { index.close(); }
    });
  });
const artifact = program.command('artifact').description('Read retained masked historical output without reexecution');
artifact.command('read <id>').option('--offset <record>', 'zero-based record offset', integer, 0).option('--limit <records>', 'record count, at most 1000', integer, 200).option('--session <id>')
  .action((id: string, options: { offset: number; limit: number; session?: string }) => withStore(store => output(store.readEvidence(id, options.offset, options.limit, options.session, { source: 'cli' }))));
const session = program.command('session').description('Persistent task state and context epochs');
session.command('start').option('--task <text>').option('--task-file <file>').action(async (options: { task?: string; taskFile?: string }) => { const task = await taskInput(options); await withStore(store => output(store.startSession(task))); });
session.command('checkpoint').requiredOption('--session <id>').option('--file <json>', 'task state JSON; source evidence is not system instruction').action((options: { session: string; file?: string }) => withStore(store => output(store.checkpoint(options.session, options.file ? JSON.parse(boundedFile(options.file, 64000)) as Record<string, unknown> : {}))));
session.command('close').requiredOption('--session <id>').action((options: { session: string }) => withStore(store => output(store.closeSession(options.session))));
program.command('report').description('Bounded local report; --run and --context print one complete record')
  .option('--session <id>').option('--format <format>', 'json or csv', 'json').option('--limit <runs>', 'run summaries per page', integer, 200).option('--offset <runs>', 'run summary offset', integer, 0)
  .option('--run <id>', 'print one complete run record').option('--context <id>', 'print one complete context package')
  .action((options: { session?: string; format: string; limit: number; offset: number; run?: string; context?: string }) => withStore(store => {
    if (options.run) { output(store.run(options.run)); return; }
    if (options.context) { output(store.contextPackage(options.context)); return; }
    if (options.limit < 1 || options.offset < 0) throw new Error('--limit must be positive and --offset non-negative');
    const report = store.report(options.session, { runLimit: options.limit, runOffset: options.offset });
    if (options.format === 'json') output(report);
    else if (options.format === 'csv') process.stdout.write('id,exitCode,originalBytes,reducedBytes,durationMs\n' + report.runs.map(run => [run.id, run.exitCode, run.originalSize, run.reducedSize, run.durationMs].map(csvCell).join(',')).join('\n') + '\n');
    else throw new Error('format must be json or csv');
  }));
const adapters = program.command('adapters');
adapters.command('inspect').action(async () => {
  const { inspectAdapters } = await import('../../../packages/adapters/src/index.js'); const { detectVersion } = await hook();
  output(inspectAdapters({ versions: { claude: detectVersion('claude'), codex: detectVersion('codex') } }));
});
/** Whether a bare command resolves on PATH (with PATHEXT on Windows); a command containing a path is checked directly. */
function onPath(command: string): boolean {
  if (/[\\/]/.test(command)) return existsSync(command);
  const extensions = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
  return (process.env.PATH ?? '').split(delimiter).filter(Boolean).some(directory => extensions.some(extension => existsSync(join(directory, command + extension))));
}
for (const action of ['install', 'uninstall'] as const) adapters.command(`${action} <client>`).option('--dry-run', 'preview changes (default)').option('--apply', 'apply only project-local changes')
  .option('--command <executable>', 'MCP server executable to register (default: codebudget on PATH)')
  .option('--arg <value>', 'argument for --command; repeat for several (default: mcp serve)', (value: string, previous: string[] = []) => [...previous, value])
  .action(async (client: ClientId, options: { apply?: boolean; dryRun?: boolean; command?: string; arg?: string[] }) => {
    if (options.apply && options.dryRun) throw new Error('Choose --dry-run or --apply');
    if (options.arg && !options.command) throw new Error('--arg requires --command');
    const { planAdapterChange, applyAdapterPlan } = await import('../../../packages/adapters/src/index.js');
    // Portable by default (codebudget mcp serve): no machine-specific paths enter a shared project file, and the
    // server resolves the project from the client's CLAUDE_PROJECT_DIR or working directory.
    const launch = options.command ? { command: options.command, args: options.arg ?? ['mcp', 'serve'] } : {};
    const plan = await planAdapterChange({ client, action, projectRoot: root(), ...launch });
    const command = typeof plan.server?.command === 'string' ? plan.server.command : null;
    if (action === 'install' && command && !onPath(command)) plan.notes.push(`${command} is not on PATH here, so the client cannot start this registration yet. Install the CodeBudget release archive, or register an explicit launch with --command and repeated --arg (for example --command node --arg /absolute/path/dist/cli.js --arg mcp --arg serve).`);
    output(options.apply ? { plan, result: await applyAdapterPlan(plan) } : plan);
  });
program.command('mcp').command('serve').option('--session <id>', 'bind evidence access to an existing session').option('--timeout <ms>', 'per-operation limit (default: config mcpTimeoutMs)', integer)
  .action(async (options: { session?: string; timeout?: number }) => {
    let serverRoot = root();
    // Clients choose the server's working directory (Claude Code also passes CLAUDE_PROJECT_DIR). Without an explicit
    // --root, serve the nearest initialized project from there rather than adopting an arbitrary directory.
    if (program.getOptionValueSource('root') !== 'cli') {
      const { initializedProjectRoot } = await import('./project-root.js');
      const found = initializedProjectRoot(process.cwd());
      if (!found) throw new Error(`No initialized CodeBudget project found from ${process.cwd()}${process.env.CLAUDE_PROJECT_DIR?.trim() ? ' or CLAUDE_PROJECT_DIR' : ''}; run codebudget init in the project or pass --root`);
      serverRoot = found;
    }
    const { serveMcp } = await import('../../../packages/mcp/src/index.js'); await serveMcp(serverRoot, options.session, { timeoutMs: options.timeout });
  });
program.command('hook').description('Native Claude plugin entry; reads one bounded hook event from stdin').action(async () => { const { runHook } = await hook(); const result = await runHook(await readStdin(), root()); if (result) process.stdout.write(JSON.stringify(result)); });
program.command('dashboard').option('--port <port>', 'loopback port, 0 selects a free port', integer, 0).action(async (options: { port: number }) => {
  const { startDashboard } = await import('../../dashboard/src/server.js'); const store = openStore();
  const base = dirname(fileURLToPath(import.meta.url)); const assetsDir = existsSync(join(base, 'dashboard/index.html')) ? join(base, 'dashboard') : resolve(base, '../../../dist/dashboard');
  const dashboard = await startDashboard({ store, port: options.port, assetsDir });
  process.stderr.write(`CodeBudget dashboard: ${dashboard.url}\nThe link works once; keep this process running and use the opened page.\n`);
  let closed = false; const stop = async () => { if (closed) return; closed = true; await dashboard.close(); store.close(); };
  process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
});
const benchmark = program.command('benchmark');
benchmark.command('replay').option('--corpus <corpus>', 'all, captured, or synthetic; results remain separated', 'all').action(async (options: { corpus: string }) => {
  if (!['all', 'captured', 'synthetic'].includes(options.corpus)) throw new Error('corpus must be all, captured, or synthetic');
  const { replayBenchmark, replayCases, capturedReplayCases } = await import('../../../packages/benchmarks/src/index.js');
  await withStore(store => {
    const result = replayBenchmark(options.corpus === 'captured' ? capturedReplayCases : options.corpus === 'synthetic' ? replayCases : [...replayCases, ...capturedReplayCases]);
    store.recordEvent('benchmark', result); output(result); if (!result.preservationPassed) process.exitCode = 1;
  });
});
benchmark.command('tasks').option('--dry-run', 'generate manifest only, no model calls').option('--seed <seed>', 'randomization seed', integer, 42).option('--repeats <count>', 'repeats per condition/task', integer, 3)
  .action(async (options: { seed: number; repeats: number }) => { const { createTaskBenchmarkPlan } = await import('../../../packages/benchmarks/src/index.js'); output(createTaskBenchmarkPlan(options)); });
program.command('data').command('prune').option('--dry-run', 'preview retention/quota cleanup (default)').option('--apply', 'remove expired or over-budget evidence, run/event records and index metadata').action(async (options: { apply?: boolean; dryRun?: boolean }) => {
  if (options.apply && options.dryRun) throw new Error('Choose --dry-run or --apply');
  const { createIndexer } = await indexer();
  await withStore(async store => {
    const index = await createIndexer(root(), store.dataDir, indexOptions(store));
    try { output({ artifacts: store.prune(!options.apply), indexMetadata: index.prune(!options.apply), sourceFilesAffected: 0 }); } finally { index.close(); }
  });
});
program.command('config').command('mode <mode>').description('Explicitly opt into observe, balanced or experimental project mode').action((mode: string) => {
  if (!['observe', 'balanced', 'experimental'].includes(mode)) throw new Error('mode must be observe, balanced or experimental');
  output(setMode(root(), mode as 'observe' | 'balanced' | 'experimental'));
});
program.command('usage').command('import').requiredOption('--file <path>', 'user-provided export; - for stdin').requiredOption('--format <format>', 'codex-jsonl or claude-otel').requiredOption('--client-version <version>')
  .option('--import-id <id>', 'stable source capture identity, required for Codex').option('--session <id>').action(async (options: { file: string; format: 'codex-jsonl' | 'claude-otel'; clientVersion: string; importId?: string; session?: string }) => {
    const { importUsageIntoStore } = await import('../../../packages/core/src/usage.js');
    const text = options.file === '-' ? await readStdin(8 * 1024 * 1024) : boundedFile(options.file);
    await withStore(store => output(importUsageIntoStore(store, text, { format: options.format, clientVersion: options.clientVersion, importId: options.importId, sessionId: options.session, observedAt: new Date().toISOString() })));
  });

try { await program.parseAsync(); }
catch (error) { process.stderr.write(`CodeBudget: ${redact(error instanceof Error ? error.message : String(error))}\n`); process.exitCode = 1; }

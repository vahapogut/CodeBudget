import { Worker } from 'node:worker_threads';

/** Worker termination makes cancellation effective even during synchronous SQLite/parser work. */
export function indexOperation<T>(root: string, dataDir: string, method: 'prepareContext' | 'readEvidence' | 'getChanges', args: unknown[], signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const source = import.meta.url.endsWith('.ts');
  const entry = new URL(source ? './worker.ts' : './evidence-worker.mjs', import.meta.url).href;
  const workerData = { root, dataDir, method, args, entry, parentUrl: import.meta.url };
  // stdout: true keeps any worker console output (for example a grammar loader message) off the MCP protocol stream.
  const worker = source
    ? new Worker('const {workerData}=require("node:worker_threads"); import("tsx/esm/api").then(({tsImport})=>tsImport(workerData.entry,workerData.parentUrl));', { eval: true, workerData, stdout: true })
    : new Worker(new URL(entry), { workerData, stdout: true });
  worker.stdout.pipe(process.stderr, { end: false });
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = (error: unknown, value?: T) => {
      if (done) return; done = true;
      signal.removeEventListener('abort', abort);
      // Await process resource release before consumers close/prune databases (Windows locks).
      void worker.terminate().then(() => { if (error) reject(error); else resolve(value as T); }, reject);
    };
    const abort = () => finish(signal.reason ?? new Error('Operation cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    worker.once('message', (message: { value?: T; error?: string }) => finish(message.error ? new Error(message.error) : null, message.value));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!done) finish(new Error(`Indexer worker exited before result (${code})`)); });
    if (signal.aborted) abort();
  });
}

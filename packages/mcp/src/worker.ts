import { parentPort, workerData } from 'node:worker_threads';
import { createIndexer } from '../../indexer/src/index.js';
import { redact, sanitize, SECURITY_VERSION } from '../../core/src/security.js';
import { loadConfig } from '../../core/src/config.js';

const { root, dataDir, method, args } = workerData as { root: string; dataDir: string; method: 'prepareContext' | 'readEvidence' | 'getChanges'; args: unknown[] };
try {
  const config = loadConfig(root);
  const indexer = await createIndexer(root, dataDir, { redact, securityPolicyId: SECURITY_VERSION, weights: config.contextWeights, dependencies: config.contextDependencies, tokenizerConfig: config.contextTokenizer, diskBudgetBytes: Math.floor(config.diskBudgetBytes / 4), retentionDays: config.artifactRetentionDays });
  let value: unknown;
  try {
    if (method === 'prepareContext') value = await indexer.prepareContext(args[0] as Parameters<typeof indexer.prepareContext>[0]);
    else if (method === 'readEvidence') value = indexer.readEvidence(args[0] as string, args[1] as Parameters<typeof indexer.readEvidence>[1]);
    else value = await indexer.getChanges(args[0] as string | undefined, args[1] as string | undefined);
  } finally { indexer.close(); }
  parentPort?.postMessage({ value: sanitize(value) });
} catch (error) { parentPort?.postMessage({ error: redact(error instanceof Error ? error.message : String(error)) }); }

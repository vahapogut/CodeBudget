import { serveMcp } from '../../../packages/mcp/src/index.js';
import { initializedProjectRoot } from './project-root.js';
import { redact } from '../../../packages/core/src/security.js';
try {
  const root = initializedProjectRoot(process.cwd());
  if (!root) throw new Error('Initialize this project with codebudget init before loading its plugin');
  await serveMcp(root);
}
catch (error) { process.stderr.write(`CodeBudget MCP startup failed: ${redact(error instanceof Error ? error.message : 'error')}\n`); process.exitCode = 1; }

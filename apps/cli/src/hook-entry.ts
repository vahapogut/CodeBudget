import { runHook, readStdin } from './hook.js';
try {
  const result = await runHook(await readStdin());
  if (result) process.stdout.write(JSON.stringify(result));
} catch (error) { process.stderr.write(`CodeBudget hook unavailable: ${error instanceof Error ? error.name : 'error'}\n`); }

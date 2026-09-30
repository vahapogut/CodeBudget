import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The native plugin hook and MCP server must resolve the same project. Start at CLAUDE_PROJECT_DIR
 * when the client provides it (hooks and stdio servers both receive it), otherwise at the working
 * directory, and walk up to the nearest initialized directory without crossing a repository (.git)
 * boundary, so an unrelated parent project is never adopted.
 */
export function initializedProjectRoot(cwd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const projectDir = env.CLAUDE_PROJECT_DIR?.trim();
  let root = realpathSync(projectDir && existsSync(projectDir) ? projectDir : cwd);
  for (;;) {
    if (existsSync(join(root, '.codebudget.json'))) return root;
    if (existsSync(join(root, '.git'))) return null;
    const parent = dirname(root); if (parent === root) return null; root = parent;
  }
}

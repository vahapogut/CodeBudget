import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Native plugin hook and MCP must share the same initialized project boundary. */
export function initializedProjectRoot(cwd: string): string | null {
  let root = realpathSync(cwd);
  for (;;) {
    if (existsSync(join(root, '.codebudget.json'))) return root;
    const parent = dirname(root); if (parent === root) return null; root = parent;
  }
}

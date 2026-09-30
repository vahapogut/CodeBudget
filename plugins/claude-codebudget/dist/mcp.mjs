// CodeBudget launcher: runtime check, then the bundled entry.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 16)) { process.stderr.write(`CodeBudget MCP server needs Node.js 22.16 or newer on PATH (found ${process.version}).\n`); process.exit(1); }
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => /SQLite is an experimental feature/.test(typeof warning === 'string' ? warning : warning?.message ?? '') ? undefined : emitWarning(warning, ...rest);
await import("./mcp-main.mjs");

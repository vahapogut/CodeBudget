# Troubleshooting

| Symptom | Check and next action |
| --- | --- |
| `node:sqlite` missing or "requires Node.js 22.16 or newer" | Use a supported Node version from `package.json`; run `node --version` and `codebudget doctor`. The plugin hook leaves tool results unchanged on an older Node on `PATH`. |
| Node prints an experimental SQLite warning | The built launchers suppress only this notice. When running sources directly it is an acknowledged Node 22 runtime limitation, not a successful or failed database check by itself. Protocol diagnostics belong on stderr. |
| Frozen-lockfile install fails | Confirm pnpm 10.33.2 and the committed lockfile. Do not silently regenerate it with an incompatible toolchain. |
| Tree-sitter grammar load fails | Rebuild and inspect packaged WASM assets; run `doctor`. Preserve the source and report parser support honestly rather than claiming semantic indexing. |
| Index omits a file | Check `.gitignore`, `.codebudgetignore`, sensitive-path rules, size limits, symlinks and parser support. Sensitive exclusions cannot be overridden by an ordinary include. |
| Context reports `budget_exceeded` | Read the minimum-required estimate and missing sources. Increase the budget or narrow the task; do not assume required code was complete. |
| Context reports stale/inconsistent sources | Save the editor buffer and rerun indexing/context preparation. Unsaved buffers are not visible. |
| Output did not shrink | Check observe mode, known format, machine-consumer path, preservation diagnostics and schema overhead. No-gain output is intentionally retained. |
| Failed command appears archived | Archive status is historical evidence, not proof of success. Inspect child exit code, signal, timeout, wrapper error and completeness. |
| Artifact is missing/expired | Verify repository/session identity and retention. The oldest evidence is evicted when storage passes half of `diskBudgetBytes`; raise the budget if you need longer history. Reading evidence never reruns a command; rerun only as an explicit fresh action. |
| `run` warns that evidence was not archived | The command still ran to completion and its exit code is returned; only the archive failed (for example a full disk). Free space or raise `diskBudgetBytes`, then rerun if you need the evidence. |
| Windows executable fails to spawn | Use an actual executable with separate argv. `.cmd`/PowerShell shims and pipelines may need explicit invocation and are not silently rewritten. |
| Claude hook does nothing | Run `codebudget doctor`: its `warnings` name observe mode, an unsupported client version and the last recorded hook no-op reason. Output replacement needs Claude Code 2.1.216 or a later 2.x release, built plugin bundles, balanced mode and a recognized native Bash shape; anything else keeps the original result. |
| Duplicate MCP tools | Choose native plugin registration or the project-local MCP adapter; remove the duplicate owned registration. |
| Adapter uninstall reports a conflict | Preserve the user's edited configuration. Review the exact CodeBudget entry instead of restoring an old whole-file backup. |
| Dashboard returns unauthorized/forbidden | Each printed link works once. Start `codebudget dashboard` again for a new link, or reload the tab that already opened it; check Host/Origin. Do not disable authentication to bypass the error. |
| MCP call fails with busy or timeout | At most eight evidence operations queue per server; cancel stale calls or raise `mcpTimeoutMs` (or `codebudget mcp serve --timeout`). |
| A committed setting seems ignored | `rawArchive` and `experimental` are honored only from `.codebudget/local.json` or environment variables; `doctor` and `run` print a warning when the committed file sets them. |
| Usage total or cost is unknown | Imports may cover only some calls, contain cumulative samples or lack valid pricing. Unknown is not zero. Supply a supported explicit export if available. |
| SQLite reports full/locked/corrupt | Stop overlapping operations, inspect disk space, retain a backup of local evidence, and read the exact error. Do not delete source files or pretend lost evidence was preserved. |
| Task benchmark will not run | `--dry-run` is the free CLI path. A real runner requires explicit opt-in, pinned versions and spending/run/time budgets. |

When filing a report, include the command, runtime/client versions and a minimal masked reproduction. Omit dashboard tokens, unmasked artifacts and private source. See `docs/VERIFICATION.md` for the last actual checks and `docs/STATUS.md` for known incomplete work.

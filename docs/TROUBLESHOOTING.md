# Troubleshooting

| Symptom | Check and next action |
| --- | --- |
| `node:sqlite` missing | Use a supported Node version from `package.json`; run `node --version` and `codebudget doctor`. |
| Node prints an experimental SQLite warning | This is an acknowledged Node 22 runtime limitation. It is not a successful or failed database check by itself. Protocol diagnostics belong on stderr. |
| Frozen-lockfile install fails | Confirm pnpm 10.33.2 and the committed lockfile. Do not silently regenerate it with an incompatible toolchain. |
| Tree-sitter grammar load fails | Rebuild and inspect packaged WASM assets; run `doctor`. Preserve the source and report parser support honestly rather than claiming semantic indexing. |
| Index omits a file | Check `.gitignore`, `.codebudgetignore`, sensitive-path rules, size limits, symlinks and parser support. Sensitive exclusions cannot be overridden by an ordinary include. |
| Context reports `budget_exceeded` | Read the minimum-required estimate and missing sources. Increase the budget or narrow the task; do not assume required code was complete. |
| Context reports stale/inconsistent sources | Save the editor buffer and rerun indexing/context preparation. Unsaved buffers are not visible. |
| Output did not shrink | Check observe mode, known format, machine-consumer path, preservation diagnostics and schema overhead. No-gain output is intentionally retained. |
| Failed command appears archived | Archive status is historical evidence, not proof of success. Inspect child exit code, signal, timeout, wrapper error and completeness. |
| Artifact is missing/expired | Verify repository/session identity and retention. Reading evidence never reruns a command; rerun only as an explicit fresh action. |
| Windows executable fails to spawn | Use an actual executable with separate argv. `.cmd`/PowerShell shims and pipelines may need explicit invocation and are not silently rewritten. |
| Claude hook does nothing | Check the exact contract version (2.1.216), built plugin bundles, mode and native event shape. Unknown versions/unsupported events fail to no transformation. |
| Duplicate MCP tools | Choose native plugin registration or the project-local MCP adapter; remove the duplicate owned registration. |
| Adapter uninstall reports a conflict | Preserve the user's edited configuration. Review the exact CodeBudget entry instead of restoring an old whole-file backup. |
| Dashboard returns unauthorized/forbidden | Open the URL printed by the current process with its local token; check Host/Origin. Do not disable authentication to bypass the error. |
| Usage total or cost is unknown | Imports may cover only some calls, contain cumulative samples or lack valid pricing. Unknown is not zero. Supply a supported explicit export if available. |
| SQLite reports full/locked/corrupt | Stop overlapping operations, inspect disk space, retain a backup of local evidence, and read the exact error. Do not delete source files or pretend lost evidence was preserved. |
| Task benchmark will not run | `--dry-run` is the free CLI path. A real runner requires explicit opt-in, pinned versions and spending/run/time budgets. |

When filing a report, include the command, runtime/client versions and a minimal masked reproduction. Omit dashboard tokens, unmasked artifacts and private source. See `docs/VERIFICATION.md` for the last actual checks and `docs/STATUS.md` for known incomplete work.

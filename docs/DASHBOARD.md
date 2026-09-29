# Local dashboard

Start with `codebudget dashboard`. Open the printed URL, including its bootstrap fragment. The server runs only while that CLI process is alive. Its data is the current repository's actual SQLite records; no sample charts or manufactured savings are inserted.

The dashboard provides overview, sessions and task state, recorded command/output comparisons, paged evidence, context package inspection, saved benchmark records, and the adapter support matrix. Imported usage, output bytes and unmeasured task savings remain separate. Unknown provider usage, billing and subscription quota are not displayed as zero. Empty states include the relevant CLI action. Adapter version detection is not inferred from a successful HTTP request.

## Interface

The dashboard uses a compact developer-workspace layout: neutral navigation, plain screen titles, tabular figures, a single blue accent and collapsible adapter details. Overview separates command activity, native hooks and a measurement inspector. Command records can be searched by executable/arguments and filtered by result; session records can be searched by task or ID. Empty states include copyable local commands. There are no marketing headlines, decorative charts or sample metrics.

Navigation exposes its current page and a keyboard skip link. Inputs have accessible names, focus is visible, and mobile navigation fits a two-row grid. Wide evidence tables scroll inside their panel rather than widening the page. Selecting another output clears the previous archive immediately; late responses cannot replace the currently selected evidence. Measurement limits remain next to their data or in the expandable measurement note.

The toolbar switches between light and dark themes. A saved choice in origin-scoped browser local storage survives page reloads; before a choice exists, the operating system's color-scheme preference supplies the initial theme. Storage failure does not disable the toggle. This appearance preference contains no repository data or credentials and does not change IDE settings.

The backend exports `startDashboard({ store, port?, assetsDir?, host?, clientVersions? })` and returns `{ url, origin, close() }`. The only allowed bind address is `127.0.0.1`; default port is zero (a free ephemeral port). The CLI supplies its packaged `dist/dashboard` directory. To build the standalone frontend during development:

```sh
pnpm exec vite build --config apps/dashboard/vite.config.ts
```

The Node API is read-only:

- `GET /api/report[?session=<id>]` reads stored report data. At most 200 runs and 100 entries in each displayed event list are returned; counts state the scope.
- `GET /api/evidence/<artifact-id>?offset=0&limit=200[&session=<id>]` returns retained, redacted historical records. It never reruns a command or serves raw opt-in archives.
- `GET /api/export?format=json|csv[&session=<id>]` exports redacted reports or run rows. CSV formula prefixes are escaped.

All API calls require a fresh random 256-bit bearer token. The initial URL carries it in a fragment (not a request query or server log); the frontend removes the fragment and retains the token in tab-scoped session storage. Restarting the server invalidates the token. Static UI files contain no repository records.

Host must exactly match the bound loopback host and port, Origin when present must exactly match the server, and cross-site Fetch Metadata is rejected. Cookies do not grant access. Non-GET methods and preflight are rejected. Responses have no CORS allowlist, no-store caching, same-origin resource policy, no-referrer policy, frame denial and strict CSP. There are no inline executable scripts, remote fonts, CDN assets, analytics or automatic external network requests. Code and logs render through React text nodes; no HTML interpretation occurs. Sensitive-data redaction is required before JSON and CSV export. API responses larger than 8 MiB fail visibly rather than silently truncate.

Security is scoped to browser-origin isolation and the local process. Another process running as the same OS user can potentially inspect process memory, files or browser state; the loopback token is not an OS sandbox. Unsaved editor buffers and invisible IDE requests are unavailable.

## Verified locally

Windows / Node 22.16.0 / Chromium via Playwright:

```sh
pnpm exec vitest run apps/dashboard/src/server.test.ts packages/indexer/src/indexer.test.ts
pnpm exec eslint apps/dashboard packages/indexer tests/e2e/dashboard.spec.ts playwright.config.ts
pnpm typecheck
pnpm exec vite build --config apps/dashboard/vite.config.ts
pnpm exec playwright test
```

The current scoped suite contains 21 tests (16 indexer, 5 dashboard API), all included in the successful full verification run. Lint, repository typecheck and Vite production build passed. Both browser tests passed: real SQLite values, session navigation, evidence comparison, safe HTML text, JSON download, adapter unknown states, no outbound requests, unauthorized browser isolation and 390px responsive layout. Desktop and mobile screenshots under `test-results` were visually inspected. Browser fixtures are disposable test databases, not product demo records. Linux and macOS runs are left to the CI matrix; they are not claimed as locally verified.

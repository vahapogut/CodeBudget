import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Store, Session } from '../../../packages/core/src/store.js';
import type { inspectAdapters } from '../../../packages/adapters/src/capabilities.js';
import './style.css';

type Report = ReturnType<Store['report']> & { mode: string; generatedAt: string; adapters: ReturnType<typeof inspectAdapters>; limits: { retainedRuns: number; visibleRuns: number; visibleEvents: number } };
type View = 'Overview' | 'Sessions' | 'Outputs' | 'Context' | 'Benchmarks' | 'Adapters';
type IconName = View | 'refresh' | 'download' | 'search' | 'arrow' | 'terminal' | 'copy' | 'folder' | 'sun' | 'moon';
const views: View[] = ['Overview', 'Sessions', 'Outputs', 'Context', 'Benchmarks', 'Adapters'];
const bytes = (value: number): string => Math.abs(value) >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MiB` : Math.abs(value) >= 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${value.toLocaleString()} B`;
const number = (value: unknown): string => typeof value === 'number' ? value.toLocaleString() : 'Unknown';
const text = (value: unknown): string => typeof value === 'string' ? value : value === null || value === undefined ? 'Unknown' : JSON.stringify(value);
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const date = (value: string): string => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const clientName = (client: string): string => ({ claude: 'Claude Code', codex: 'OpenAI Codex', cursor: 'Cursor', antigravity: 'Google Antigravity' })[client] ?? client;
const capabilityName = (name: string): string => ({ mcpRegistration: 'MCP registration', commandRouting: 'Command routing', toolOutputReplacement: 'Output filtering', usageImport: 'Usage import', sessionLifecycle: 'Session lifecycle', safeInstallUninstall: 'Install / uninstall' })[name] ?? name.replace(/([A-Z])/g, ' $1');

function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    Overview: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="13" y="3" width="6" height="6" rx="1" /><rect x="3" y="13" width="6" height="6" rx="1" /><rect x="13" y="13" width="6" height="6" rx="1" /></>,
    Sessions: <><rect x="3" y="4" width="16" height="14" rx="2" /><path d="M7 8h8M7 12h5" /></>,
    Outputs: <><path d="m4 6 5 5-5 5M12 16h6" /></>,
    Context: <><path d="m7 5-5 6 5 6m8-12 5 6-5 6M12 3l-2 16" /></>,
    Benchmarks: <><path d="M4 18V11M11 18V4M18 18V8M2 20h19" /></>,
    Adapters: <><path d="M8 2v5m6-5v5M5 7h12v3a6 6 0 0 1-6 6v4M5 7v3a6 6 0 0 0 6 6" /></>,
    refresh: <><path d="M18 8a7 7 0 1 0 .2 6M18 3v5h-5" /></>,
    download: <><path d="M11 3v11m-4-4 4 4 4-4M4 15v4h14v-4" /></>,
    search: <><circle cx="9" cy="9" r="6" /><path d="m14 14 5 5" /></>,
    arrow: <path d="M4 11h14m-5-5 5 5-5 5" />,
    terminal: <><rect x="2" y="3" width="18" height="16" rx="2" /><path d="m6 8 3 3-3 3m6 0h4" /></>,
    copy: <><rect x="7" y="7" width="12" height="12" rx="2" /><path d="M14 7V3H3v11h4" /></>,
    folder: <path d="M2 6V4h7l2 3h9v11H2V6Z" />,
    sun: <><circle cx="11" cy="11" r="4" /><path d="M11 1v2m0 16v2M1 11h2m16 0h2M4 4l1.5 1.5m11 11L18 18M4 18l1.5-1.5m11-11L18 4" /></>,
    moon: <path d="M19 13a8 8 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z" />,
  };
  return <svg className={`icon ${className}`} viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Pill({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`pill ${tone}`}>{children}</span>; }
function Snippet({ command }: { command: string }) {
  const [message, setMessage] = useState('');
  const copy = (): void => {
    if (!navigator.clipboard) { setMessage('Select the command to copy'); return; }
    void navigator.clipboard.writeText(command).then(() => setMessage('Copied'), () => setMessage('Select the command to copy'));
  };
  return <div className="command-snippet"><span aria-hidden="true">$</span><code>{command}</code><button className="copy-button" aria-label={`Copy ${command}`} onClick={copy}><Icon name="copy" /></button><span className="copy-feedback" role="status">{message}</span></div>;
}
function Empty({ title, children, command, icon = 'terminal' }: { title: string; children: ReactNode; command?: string; icon?: IconName }) {
  return <div className="empty"><div className="empty-icon"><Icon name={icon} /></div><h3>{title}</h3><p>{children}</p>{command && <Snippet command={command} />}</div>;
}
function Json({ value }: { value: unknown }) { return <pre className="code">{JSON.stringify(value, null, 2)}</pre>; }
function SectionTitle({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{children}</div>;
}

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { const saved = localStorage.getItem('codebudget-dashboard-theme'); if (saved === 'light' || saved === 'dark') return saved; } catch { /* Storage may be unavailable in private contexts. */ }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('codebudget-dashboard-theme', theme); } catch { /* The selected theme still works for this page. */ }
  }, [theme]);
  // The printed link carries a single-use secret that is exchanged once for the session's API token.
  const [bootstrap] = useState(() => { const supplied = new URLSearchParams(location.hash.slice(1)).get('token'); if (supplied) history.replaceState(null, '', location.pathname); return supplied; });
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem('codebudget-dashboard-token') ?? ''; } catch { return ''; } });
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>('Overview');
  const [session, setSession] = useState<Session | null>(null);
  const [selectedRun, setSelectedRun] = useState<Record<string, unknown> | null>(null);
  const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [selectedContext, setSelectedContext] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [resultFilter, setResultFilter] = useState('all');
  const evidenceRequest = useRef(0);
  const request = useCallback(async (path: string) => {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit' });
    if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? `Request failed (${response.status})`); }
    return response;
  }, [token]);
  useEffect(() => {
    if (!bootstrap) return;
    void (async () => {
      try {
        const response = await fetch('/api/session', { headers: { Authorization: `Bearer ${bootstrap}` }, credentials: 'omit' });
        const body = await response.json() as { token?: string; error?: string };
        if (!response.ok || !body.token) throw new Error(body.error ?? 'This dashboard link could not be used');
        try { sessionStorage.setItem('codebudget-dashboard-token', body.token); } catch { /* the token stays in memory for this page */ }
        setToken(body.token);
      } catch (cause) { setError(text((cause as Error).message)); }
    })();
  }, [bootstrap]);
  const refresh = useCallback(async () => {
    if (!token) { if (!bootstrap) setError('Dashboard authorization required; open the URL printed by codebudget dashboard'); return; }
    setBusy(true); setError('');
    try { setReport(await (await request('/api/report')).json() as Report); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load local records'); }
    finally { setBusy(false); }
  }, [request, token, bootstrap]);
  useEffect(() => { void refresh(); }, [refresh]);
  const exportReport = async (format: 'json' | 'csv'): Promise<void> => {
    try {
      const response = await request(`/api/export?format=${format}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `codebudget-report.${format}`; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(text((cause as Error).message)); }
  };
  const readEvidence = async (run: Record<string, unknown>, offset = 0): Promise<void> => {
    const requestId = ++evidenceRequest.current;
    setSelectedRun(run); setEvidence(null); setEvidenceBusy(true); setError('');
    try {
      const suffix = typeof run.sessionId === 'string' ? `&session=${encodeURIComponent(run.sessionId)}` : '';
      // Report rows are summaries; the stored agent output is loaded with the evidence page.
      const [result, detail] = await Promise.all([
        request(`/api/evidence/${encodeURIComponent(String(run.artifactId))}?offset=${offset}&limit=100${suffix}`).then(async response => await response.json() as Record<string, unknown>),
        offset === 0 ? request(`/api/run/${encodeURIComponent(String(run.id))}${suffix.replace('&', '?')}`).then(async response => await response.json() as Record<string, unknown>) : Promise.resolve(null),
      ]);
      if (requestId === evidenceRequest.current) { setEvidence(result); if (detail) setSelectedRun({ ...run, ...detail }); }
    } catch (cause) { if (requestId === evidenceRequest.current) setError(text((cause as Error).message)); }
    finally { if (requestId === evidenceRequest.current) setEvidenceBusy(false); }
  };
  const selectContext = async (entry: unknown): Promise<void> => {
    const id = text(object(entry).id);
    setSelectedContext(entry);
    try { setSelectedContext(await (await request(`/api/context/${encodeURIComponent(id)}`)).json() as unknown); }
    catch (cause) { setError(text((cause as Error).message)); }
  };
  const navigate = (next: View): void => {
    evidenceRequest.current++;
    setView(next); setSession(null); setSelectedRun(null); setEvidence(null); setEvidenceBusy(false); setSelectedContext(null); setQuery(''); setResultFilter('all');
  };
  const local = report?.localOutput;
  const saved = local?.savedBytes ?? 0;
  const reduction = local && local.originalBytes > 0 ? ((saved / local.originalBytes) * 100).toFixed(1) : null;
  const filteredRuns = report?.runs.filter(run => {
    const matchesResult = resultFilter === 'all' || (resultFilter === 'timeout' ? run.timedOut === true : resultFilter === 'cancelled' ? run.cancelled === true : run.status === resultFilter);
    return matchesResult && `${text(run.executable)} ${Array.isArray(run.args) ? run.args.map(text).join(' ') : ''}`.toLowerCase().includes(query.toLowerCase());
  }) ?? [];
  const sessionRuns = report?.runs.filter(run => run.sessionId === session?.id) ?? [];
  const filteredSessions = report?.sessions.filter(entry => `${entry.task} ${entry.id}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const title = session && view === 'Sessions' ? 'Session detail' : view;
  const descriptions: Record<View, string> = {
    Overview: 'Output and context activity for this repository.', Sessions: 'Task state, checkpoints and recorded commands.',
    Outputs: 'Inspect the result delivered to the agent and its retained evidence.', Context: 'Source packages prepared for your coding tasks.',
    Benchmarks: 'Saved replay measurements and task experiments.', Adapters: 'Client capabilities and their verification status.',
  };
  const runTable = (items: Record<string, unknown>[]) => <div className="table-wrap"><table className="run-table"><thead><tr><th scope="col">Command</th><th scope="col">Result</th><th scope="col" className="numeric">Original</th><th scope="col" className="numeric">Returned</th><th scope="col" className="numeric">Duration</th><th scope="col"><span className="sr-only">Evidence</span></th></tr></thead><tbody>{items.map(run => <tr key={text(run.id)} className={selectedRun?.id === run.id ? 'selected' : ''}>
    <td className="command-cell"><div><Icon name="terminal" /><code>{text(run.executable)}</code></div><small>{Array.isArray(run.args) ? run.args.map(text).join(' ') : ''}</small></td>
    <td><Pill tone={run.status === 'failure' ? 'bad' : run.status === 'success' ? 'good' : ''}>{text(run.status)}</Pill><small>exit {text(run.exitCode)}</small></td>
    <td className="numeric">{bytes(Number(run.originalSize ?? 0))}</td><td className="numeric">{bytes(Number(run.reducedSize ?? 0))}</td><td className="numeric">{typeof run.durationMs === 'number' ? `${Math.round(run.durationMs)} ms` : 'Unknown'}</td>
    <td><button className="text-button" aria-label={`Compare ${text(run.executable)} output`} onClick={() => { if (view !== 'Outputs') navigate('Outputs'); void readEvidence(run); }}>Compare<Icon name="arrow" /></button></td>
  </tr>)}</tbody></table></div>;

  const nativeFilters = report && <section className="panel"><SectionTitle title="Native output filters" description="Claude hook results · separate from CLI totals"><span className="section-tag">{Math.min(report.hookMetrics.length, 10)} shown</span></SectionTitle>
    {report.hookMetrics.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Action</th><th scope="col" className="numeric">Original</th><th scope="col" className="numeric">Returned</th><th scope="col" className="numeric">Candidate saving</th></tr></thead><tbody>{report.hookMetrics.slice(0, 10).map((item, index) => { const metric = object(item); const inactive = metric.kind === 'hook-noop'; return <tr key={index} title={inactive ? text(metric.reason) : undefined}><td><Pill tone={metric.applied === true ? 'good' : ''}>{inactive ? 'Inactive' : metric.applied === true ? 'Reduced' : 'Unchanged'}</Pill></td><td className="numeric">{typeof metric.originalBytes === 'number' ? bytes(metric.originalBytes) : '—'}</td><td className="numeric">{typeof metric.reducedBytes === 'number' ? bytes(metric.reducedBytes) : '—'}</td><td className="numeric">{typeof metric.candidateSavingsBytes === 'number' ? `${bytes(metric.candidateSavingsBytes)} est.` : 'Not measured'}</td></tr>; })}</tbody></table></div> : <div className="integration-empty"><Icon name="Adapters" /><div><strong>Waiting for a supported hook result</strong><p>Native plugin activity will appear here when observed.</p></div><button className="text-button" onClick={() => navigate('Adapters')}>View adapters<Icon name="arrow" /></button></div>}
    {report.pluginOverhead.length > 0 && <details className="inline-details"><summary>Plugin context overhead <span>Local estimates</span></summary><Json value={report.pluginOverhead} /></details>}
  </section>;

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('Overview'); }}><span className="brand-symbol" aria-hidden="true"><i /><i /><i /></span><span>CodeBudget</span><span className="beta-label">beta</span></a>
      <div className="workspace-label"><Icon name="folder" /><div><strong>Local workspace</strong><code>{report?.repositoryId.slice(0, 12) ?? 'Connecting…'}</code></div></div>
      <div className="nav-group-label">Workspace</div>
      <nav aria-label="Main navigation">{views.map(item => <button key={item} className={view === item ? 'nav active' : 'nav'} aria-current={view === item ? 'page' : undefined} onClick={() => navigate(item)}><Icon name={item} /><span>{item}</span>{item === 'Sessions' && report && <small>{report.sessions.length}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div><span className={`status-dot ${error ? 'offline' : ''}`} />{error ? 'Refresh unavailable' : report ? 'Local storage connected' : 'Local storage'}</div><p>Stored on this machine.<br />No external telemetry.</p><span className="version">v0.1.0-beta.3</span></div>
    </aside>
    <main id="main" tabIndex={-1}>
      <header className="topbar"><div className="breadcrumb"><Icon name="folder" /><span>Workspace</span><span className="slash">/</span><strong>{view}</strong></div><div className="header-actions"><Pill tone="mode"><span className="status-dot" />{report?.mode ?? 'observe'}</Pill><button className="icon-button theme-toggle" aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /><span>{theme === 'light' ? 'Dark' : 'Light'}</span></button><button className="icon-button" onClick={() => void refresh()} disabled={busy} aria-label="Refresh records"><Icon name="refresh" className={busy ? 'spinning' : ''} /><span>{busy ? 'Refreshing' : 'Refresh'}</span></button></div></header>
      <div className="page-content">
        <div className="page-heading"><div><h1>{title}</h1><p>{descriptions[view]}</p></div><div className="export-actions"><button className="button secondary" onClick={() => void exportReport('csv')} disabled={!report}>CSV</button><button className="button" onClick={() => void exportReport('json')} disabled={!report}><Icon name="download" />Export JSON</button></div></div>
        {error && <div role="alert" className="error-banner"><strong>Records unavailable.</strong> {error}</div>}
        {!report && !error && <div role="status" className="loading-state"><Icon name="refresh" className="spinning" />Reading local records…</div>}

        {report && view === 'Overview' && <>
          <section className="metric-row" aria-label="Measurement overview">
            <div className="metric"><span>Output removed</span><strong>{bytes(saved)}</strong><small>{reduction === null ? 'No output recorded' : `${reduction}% of CLI output · bytes`}</small></div>
            <div className="metric"><span>Commands recorded</span><strong>{number(report.limits.retainedRuns)}</strong><small>{report.runs.filter(run => run.status === 'failure').length} failures in shown records</small></div>
            <div className="metric"><span>Saved sessions</span><strong>{number(report.sessions.length)}</strong><small>{report.sessions.filter(entry => entry.status === 'active').length} active</small></div>
            <div className="metric"><span>Imported usage</span><strong className={report.observedUsage.total === null ? 'unknown-value' : ''}>{number(report.observedUsage.total)}</strong><small>{report.observedUsage.total === null ? 'No complete usage import' : 'Tokens · imported delta events'}</small></div>
          </section>
          <div className="overview-grid"><div className="main-column">
            <section className="panel"><SectionTitle title="Command activity"><button className="text-button" onClick={() => navigate('Outputs')}>View all<Icon name="arrow" /></button></SectionTitle>
              {report.runs.length ? <>{runTable(report.runs.slice(0, 6))}<div className="table-footer">{Math.min(report.runs.length, 6)} of {report.limits.retainedRuns} recorded commands<span>CLI wrapper</span></div></> : <Empty title="No commands recorded" command="codebudget run -- pnpm test">Run a command to capture its output and inspect the evidence.</Empty>}
            </section>
            {nativeFilters}
          </div><aside className="inspector-column" aria-label="Measurement details">
            <section className="panel output-volume"><SectionTitle title="Output volume"><span className="section-tag">CLI</span></SectionTitle><div className="volume-content">
              <div className="volume-value"><span>Original</span><strong>{bytes(local?.originalBytes ?? 0)}</strong></div><meter min={0} max={Math.max(local?.originalBytes ?? 0, local?.reducedBytes ?? 0, 1)} value={local?.originalBytes ?? 0} aria-label="Original output bytes" />
              <div className="volume-value"><span>Returned</span><strong>{bytes(local?.reducedBytes ?? 0)}</strong></div><meter className="returned" min={0} max={Math.max(local?.originalBytes ?? 0, local?.reducedBytes ?? 0, 1)} value={local?.reducedBytes ?? 0} aria-label="Returned output bytes" />
              <p>Measured after secret redaction.</p></div></section>
            <section className="panel"><SectionTitle title="Context & retrieval" /><dl className="fact-list"><div><dt>Packages shown</dt><dd>{report.contextPackages.length}</dd></div><div><dt>Detail reads shown</dt><dd>{report.retrievals.length}</dd></div><div><dt>Task savings</dt><dd className="muted">Not measured</dd></div></dl><button className="inspector-link" onClick={() => navigate('Context')}>Inspect context<Icon name="arrow" /></button></section>
            <details className="measurement-note"><summary>About these measurements</summary><p>Output bytes are not provider tokens or billing. Task savings require matched experiments including retries, retrieval and subagent usage. Cost and subscription quota remain unknown.</p></details>
          </aside></div>
        </>}

        {report && view === 'Sessions' && <section className="panel"><SectionTitle title={session ? session.task : 'Saved sessions'} description={session ? `${session.status} · epoch ${session.epoch} · ${date(session.updatedAt)}` : undefined}>{session ? <button className="text-button" onClick={() => setSession(null)}>All sessions</button> : <span className="section-tag">{report.sessions.length} sessions</span>}</SectionTitle>
          {session ? <><div className="detail-grid"><div><h3>Task state</h3><Json value={session.state} /></div><div><h3>Session identity</h3><dl className="identity-list"><dt>ID</dt><dd><code>{session.id}</code></dd><dt>Epoch</dt><dd>{session.epoch}</dd><dt>Started</dt><dd>{date(session.createdAt)}</dd><dt>Status</dt><dd><Pill>{session.status}</Pill></dd></dl><p className="muted">A new epoch resets previous context visibility.</p></div></div>{sessionRuns.length ? runTable(sessionRuns) : <div className="compact-empty">No commands associated with this session.</div>}</> : <>
            {report.sessions.length > 0 && <div className="filter-bar"><label className="search-field"><Icon name="search" /><input aria-label="Search sessions" placeholder="Search sessions…" value={query} onChange={event => setQuery(event.target.value)} /></label><span className="filter-count">{filteredSessions.length} sessions</span></div>}
            {filteredSessions.length ? <div className="session-list">{filteredSessions.map(entry => <button key={entry.id} className="session-row" onClick={() => setSession(entry)}><Icon name="Sessions" /><span><strong>{entry.task}</strong><small>{entry.id.slice(0, 8)} · epoch {entry.epoch}</small></span><time>{date(entry.updatedAt)}</time><Pill tone={entry.status === 'active' ? 'good' : ''}>{entry.status}</Pill><Icon name="arrow" /></button>)}</div> : <Empty title={query ? 'No matching sessions' : 'No sessions yet'} icon="Sessions" command={query ? undefined : 'codebudget session start --task "Your task"'}>{query ? 'Try another task name or session ID.' : 'Create a session to keep task state and command evidence together.'}</Empty>}
          </>}
        </section>}

        {report && view === 'Outputs' && <><section className="panel"><SectionTitle title="Command evidence"><span className="section-tag">{report.limits.visibleRuns} of {report.limits.retainedRuns} runs</span></SectionTitle>
          <div className="filter-bar"><label className="search-field"><Icon name="search" /><input aria-label="Search commands" placeholder="Search commands…" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Filter command result" value={resultFilter} onChange={event => setResultFilter(event.target.value)}><option value="all">All results</option><option value="success">Success</option><option value="failure">Failure</option><option value="timeout">Timeout</option><option value="cancelled">Cancelled</option></select>{(query || resultFilter !== 'all') && <button className="text-button" onClick={() => { setQuery(''); setResultFilter('all'); }}>Clear filters</button>}</div>
          {filteredRuns.length ? runTable(filteredRuns) : <Empty title={report.runs.length ? 'No matching commands' : 'No commands recorded'} command={report.runs.length ? undefined : 'codebudget run -- pnpm test'}>{report.runs.length ? 'Change your search or result filter to see more commands.' : 'Capture a command to compare the returned output with its retained archive.'}</Empty>}
        </section>{selectedRun && <section className="panel"><SectionTitle title="Output comparison" description={`${text(selectedRun.executable)} · exit ${text(selectedRun.exitCode)} · ${text(selectedRun.reducerId)}`}><Pill tone={selectedRun.truncated ? 'bad' : ''}>{selectedRun.truncated ? 'Truncated archive' : 'Retained archive'}</Pill></SectionTitle><div className="output-grid"><div><div className="code-heading"><h3>Original evidence</h3><span>Redacted · historical</span></div><pre className="code" aria-busy={evidenceBusy}>{evidenceBusy ? 'Loading evidence…' : evidence ? (Array.isArray(evidence.chunks) ? evidence.chunks.map(chunk => text(object(chunk).text)).join('') : 'No retained chunks') : 'Evidence unavailable'}</pre>{typeof evidence?.nextOffset === 'number' && <button className="button secondary next-page" onClick={() => void readEvidence(selectedRun, Number(evidence.nextOffset))}>Next page<Icon name="arrow" /></button>}</div><div><div className="code-heading"><h3>Agent output</h3><span>Reduced or passthrough</span></div><pre className="code">{text(selectedRun.output)}</pre><p className="muted">{text(selectedRun.reason)}</p></div></div></section>}</>}

        {report && view === 'Context' && <section className="panel"><SectionTitle title="Context packages"><span className="section-tag">{report.contextPackages.length} shown</span></SectionTitle>{report.contextPackages.length ? <><div className="context-list">{report.contextPackages.map((entry, index) => { const value = object(entry); const tokens = object(value.tokenMeasurement); return <button className="context-row" key={text(value.id) + index} onClick={() => void selectContext(entry)}><Icon name="Context" /><span><strong>{text(value.purpose ?? value.task ?? value.id)}</strong><small>{number(tokens.tokens)} tokens · {text(tokens.accuracy)}</small></span><Pill>{text(value.status)}</Pill><Icon name="arrow" /></button>; })}</div>{selectedContext !== null && <div className="context-detail"><h3>Serialized context package</h3><Json value={selectedContext} /></div>}</> : <Empty title="No context packages" icon="Context" command={'codebudget context --task "Your task" --budget 8000'}>Prepare a package to inspect source ranges, inclusion reasons and token estimates.</Empty>}</section>}

        {report && view === 'Benchmarks' && <><div className="benchmark-types"><div><span className="section-tag">01 / REPLAY</span><h2>Output preservation</h2><p>Compare recorded bytes and verify required evidence survives.</p></div><div><span className="section-tag">02 / TASK EXPERIMENT</span><h2>Consumption per success</h2><p>Requires authorized model runs and a separate spending budget.</p></div></div><section className="panel"><SectionTitle title="Benchmark records"><span className="section-tag">{report.benchmark.length} shown</span></SectionTitle>{report.benchmark.length ? report.benchmark.map((entry, index) => <details className="benchmark-record" key={index}><summary>Record {index + 1}<span>{text(object(entry).kind ?? 'benchmark')}</span></summary><Json value={entry} /></details>) : <Empty title="No benchmark records" icon="Benchmarks" command="codebudget benchmark replay">Run a local replay to record output measurements. Real task savings remain unmeasured.</Empty>}</section></>}

        {report && view === 'Adapters' && <section className="panel adapter-panel"><SectionTitle title="Client compatibility" description="Documented support does not imply a verified model session."><span className="section-tag">{report.adapters.length} clients</span></SectionTitle><div className="adapter-list">{report.adapters.map(adapter => <details className="adapter-row" key={adapter.client}><summary><span className="client-monogram" aria-hidden="true">{clientName(adapter.client).slice(0, 1)}</span><span className="adapter-identity"><h3>{clientName(adapter.client)}</h3><small>{adapter.clientVersion ? `Version ${adapter.clientVersion}` : 'Version not verified'}</small></span><span className="adapter-summary"><span>MCP</span><Pill tone={adapter.capabilities.mcpRegistration.support === 'supported' ? 'good' : ''}>{adapter.capabilities.mcpRegistration.support}</Pill></span><span className="expand-label">Details</span></summary><div className="adapter-capabilities"><div className="capability-head"><span>Capability</span><span>Support</span><span>Implementation / verification</span></div>{Object.entries(adapter.capabilities).map(([name, capability]) => <div className="capability" key={name}><strong>{capabilityName(name)}</strong><Pill tone={capability.support === 'supported' ? 'good' : ''}>{capability.support}</Pill><div className="capability-meta"><span>{capability.implementation}</span><span>{capability.verification}</span></div><p>{capability.notes} <a href={capability.source} target="_blank" rel="noopener noreferrer">Documentation ↗</a></p></div>)}</div><div className="adapter-footer">Matrix {adapter.matrixVersion} · checked {adapter.checkedAt}</div></details>)}</div></section>}

        <footer className="page-footer"><span><span className="status-dot" />Local records · no external telemetry</span><span>{report ? `Updated ${date(report.generatedAt)}` : 'Waiting for data'}</span></footer>
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

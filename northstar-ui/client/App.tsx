import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { COURTS, isUuid, isV2Snapshot, normalizeSnapshot, pct, prettyTime, text, redline, splitbrain, warpath, engineSplitbrain, engineWarpath } from './snapshot';
import type { Court, CourtResult, CourtState, Redline, Snapshot, Splitbrain, Warpath } from './snapshot';
import { exportSnapshot as renderOffline } from '../reports/export.js';
import { EngineSplitbrainView, EngineWarpathView, RawEvidence } from './EngineEvidence';
import { MutationLive } from './MutationLive';
import './styles.css';

type Tab = 'overview' | Court;
type Format = 'html' | 'md' | 'json';
const LABEL: Record<Court, string> = { redline: 'REDLINE', splitbrain: 'SPLITBRAIN', warpath: 'WARPATH' };
const SUBTITLE: Record<Court, string> = { redline: 'Specification witness', splitbrain: 'Test honesty audit', warpath: 'Incident forensics' };
const MARK: Record<Court, string> = { redline: '01', splitbrain: '02', warpath: '03' };
const MAX_BYTES = 5 * 1024 * 1024;

async function limitedBody(response: Response): Promise<Uint8Array> {
  const size = Number(response.headers.get('content-length'));
  if (size > MAX_BYTES) { await response.body?.cancel(); throw new Error('Response exceeds the 5 MB safety limit.'); }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) throw new Error('Response exceeds the 5 MB safety limit.');
    return bytes;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { await reader.cancel(); throw new Error('Response exceeds the 5 MB safety limit.'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
  return joined;
}
async function jsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    const detail = new TextDecoder().decode(await limitedBody(response)).slice(0, 300);
    throw new Error(`Request failed (${response.status}${detail ? `: ${detail}` : ''}).`);
  }
  return JSON.parse(new TextDecoder().decode(await limitedBody(response))) as unknown;
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function fmtState(state: CourtState) { return state.replace('_', ' '); }
function Status({ state }: { state: CourtState }) { return <span className={`state state-${state}`}><span className="state-dot" />{fmtState(state)}</span>; }
function Stamp({ label, value }: { label: string; value: string | null }) { return <div className="stamp"><dt>{label}</dt><dd>{prettyTime(value)}</dd></div>; }
function CourtNotReady({ result }: { result: CourtResult<unknown> }) {
  return <div className="empty-state"><span className="empty-icon" aria-hidden="true">◇</span><h3>{result.state === 'unavailable' ? 'Evidence unavailable' : result.state === 'error' ? 'Court could not be collected' : result.state === 'running' ? 'Collecting evidence…' : 'No evidence collected yet'}</h3><p>{result.state === 'unavailable' ? 'Required fixtures or evidence are missing. This is not a passing result.' : result.state === 'error' ? 'The court returned an error. No verdict can be inferred.' : result.state === 'running' ? 'This court is still in progress. Results will appear automatically.' : 'Run this court to collect its evidence.'}</p>{result.errors.length > 0 && <ul className="error-list">{result.errors.map((error, i) => <li key={i}>{error}</li>)}</ul>}</div>;
}
function Provenance({ result }: { result: CourtResult<unknown> }) { return <dl className="provenance"><Stamp label="Collected" value={result.collectedAt} /><Stamp label="Source generated" value={result.sourceGeneratedAt} /></dl>; }
function Metric({ label, value, hint, tone = '' }: { label: string; value: string; hint: string; tone?: string }) { return <div className={`metric ${tone}`}><span className="metric-label">{label}</span><strong>{value}</strong><small>{hint}</small></div>; }

function Overview({ snapshot, onNavigate }: { snapshot: Snapshot; onNavigate: (tab: Tab) => void }) {
  return <section className="page-section" aria-labelledby="overview-heading"><div className="section-heading"><div><span className="eyebrow">THE EVIDENCE DESK / 00</span><h2 id="overview-heading">The whole picture.</h2><p>Three independent courts. No composite score, no shortcut to a release decision.</p></div></div>
    <div className="overview-grid">{COURTS.map((court) => { const r = snapshot[court]; return <button type="button" className="court-card" key={court} onClick={() => onNavigate(court)}><div className="card-top"><span className="card-index">{MARK[court]} / COURT</span><Status state={r.state} /></div><span className={`court-symbol symbol-${court}`} aria-hidden="true">{court === 'redline' ? '≡' : court === 'splitbrain' ? '◈' : '↗'}</span><h3>{LABEL[court]}</h3><p>{SUBTITLE[court]}</p><div className="card-foot">{r.state === 'complete' && r.payload ? court === 'redline' ? redline(r.payload) ? `${r.payload.summary.red} red clauses` : 'Evidence available · unrecognized format' : court === 'splitbrain' ? splitbrain(r.payload) ? `${pct(r.payload.trustGap)} trust gap${r.payload.stale ? ' · stale artifact' : ''}` : engineSplitbrain(r.payload) ? 'Engine mutation evidence · inspect scores' : 'Evidence available · unrecognized format' : warpath(r.payload) || engineWarpath(r.payload) ? 'Incident evidence available' : 'Evidence available · unrecognized format' : r.state === 'unavailable' ? 'Missing evidence · no verdict' : r.state === 'error' ? 'Collection failed · no verdict' : 'Open court details'}<span aria-hidden="true">↗</span></div></button>; })}</div>
    <div className="overview-bottom"><div className="callout"><span className="callout-mark">!</span><div><strong>Evidence, not authorization.</strong><p>This dashboard is not a release approval. A green clause is one observed test outcome, not proof of system safety. Missing evidence is never a pass.</p></div></div><div className="ledger"><span className="eyebrow">RUN LEDGER</span><dl><div><dt>Run state</dt><dd>{snapshot.state}</dd></div><div><dt>Created</dt><dd>{prettyTime(snapshot.createdAt)}</dd></div><div><dt>Commit</dt><dd className="mono">{snapshot.checkedOutCommit ?? 'Unknown'}</dd></div><div><dt>Working tree</dt><dd>{snapshot.workingTreeDirty === null ? 'Unknown' : snapshot.workingTreeDirty ? 'Modified' : 'Clean'}</dd></div></dl></div></div>
  </section>;
}
function GenericEvidence({ payload }: { payload: unknown }) {
  return <div className="panel"><h3>Unrecognized court payload</h3><p className="muted">Unrecognized evidence: the producer supplied complete evidence in another format. The raw contents are shown below without interpreting scores, inferring a verdict, or treating missing data as a pass.</p><pre className="method-summary">{text(payload)}</pre></div>;
}

function RedlineView({ result }: { result: CourtResult<Redline> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const payload = result.payload;
  // Court payloads are opaque in v2. Only access structured fields after the
  // shape guard; a valid generic evidence object need not contain results.
  const active = redline(payload) ? payload.results.find((r) => r.clause === selected) ?? payload.results[0] : undefined;
  return <section className="page-section" aria-labelledby="redline-heading"><Heading court="redline" id="redline-heading" intro="The spec is the law. Each clause stands on its own test evidence." /><Provenance result={result} />{result.state !== 'complete' || !payload ? <CourtNotReady result={result} /> : !redline(payload) ? <GenericEvidence payload={payload} /> : <><div className="metrics three"><Metric label="GREEN CLAUSES" value={String(payload.summary.green)} hint="Assertions passed" tone="positive" /><Metric label="RED CLAUSES" value={String(payload.summary.red)} hint="Assertions failed" tone="negative" /><Metric label="TOTAL EXAMINED" value={String(payload.summary.total)} hint="Including inconclusive clauses" /></div><div className="subhead"><h3>Clause register</h3><span>{payload.results.length} recorded</span></div>{payload.results.length === 0 ? <div className="empty-state"><h3>No clauses reported</h3><p>No clause verdict can be inferred from an empty result.</p></div> : <div className="drill-layout"><div className="clause-list" aria-label="Select a clause">{payload.results.map((item, i) => <button type="button" key={`${item.clause}-${i}`} className={`clause-row ${active === item ? 'selected' : ''}`} onClick={() => setSelected(item.clause)} aria-pressed={active === item}><span className={`verdict verdict-${item.status}`} aria-label={`${item.status} verdict`} /> <span><strong>{item.clause}</strong><small>{item.failed} failed · {item.passed} passed</small></span><span className="row-arrow" aria-hidden="true">→</span></button>)}</div>{active && <article className="detail-panel"><div className="detail-head"><span className="eyebrow">CLAUSE / {active.clause}</span><span className={`pill pill-${active.status}`}>{active.status}</span></div><h3>{active.clause} testimony</h3><p className="detail-count">{active.passed} passed <span>·</span> {active.failed} failed <span>·</span> {active.total} total assertions</p><div className="spec-ref"><span>SPEC ANCHOR</span><code>{active.spec_anchor}</code></div><div className={active.spec_text !== undefined ? 'testimony-grid' : undefined}>{active.spec_text !== undefined && <section className="spec-testimony" aria-label="Specification text"><h4>Specification text</h4><pre>{active.spec_text}</pre></section>}<section aria-label="Failure testimony"><h4>Failure testimony</h4>{active.failures.length ? <div className="failure-list">{active.failures.map((f, i) => <div className="failure" key={i}><strong>{f.title}</strong><pre>{f.message || 'No failure message recorded.'}</pre></div>)}</div> : <p className="muted">No failure messages recorded for this clause.{active.status === 'yellow' ? ' The result is inconclusive, not a pass.' : ''}</p>}</section></div></article>}</div>}<RawEvidence payload={payload} /></> }</section>;
}
function Heading({ court, id, intro }: { court: Court; id: string; intro: string }) { return <div className="section-heading"><div><span className="eyebrow">COURT {MARK[court]} / {SUBTITLE[court]}</span><h2 id={id}>{LABEL[court]}<span className="heading-period">.</span></h2><p>{intro}</p></div></div>; }
function SplitbrainView({ result, live }: { result: CourtResult<Splitbrain>; live: React.ReactNode }) {
  const data = result.payload;
  return <section className="page-section" aria-labelledby="splitbrain-heading"><Heading court="splitbrain" id="splitbrain-heading" intro="Coverage says what ran. Mutation asks whether tests would notice a change." />{live}<Provenance result={result} />{result.state !== 'complete' || !data ? <CourtNotReady result={result} /> : !splitbrain(data) ? engineSplitbrain(data) ? <EngineSplitbrainView data={data} /> : <GenericEvidence payload={data} /> : <><div className="notice" role="status"><strong>{data.stale ? 'Stale mutation evidence. ' : 'Mutation evidence as reported. '}</strong>Source and collection method are self-reported; confirm them against the producer's records.{data.codeCommitAt && <> Latest committed code/test change: {prettyTime(data.codeCommitAt)}.</>}{data.warnings?.length ? <ul>{data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul> : null}</div><div className="metrics three"><Metric label="CLAIMED COVERAGE" value={pct(data.claimedCoverage)} hint="Reported line coverage" /><Metric label="HONEST MUTATION" value={pct(data.honestMutationScore)} hint="Mutants killed by honest tests" tone="positive" /><Metric label="TRUST GAP" value={pct(data.trustGap)} hint="Coverage minus honest mutation" tone="negative" /></div><div className="split-layout"><article className="panel"><div className="subhead"><h3>Coverage ≠ confidence</h3><span>Measured, not assumed</span></div><div className="bar-row"><div><strong>Claimed coverage</strong><span>{pct(data.claimedCoverage)}</span></div><div className="bar-track"><div className="bar-fill bar-claimed" style={{ width: `${Math.max(0, Math.min(100, data.claimedCoverage * 100))}%` }} /></div></div><div className="bar-row"><div><strong>Honest mutation</strong><span>{pct(data.honestMutationScore)}</span></div><div className="bar-track"><div className="bar-fill bar-honest" style={{ width: `${Math.max(0, Math.min(100, data.honestMutationScore * 100))}%` }} /></div></div><p className="panel-note">The trust gap is the reported difference between these two metrics, not a release score. Mutation evidence must be interpreted in context.</p></article><article className="panel"><div className="subhead"><h3>Dishonest tests</h3><span>{data.dishonestTests.length} identified</span></div>{data.dishonestTests.length ? <ul className="test-list">{data.dishonestTests.map((test, i) => <li key={`${test}-${i}`}><span className="test-alert" aria-hidden="true">!</span><code>{test}</code></li>)}</ul> : <p className="muted">No dishonest tests identified in this report. This does not prove all tests are honest.</p>}</article></div><article className="panel mutants-panel"><div className="subhead"><h3>Mutation evidence</h3><span>{data.mutants.length} entries</span></div>{data.mutants.length ? <div className="mutation-list">{data.mutants.map((mutant, i) => <div key={i} className="mutation-item"><span className="mono mutation-index">{String(i + 1).padStart(2, '0')}</span><code>{text(mutant)}</code></div>)}</div> : <p className="muted">No individual mutant entries included in this snapshot. Summary metrics are still shown as reported.</p>}</article>{data.suiteLevelTotals && <article className="panel evidence-panel"><div className="subhead"><h3>Suite-level mutation totals</h3><span>Unique mutants · not per-test counts</span></div><dl className="field-list"><div><dt>Killed</dt><dd>{data.suiteLevelTotals.killed}</dd></div><div><dt>Survived</dt><dd>{data.suiteLevelTotals.survived}</dd></div><div><dt>No coverage</dt><dd>{data.suiteLevelTotals.noCoverage}</dd></div><div><dt>Timeout</dt><dd>{data.suiteLevelTotals.timeout}</dd></div><div><dt>Total</dt><dd>{data.suiteLevelTotals.totalMutants}</dd></div><div><dt>Suite mutation score</dt><dd>{pct(data.suiteLevelTotals.mutationScore)}</dd></div></dl></article>}{data.itLedger && <article className="panel evidence-panel"><div className="subhead"><h3>Per-test attribution</h3><span>{data.itLedger.length} test blocks</span></div><p className="muted">A mutant can be attributed to multiple tests. These rows do not sum to suite-level unique counts.</p>{data.itLedger.length ? <div className="ledger-scroll"><table className="evidence-table"><thead><tr><th scope="col">Test / spec</th><th scope="col">Honesty</th><th scope="col">Killed</th><th scope="col">Survived</th><th scope="col">Timeout</th><th scope="col">No coverage</th></tr></thead><tbody>{data.itLedger.map((entry, i) => <tr key={`${entry.itId}-${i}`}><th scope="row"><code>{entry.itId}</code><small>{entry.file} · {entry.specRef}</small></th><td>{entry.honest ? 'Honest' : 'Dishonest'}</td><td>{entry.killed}</td><td>{entry.survived}</td><td>{entry.timeout}</td><td>{entry.noCoverage}</td></tr>)}</tbody></table></div> : <p className="muted">No per-test entries supplied.</p>}</article>}{data.summary && <details className="panel evidence-panel"><summary>Artifact methodology and caveats</summary><p className="method-summary">{data.summary}</p></details>}</>}</section>;
}
function Fields({ value, empty = 'No values recorded.' }: { value: Record<string, unknown> | undefined; empty?: string }) { return value && Object.keys(value).length ? <dl className="field-list">{Object.entries(value).map(([key, val]) => <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1')}</dt><dd>{text(val)}</dd></div>)}</dl> : <p className="muted">{empty}</p>; }
function WarpathView({ result }: { result: CourtResult<Warpath> }) {
  const data = result.payload;
  return <section className="page-section" aria-labelledby="warpath-heading"><Heading court="warpath" id="warpath-heading" intro="Reported deploys, signals and triage. Check timestamps independently before attributing cause." /><Provenance result={result} />{result.state !== 'complete' || !data ? <CourtNotReady result={result} /> : !warpath(data) ? engineWarpath(data) ? <EngineWarpathView data={data} /> : <GenericEvidence payload={data} /> : <><div className="metrics three"><Metric label="DEPLOYS IN CONTEXT" value={String(data.context.deploys.length)} hint="Available deploy records" /><Metric label="LOG ENTRIES" value={String(data.context.logWindow.length)} hint="Collected log window" /><Metric label="INCIDENT WINDOW" value={data.triage.incidentWindow ?? 'Not recorded'} hint="As reported by triage" tone="metric-window" /></div>{data.triage.status && <div className="notice">Triage status: <strong>{data.triage.status}</strong>{data.triage.detail ? ` — ${data.triage.detail}` : ''}. This is not a confirmed root cause.</div>}<div className="war-grid"><article className="panel"><div className="subhead"><h3>Deploy timeline</h3><span>Chronological evidence</span></div>{data.context.deploys.length ? <ol className="timeline">{[...data.context.deploys].sort((a, b) => { const left = Date.parse(String(a.at ?? '')); const right = Date.parse(String(b.at ?? '')); return (Number.isFinite(left) ? left : Infinity) - (Number.isFinite(right) ? right : Infinity) || 0; }).map((deploy, i) => <li key={i}><div className="timeline-time">{deploy.at ? prettyTime(String(deploy.at)) : 'Time unknown'}</div><strong>{text(deploy.id ?? `Deploy ${i + 1}`)}</strong><span>{text(deploy.service ?? 'Service unknown')}</span>{deploy.commit && <code>{text(deploy.commit)}</code>}</li>)}</ol> : <p className="muted">No deploy records available. A suspect cannot be established from deploys alone.</p>}</article><article className="panel"><div className="subhead"><h3>Suspect & signal</h3><span>Reported candidate, not confirmed cause</span></div><span className="eyebrow">SUSPECT DEPLOY</span><Fields value={data.triage.suspect ?? undefined} empty="No suspect identified. Evidence is insufficient." /><span className="eyebrow separator">BREAKER SNAPSHOT</span><Fields value={data.triage.breakerSnapshot} empty="No breaker snapshot supplied." /><span className="eyebrow separator">METRICS</span><Fields value={data.context.metrics} empty="No metrics supplied." /></article></div><div className="war-grid"><article className="panel"><div className="subhead"><h3>Log window</h3><span>{data.context.logWindow.length} records</span></div>{data.context.logWindow.length ? <div className="log-list">{data.context.logWindow.map((line, i) => <div className="log-entry" key={i}><span className={`log-level ${line.level === 'error' ? 'log-error' : line.level === 'warn' ? 'log-warn' : ''}`}>{text(line.level ?? 'log')}</span><span className="mono">{text(line.at ?? line.timestamp ?? 'Time unknown')}</span><span>{text(line.message ?? line)}</span></div>)}</div> : <p className="muted">No logs available. Missing log evidence is not a clean bill of health.</p>}</article><article className="panel"><div className="subhead"><h3>Triage evidence</h3><span>{data.triage.evidence?.length ?? 0} signals · timestamps not verified</span></div>{data.triage.evidence?.length ? <div className="log-list">{data.triage.evidence.map((line, i) => <div className="log-entry" key={i}><span className={`log-level ${line.level === 'error' ? 'log-error' : ''}`}>{text(line.level ?? 'signal')}</span><span>{text(line.message ?? line)}</span></div>)}</div> : <p className="muted">No error or warning signals included in this triage report.</p>}<span className="eyebrow separator">CLEARED DEPLOYS</span>{data.triage.clearedDeploys?.length ? <ul className="simple-list">{data.triage.clearedDeploys.map((d, i) => <li key={i}>{text(d.id ?? `Deploy ${i + 1}`)} <span>{d.at ? prettyTime(String(d.at)) : ''}</span></li>)}</ul> : <p className="muted">None recorded.</p>}{data.triage.rule && <><span className="eyebrow separator">RULE / RUNBOOK</span><p className="rule">{data.triage.rule}</p></>}</article></div></>}</section>;
}

type Project = { id: string; name: string; connected: boolean; lastRunAt: string | null; runCount: number };
type Run = { runId: string; createdAt: string; state: Snapshot['state']; revision: number; branch: string | null; courts: Court[] };
type Route = { projectId: string | null; runId: string | null; importId: string | null };
type SavedImport = { id: string; project: { id: string; name: string }; runId: string; createdAt: string; state: Snapshot['state'] };
function routeFromPath(): Route {
  const imported = /^\/imports\/([^/]+)\/?$/.exec(window.location.pathname);
  if (imported) { try { const importId = decodeURIComponent(imported[1]); if (isUuid(importId)) return { projectId: null, runId: null, importId }; } catch { /* invalid URL */ } }
  const match = /^\/projects\/([^/]+)(?:\/runs\/([^/]+))?\/?$/.exec(window.location.pathname);
  if (!match) return { projectId: null, runId: null, importId: null };
  try {
    const projectId = decodeURIComponent(match[1]);
    const runId = match[2] ? decodeURIComponent(match[2]) : null;
    return isUuid(projectId) && (!runId || isUuid(runId)) ? { projectId, runId, importId: null } : { projectId: null, runId: null, importId: null };
  } catch { return { projectId: null, runId: null, importId: null }; }
}
function projectsFrom(value: unknown): Project[] {
  if (!Array.isArray(value) || !value.every((p) => p && typeof p === 'object' && isUuid(p.id) && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 2000 && typeof p.connected === 'boolean' && (p.lastRunAt === null || typeof p.lastRunAt === 'string' && Number.isFinite(Date.parse(p.lastRunAt))) && Number.isSafeInteger(p.runCount) && p.runCount >= 0)) throw new Error('Invalid projects response.');
  return value;
}
function runsFrom(value: unknown): Run[] {
  if (!Array.isArray(value) || !value.every((r) => r && typeof r === 'object' && isUuid(r.runId) && typeof r.createdAt === 'string' && Number.isFinite(Date.parse(r.createdAt)) && ['running', 'complete', 'interrupted'].includes(r.state) && Number.isSafeInteger(r.revision) && r.revision >= 0 && (r.branch === null || typeof r.branch === 'string') && Array.isArray(r.courts) && r.courts.every((court: unknown) => COURTS.includes(court as Court)))) throw new Error('Invalid run history response.');
  return value;
}
export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [route, setRoute] = useState<Route>(routeFromPath);
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runFilter, setRunFilter] = useState('all');
  const [courtFilter, setCourtFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [savedImports, setSavedImports] = useState<SavedImport[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [importedRaw, setImportedRaw] = useState<unknown>(null);
  const [source, setSource] = useState<'live' | 'imported' | 'saved-import' | null>(null);
  const [connection, setConnection] = useState<'loading' | 'online' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestController = useRef<AbortController | null>(null);
  const actionVersion = useRef(0);
  const selectedProject = projects.find((p) => p.id === route.projectId);
  const visibleRuns = runs.filter((run) => (runFilter === 'all' || run.state === runFilter) && (courtFilter === 'all' || run.courts.includes(courtFilter as Court)) && (!branchFilter || (run.branch ?? '').toLowerCase().includes(branchFilter.toLowerCase())) && (!dateFilter || run.createdAt.slice(0, 10) === dateFilter));
  const canRun = source !== 'imported' && source !== 'saved-import' && connection === 'online' && !!selectedProject?.connected && !busy;
  const runDisabledReason = source === 'imported' || source === 'saved-import' ? 'Imported evidence cannot execute, even after saving.' : !selectedProject ? 'Select a project first.' : !selectedProject.connected ? 'This project is not connected.' : connection !== 'online' ? 'Cannot reach the project service.' : undefined;

  function navigate(projectId: string | null, runId: string | null = null) {
    ++actionVersion.current;
    requestController.current?.abort();
    const next = { projectId, runId, importId: null };
    window.history.pushState(null, '', projectId ? `/projects/${encodeURIComponent(projectId)}${runId ? `/runs/${encodeURIComponent(runId)}` : ''}` : '/');
    if (projectId !== route.projectId) { setRunFilter('all'); setCourtFilter('all'); setBranchFilter(''); setDateFilter(''); }
    setRoute(next); setSnapshot(null); setSource(null); setImportedRaw(null); setTab('overview'); setError(null);
  }
  useEffect(() => {
    const onPop = () => { ++actionVersion.current; requestController.current?.abort(); setRoute(routeFromPath()); setSnapshot(null); setSource(null); setImportedRaw(null); setTab('overview'); setError(null); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const list = projectsFrom(await jsonResponse(await fetch('/api/projects')));
        if (stopped) return;
        setProjects(list); setConnection('online');
      } catch (e) { if (!stopped) { setConnection('error'); setError((previous) => previous ?? (e instanceof Error ? e.message : 'Could not load projects.')); } }
      if (!stopped) timer = setTimeout(refresh, 10000);
    }
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!route.projectId || source === 'imported' || source === 'saved-import') { setRuns([]); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const list = runsFrom(await jsonResponse(await fetch(`/api/projects/${encodeURIComponent(route.projectId!)}/runs`, { signal: controller.signal })));
        if (!controller.signal.aborted) setRuns(list);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load run history.'); }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 6000);
    }
    setRuns([]); void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [route.projectId, source]);
  useEffect(() => {
    if (!route.projectId || !route.runId || source === 'imported' || source === 'saved-import') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const raw = await jsonResponse(await fetch(`/api/projects/${encodeURIComponent(route.projectId!)}/runs/${encodeURIComponent(route.runId!)}`, { signal: controller.signal }));
        if (!isV2Snapshot(raw)) throw new Error('Server returned an invalid v2 report.');
        const next = raw;
        if (next.project.id !== route.projectId || next.runId !== route.runId) throw new Error('Server returned a report for another project or run.');
        if (controller.signal.aborted) return;
        setSnapshot(next); setSource('live'); setError(null);
        if (next.state === 'running') timer = setTimeout(poll, 1800);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : 'Could not load the run.');
        timer = setTimeout(poll, 4000);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [route.projectId, route.runId, source === 'imported' || source === 'saved-import']);

  function selectImport(importId: string) {
    ++actionVersion.current; requestController.current?.abort();
    window.history.pushState(null, '', `/imports/${encodeURIComponent(importId)}`);
    setRoute({ projectId: null, runId: null, importId }); setSnapshot(null); setSource(null); setImportedRaw(null); setTab('overview'); setError(null);
  }
  useEffect(() => {
    if (!route.importId) return;
    const controller = new AbortController();
    async function load() {
      try {
        const raw = await jsonResponse(await fetch(`/api/imports/${encodeURIComponent(route.importId!)}`, { signal: controller.signal }));
        if (!isV2Snapshot(raw)) throw new Error('Saved import is not a valid v2 report.');
        if (!controller.signal.aborted) { setSnapshot(raw); setSource('saved-import'); setError(null); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load saved import.'); }
    }
    void load(); return () => controller.abort();
  }, [route.importId]);
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const raw = await jsonResponse(await fetch('/api/imports'));
        if (!Array.isArray(raw) || !raw.every((entry) => entry && typeof entry === 'object' && isUuid(entry.id) && isUuid(entry.runId) && entry.project && isUuid(entry.project.id) && typeof entry.project.name === 'string' && typeof entry.createdAt === 'string' && ['running', 'complete', 'interrupted'].includes(entry.state))) throw new Error('Invalid saved imports response.');
        if (!stopped) setSavedImports(raw);
      } catch { /* Optional endpoint may not be available; local detached viewing still works. */ }
      if (!stopped) timer = setTimeout(refresh, 10000);
    }
    void refresh(); return () => { stopped = true; clearTimeout(timer); };
  }, []);
  async function start(courts: Court[]) {
    if (!canRun || !route.projectId) return;
    const projectId = route.projectId;
    const version = ++actionVersion.current;
    requestController.current?.abort();
    const controller = new AbortController(); requestController.current = controller;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courts }), signal: controller.signal });
      const value = await jsonResponse(res);
      if (res.status !== 202 || !value || typeof value !== 'object' || !('runId' in value) || !isUuid(value.runId)) throw new Error('The server did not return a valid 202 run ID.');
      if (version !== actionVersion.current) return;
      navigate(projectId, value.runId); setTab(courts.length === 1 ? courts[0] : 'overview');
    } catch (e) { if (!controller.signal.aborted && version === actionVersion.current) setError(e instanceof Error ? e.message : 'Could not start the run.'); }
    finally { if (requestController.current === controller) { setBusy(false); requestController.current = null; } }
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const version = ++actionVersion.current;
    requestController.current?.abort(); requestController.current = null;
    setBusy(false); setError(null);
    if (file.size > MAX_BYTES) { setError('Import refused: file exceeds 5 MB.'); return; }
    try {
      const raw = await file.text();
      if (version !== actionVersion.current) return;
      if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error('Import refused: file exceeds 5 MB.');
      const value: unknown = JSON.parse(raw);
      const data = normalizeSnapshot(value);
      window.history.pushState(null, '', '/');
      setRoute({ projectId: null, runId: null, importId: null }); setRuns([]); setSource('imported'); setImportedRaw(value); setSnapshot(data); setTab('overview');
    } catch (e) { if (version === actionVersion.current) setError(e instanceof Error ? e.message : 'Unable to read report.'); }
  }
  async function saveImport() {
    if (source !== 'imported' || !snapshot || importedRaw === null || busy) return;
    const version = ++actionVersion.current;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(importedRaw) });
      const value = await jsonResponse(res);
      if (res.status !== 201 || !value || typeof value !== 'object' || !('projectId' in value) || !isUuid(value.projectId) || !('runId' in value) || !isUuid(value.runId)) throw new Error('Import was not saved with a valid project and run ID.');
      if (version === actionVersion.current) {
        if (!('importId' in value) || !isUuid(value.importId)) throw new Error('Server did not return an import ID.');
        selectImport(value.importId);
      }
    } catch (e) { if (version === actionVersion.current) setError(e instanceof Error ? e.message : 'Could not save import.'); }
    finally { setBusy(false); }
  }
  async function exportFile(format: Format) {
    if (!snapshot) return;
    setError(null);
    try {
      if (source === 'imported') {
        if (snapshot.state === 'running' && format !== 'json') return;
        const rendered = renderOffline(snapshot, format);
        download(new Blob([rendered], { type: { html: 'text/html', md: 'text/markdown', json: 'application/json' }[format] }), `triumph-${snapshot.runId}.${format}`);
        return;
      }
      if (source !== 'live' && source !== 'saved-import' || snapshot.state === 'running') return;
      const query = source === 'saved-import' && route.importId ? `&importId=${encodeURIComponent(route.importId)}` : route.projectId ? `&projectId=${encodeURIComponent(route.projectId)}` : '';
      const res = await fetch(`/api/runs/${encodeURIComponent(snapshot.runId)}/export?format=${format}${query}`);
      if (!res.ok) throw new Error(`Export failed (${res.status}).`);
      const bytes = await limitedBody(res);
      download(new Blob([new Uint8Array(bytes)], { type: { html: 'text/html', md: 'text/markdown', json: 'application/json' }[format] }), `triumph-${snapshot.runId}.${format}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed.'); }
  }
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark" aria-hidden="true">✳</div><div><strong>TRIUMPH</strong><small>THE COURTROOM</small></div></div>
    <div className="side-label">PROJECTS</div><div className="project-list" aria-label="Projects">{connection === 'loading' && <p className="side-hint">Loading projects…</p>}{connection === 'error' && <p className="side-hint">Project service unavailable. Retrying…</p>}{connection === 'online' && projects.length === 0 && <p className="side-hint">No projects configured. Connect a project to collect evidence.</p>}{projects.map((project) => <button type="button" key={project.id} className={`project-item ${route.projectId === project.id && source !== 'imported' && source !== 'saved-import' ? 'active' : ''}`} onClick={() => navigate(project.id)} aria-pressed={route.projectId === project.id && source !== 'imported' && source !== 'saved-import'}><span className={`project-dot ${project.connected ? 'connected' : ''}`} /><span className="project-name">{project.name}<small>{project.connected ? 'Connected' : 'Disconnected'} · {project.runCount} runs</small></span></button>)}</div>
    <div className="side-label history-label">RUN HISTORY</div>{route.projectId && runs.length > 0 && <div className="history-filters" aria-label="Filter run history"><select aria-label="Filter run state" value={runFilter} onChange={(e) => setRunFilter(e.target.value)}><option value="all">All states</option><option value="running">Running</option><option value="complete">Complete</option><option value="interrupted">Interrupted</option></select><select aria-label="Filter court" value={courtFilter} onChange={(e) => setCourtFilter(e.target.value)}><option value="all">All courts</option>{COURTS.map((court) => <option key={court} value={court}>{LABEL[court]}</option>)}</select><input aria-label="Filter branch" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} placeholder="Branch" /><input aria-label="Filter date" type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} /></div>}<div className="run-list" aria-label="Run history">{source === 'imported' || source === 'saved-import' ? <p className="side-hint">Imported report · no project run history</p> : !route.projectId ? <p className="side-hint">Select a project to view its runs.</p> : runs.length === 0 ? <p className="side-hint">No runs recorded yet.</p> : visibleRuns.length === 0 ? <p className="side-hint">No matching runs.</p> : visibleRuns.map((run) => <button type="button" key={run.runId} className={`run-item ${route.runId === run.runId ? 'active' : ''}`} onClick={() => navigate(route.projectId, run.runId)} aria-pressed={route.runId === run.runId}><span className={`run-indicator run-${run.state}`} /><span><strong>{prettyTime(run.createdAt)}</strong><small>{run.state} · {run.branch ?? 'branch unknown'} · {run.runId.slice(0, 8)} · rev {run.revision}</small></span></button>)}</div>
    {savedImports.length > 0 && <><div className="side-label history-label">SAVED IMPORTS</div><div className="run-list" aria-label="Saved imports">{savedImports.map((entry) => <button type="button" key={entry.id} className={`run-item ${route.importId === entry.id ? 'active' : ''}`} onClick={() => selectImport(entry.id)}><span className="run-indicator" /><span><strong>{entry.project.name}</strong><small>{prettyTime(entry.createdAt)} · {entry.runId.slice(0, 8)}</small></span></button>)}</div></>}<div className="side-label courts-label">COURTS</div><nav className="nav" aria-label="Court navigation"><button className={`nav-item ${tab === 'overview' ? 'active' : ''}`} aria-current={tab === 'overview' ? 'page' : undefined} onClick={() => setTab('overview')}><span className="nav-number">00</span> Overview <span className="nav-glyph" aria-hidden="true">⌗</span></button>{COURTS.map((court) => <button key={court} className={`nav-item ${tab === court ? 'active' : ''}`} aria-current={tab === court ? 'page' : undefined} onClick={() => setTab(court)}><span className="nav-number">{MARK[court]}</span> {LABEL[court]} {snapshot && <span className={`nav-status nav-${snapshot[court].state}`} aria-label={fmtState(snapshot[court].state)} />}</button>)}</nav>
    <div className="side-actions"><span className="side-label">COLLECT EVIDENCE</span><button type="button" className="all-button" disabled={!canRun} title={runDisabledReason} onClick={() => void start([...COURTS])}>{busy ? 'Starting…' : 'Run all courts'}<span aria-hidden="true">↗</span></button><div className="single-actions">{COURTS.map((court) => <button key={court} type="button" disabled={!canRun} title={runDisabledReason} onClick={() => void start([court])}>Run {LABEL[court]} <span aria-hidden="true">→</span></button>)}</div>{runDisabledReason && <p className="side-hint">{runDisabledReason}</p>}</div><div className="sidebar-foot"><span className="foot-spark" aria-hidden="true">✳</span> Legal. Honest. Survivable.<small>Evidence is not authorization.</small></div></aside>
    <main className="main"><header className="topbar"><div className="breadcrumb">TRIUMPH <span>/</span> {source === 'imported' ? 'DETACHED IMPORT' : source === 'saved-import' ? 'SAVED IMPORT' : selectedProject?.name ?? 'PROJECTS'} <span>/</span> <strong>{tab.toUpperCase()}</strong></div><div className="header-right"><span className={`connection ${source === 'imported' || source === 'saved-import' ? 'connection-imported' : connection === 'error' ? 'connection-error' : connection === 'loading' ? 'connection-loading' : selectedProject && !selectedProject.connected ? 'connection-disconnected' : ''}`}><span />{source === 'imported' ? 'DETACHED VIEWER' : source === 'saved-import' ? 'SAVED IMPORT / NOT CONNECTED' : connection === 'error' ? 'SERVICE UNAVAILABLE' : connection === 'loading' ? 'CONNECTING' : selectedProject ? selectedProject.connected ? 'PROJECT CONNECTED' : 'PROJECT DISCONNECTED' : 'PROJECTS LOADED'}</span></div></header><div className="content"><div className="masthead"><div><span className="eyebrow">INDEPENDENT EVIDENCE / TRIUMPH</span><h1>Proof before <em>promise.</em></h1><p>Spec compliance, test honesty and incident evidence — for every project and run.</p></div><div className="masthead-icon" aria-hidden="true">✳</div></div><div className="toolbar"><div className="run-identity"><span className="identity-icon" aria-hidden="true">▧</span><div><strong>{snapshot ? `${snapshot.project.name} / Run ${snapshot.runId}` : selectedProject ? `${selectedProject.name} / ${route.runId ? `Run ${route.runId}` : 'No run selected'}` : 'No project selected'}</strong><small>{source === 'imported' ? 'Detached import · self-reported provenance · execution disabled' : source === 'saved-import' ? 'Saved import · not connected · execution disabled' : snapshot ? `Created ${prettyTime(snapshot.createdAt)} · ${snapshot.state} · revision ${snapshot.revision}` : selectedProject ? `${selectedProject.connected ? 'Connected' : 'Disconnected'} · ${selectedProject.runCount} recorded runs` : 'Select a project or import a JSON report'}</small></div></div><div className="toolbar-actions"><input ref={fileInput} id="snapshot-upload" type="file" accept=".json,application/json" className="visually-hidden" onChange={(e) => void importFile(e)} aria-label="Import a schema version 1 or 2 JSON report" /><button type="button" className="button-secondary" onClick={() => fileInput.current?.click()}>↑ Import JSON</button>{source === 'imported' && <button type="button" disabled={busy || connection !== 'online'} onClick={() => void saveImport()}>{busy ? 'Saving…' : 'Save to server'}</button>}{snapshot && <div className="export-group" aria-label="Export report"><button type="button" disabled={source === 'live' && snapshot.state === 'running'} title={source === 'live' && snapshot.state === 'running' ? 'Exports are available when the run finishes' : undefined} onClick={() => void exportFile('json')}>↓ JSON</button>{(source === 'live' || source === 'saved-import' || source === 'imported') && <><button type="button" disabled={snapshot.state === 'running'} onClick={() => void exportFile('html')}>HTML</button><button type="button" disabled={snapshot.state === 'running'} onClick={() => void exportFile('md')}>Markdown</button></>}</div>}</div></div>{route.projectId && !selectedProject && connection === 'online' && source !== 'imported' && <div className="notice" role="status">This project is not in the current project list. You can still inspect a bookmarked run, but cannot start a new one.</div>}{source === 'saved-import' && <div className="notice offline" role="status"><strong>Saved imported evidence.</strong> This report is saved on the server but is not a connected project. Run buttons remain disabled; server exports are available.</div>}{source === 'imported' && <div className="notice offline" role="status"><strong>Detached evidence view.</strong> This report came from a file, not this server. Provenance is self-reported. Execution is disabled. Offline exports remain available; saving to the server does not connect its project.</div>}{error && <div className="notice error-notice" role="alert"><strong>Action needed.</strong> {error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}{!snapshot ? <div className="welcome"><div className="welcome-art" aria-hidden="true">✳</div><span className="eyebrow">EVIDENCE WORKSPACE</span><h2>{route.runId ? 'Loading run evidence…' : selectedProject ? `Explore ${selectedProject.name}.` : 'Choose a project.'}</h2><p>{route.runId ? 'Retrieving the selected run. If it cannot be loaded, check the message above.' : selectedProject ? 'Select a run from history or collect new evidence from a connected project.' : 'Choose a project to inspect run history, or import a versioned JSON report for a detached review.'}</p><button type="button" className="primary-button" disabled={!canRun} title={runDisabledReason} onClick={() => void start([...COURTS])}>{busy ? 'Starting run…' : 'Run all three courts'} <span aria-hidden="true">↗</span></button><small>Missing fixtures are unavailable, never passed.</small></div> : <>{tab === 'overview' ? <Overview snapshot={snapshot} onNavigate={setTab} /> : tab === 'redline' ? <RedlineView result={snapshot.redline} /> : tab === 'splitbrain' ? <SplitbrainView result={snapshot.splitbrain} live={route.projectId && route.runId ? <MutationLive projectId={route.projectId} runId={route.runId} active={snapshot.state === 'running'} /> : null} /> : <WarpathView result={snapshot.warpath} />}</>}<footer className="footer"><span>✳ TRIUMPH / COURTROOM</span><span>Evidence is not a release approval.</span><span>SCHEMA v{snapshot?.schemaVersion ?? 2}</span></footer></div></main></div>;
}

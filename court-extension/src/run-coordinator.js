'use strict';
/** Single execution owner for every extension entry point. Locks are process-local,
 * keyed by realpath; they do not claim ownership of external mutation processes. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { loadConfig, findConfigFile } = require('../lib/config');
const { projectId, sourceGeneratedAt } = require('../lib/convert');
const store = require('../lib/run-store');
const { McpClient } = require('./mcp-client');
const ALL = ['witness', 'trustgap', 'triage'];
const COURTS = ALL.map(c => c.toUpperCase());
const active = new Map();
const listeners = new Set();
const requests = new Map();
const publications = new Map();
const clone = value => JSON.parse(JSON.stringify(value));
function error(code, message) { return Object.assign(new Error(message), { code }); }
function trusted(ctx) {
  if (ctx.isTrusted === false || ctx.vscode?.workspace?.isTrusted === false) throw error('UNTRUSTED_WORKSPACE', 'Trust this workspace before executing commands or writing files.');
}
function onRunEvent(fn) { listeners.add(fn); return { dispose() { listeners.delete(fn); } }; }
function event(ctx, run, kind, payload = {}) {
  const frame = { root: ctx.root, workspaceId: run.workspaceId, runId: run.runId, sequence: ++run.sequence, kind, phase: run.phase, payload: clone(payload) };
  for (const fn of [ctx.onRunEvent, ctx.emitRunEvent, ...listeners]) if (typeof fn === 'function') { try { fn(frame); } catch {} }
}
function step(ctx, status, text) {
  try { if (ctx.emitStep) ctx.emitStep({status, text}); else ctx.emit?.({level: status === 'error' ? 'error' : 'info', text}); } catch {}
}
function gitProvenance(root) {
  const run = (args) => new Promise((res) => {
    execFile('git', args, { cwd: root, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
      (e, out) => res(e ? null : String(out).trim()));
  });
  return (async () => {
    const [commit, branch, status] = await Promise.all([
      run(['rev-parse', 'HEAD']),
      run(['rev-parse', '--abbrev-ref', 'HEAD']),
      run(['status', '--porcelain']),
    ]);
    return {
      checkedOutCommit: commit || null,
      branch: !branch || branch === 'HEAD' ? null : branch, // detached or failed → null
      workingTreeDirty: status === null ? null : status.length > 0, // clean ('' ) → false
    };
  })();
}

/**
 * Preflight: decide which courts are *able* to run. A court is 'unavailable'
 * when a verified precondition is absent — never run it and call it a pass.
 * Returns { runnable, reasons, cfg }.
 */
function preflight(root) {
  const reasons = {};
  let cfg;
  try {
    if (!findConfigFile(root)) throw new Error('No GAIA configuration found');
    cfg = loadConfig(root);
  } catch (e) {
    for (const court of ALL) reasons[court] = `Invalid GAIA configuration: ${e.message}`;
    return { runnable: [], reasons };
  }
  if (!fs.existsSync(cfg.spec.absPath)) reasons.witness = 'spec.path missing';
  if (!fs.existsSync(cfg.tests.absDir)) reasons.witness = 'tests.dir missing';
  if (!(cfg.mutation.absReport && fs.existsSync(cfg.mutation.absReport)) &&
      !fs.existsSync(cfg.evidence.trustgap) && !cfg.mutation.command) {
    reasons.trustgap = 'no mutation report, TrustGap ledger or mutation command';
  }
  if (!cfg.fixtures.metrics || !fs.existsSync(cfg.fixtures.metrics)) reasons.triage = 'metrics fixture missing';
  else if (!cfg.fixtures.deploys || !fs.existsSync(cfg.fixtures.deploys)) reasons.triage = 'deploy fixture missing';
  const runnable = ALL.filter((c) => !reasons[c]);
  const configuredTimeout = cfg.mutation.timeoutSeconds;
  if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0 || configuredTimeout > 86400) {
    reasons.trustgap = 'mutation.timeoutSeconds must be a number between 0 and 86400 (exclusive of 0)';
  }
  return { runnable: ALL.filter(c => !reasons[c]), reasons, cfg };
}

/** Classify a court's engine payload as complete/unavailable/error evidence. */
function outcome(court, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { kind: 'error', errors: ['Engine returned no object evidence'] };
  if (court === 'witness' && (payload.status === 'error' || !Array.isArray(payload.results))) {
    return { kind: 'error', errors: [String(payload.detail || 'WITNESS produced no verdicts')], payload };
  }
  if (court === 'trustgap' && payload.status !== 'ok') return {
    kind: payload.status === 'not-run' || payload.status === 'unconfigured' ? 'unavailable' : 'error',
    errors: [String(payload.note || payload.error || `TRUSTGAP status: ${payload.status || 'missing'}`)], payload,
  };
  if (court === 'triage' && (payload.status || !payload.incidentWindow)) return {
    kind: payload.status === 'no-signal-window' ? 'unavailable' : 'error',
    errors: [String(payload.detail || `TRIAGE status: ${payload.status || 'missing incident window'}`)], payload,
  };
  return { kind: 'complete', payload };
}

/** Collect the requested courts from the engine. Returns { court: outcome }.
 *  A configured mutation command makes a rerun fresh; without one, the
 *  precomputed report/ledger is shown as evidence (never pretend it reran). */
async function collectCourts(client, root, requested, reasons = {}, cfg, signal, onMutationProgress, options = {}) {
  const outcomes = {};
  for (const court of [...requested, ...ALL.filter(c => !requested.includes(c))]) {
    if (!requested.includes(court)) { outcomes[court] = { kind: 'not_run' }; continue; }
    if (reasons[court]) { outcomes[court] = { kind: 'unavailable', errors: [reasons[court]] }; continue; }
    if (signal?.aborted) { outcomes[court] = { kind: 'error', errors: ['Extension stopped'] }; continue; }
    try {
      let payload;
      if (court === 'witness') payload = await client.call('witness_verdict_all');
      else if (court === 'triage') payload = await client.call('triage_run');
      else {
        if (cfg.mutation.command) {
          const startedAt = Date.now();
          const before = fileStamp(cfg.mutation.absReport);
          const started = await client.call('trustgap_mutate');
          if (started.status !== 'started' || !started.job_id) { outcomes[court] = outcome(court, started); continue; }
          const jobId = started.job_id;
          const deadline = Date.now() + (cfg.mutation.timeoutSeconds || 900) * 1000 + 10_000;
          let status;
          let lastProgressIdx = 0; // track which events we have already forwarded
          do {
            if (signal?.aborted) throw new Error('Extension stopped');
            if (Date.now() > deadline) throw new Error('Mutation job timed out');
            await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? 1000));
            status = await client.call('trustgap_status', { job_id: jobId });
            // Forward any new progress events to the dashboard's mutation bus.
            if (onMutationProgress && Array.isArray(status.progress)) {
              const newEvents = status.progress.slice(lastProgressIdx);
              lastProgressIdx = status.progress.length;
              for (const ev of newEvents) onMutationProgress(jobId, ev);
            }
          } while (status.status === 'running');
          if (status.status !== 'done') { outcomes[court] = { kind: 'error', errors: [String(status.error || `Mutation status: ${status.status}`)], payload: status }; continue; }
          const commandResult = status.commandResult || status.result || {};
          if (commandResult.exitCode !== undefined && commandResult.exitCode !== 0) {
            outcomes[court] = { kind: 'error', errors: [`Mutation command exited ${commandResult.exitCode}: ${String(commandResult.stderr || commandResult.error || '').slice(0, 1000)}`], payload: status }; continue;
          }
          if (!cfg.mutation.absReport || !fs.existsSync(cfg.mutation.absReport) ||
              fs.statSync(cfg.mutation.absReport).mtimeMs < startedAt - 2000 ||
              fileStamp(cfg.mutation.absReport) === before) {
            outcomes[court] = { kind: 'error', errors: ['Mutation finished without a fresh report'], payload: status }; continue;
          }
          // Signal completion to the bus.
          if (onMutationProgress) onMutationProgress(jobId, null, 'done');
        }
        payload = await client.call('trustgap_report');
      }
      outcomes[court] = outcome(court, payload);
      outcomes[court].evidenceSource = court === 'trustgap' && !cfg.mutation.command ? 'precomputed' : 'executed';
      outcomes[court].evidenceFreshness = outcomes[court].evidenceSource === 'executed' ? 'fresh' : 'unknown';
    } catch (e) {
      outcomes[court] = { kind: 'error', errors: [String(e.message || e)] };
    }
  }
  return outcomes;
}

function fileStamp(file) {
  try { const s = fs.statSync(file); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; } catch { return null; }
}
function fingerprint(root) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(findConfigFile(root))).digest('hex'); } catch { return null; }
}
function normalized(court, result, now) {
  // The shared semantic layer owns verdict policy; orchestration owns provenance.
  const base = {
    execution: result.kind === 'complete' ? 'complete' : result.kind,
    verdict: result.kind === 'complete' ? 'inconclusive' : 'unknown',
    collectedAt: result.kind === 'not_run' || result.kind === 'queued' ? null : now,
    sourceGeneratedAt: sourceGeneratedAt(court.toLowerCase(), result.payload), evidenceSource: result.evidenceSource || 'none',
    evidenceFreshness: result.evidenceFreshness || 'unknown', payload: result.payload || null,
    errors: (result.errors || (result.error ? [result.error] : [])).map(message => ({ code: result.kind === 'unavailable' ? 'NOT_READY' : 'EXECUTION_ERROR', message: String(message), diagnosticRef: null })),
    metrics: [], progress: null,
  };
  const semantic = require('../lib/run-summary').summarizeCourt(court, base);
  return {...base, execution: semantic.execution, verdict: semantic.verdict, metrics: semantic.metrics};
}
function legacyOutcomes(run) {
  return Object.fromEntries(ALL.map(c => {
    const o = run.courts[c.toUpperCase()];
    const kind = ['not_run', 'unavailable', 'complete'].includes(o.execution) ? o.execution : 'error';
    const errors = o.errors.map(e => typeof e === 'string' ? e : e.message);
    if (o.execution === 'cancelled' && !errors.length) errors.push('Run cancelled');
    return [c, { kind, ...(o.payload ? { payload: o.payload } : {}), ...(errors.length ? { errors, error: errors.join('; ') } : {}) }];
  }));
}
function resultFor(run) {
  const outcomes = legacyOutcomes(run);
  const paths = {};
  for (const a of run.artifacts) if (a.status === 'ready') paths[`${a.kind}Path`] = a.path;
  const errors = run.requestedCourts.flatMap(c => (outcomes[c.toLowerCase()].errors || []).map(e => `${c}: ${e}`));
  const out = { courts: Object.fromEntries(run.requestedCourts.map(c => [c, outcomes[c.toLowerCase()]])),
    run, runRecord: run, runId: run.runId,
    report: { htmlPath: paths.htmlPath || null, mdPath: paths.mdPath || null, jsonPath: paths.jsonPath || null, generatedAt: run.finishedAt, runId: run.runId },
    artifactErrors: run.artifacts.filter(a => a.status === 'failed').map(a => a.error) };
  if (errors.length) out.errors = errors;
  if (run.publication.state === 'published') out.dashboardUrl = run.publication.url;
  if (run.publication.state === 'failed') out.publicationError = run.publication.error;
  return out;
}
function renderArtifacts(ctx, run, formats) {
  const dir = store.runDirectory(ctx.root, run.runId);
  store.safeDirectory(dir);
  const input = { repo: path.basename(ctx.root), repoRootAbs: ctx.root, generated: run.finishedAt, runId: run.runId };
  // Never dress an error payload up as successful evidence in the legacy renderer.
  for (const c of ALL) if (run.courts[c.toUpperCase()].execution === 'complete') input[c] = run.courts[c.toUpperCase()].payload;
  input.outcomes = legacyOutcomes(run);
  const artifacts = [];
  const add = (kind, file, err) => artifacts.push({ id: kind, artifactId: kind, runId: run.runId, kind, path: file, status: err ? 'failed' : 'ready', error: err ? String(err.message || err) : null });
  // Canonical evidence is always present even when JSON export was not selected.
  add('canonical', path.join(dir, 'run.json'));
  try { store.atomic(path.join(dir, 'gaia-input.json'), input); add('json', path.join(dir, 'gaia-input.json')); }
  catch (e) { add('json', null, e); }
  if (formats.includes('html') || formats.includes('md')) {
    try {
      const rendered = require('../lib/render').writeReports(input, dir);
      for (const kind of ['html', 'md']) {
        if (formats.includes(kind)) add(kind, rendered[`${kind}Path`]);
        else fs.rmSync(rendered[`${kind}Path`], { force: true });
      }
    } catch (e) { for (const kind of ['html', 'md']) if (formats.includes(kind)) add(kind, null, e); }
  }
  run.artifacts = artifacts;
  // Compatibility paths contain only this run. Remove obsolete exports rather
  // than combining the latest JSON with an older successful HTML report.
  for (const [kind, name] of [['json', 'gaia-input.json'], ['html', 'gaia-report.html'], ['md', 'gaia-report.md']]) {
    const dest = path.join(store.directory(ctx.root), name);
    const a = artifacts.find(a => a.kind === kind && a.status === 'ready');
    try { if (a) store.atomic(dest, fs.readFileSync(a.path, 'utf8')); else fs.rmSync(dest, { force: true }); }
    catch (e) { add(`legacy-${kind}`, dest, e); }
  }
}
function getActiveRun(root) { const entry = active.get(store.canonicalRoot(root)); return entry?.run ? clone(entry.run) : null; }
function capabilities() { return { cancellation: false, timeoutOverride: false }; }
function cancelRun(ctx, opts = {}) {
  trusted(typeof ctx === 'string' ? {root: ctx} : ctx);
  const run = getActiveRun(ctx);
  if (!run || (opts.runId && opts.runId !== run.runId)) throw error('NOT_FOUND', 'No matching active run');
  throw error('NOT_SUPPORTED', 'This engine cannot verify child-process cancellation; the run is still executing.');
}
function runCourt(ctx, opts = {}) {
  try {
    trusted(ctx);
    const root = store.canonicalRoot(ctx);
    const selected = opts.courts !== undefined ? opts.courts : opts.court !== undefined ? [opts.court] : null;
    if (!Array.isArray(selected) || !selected.length || selected.some(c => !COURTS.includes(c)) || new Set(selected).size !== selected.length) throw error('INVALID_REQUEST', `Court selection must be a non-empty distinct subset of ${COURTS.join(', ')}`);
    if (opts.outputTarget !== undefined && !['local', 'dashboard'].includes(opts.outputTarget)) throw error('INVALID_REQUEST', 'Unknown output target');
    if (opts.publishToDashboard !== undefined && typeof opts.publishToDashboard !== 'boolean') throw error('INVALID_REQUEST', 'publishToDashboard must be boolean');
    if (opts.timeoutSeconds !== undefined && (!Number.isFinite(opts.timeoutSeconds) || opts.timeoutSeconds <= 0 || opts.timeoutSeconds > 86400)) throw error('INVALID_REQUEST', 'timeoutSeconds must be a number greater than 0 and at most 86400');
    const formats = opts.formats === undefined ? ['html', 'md', 'json'] : opts.formats;
    if (!Array.isArray(formats) || formats.some(f => !['html', 'md', 'json'].includes(f))) throw error('INVALID_REQUEST', 'Invalid report formats');
    const key = opts.requestId ? `${root}:${opts.requestId}` : null;
    const signature = JSON.stringify({ selected, formats, timeout: opts.timeoutSeconds, publish: opts.publishToDashboard || opts.outputTarget === 'dashboard' });
    if (key && requests.has(key)) {
      const prior = requests.get(key);
      if (prior.signature !== signature) throw error('INVALID_REQUEST', 'Request ID was already used with different settings');
      return prior.promise;
    }
    if (active.has(root)) throw error('BUSY', 'GAIA run already in progress for this workspace');
    const plan = preflight(root);
    const timeout = plan.cfg?.mutation.timeoutSeconds || 900;
    if (opts.timeoutSeconds !== undefined && opts.timeoutSeconds !== timeout && selected.includes('TRUSTGAP')) throw error('NOT_SUPPORTED', 'The engine does not support per-run timeout overrides. Change mutation.timeoutSeconds in configuration and validate it first.');
    const runId = opts.runId || crypto.randomUUID();
    store.runDirectory(root, runId); // validates caller-provided dashboard IDs
    if (fs.existsSync(path.join(store.runDirectory(root, runId), 'run.json'))) throw error('INVALID_REQUEST', 'Run ID already exists; publish the saved run instead');
    const publish = opts.publishToDashboard === true || opts.outputTarget === 'dashboard';
    const run = { schemaVersion: 1, runId, workspaceId: projectId(require('url').pathToFileURL(root).href),
      requestedCourts: [...selected], trigger: opts.trigger || 'command', startedAt: new Date().toISOString(), finishedAt: null,
      phase: 'preflight', lifecycle: 'running', settings: { timeoutSeconds: timeout, timeoutSource: 'configuration', publishToDashboard: publish },
      provenance: { checkedOutCommit: null, branch: null, workingTreeDirty: null, configFingerprint: fingerprint(root) },
      courts: Object.fromEntries(COURTS.map(c => [c, normalized(c, {kind: selected.includes(c) ? 'queued' : 'not_run'}, null)])),
      artifacts: [], publication: {state: publish ? 'pending' : 'not_requested', url: null, error: null}, sequence: 0 };
    const entry = {run};
    active.set(root, entry); // reserve before the first await, including preflight/provenance
    const promise = execute({...ctx, root}, {...opts, formats: [...formats]}, plan, entry).finally(() => { if (active.get(root) === entry) active.delete(root); });
    entry.promise = promise;
    if (key) { requests.set(key, {signature, promise}); if (requests.size > 200) requests.delete(requests.keys().next().value); }
    return promise;
  } catch (e) { return Promise.reject(e); }
}
async function execute(ctx, opts, plan, entry) {
  const run = entry.run;
  event(ctx, run, 'accepted', {run: store.summary(run)});
  store.checkpoint(ctx.root, run);
  run.provenance = {...run.provenance, ...await gitProvenance(ctx.root)};
  const Client = ctx.McpClient || McpClient;
  let client;
  try {
    if (run.requestedCourts.some(c => !plan.reasons[c.toLowerCase()])) {
      client = new Client(ctx.enginePath, ctx.root);
      await client.start();
    }
    run.phase = 'executing';
    for (const name of run.requestedCourts) {
      const court = name.toLowerCase();
      run.courts[name].execution = 'running';
      event(ctx, run, 'court.started', {court: name});
      step(ctx, 'running', `${name} — collecting evidence`);
      // Do not abort just polling when a dashboard disconnects. Owned execution
      // settles first; a transport failure cannot erase local evidence.
      const results = await collectCourts(client, ctx.root, [court], plan.reasons, plan.cfg, null, (jobId, ev, signal) => {
        try { ctx.emitMutation?.(ev, signal); ctx.onMutationProgress?.(jobId, ev, signal, run.runId); } catch {}
        event(ctx, run, 'court.progress', {court: name, event: ev, signal});
      }, {pollIntervalMs: ctx.pollIntervalMs});
      run.courts[name] = normalized(name, results[court], new Date().toISOString());
      store.checkpoint(ctx.root, run);
      event(ctx, run, 'court.settled', {court: name, outcome: run.courts[name]});
      step(ctx, run.courts[name].execution === 'error' ? 'error' : 'success', `${name} — ${run.courts[name].execution}`);
    }
  } catch (e) {
    for (const c of run.requestedCourts) if (['queued', 'running'].includes(run.courts[c].execution)) run.courts[c] = normalized(c, {kind: 'error', errors: [String(e.message || e)]}, new Date().toISOString());
  } finally { if (client) await client.dispose(); }
  run.phase = 'saving';
  run.finishedAt = new Date().toISOString();
  run.lifecycle = 'completed';
  event(ctx, run, 'saving');
  renderArtifacts(ctx, run, opts.formats);
  run.phase = 'settled';
  store.saveRun(ctx.root, run);
  if (run.settings.publishToDashboard) {
    const published = await publishRun(ctx, {runId: run.runId, session: opts.session, existingRun: opts.existingRun});
    run.publication = published.publication;
  }
  event(ctx, run, 'settled', {run: store.summary(run)});
  return resultFor(clone(run));
}
async function publishRun(ctx, {runId, session, existingRun} = {}) {
  trusted(ctx);
  const root = store.canonicalRoot(ctx);
  const key = `${root}:${runId}`;
  if (publications.has(key)) return publications.get(key);
  const promise = (async () => {
    let run = store.readRun(root, runId);
    if (run.publication.state === 'published') return run;
    run = store.updatePublication(root, runId, {...run.publication, state: 'publishing', error: null});
    event({...ctx, root}, run, 'publication.started');
    try {
      const dashboard = ctx.dashboardCmd || require('./dashboard');
      if (typeof dashboard.publishEvidence !== 'function') throw error('NOT_SUPPORTED', 'Dashboard transport must implement publishEvidence; refusing to rerun courts during publication');
      const published = await dashboard.publishEvidence(ctx.vscode, {root, enginePath: ctx.enginePath,
        historyDir: ctx.historyDir || (ctx.globalStoragePath ? path.join(ctx.globalStoragePath, 'dashboard-history') : path.join(store.directory(root), 'dashboard-history')),
        run, session, existingRun, onError: e => { try { ctx.emit?.({level: 'error', text: `dashboard: ${e.message}`}); } catch {} }});
      run = store.updatePublication(root, runId, {state: 'published', url: published.url, error: null});
    } catch (e) {
      run = store.updatePublication(root, runId, {state: 'failed', url: null, error: String(e.message || e)});
    }
    event({...ctx, root}, run, 'publication.settled', {publication: run.publication});
    return run;
  })().finally(() => publications.delete(key));
  publications.set(key, promise);
  return promise;
}
module.exports = { COURTS, runCourt, publishRun, cancelRun, capabilities, getActiveRun, onRunEvent,
  listRuns: store.listRuns, readRun: store.readRun, selectRun: store.selectRun, selectedRun: store.selectedRun,
  preflight, collectCourts, outcome, gitProvenance, legacyOutcomes, resultFor };

'use strict';
/**
 * src/actions.js — TRIUMPH action logic, extracted from the old
 * src/extension.js cmd* command handlers so the persistent panel (and the
 * thin command wrappers) can call the same code.
 *
 * NO vscode.window.* calls here (and no `require('vscode')` at all) — every
 * VS-Code-specific capability comes in through `ctx`:
 *   ctx = { root, enginePath, emit, emitStep, emitMutation, globalStoragePath, openExternal, vscode }
 *     root:             workspace root (string) or null/undefined
 *     enginePath:       resolved path to court.js
 *     emit({level, text}): stream a raw console-log line ('info'|'warn'|'error')
 *     emitStep({status, text}): push an agent-activity feed entry
 *                       ('running'|'success'|'warn'|'error'|'pending'). Panel
 *                       mirrors steps into the raw log; actions never have to.
 *     emitMutation(event, signal): live SPLITBRAIN progress events
 *                       (lib/mutation-progress.js shape); signal 'done' ends the run.
 *     globalStoragePath: extension global storage dir (dashboard publish only)
 *     openExternal(url): open a URL in the user's browser (dashboard publish only)
 *     vscode:           the real `vscode` module, forwarded through to
 *                        dashboardCmd.runAndPublish — supplied by panel.js's
 *                        _actionsCtx(); actions.js itself never requires 'vscode'.
 * ctx.McpClient / ctx.dashboardCmd may be injected (tests) — default to the
 * real modules otherwise.
 *
 * Every action throws Error on failure, including Error('Open a workspace
 * folder first.') when ctx.root is falsy. Callers (panel.js's runJob) turn
 * that into an `error` message.
 */

const path = require('path');
const fs = require('fs');

const DefaultMcpClient = require('./mcp-client').McpClient;
const DefaultDashboardCmd = require('./dashboard');

const COURTS = ['REDLINE', 'SPLITBRAIN', 'WARPATH'];
const CONFIG_NAMES = ['.triumph.yml', '.triumph.yaml', '.triumph.json'];
const REPORT_FORMATS = ['html', 'md', 'json'];

function emit(ctx, level, text) {
  if (ctx && typeof ctx.emit === 'function') {
    try { ctx.emit({ level, text }); } catch { /* logging must never throw */ }
  }
}

/** Agent-activity feed entry. Falls back to the raw log when the host
 *  provides no step channel (CLI callers, older panel). */
function step(ctx, status, text) {
  if (ctx && typeof ctx.emitStep === 'function') {
    try { ctx.emitStep({ status, text }); return; } catch { /* fall through to raw log */ }
  }
  emit(ctx, status === 'error' ? 'error' : status === 'warn' ? 'warn' : 'info', text);
}

function emitMutation(ctx, event, signal) {
  if (ctx && typeof ctx.emitMutation === 'function') {
    try { ctx.emitMutation(event, signal); } catch { /* progress is best-effort */ }
  }
}

function requireRoot(ctx) {
  const root = ctx && ctx.root;
  if (!root) throw new Error('Open a workspace folder first.');
  return root;
}

function findConfigPath(root) {
  for (const name of CONFIG_NAMES) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Read the mutation timeout from .triumph.yml (0 when unset/unreadable). */
function mutationTimeoutSeconds(root) {
  try {
    const { loadConfig } = require('../lib/config');
    const cfg = loadConfig(root);
    return (cfg.mutation && cfg.mutation.timeoutSeconds) || 0;
  } catch { return 0; }
}

/** Lightweight existence check (no auto-detect) for state refresh. */
function configStatus(root) {
  if (!root) return { exists: false, path: null, notes: [] };
  const p = findConfigPath(root);
  return { exists: Boolean(p), path: p, notes: [] };
}

/** Same as old cmdDetectConfig, minus opening the file in an editor. */
async function detectConfig(ctx) {
  const root = requireRoot(ctx);
  const { detect, toYaml } = require('../lib/detect');
  const { config, notes } = detect(root);
  const dest = path.join(root, '.triumph.yml');
  const header = '# TRIUMPH 3-court repo adapter. See schemas/triumph-config.schema.json in the extension.\n';
  fs.writeFileSync(dest, header + toYaml(config) + '\n', 'utf8');
  step(ctx, 'success', 'Loaded detection heuristics — .triumph.yml written');
  emit(ctx, 'info', `.triumph.yml written. ${notes.join(' · ')}`);
  return { path: dest, notes };
}

/** Same as old cmdInstallCourts (minus the quickpick — host is given). */
async function installCourts(ctx, { host } = {}) {
  const root = requireRoot(ctx);
  const { HOSTS, installHost } = require('../lib/hosts');

  const hasConfig = Boolean(findConfigPath(root));
  if (!hasConfig) {
    step(ctx, 'running', 'No .triumph.yml — auto-detecting first');
    await detectConfig(ctx);
  }

  const hosts = host === 'all' ? Object.keys(HOSTS) : [host];
  const written = [];
  const errors = [];
  for (const h of hosts) {
    try {
      const r = installHost(h, root);
      written.push(...r.files.map((f) => path.relative(root, f)));
      step(ctx, 'success', `${h}: courts installed`);
      emit(ctx, 'info', `${h}: installed`);
    } catch (e) {
      errors.push({ host: h, message: e.message });
      step(ctx, 'error', `${h}: ${e.message}`);
      emit(ctx, 'error', `TRIUMPH ${h}: ${e.message}`);
    }
  }
  const extVersion = require('../package.json').version;
  emit(ctx, 'info', `files written: ${written.join(', ') || '(none)'}`);
  emit(ctx, 'info',
    `TRIUMPH courts installed (${hosts.join(', ')}) — extension v${extVersion}. ${written.length} files written. ` +
    `If you expected skills/rules/modes and only see agents+mcp.json, reload the window (Developer: Reload Window) so the host picks up the current extension build.`);
  step(ctx, errors.length ? 'warn' : 'success',
    `Install complete — ${written.length} files written (${hosts.join(', ')})`);
  return { hosts, files: written, errors };
}

// ---------------------------------------------------------------------------
// Court execution
// ---------------------------------------------------------------------------

/**
 * Run REDLINE: wall verification, then every clause witness suite.
 * Returns { kind: 'complete', payload } | { kind: 'error', error }.
 */
async function runRedline(ctx, client) {
  step(ctx, 'running', 'REDLINE — verifying testimony wall');
  const payload = await client.call('redline_verdict_all');
  const s = payload && payload.summary;
  if (!s) {
    step(ctx, 'error', 'REDLINE returned no clause summary');
    return { kind: 'error', error: 'REDLINE produced no verdict summary', payload };
  }
  step(ctx, 'success', `REDLINE clause tests complete — ${s.green} green / ${s.red} red / ${s.yellow} yellow of ${s.total}`);
  if (s.red > 0) step(ctx, 'warn', `${s.red} clause${s.red === 1 ? '' : 's'} red — witness failures are evidence, not noise`);
  return { kind: 'complete', payload };
}

/**
 * Run SPLITBRAIN. With a configured mutation.command this is async:
 * splitbrain_mutate starts the runner and splitbrain_status is polled until
 * the job settles, streaming live progress through ctx.emitMutation.
 * Without a command, the precomputed report/ledger is read directly.
 */
async function runSplitbrain(ctx, client, { timeoutSeconds } = {}) {
  const McpClientCtor = (ctx && ctx.McpClient) || DefaultMcpClient;
  const startedAt = Date.now();
  step(ctx, 'running', 'SPLITBRAIN — starting mutation runner');
  const start = await client.call('splitbrain_mutate');
  if (start.status === 'started' && start.job_id) {
    const jobId = start.job_id;
    step(ctx, 'success', `Mutation job ${jobId} started — streaming verdicts`);
    const cfgTimeout = mutationTimeoutSeconds(ctx.root);
    const deadline = startedAt + (timeoutSeconds || cfgTimeout || 900) * 1000 + 10_000;
    let status;
    let lastProgressIdx = 0;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      status = await client.call('splitbrain_status', { job_id: jobId });
      const progress = Array.isArray(status.progress) ? status.progress : [];
      const fresh = progress.slice(lastProgressIdx);
      lastProgressIdx = progress.length;
      for (const ev of fresh) emitMutation(ctx, ev);
      if (status.status !== 'running') break;
      if (Date.now() > deadline) {
        step(ctx, 'error', 'Mutation job timed out — partial evidence only');
        return { kind: 'error', error: 'Mutation job timed out', payload: status };
      }
    }
    emitMutation(ctx, null, 'done');
    if (status.status !== 'done') {
      const detail = status.error || `mutation status: ${status.status}`;
      step(ctx, 'error', `Mutation job failed — ${detail}`);
      return { kind: 'error', error: detail, payload: status };
    }
    step(ctx, 'success', 'Mutation run finished — deriving trust gap');
    const payload = await client.call('splitbrain_trustgap');
    stepSplitbrainSummary(ctx, payload);
    return { kind: 'complete', payload };
  }
  if (start.status === 'busy') {
    step(ctx, 'warn', start.error || 'A mutation job is already running in this engine');
  }
  // Unconfigured / busy / skipped: the honest answer is the precomputed
  // report or TrustGap ledger — never pretend a rerun happened.
  step(ctx, 'running', 'Reading precomputed mutation evidence (report / TrustGap ledger)');
  const payload = await client.call('splitbrain_trustgap');
  stepSplitbrainSummary(ctx, payload);
  return { kind: 'complete', payload };
}

function stepSplitbrainSummary(ctx, payload) {
  if (payload && payload.trustGap != null) {
    const score = payload.honestMutationScore != null ? `, honest mutation ${Math.round(payload.honestMutationScore * 100)}%` : '';
    step(ctx, 'success', `SPLITBRAIN complete — trust gap ${payload.trustGap}${score}`);
  } else if (payload && payload.status && payload.status !== 'ok') {
    step(ctx, 'warn', `SPLITBRAIN: ${payload.note || payload.status}`);
  } else {
    step(ctx, 'success', 'SPLITBRAIN complete');
  }
}

/** Run WARPATH: incident forensics triage over the fixtures. */
async function runWarpath(ctx, client) {
  step(ctx, 'running', 'WARPATH — triaging deploys, metrics and log window');
  const payload = await client.call('warpath_triage');
  if (payload && payload.incidentWindow) {
    step(ctx, 'warn', `WARPATH incident window ${payload.incidentWindow}${payload.suspect && payload.suspect.id ? ` — suspect ${payload.suspect.id}` : ''}`);
  } else if (payload && payload.status) {
    step(ctx, 'warn', `WARPATH: ${payload.detail || payload.status}`);
  } else {
    step(ctx, 'success', 'WARPATH complete — no incident window detected');
  }
  return { kind: 'complete', payload };
}

/**
 * Write local report artifacts for the courts that actually ran.
 * Honours formats ('html' | 'md' | 'json'); the JSON input is always written
 * when 'json' is selected OR when a dashboard publish will need it. Returns
 * null when nothing ran.
 */
function writeLocalReports(ctx, results, formats) {
  const input = { repo: path.basename(ctx.root), repoRootAbs: ctx.root, generated: new Date().toISOString() };
  let any = false;
  if (results.redline && results.redline.kind === 'complete') { input.redline = results.redline.payload; any = true; }
  if (results.splitbrain && results.splitbrain.kind === 'complete') { input.splitbrain = results.splitbrain.payload; any = true; }
  if (results.warpath && results.warpath.kind === 'complete') { input.warpath = results.warpath.payload; any = true; }
  if (!any) return null;
  const outDir = path.join(ctx.root, 'reports', 'triumph');
  fs.mkdirSync(outDir, { recursive: true });
  const wanted = new Set(formats && formats.length ? formats : REPORT_FORMATS);
  let htmlPath = null;
  let mdPath = null;
  if (wanted.has('html') || wanted.has('md')) {
    const written = require('../lib/render').writeReports(input, outDir);
    if (wanted.has('html')) htmlPath = written.htmlPath; else fs.rmSync(written.htmlPath, { force: true });
    if (wanted.has('md')) mdPath = written.mdPath; else fs.rmSync(written.mdPath, { force: true });
  }
  let jsonPath = null;
  if (wanted.has('json')) {
    jsonPath = path.join(outDir, 'triumph-input.json');
    fs.writeFileSync(jsonPath, JSON.stringify(input, null, 2) + '\n', 'utf8');
  }
  step(ctx, 'success', `Report written — ${[htmlPath && 'HTML', mdPath && 'Markdown', jsonPath && 'JSON'].filter(Boolean).join(' + ') || 'no artifacts'}`);
  return { htmlPath, mdPath, jsonPath, generatedAt: input.generated };
}

/**
 * Run one or more courts. `court` (legacy single) and `courts` (multi-select
 * panel) are both accepted; the panel order is preserved.
 *
 * opts.outputTarget: 'local' (default) writes report artifacts under
 * reports/triumph/; 'dashboard' additionally publishes all three courts and
 * keeps the dashboard session alive for browser "Run again".
 *
 * Returns { courts: { REDLINE?, SPLITBRAIN?, WARPATH? }, dashboardUrl?,
 *           report?, errors? } — per-court values are
 *           { kind: 'complete'|'error', payload?, error? }.
 */
async function runCourt(ctx, { court, courts, outputTarget, timeoutSeconds, formats } = {}) {
  const root = requireRoot(ctx);
  let selected = courts !== undefined ? courts : (court !== undefined ? [court] : null);
  if (!Array.isArray(selected) || !selected.length || selected.some((c) => !COURTS.includes(c)) ||
      new Set(selected).size !== selected.length) {
    throw new Error(`Court selection must be a non-empty distinct subset of ${COURTS.join(', ')}`);
  }
  const target = outputTarget === 'dashboard' ? 'dashboard' : 'local';

  step(ctx, 'success', `Loaded .triumph.yml — ${selected.join(' + ')} queued`);

  const results = {};
  const errors = [];
  const McpClientCtor = (ctx && ctx.McpClient) || DefaultMcpClient;
  const client = new McpClientCtor(ctx.enginePath, root);
  try {
    await client.start();
    for (const c of selected) {
      try {
        if (c === 'REDLINE') results.redline = await runRedline(ctx, client);
        else if (c === 'SPLITBRAIN') results.splitbrain = await runSplitbrain(ctx, client, { timeoutSeconds });
        else results.warpath = await runWarpath(ctx, client);
      } catch (e) {
        const message = e && e.message ? e.message : String(e);
        results[c.toLowerCase()] = { kind: 'error', error: message };
        errors.push(`${c}: ${message}`);
        step(ctx, 'error', `${c} failed — ${message}`);
      }
    }
  } finally {
    client.dispose();
  }

  const out = { courts: {} };
  for (const c of selected) out.courts[c] = results[c.toLowerCase()];

  if (target === 'local') {
    const report = writeLocalReports(ctx, results, formats);
    if (report) out.report = report;
  } else {
    step(ctx, 'running', 'Publishing all three courts to the dashboard');
    const dashboardCmdMod = (ctx && ctx.dashboardCmd) || DefaultDashboardCmd;
    const historyDir = path.join(ctx.globalStoragePath, 'dashboard-history');
    fs.mkdirSync(historyDir, { recursive: true });
    try {
      const { url } = await dashboardCmdMod.runAndPublish(ctx.vscode, {
        root,
        enginePath: ctx.enginePath,
        requested: ['redline', 'splitbrain', 'warpath'],
        existingRun: null,
        historyDir,
        openExternal: null, // the user opens the dashboard explicitly from its tab
        onError: (e) => emit(ctx, 'error', 'dashboard: ' + (e && e.message ? e.message : String(e))),
      });
      out.dashboardUrl = url;
      step(ctx, 'success', `Published — dashboard live at ${url}`);
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      errors.push('dashboard: ' + message);
      step(ctx, 'error', `Dashboard publish failed — ${message}`);
    }
  }

  if (errors.length) out.errors = errors;
  step(ctx, errors.length ? 'warn' : 'success',
    errors.length ? `Run finished with ${errors.length} failure${errors.length === 1 ? '' : 's'}` : 'Run complete — all selected courts settled');
  return out;
}

/** Full three-court report (same engine calls as old cmdGenerateReport). */
async function generateReport(ctx, { formats } = {}) {
  const root = requireRoot(ctx);
  const McpClientCtor = (ctx && ctx.McpClient) || DefaultMcpClient;
  const client = new McpClientCtor(ctx.enginePath, root);
  try {
    await client.start();
    const input = { repo: path.basename(root), repoRootAbs: root, generated: new Date().toISOString() };
    input.redline = (await runRedline(ctx, client)).payload || null;
    input.splitbrain = (await runSplitbrain(ctx, client, {})).payload || null;
    input.warpath = (await runWarpath(ctx, client)).payload || null;

    const outDir = path.join(root, 'reports', 'triumph');
    fs.mkdirSync(outDir, { recursive: true });
    const wanted = new Set(formats && formats.length ? formats : REPORT_FORMATS);
    // triumph-input.json is the scorecard's data source — always written.
    fs.writeFileSync(path.join(outDir, 'triumph-input.json'), JSON.stringify(input, null, 2) + '\n', 'utf8');
    let htmlPath = null;
    let mdPath = null;
    if (wanted.has('html') || wanted.has('md')) {
      const written = require('../lib/render').writeReports(input, outDir);
      if (wanted.has('html')) htmlPath = written.htmlPath; else fs.rmSync(written.htmlPath, { force: true });
      if (wanted.has('md')) mdPath = written.mdPath; else fs.rmSync(written.mdPath, { force: true });
    }
    step(ctx, 'success', 'Report written — HTML + Markdown + JSON input');
    emit(ctx, 'info', `report written: ${htmlPath || '(no html)'}, ${mdPath || '(no md)'}`);
    return { htmlPath, mdPath, generatedAt: input.generated };
  } finally {
    client.dispose();
  }
}

/**
 * Stat reports/triumph/triumph-report.html (+.md) → summary/metadata, or
 * null if no report has ever been generated for this root. When
 * triumph-input.json is readable its per-court payloads are exposed verbatim
 * so the panel can render the verdict scorecard (REDLINE pills, SPLITBRAIN
 * trust gap, WARPATH incident status) without re-running anything.
 */
function findLastReport(root) {
  if (!root) return null;
  const outDir = path.join(root, 'reports', 'triumph');
  const htmlPath = path.join(outDir, 'triumph-report.html');
  const inputPath = path.join(outDir, 'triumph-input.json');
  const mdPath = path.join(outDir, 'triumph-report.md');
  const htmlExists = fs.existsSync(htmlPath);
  const inputExists = fs.existsSync(inputPath);
  if (!htmlExists && !inputExists) return null;
  // The JSON input is the freshest artifact when both exist (runCourt's
  // local target writes it last); the HTML mtime otherwise.
  const stat = fs.statSync(inputExists ? inputPath : htmlPath);
  let summary = null;
  let redline = null;
  let splitbrain = null;
  let warpath = null;
  try {
    const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    if (raw && typeof raw === 'object') {
      redline = raw.redline || null;
      splitbrain = raw.splitbrain || null;
      warpath = raw.warpath || null;
      if (redline && redline.summary) summary = redline.summary;
    }
  } catch { /* no triumph-input.json, or unparsable — per-court data stays null */ }
  return {
    htmlPath: htmlExists ? htmlPath : null,
    mdPath: fs.existsSync(mdPath) ? mdPath : null,
    generatedAt: stat.mtime.toISOString(),
    summary,
    redline,
    splitbrain,
    warpath,
  };
}

/** Same core as old cmdDashboardRun (progress notification lives in panel.js/extension.js). */
async function dashboardRun(ctx) {
  const root = requireRoot(ctx);
  const dashboardCmdMod = (ctx && ctx.dashboardCmd) || DefaultDashboardCmd;
  const historyDir = path.join(ctx.globalStoragePath, 'dashboard-history');
  fs.mkdirSync(historyDir, { recursive: true });
  step(ctx, 'running', 'Running all three courts and publishing to the dashboard');
  emit(ctx, 'info', 'publishing…');
  const { url } = await dashboardCmdMod.runAndPublish(ctx.vscode, {
    root,
    enginePath: ctx.enginePath,
    requested: ['redline', 'splitbrain', 'warpath'],
    existingRun: null,
    historyDir,
    openExternal: ctx.openExternal,
    // The session (and its "Run again" polling loop) outlives this job, so
    // a browser-triggered failure after this call returns must still reach
    // the panel log — not just failures from this dashboardRun itself.
    onError: (e) => emit(ctx, 'error', 'dashboard: ' + (e && e.message ? e.message : String(e))),
  });
  step(ctx, 'success', `Published — dashboard live at ${url}`);
  emit(ctx, 'info', `published: ${url}`);
  return { url };
}

module.exports = {
  COURTS,
  REPORT_FORMATS,
  configStatus,
  detectConfig,
  installCourts,
  runCourt,
  generateReport,
  findLastReport,
  dashboardRun,
};

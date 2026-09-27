'use strict';
/**
 * src/panel.js — GaiaPanelProvider: persistent Webview View for the
 * Gaia activity-bar container (`gaia.panel`).
 *
 * The provider owns state, logging, the single-flight job slot and message
 * plumbing. `handleMessage` dispatches job-type messages into src/actions.js
 * (constructed into the provider via `deps.actions`) under the single-flight
 * job slot, and handles the non-job message types (openConfig,
 * openLastReport, dashboardOpen, dashboardStatus) directly — those need
 * vscode.window/vscode.env, which src/actions.js deliberately avoids.
 *
 * See the contract for the message protocol (C), state shape (D) and CSP (E).
 */

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { HOSTS } = require('../lib/hosts');
const { TYPES, decodeMessage, allowedDashboardUrl } = require('./panel-protocol');
const { summarizeRun, summarizeCourt } = require('../lib/run-summary');

const LOG_LIMIT = 200;
const STEP_LIMIT = 200;
const FALLBACK_COURTS = ['WITNESS', 'TRUSTGAP', 'TRIAGE'];

const WHITELIST = new Set(Object.keys(TYPES));

// The single job slot is shared by these five message types (section D).
const JOB_TYPES = new Set(['detectConfig', 'installCourts', 'runCourt', 'generateReport', 'dashboardRun']);

/** Map a raw mutation-runner progress event (lib/mutation-progress.js shape)
 *  to an agent-feed step status. Kills are successes, survivors/no-coverage
 *  are warnings, timeouts are errors, everything else is a running update. */
function mutationStepStatus(event) {
  if (!event || typeof event !== 'object') return 'running';
  if (event.error) return 'error';
  const v = typeof event.verdict === 'string' ? event.verdict.toLowerCase() : '';
  if (/^timed\s*out/.test(v) || /timeout/.test(v)) return 'error';
  if (/^killed/.test(v)) return 'success';
  if (/^(survived|no coverage)/.test(v)) return 'warn';
  return 'running';
}

function nonce() {
  return crypto.randomBytes(16).toString('base64');
}

function hostLabels() {
  return Object.fromEntries(Object.keys(HOSTS).map((id) => [id, HOSTS[id].name]));
}

/** Best-effort call: never let a host-API quirk crash panel bookkeeping. */
function safe(fn, fallback) {
  try { return fn(); } catch (e) {
    console.error('[gaia] safe(): swallowed exception:', e && e.message ? e.message : e);
    return fallback;
  }
}

class GaiaPanelProvider {
  /**
   * @param {object} deps
   * @param {object} [deps.actions] src/actions.js module (subtask 4). May be
   *   absent for now — handlers stay stubs until it is provided.
   * @param {() => (string|null)} deps.repoRoot primary workspace root, or null.
   * @param {() => string} deps.enginePath resolved path to court.js.
   * @param {object} [deps.dashboardCmd] src/dashboard.js module.
   * @param {object} [deps.context] vscode.ExtensionContext.
   * @param {() => void} [deps.onDashboardChange] called after a dashboardRun
   *   job settles (success or failure), regardless of trigger, so the
   *   extension host's status bar stays in sync (contract H4).
   */
  constructor({ actions, repoRoot, enginePath, dashboardCmd, context, onDashboardChange, onCourtResult, onJobChange, onMutation } = {}) {
    this.actions = actions || null;
    this.repoRoot = repoRoot;
    this.enginePath = enginePath;
    this.dashboardCmd = dashboardCmd || null;
    this.context = context || null;
    this.onDashboardChange = typeof onDashboardChange === 'function' ? onDashboardChange : null;
    this.onCourtResult = typeof onCourtResult === 'function' ? onCourtResult : null;
    this.onJobChange = typeof onJobChange === 'function' ? onJobChange : null;
    this.onMutation = typeof onMutation === 'function' ? onMutation : null;
    this.extensionUri = this.context && this.context.extensionUri;

    this._view = null;
    this._ready = false;
    this._pendingReveal = null;
    this._disposables = [];
    this._reportPanel = null;
    this._requests = new Map();
    this._historyLimit = 10;
    this._output = safe(() => vscode.window.createOutputChannel('GAIA'), null);

    this.state = {
      workspace: { root: null, name: null },
      config: { exists: false, path: null, notes: [] },
      hosts: { available: ['all', ...Object.keys(HOSTS)], labels: hostLabels(), default: null },
      protocolVersion: 2,
      readiness: null, activeRun: null, selectedRun: null, recentRuns: [],
      configPreview: null, installPreview: null,
      capabilities: { cancellation: false },
      lastReport: null,
      dashboard: { connected: false, url: null },
      job: null,
      log: [],
      steps: [], // agent activity feed entries ({ts,status,text})
      mutations: null, // live mutation metrics ({tested,total,killed,killRate,line,status}) or null when idle
    };

    this._refreshWorkspace();
    this._refreshHostsDefault();
    this._refreshDashboardConnected();
    if (this.actions && typeof this.actions.onRunEvent === 'function') {
      this._disposables.push(this.actions.onRunEvent(event => this._onRunEvent(event)));
    } else {
      this._disposables.push(require('./run-coordinator').onRunEvent(event => this._onRunEvent(event)));
    }

    // No polling: dashboard.js notifies on session start / server exit /
    // stopAll. Push the change into panel state (and log it) as it happens,
    // instead of only refreshing after a dashboardRun job settles.
    if (this.dashboardCmd && typeof this.dashboardCmd.onConnectionChange === 'function') {
      this._connectionSub = this.dashboardCmd.onConnectionChange((connected) => {
        this._onConnectionChange(connected);
      });
    } else {
      this._connectionSub = null;
    }
  }

  /** Called with isConnected()'s latest value on every dashboard connection
   * change. Only logs/pushes state when the value actually changed. */
  _onConnectionChange(connected) {
    const was = this.state.dashboard.connected;
    if (connected === was) return;
    this.state.dashboard.connected = connected;
    this.log(connected ? 'info' : 'warn', connected ? 'dashboard connected' : 'dashboard disconnected');
    this.postState();
  }

  // --- initial-state helpers (real data; everything else stays default) ----

  _refreshWorkspace() {
    const root = safe(() => (typeof this.repoRoot === 'function' ? this.repoRoot() : null), null);
    const previous = this.state.workspace.root;
    this.state.workspace = { root, workspaceId: root ? safe(() => fs.realpathSync(root), root) : null, name: root ? path.basename(root) : null, trusted: vscode.workspace.isTrusted !== false };
    if (previous !== root) {
      this.state.lastReport = null; this.state.selectedRun = null; this.state.activeRun = null;
      this.state.recentRuns = []; this.state.dashboard = { connected: false, url: null };
      this.state.steps = []; this.state.mutations = null;
      this.state.configPreview = null; this.state.installPreview = null;
      this._historyLimit = 10;
    }
  }

  _refreshHostsDefault() {
    const def = safe(() => vscode.workspace.getConfiguration('gaia').get('defaultHost'), null);
    this.state.hosts.default = def && (def === 'all' || HOSTS[def]) ? def : null;
  }

  _refreshDashboardConnected() {
    const connected = safe(() => Boolean(this.dashboardCmd && this.dashboardCmd.isConnected()), false);
    this.state.dashboard.connected = connected;
  }

  /** Refresh every "live" piece of state. Called at construction AND on
   * every `ready` (bug fix: state used to be computed only once, at
   * construction, so a webview reload never saw config/report changes that
   * happened while it was torn down). */
  _refreshAll() {
    this._refreshWorkspace();
    this._refreshHostsDefault();
    this._refreshDashboardConnected();
    const root = this.state.workspace.root;
    if (this.actions) {
      this.state.config = safe(() => this.actions.configStatus(root), this.state.config);
      this.state.lastReport = safe(() => this.actions.findLastReport(root), this.state.lastReport);
    }
    this._refreshEvidence();
    this.state.readiness = { courts: this.state.config.readiness || {}, timeoutSeconds: this.state.config.timeoutSeconds || 900, timeoutSource: this.state.config.timeoutSource || 'configuration' };
  }

  _refreshEvidence() {
    const root = this.state.workspace.root;
    if (!root) return;
    const store = require('../lib/run-store');
    const coordinator = require('./run-coordinator');
    this.state.capabilities = coordinator.capabilities();
    const active = safe(() => coordinator.getActiveRun(root), null);
    this.state.activeRun = active ? this._presentRun(active) : null;
    const selected = safe(() => store.selectedRun(root), null);
    this.state.selectedRun = selected ? this._presentRun(selected) : null;
    this.state.recentRuns = safe(() => store.listRuns(root, { limit: this._historyLimit }), []);
    this.state.recentRunsHasMore = safe(() => store.listRuns(root, { limit: 1, offset: this._historyLimit }).length > 0, false);
    const latest = safe(() => store.latestRun(root), null);
    this.state.latestRun = latest ? this._presentRun(latest) : null;
    if (selected) this.state.dashboard.url = selected.publication?.state === 'published' ? selected.publication.url : null;
    if (this.onCourtResult) for (const court of FALLBACK_COURTS) {
      safe(() => this.onCourtResult(court, (active || selected)?.courts[court] || { execution: 'not_run', payload: null }), undefined);
    }
  }

  _presentRun(record) {
    const summary = summarizeRun(record);
    const courts = {};
    for (const [court, value] of Object.entries(summary.courts)) {
      const { payload, ...compact } = value;
      compact.findings = (value.findings || []).slice(0, 20).map(f => {
        const source = f.payload || f;
        return { clause: f.clause || source.clause || null, status: f.status || source.status || null,
          detail: String(source.reason || source.detail || source.note || source.description || '').slice(0, 2000),
          passed: source.passed ?? null, failed: source.failed ?? null, total: source.total ?? null };
      });
      if (compact.clauses) compact.clauses = compact.findings;
      compact.progress = record.courts?.[court]?.progress || null;
      courts[court] = compact;
    }
    return { ...require('../lib/run-store').summary(record), courts, summary: { ...summary, courts }, label: summary.label, tone: summary.tone };
  }

  _onRunEvent(event) {
    if (!event || !this.state.workspace.root) return;
    const root = safe(() => fs.realpathSync(this.state.workspace.root), this.state.workspace.root);
    if (event.root !== root) return;
    if (!this._runSequences) this._runSequences = new Map();
    if (event.sequence <= (this._runSequences.get(event.runId) || 0)) return;
    this._runSequences.set(event.runId, event.sequence);
    if (this._runSequences.size > 100) this._runSequences.delete(this._runSequences.keys().next().value);
    this._refreshEvidence();
    if (event.kind === 'settled') {
      this.state.activeRun = null;
      safe(() => require('../lib/run-store').selectRun(root, event.runId), null);
      this._refreshEvidence();
      this.state.activeRun = null;
      this.state.lastReport = safe(() => this.actions.findLastReport(root), this.state.lastReport);
      if (this.onJobChange) this.onJobChange(null);
    } else if (this.state.activeRun && this.onJobChange) {
      this.onJobChange({ label: 'Running ' + this.state.activeRun.requestedCourts.join(' + '), startedAt: this.state.activeRun.startedAt });
    }
    // Full payloads stay on disk. The sidebar receives bounded summaries only.
    this._post({ type: 'run.event', runId: event.runId, sequence: event.sequence, kind: event.kind, payload: { phase: event.phase, court: event.payload?.court } });
    this.postState();
  }

  /** Build the ctx object src/actions.js functions expect. */
  _actionsCtx() {
    const root = safe(() => (typeof this.repoRoot === 'function' ? this.repoRoot() : null), null);
    const enginePath = safe(() => (typeof this.enginePath === 'function' ? this.enginePath() : null), null);
    return {
      root,
      enginePath,
      trusted: vscode.workspace.isTrusted !== false,
      trigger: 'sidebar',
      onRunEvent: (event) => this._onRunEvent(event),
      emit: (e) => this.log((e && e.level) || 'info', e && e.text),
      // Steps feed the agent-activity timeline AND mirror into the raw
      // console log so the audit trail never loses a narrative line.
      emitStep: (step) => {
        const entry = this.postStep(step);
        if (entry) this.log(entry.status === 'error' ? 'error' : entry.status === 'warn' ? 'warn' : 'info', entry.text);
      },
      emitMutation: (event, signal) => {
        this._onMutationEvent(event, signal);
        if (this.onMutation) safe(() => this.onMutation(event, signal), undefined);
      },
      globalStoragePath: this.context && this.context.globalStorageUri ? this.context.globalStorageUri.fsPath : null,
      openExternal: (url) => {
        if (!allowedDashboardUrl(url)) throw new Error('Refusing an invalid local dashboard URL.');
        return vscode.env.openExternal(vscode.Uri.parse(url));
      },
      vscode,
    };
  }

  /** Open (or reuse) the singleton 'gaiaReport' WebviewPanel. */
  _openReportPanel(htmlPath) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    if (this._reportPanel) {
      const ok = safe(() => {
        this._reportPanel.webview.html = html;
        this._reportPanel.reveal(vscode.ViewColumn.One);
        return true;
      }, false);
      if (ok) return;
      this._reportPanel = null; // stale reference (panel disposed without firing onDidDispose)
    }
    const panel = vscode.window.createWebviewPanel(
      'gaiaReport', 'Gaia 3-Court Report', vscode.ViewColumn.One, { enableScripts: false, localResourceRoots: [] }
    );
    panel.webview.html = html;
    this._reportPanel = panel;
    if (typeof panel.onDidDispose === 'function') {
      panel.onDidDispose(() => { if (this._reportPanel === panel) this._reportPanel = null; });
    }
  }

  // --- webview lifecycle -----------------------------------------------------

  /** vscode.WebviewViewProvider#resolveWebviewView */
  resolveWebviewView(webviewView) {
    this._view = webviewView;
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: this.extensionUri ? [vscode.Uri.joinPath(this.extensionUri, 'media')] : undefined,
    };
    webview.html = this._html(webview);

    this._disposables.push(webview.onDidReceiveMessage((msg) => {
      Promise.resolve(handleMessage(msg, this._deps())).catch((e) => {
        this.postError(e && e.message ? e.message : String(e));
      });
    }));

    if (typeof webviewView.onDidDispose === 'function') {
      this._disposables.push(webviewView.onDidDispose(() => {
        this._ready = false;
        this._view = null;
      }));
    }

    // Bug fix: retainContextWhenHidden is false, so the webview's JS context
    // (and thus its in-memory "ready" state) is torn down whenever the view
    // is hidden — but _ready stayed true, so a reveal() after re-showing
    // would post state/focus into a webview that had not sent `ready` again
    // yet. Track visibility and reset _ready; the reloaded webview re-sends
    // `ready`, which flushes any pending reveal via markReady().
    if (typeof webviewView.onDidChangeVisibility === 'function') {
      this._disposables.push(webviewView.onDidChangeVisibility(() => {
        if (!webviewView.visible) this._ready = false;
      }));
    }
  }

  dispose() {
    for (const d of this._disposables) safe(() => d.dispose(), undefined);
    this._disposables = [];
    if (this._connectionSub) safe(() => this._connectionSub.dispose(), undefined);
    this._connectionSub = null;
    if (this._output) this._output.dispose();
  }

  _deps() {
    return {
      provider: this,
      actions: this.actions,
      repoRoot: this.repoRoot,
      enginePath: this.enginePath,
      dashboardCmd: this.dashboardCmd,
      context: this.context,
      onCourtResult: this.onCourtResult,
      onJobChange: this.onJobChange,
      onMutation: this.onMutation,
    };
  }

  _html(webview) {
    const n = nonce();
    const mediaUri = (name) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name));
    const cssHref = mediaUri('panel.css');
    const jsSrc = mediaUri('panel.js');
    const csp = `default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${n}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${cssHref}">
<title>Gaia</title>
</head>
<body>
<div id="root"></div>
<script nonce="${n}" src="${jsSrc}"></script>
</body>
</html>`;
  }

  // --- outbound messages -------------------------------------------------

  /** Deep-ish snapshot safe to JSON-serialize across the webview boundary. */
  getState() {
    const s = this.state;
    return {
      protocolVersion: 2,
      readiness: s.readiness, capabilities: { ...s.capabilities },
      activeRun: s.activeRun, selectedRun: s.selectedRun, latestRun: s.latestRun, recentRuns: s.recentRuns, recentRunsHasMore: s.recentRunsHasMore,
      configPreview: s.configPreview, installPreview: s.installPreview,
      workspace: { ...s.workspace },
      config: { ...s.config, notes: [...s.config.notes] },
      hosts: { ...s.hosts, labels: { ...s.hosts.labels } },
      lastReport: s.lastReport ? { ...s.lastReport } : null,
      dashboard: { ...s.dashboard },
      job: s.job ? { ...s.job } : null,
      log: s.log.slice(-LOG_LIMIT),
      steps: s.steps.slice(-STEP_LIMIT),
      mutations: s.mutations ? { ...s.mutations } : null,
    };
  }

  postState() {
    this._post({ type: 'state', state: this.getState() });
  }

  /** Append to the 200-entry ring buffer and push it immediately. */
  log(level, text) {
    const entry = { ts: new Date().toISOString(), level, text: String(text || '') };
    if (this._output) this._output.appendLine(`${entry.ts} [${level}] ${entry.text}`);
    this.state.log.push(entry);
    if (this.state.log.length > LOG_LIMIT) this.state.log.splice(0, this.state.log.length - LOG_LIMIT);
    this.postLog(entry);
    return entry;
  }

  postLog(entry) {
    this._post({ type: 'log', entry });
  }

  /** Append an agent-activity step ({status, text}) and push it immediately.
   *  Steps stay in the feed after completion so the full trace is visible.
   *  Consecutive identical 'running' steps (e.g. mutation-runner lines that
   *  repeat) coalesce into one entry rather than flooding the feed. */
  postStep(step) {
    if (!step || typeof step.text !== 'string' || !step.text) return null;
    const status = step.status || 'running';
    const last = this.state.steps[this.state.steps.length - 1];
    if (last && last.status === 'running' && status === 'running' && last.text === step.text) {
      last.ts = new Date().toISOString(); // refresh the timestamp, keep one line
      this._post({ type: 'step', step: { ...last }, replace: true });
      return last;
    }
    const entry = { ts: new Date().toISOString(), status, text: step.text };
    this.state.steps.push(entry);
    if (this.state.steps.length > STEP_LIMIT) this.state.steps.splice(0, this.state.steps.length - STEP_LIMIT);
    this._post({ type: 'step', step: entry });
    return entry;
  }

  /** Live mutation progress from an action's TRUSTGAP status polling.
   *  Updates the metrics state (pushed lazily with the next state post) and
   *  mirrors every event into the activity feed as a step. */
  _onMutationEvent(event, signal) {
    if (signal === 'done' || event == null) {
      this.state.mutations = this.state.mutations ? { ...this.state.mutations, status: 'done' } : { status: 'done' };
      return;
    }
    const prev = this.state.mutations || {};
    this.state.mutations = {
      status: 'running',
      tested: event.tested != null ? event.tested : (prev.tested ?? null),
      total: event.total != null ? event.total : (prev.total ?? null),
      killed: event.killed != null ? event.killed : (prev.killed ?? null),
      survived: event.survived != null ? event.survived : (prev.survived ?? null),
      killRate: event.killRate != null ? event.killRate : (prev.killRate ?? null),
      line: typeof event.line === 'string' ? event.line : (prev.line || ''),
    };
    this.postStep({ status: mutationStepStatus(event), text: this.state.mutations.line || 'mutation runner progress' });
  }

  postError(text) {
    this.log('error', text);
    this._post({ type: 'error', text });
  }

  _post(message) {
    if (this._view && this._view.webview && typeof this._view.webview.postMessage === 'function') {
      safe(() => this._view.webview.postMessage(message), undefined);
    }
  }

  // --- ready / reveal ------------------------------------------------------

  /** Called by handleMessage on the webview's `ready` message. */
  markReady() {
    this._ready = true;
    this._refreshAll();
    this.postState();
    if (this._pendingReveal) {
      const pending = this._pendingReveal;
      this._pendingReveal = null;
      this._doReveal(pending);
    }
  }

  /**
   * Bring the panel into view and, once (or if already) ready, push state,
   * a `focus` message and optionally run `dispatch`. Only the latest
   * pending reveal survives while the webview is not yet ready.
   */
  reveal(opts = {}) {
    safe(() => {
      if (vscode.commands && typeof vscode.commands.executeCommand === 'function') {
        Promise.resolve(vscode.commands.executeCommand('gaia.panel.focus')).catch((e) => {
          console.error('[gaia] executeCommand gaia.panel.focus failed:', e && e.message ? e.message : e);
        });
      }
    }, undefined);
    if (this._ready) this._doReveal(opts);
    else this._pendingReveal = opts;
  }

  _doReveal({ section, preselect, dispatch } = {}) {
    this.postState();
    this._post({ type: 'focus', section, preselect });
    if (typeof dispatch === 'function') {
      Promise.resolve(dispatch()).catch((e) => this.postError(e && e.message ? e.message : String(e)));
    }
  }

  // --- single-flight job slot ---------------------------------------------

  /**
   * Run `fn` under the single job slot shared by detectConfig, installCourts,
   * runCourt, generateReport and dashboardRun. A second request while busy
   * posts an `error` instead of running. State is pushed on set + clear.
   */
  async runJob(kind, label, fn) {
    if (this.state.job || this.state.activeRun?.lifecycle === 'running') {
      this.postError(`A Gaia job is already running (${this.state.job?.label || this.state.activeRun.runId}).`);
      return undefined;
    }
    // New run: clear the activity feed (append-only *during* a run) and reset
    // live mutation metrics. Raw console log is kept (it is the audit trail).
    this.state.steps = [];
    this.state.mutations = null;
    this.state.job = { kind, label, startedAt: new Date().toISOString() };
    if (this.onJobChange) safe(() => this.onJobChange(this.state.job), undefined);
    this.postState();
    this.postStep({ status: 'running', text: label });
    try {
      return await fn();
    } catch (e) {
      this.postError(e && e.message ? e.message : String(e));
      return undefined;
    } finally {
      this.state.job = null;
      if (this.onJobChange) safe(() => this.onJobChange(null), undefined);
      this.postState();
    }
  }
}

// --- one-line runCourt result summaries (logged after the job settles) ----

function resultSummary(court, result) {
  if (!result) return 'no result';
  if (result.kind === 'error') return result.error || 'failed';
  const payload = result.kind === 'complete' ? result.payload : result; // accept raw engine payloads too
  if (!payload) return 'no evidence';
  if (court === 'WITNESS' && payload.summary) {
    const s = payload.summary;
    return `${s.green} green / ${s.red} red / ${s.yellow} yellow of ${s.total}`;
  }
  if (court === 'TRUSTGAP') {
    if (payload.status === 'started') return `mutation job ${payload.job_id} started`;
    if (payload.trustGap != null) return `trust gap ${payload.trustGap}`;
    return payload.status || 'done';
  }
  if (court === 'TRIAGE') {
    return payload.incidentWindow ? `incident window ${payload.incidentWindow}` : (payload.status || 'done');
  }
  return 'done';
}

// --- message router (webview → host) --------------------------------------

/**
 * Validate + dispatch one webview message. Exported standalone so both the
 * webview's onDidReceiveMessage and the command wrappers (subtask 4, via
 * provider.reveal({dispatch})) go through the same whitelist and validation.
 *
 * @param {{type: string, [k: string]: any}} msg
 * @param {{provider: GaiaPanelProvider, actions?: object, repoRoot?: Function,
 *   enginePath?: Function, dashboardCmd?: object, context?: object}} deps
 */
async function dispatchMessage(msg, deps) {
  const provider = deps && deps.provider;
  if (!provider) throw new Error('handleMessage: deps.provider is required');

  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    provider.log('warn', `dropped malformed message: ${safe(() => JSON.stringify(msg), String(msg))}`);
    return;
  }
  const { type } = msg;
  if (!WHITELIST.has(type)) {
    provider.log('warn', `unknown message type: ${type}`);
    return;
  }

  if (type === 'ready') {
    provider.markReady();
    return;
  }

  let params = {};
  if (type === 'installCourts') {
    const valid = ['all', ...Object.keys(HOSTS)];
    if (typeof msg.host !== 'string' || !valid.includes(msg.host)) {
      provider.postError(`installCourts: host must be one of ${valid.join(', ')}`);
      return;
    }
    params = { host: msg.host };
  } else if (type === 'runCourt') {
    const courts = (deps.actions && Array.isArray(deps.actions.COURTS)) ? deps.actions.COURTS : FALLBACK_COURTS;
    // Accept either the legacy single-court form ({court: 'WITNESS'}) or the
    // multi-select panel form ({courts: ['WITNESS', ...]}). Both normalize to
    // params.courts (array, panel order).
    let selected;
    if (Array.isArray(msg.courts)) {
      if (!msg.courts.length || msg.courts.some((c) => typeof c !== 'string' || !courts.includes(c)) ||
          new Set(msg.courts).size !== msg.courts.length) {
        provider.postError(`runCourt: courts must be a non-empty distinct subset of ${courts.join(', ')}`);
        return;
      }
      selected = [...msg.courts];
    } else if (typeof msg.court === 'string' && courts.includes(msg.court)) {
      selected = [msg.court];
    } else {
      provider.postError(`runCourt: court must be one of ${courts.join(', ')}`);
      return;
    }
    params = { courts: selected };
    if (msg.publishToDashboard !== undefined) params.outputTarget = msg.publishToDashboard ? 'dashboard' : 'local';
    if (msg.outputTarget !== undefined) {
      if (msg.outputTarget !== 'local' && msg.outputTarget !== 'dashboard') {
        provider.postError(`runCourt: outputTarget must be 'local' or 'dashboard'`);
        return;
      }
      params.outputTarget = msg.outputTarget;
    }
    if (msg.timeoutSeconds !== undefined) {
      if (typeof msg.timeoutSeconds !== 'number' || !Number.isFinite(msg.timeoutSeconds) || msg.timeoutSeconds <= 0) {
        provider.postError('runCourt: timeoutSeconds must be a positive number');
        return;
      }
      params.timeoutSeconds = msg.timeoutSeconds;
    }
  } else if (type === 'generateReport') {
    if (msg.formats !== undefined) {
      const valid = ['html', 'md', 'json'];
      if (!Array.isArray(msg.formats) || !msg.formats.length || msg.formats.some((f) => !valid.includes(f))) {
        provider.postError(`generateReport: formats must be a non-empty subset of ${valid.join(', ')}`);
        return;
      }
      params.formats = [...new Set(msg.formats)];
    }
  } else if (type === 'openLastReport') {
    if (msg.format !== 'html' && msg.format !== 'md') {
      provider.postError(`openLastReport: format must be 'html' or 'md'`);
      return;
    }
    params = { format: msg.format };
  }

  const label = type === 'runCourt'
    ? `Running ${params.courts.join(' + ')}`
    : `${type} ${JSON.stringify(params)}`;
  const actions = deps.actions;
  if (!actions) {
    provider.log('warn', `no actions module wired — dropping ${label}`);
    return;
  }

  if (JOB_TYPES.has(type)) {
    await provider.runJob(type, label, async () => {
      const ctx = provider._actionsCtx();
      if (type === 'detectConfig') {
        const result = await actions.detectConfig(ctx);
        provider.state.config = { exists: true, path: result.path, notes: result.notes };
        const doc = await vscode.workspace.openTextDocument(result.path);
        await vscode.window.showTextDocument(doc);
        return result;
      }
      if (type === 'installCourts') {
        const result = await actions.installCourts(ctx, { host: params.host });
        provider.state.config = actions.configStatus(ctx.root);
        return result;
      }
      if (type === 'runCourt') {
        const result = await actions.runCourt(ctx, params);
        if (result && result.dashboardUrl) provider.state.dashboard.url = result.dashboardUrl;
        provider._refreshDashboardConnected();
        provider.state.lastReport = safe(() => actions.findLastReport(ctx.root), provider.state.lastReport);
        provider._refreshEvidence();
        const outcomes = (result && result.courts) || {};
        for (const c of params.courts) {
          // actions.runCourt keys outcomes by the uppercase court id.
          const outcome = outcomes[c] !== undefined ? outcomes[c] : outcomes[c.toLowerCase()];
          provider.log('info', `${c}: ${resultSummary(c, outcome)}`);
          if (deps.onCourtResult && outcome !== undefined) {
            safe(() => deps.onCourtResult(c, outcome), undefined);
          }
        }
        return result;
      }
      if (type === 'generateReport') {
        const result = await actions.generateReport(ctx, params);
        provider.state.lastReport = actions.findLastReport(ctx.root);
        // generateReport runs all three courts — notify with the input payload.
        if (deps.onCourtResult && result) {
          const input = safe(() => {
            const p = require('path').join(ctx.root, 'reports', 'gaia', 'gaia-input.json');
            return JSON.parse(require('fs').readFileSync(p, 'utf8'));
          }, null);
          if (input) {
            safe(() => deps.onCourtResult('witness', input.witness), undefined);
            safe(() => deps.onCourtResult('trustgap', input.trustgap), undefined);
            safe(() => deps.onCourtResult('triage', input.triage), undefined);
          }
        }
        return result;
      }
      // type === 'dashboardRun'
      const result = await actions.dashboardRun(ctx);
      provider.state.dashboard.url = result.url;
      provider._refreshDashboardConnected();
      // A dashboard run collects all three courts — surface their outcomes
      // to the ambient status bar the same way a local run does.
      if (deps.onCourtResult && result && result.outcomes) {
        for (const c of ['witness', 'trustgap', 'triage']) {
          const o = result.outcomes[c];
          if (o && o.kind === 'complete' && o.payload) safe(() => deps.onCourtResult(c, o.payload), undefined);
        }
      }
      return result;
    });
    if (type === 'dashboardRun' && provider.onDashboardChange) safe(() => provider.onDashboardChange(), undefined);
    return;
  }

  // --- non-job message types ------------------------------------------------
  const ctx = provider._actionsCtx();

  if (type === 'openConfig') {
    if (!ctx.root) { provider.postError('Open a workspace folder first.'); return; }
    const status = actions.configStatus(ctx.root);
    if (!status.exists) { provider.postError('Gaia: no config found — run "Detect config" first.'); return; }
    provider.state.config = status;
    const doc = await vscode.workspace.openTextDocument(status.path);
    await vscode.window.showTextDocument(doc);
    provider.postState();
    return;
  }

  if (type === 'openLastReport') {
    if (!ctx.root) { provider.postError('Open a workspace folder first.'); return; }
    const report = actions.findLastReport(ctx.root);
    if (!report) { provider.postError('Gaia: no report yet — run "Generate report".'); return; }
    provider.state.lastReport = report;
    if (params.format === 'html') {
      provider._openReportPanel(report.htmlPath);
    } else {
      const doc = await vscode.workspace.openTextDocument(report.mdPath);
      await vscode.window.showTextDocument(doc);
    }
    provider.postState();
    return;
  }

  if (type === 'dashboardOpen') {
    const url = provider.state.dashboard.url;
    if (!url) { provider.postError('Gaia: no dashboard run yet.'); return; }
    await ctx.openExternal(url);
    return;
  }

  if (type === 'dashboardStatus') {
    provider._refreshDashboardConnected();
    provider.postState();
    return;
  }
}

// Requests from the sidebar cross an untrusted boundary. Validate the complete
// message before resolving any workspace path or invoking an action.
async function handleMessage(raw, deps) {
  const provider = deps && deps.provider;
  if (!provider) throw new Error('handleMessage: deps.provider is required');
  const requestId = raw && raw.requestId;
  let msg;
  try { msg = decodeMessage(raw); }
  catch (e) {
    if (raw && typeof raw.type === 'string') provider.log('warn', `unknown message type or invalid payload: ${raw.type}`);
    provider.postError(e.message);
    if (typeof requestId === 'string') provider._post({ type: 'response', requestId, status: 'rejected', error: { message: e.message } });
    return;
  }
  const response = (status, data, error) => {
    if (msg.requestId) provider._post({ type: 'response', requestId: msg.requestId, status, ...(data !== undefined ? { data } : {}), ...(error ? { error: { code: error.code || 'ERROR', message: error.message || String(error) } } : {}) });
  };
  if (msg.type === 'ready') { provider.markReady(); response('ok'); return; }
  const special = new Set(['cancelRun', 'publishRun', 'selectRun', 'loadMoreRuns', 'openArtifact', 'openLogs', 'configValidate', 'configPreview', 'configApply', 'installPreview', 'installApply', 'openFolder', 'manageTrust', 'refresh', 'dashboardStart']);
  if (!special.has(msg.type)) {
    if (JOB_TYPES.has(msg.type)) response('accepted');
    try { const result = await dispatchMessage(msg, deps); response('ok', result); }
    catch (e) { provider.postError(e.message || String(e)); response('rejected', undefined, e); }
    return;
  }
  try {
    const actions = deps.actions || provider.actions;
    const ctx = provider._actionsCtx();
    const root = ctx.root;
    const writable = () => { if (!root) throw new Error('Open a workspace folder first.'); if (!ctx.trusted) throw new Error('Trust this workspace first.'); };
    let data;
    switch (msg.type) {
      case 'refresh': provider._refreshAll(); break;
      case 'openFolder': await vscode.commands.executeCommand('vscode.openFolder'); break;
      case 'manageTrust': await vscode.commands.executeCommand('workbench.trust.manage'); break;
      case 'dashboardStart': {
        writable();
        if (provider.state.job || provider.state.activeRun) throw new Error('Wait for the current run before starting the dashboard.');
        if (!provider.dashboardCmd || typeof provider.dashboardCmd.startSession !== 'function') throw new Error('Local dashboard is unavailable in this host.');
        const session = await provider.dashboardCmd.startSession(vscode, {root, enginePath: ctx.enginePath});
        provider.state.dashboard.url = session.dash.url;
        provider._refreshDashboardConnected();
        data = {connected: provider.state.dashboard.connected};
        break;
      }
      case 'configValidate': data = actions.validateConfig(ctx); provider.state.config = data; break;
      case 'configPreview': writable(); data = actions.previewConfig(ctx); provider.state.configPreview = data; break;
      case 'configApply': writable(); data = actions.applyConfig(ctx, { previewId: msg.previewId, expectedConfigRevision: msg.expectedConfigRevision ?? null, confirmReplace: true }); provider.state.configPreview = null; provider.state.config = actions.configStatus(root); break;
      case 'installPreview': writable(); data = actions.previewInstall(ctx, { host: msg.host }); provider.state.installPreview = data; break;
      case 'installApply': writable(); data = await actions.installCourts(ctx, { previewId: msg.previewId }); provider.state.installPreview = null; break;
      case 'cancelRun': writable(); data = await actions.cancelRun(ctx, { runId: msg.runId }); break;
      case 'publishRun': writable(); data = await actions.publishRun(ctx, { runId: msg.runId }); break;
      case 'selectRun': if (!root) throw new Error('Open a workspace folder first.'); data = {run: provider._presentRun(actions.selectRun(root, msg.runId))}; provider.state.selectedRun = data.run; break;
      case 'loadMoreRuns': if (!root) throw new Error('Open a workspace folder first.'); provider._historyLimit = Math.min(provider._historyLimit + 10, 100); break;
      case 'openLogs': if (provider._output && provider._output.show) provider._output.show(true); break;
      case 'openArtifact': {
        if (!root) throw new Error('Open a workspace folder first.');
        const store = require('../lib/run-store');
        const run = actions.readRun(root, msg.runId);
        const artifact = run.artifacts.find(a => (a.artifactId || a.id) === msg.artifactId && a.status === 'ready');
        if (!artifact || !artifact.path) throw new Error('Artifact unavailable for this run.');
        const dir = fs.realpathSync(store.runDirectory(root, msg.runId));
        const file = fs.realpathSync(artifact.path);
        if (!file.startsWith(dir + path.sep)) throw new Error('Artifact is outside its run directory.');
        if (artifact.kind === 'html') provider._openReportPanel(file);
        else { const doc = await vscode.workspace.openTextDocument(file); await vscode.window.showTextDocument(doc); }
        break;
      }
    }
    provider._refreshAll(); provider.postState(); response('ok', data);
  } catch (e) { provider.postError(e.message || String(e)); response('rejected', undefined, e); }
}

module.exports = { GaiaPanelProvider, handleMessage };

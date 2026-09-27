'use strict';
/**
 * src/panel.js — TriumphPanelProvider: persistent Webview View for the
 * TRIUMPH activity-bar container (`triumph.panel`).
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

const LOG_LIMIT = 200;
const STEP_LIMIT = 200;
const FALLBACK_COURTS = ['REDLINE', 'SPLITBRAIN', 'WARPATH'];

const WHITELIST = new Set([
  'ready', 'detectConfig', 'openConfig', 'installCourts', 'runCourt',
  'generateReport', 'openLastReport', 'dashboardRun', 'dashboardOpen', 'dashboardStatus',
]);

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
    console.error('[triumph] safe(): swallowed exception:', e && e.message ? e.message : e);
    return fallback;
  }
}

class TriumphPanelProvider {
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

    this.state = {
      workspace: { root: null, name: null },
      config: { exists: false, path: null, notes: [] },
      hosts: { available: ['all', ...Object.keys(HOSTS)], labels: hostLabels(), default: 'all' },
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
    this.state.workspace = { root, name: root ? path.basename(root) : null };
  }

  _refreshHostsDefault() {
    const def = safe(() => vscode.workspace.getConfiguration('triumph').get('defaultHost'), null);
    this.state.hosts.default = def || 'all';
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
  }

  /** Build the ctx object src/actions.js functions expect. */
  _actionsCtx() {
    const root = safe(() => (typeof this.repoRoot === 'function' ? this.repoRoot() : null), null);
    const enginePath = safe(() => (typeof this.enginePath === 'function' ? this.enginePath() : null), null);
    return {
      root,
      enginePath,
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
      openExternal: (url) => safe(() => vscode.env.openExternal(vscode.Uri.parse(url)), undefined),
      vscode,
    };
  }

  /** Open (or reuse) the singleton 'triumphReport' WebviewPanel. */
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
      'triumphReport', 'TRIUMPH 3-Court Report', vscode.ViewColumn.One, { enableScripts: true }
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
<title>TRIUMPH</title>
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
    const entry = { ts: new Date().toISOString(), level, text };
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

  /** Live mutation progress from an action's SPLITBRAIN status polling.
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
        Promise.resolve(vscode.commands.executeCommand('triumph.panel.focus')).catch((e) => {
          console.error('[triumph] executeCommand triumph.panel.focus failed:', e && e.message ? e.message : e);
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
    if (this.state.job) {
      this.postError(`A TRIUMPH job is already running (${this.state.job.label}).`);
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
  if (court === 'REDLINE' && payload.summary) {
    const s = payload.summary;
    return `${s.green} green / ${s.red} red / ${s.yellow} yellow of ${s.total}`;
  }
  if (court === 'SPLITBRAIN') {
    if (payload.status === 'started') return `mutation job ${payload.job_id} started`;
    if (payload.trustGap != null) return `trust gap ${payload.trustGap}`;
    return payload.status || 'done';
  }
  if (court === 'WARPATH') {
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
 * @param {{provider: TriumphPanelProvider, actions?: object, repoRoot?: Function,
 *   enginePath?: Function, dashboardCmd?: object, context?: object}} deps
 */
async function handleMessage(msg, deps) {
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
    // Accept either the legacy single-court form ({court: 'REDLINE'}) or the
    // multi-select panel form ({courts: ['REDLINE', ...]}). Both normalize to
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
        const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(result, null, 2), language: 'json' });
        await vscode.window.showTextDocument(doc, { preview: true });
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
            const p = require('path').join(ctx.root, 'reports', 'triumph', 'triumph-input.json');
            return JSON.parse(require('fs').readFileSync(p, 'utf8'));
          }, null);
          if (input) {
            safe(() => deps.onCourtResult('redline', input.redline), undefined);
            safe(() => deps.onCourtResult('splitbrain', input.splitbrain), undefined);
            safe(() => deps.onCourtResult('warpath', input.warpath), undefined);
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
        for (const c of ['redline', 'splitbrain', 'warpath']) {
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
    if (!status.exists) { provider.postError('TRIUMPH: no config found — run "Detect config" first.'); return; }
    provider.state.config = status;
    const doc = await vscode.workspace.openTextDocument(status.path);
    await vscode.window.showTextDocument(doc);
    provider.postState();
    return;
  }

  if (type === 'openLastReport') {
    if (!ctx.root) { provider.postError('Open a workspace folder first.'); return; }
    const report = actions.findLastReport(ctx.root);
    if (!report) { provider.postError('TRIUMPH: no report yet — run "Generate report".'); return; }
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
    if (!url) { provider.postError('TRIUMPH: no dashboard run yet.'); return; }
    await ctx.openExternal(url);
    return;
  }

  if (type === 'dashboardStatus') {
    provider._refreshDashboardConnected();
    provider.postState();
    return;
  }
}

module.exports = { TriumphPanelProvider, handleMessage };

'use strict';
/**
 * src/extension.js — TRIUMPH 3-Court VS Code extension host.
 *
 * Three roles, zero model calls:
 *   1. Setup orchestrator — "Install courts for this repo" materializes the
 *      court subagent prompts + MCP wiring into the user's agent host(s).
 *   2. Tool/engine server — exposes the model-free MCP engine (court.js) to
 *      VS Code via an MCP server definition provider, so Copilot/agent-mode
 *      chat can call redline_* / splitbrain_* / warpath_* with its own model.
 *   3. Report generator — "Generate report" runs the courts through the
 *      engine and renders deterministic HTML + MD reports.
 *
 * The extension never reasons about the repo and never holds an API key.
 */

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const { ENGINE_ENTRY } = require('../lib/hosts');
const dashboardCmd = require('./dashboard');
const actions = require('./actions');
const { TriumphPanelProvider, handleMessage } = require('./panel');

/** Primary workspace folder root, or null. */
function repoRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) return null;
  // Use the folder containing the active editor when there are several;
  // otherwise the single folder. Never silently pick the wrong root.
  const active = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
  if (active && active.uri) {
    const owning = vscode.workspace.getWorkspaceFolder(active.uri);
    if (owning) return owning.uri.fsPath;
  }
  return folders[0].uri.fsPath;
}

function enginePath() {
  const override = vscode.workspace.getConfiguration('triumph').get('enginePath');
  return (override && fs.existsSync(override)) ? override : ENGINE_ENTRY;
}

async function cmdDetectConfig() {
  const root = repoRoot();
  if (!root) return vscode.window.showWarningMessage('TRIUMPH: open a workspace folder first.');
  const { config, notes } = detect(root);
  const dest = path.join(root, '.triumph.yml');
  if (fs.existsSync(dest)) {
    const choice = await vscode.window.showWarningMessage(
      'TRIUMPH: .triumph.yml already exists. Overwriting discards any hand-tuned paths.',
      { modal: true }, 'Overwrite');
    if (choice !== 'Overwrite') return;
  }
  const header = '# TRIUMPH 3-court repo adapter. See schemas/triumph-config.schema.json in the extension.\n';
  fs.writeFileSync(dest, header + toYaml(config) + '\n', 'utf8');
  const doc = await vscode.workspace.openTextDocument(dest);
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage('TRIUMPH: .triumph.yml written. ' + notes.join(' · '));
}

async function cmdInstallCourts() {
  const root = repoRoot();
  if (!root) return vscode.window.showWarningMessage('TRIUMPH: open a workspace folder first.');

  // Ensure config exists first (auto-detect if missing).
  const hasConfig = ['.triumph.yml', '.triumph.yaml', '.triumph.json'].some((n) => fs.existsSync(path.join(root, n)));
  if (!hasConfig) await cmdDetectConfig();

  const cfgDefault = vscode.workspace.getConfiguration('triumph').get('defaultHost') || 'all';
  const picked = await vscode.window.showQuickPick(
    ['all', ...Object.keys(HOSTS)].map((id) => ({
      label: id,
      description: id === 'all' ? 'every known host' : (HOSTS[id] ? HOSTS[id].name : 'VS Code Chat'),
      picked: cfgDefault === id || cfgDefault === 'all',
    })),
    { placeHolder: 'Install courts into which agent host?', canPickMany: false }
  );
  if (!picked) return;
  const hosts = picked.label === 'all' ? Object.keys(HOSTS) : [picked.label];

  const written = [];
  for (const h of hosts) {
    try {
      const r = installHost(h, root);
      written.push(...r.files.map((f) => path.relative(root, f)));
    } catch (e) {
      vscode.window.showErrorMessage(`TRIUMPH ${h}: ${e.message}`);
    }
  }
  const extVersion = require('../package.json').version;
  const choice = await vscode.window.showInformationMessage(
    `TRIUMPH courts installed (${hosts.join(', ')}) — extension v${extVersion}. ${written.length} files written. ` +
    `If you expected skills/rules/modes and only see agents+mcp.json, reload the window (Developer: Reload Window) so the host picks up the current extension build.`,
    'Show files'
  );
  if (choice === 'Show files') {
    vscode.window.showQuickPick(written, { placeHolder: 'Installed files' });
  }
}

async function cmdRunCourt() {
  const root = repoRoot();
  if (!root) return vscode.window.showWarningMessage('TRIUMPH: open a workspace folder first.');
  const court = await vscode.window.showQuickPick([
    { label: 'REDLINE', description: 'spec-witness verdicts per clause' },
    { label: 'SPLITBRAIN', description: 'honesty audit (mutation vs claimed coverage)' },
    { label: 'WARPATH', description: 'incident forensics triage' },
  ], { placeHolder: 'Which court?' });
  if (!court) return;

  const client = new McpClient(enginePath(), root);
  try {
    await client.start();
    let result;
    if (court.label === 'REDLINE') {
      result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'REDLINE running witness suites…' }, () => client.call('redline_verdict_all'));
    } else if (court.label === 'SPLITBRAIN') {
      const start = await client.call('splitbrain_mutate');
      if (start.status === 'started') {
        vscode.window.showInformationMessage(`SPLITBRAIN mutation running (job ${start.job_id}). Poll: splitbrain_status.`);
        result = start;
      } else {
        result = await client.call('splitbrain_trustgap');
      }
    } else {
      result = await client.call('warpath_triage');
    }
    const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(result, null, 2), language: 'json' });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (e) {
    vscode.window.showErrorMessage('TRIUMPH: ' + (e && e.message ? e.message : e));
  } finally {
    client.dispose();
  }
}

async function cmdGenerateReport() {
  const root = repoRoot();
  if (!root) return vscode.window.showWarningMessage('TRIUMPH: open a workspace folder first.');
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'TRIUMPH: running courts…', cancellable: false },
    async (progress) => {
      const client = new McpClient(enginePath(), root);
      try {
        await client.start();
        const input = { repo: path.basename(root), repoRootAbs: root, generated: new Date().toISOString() };
        progress.report({ message: 'REDLINE …' });
        input.redline = await client.call('redline_verdict_all');
        progress.report({ message: 'SPLITBRAIN …' });
        input.splitbrain = await client.call('splitbrain_trustgap');
        progress.report({ message: 'WARPATH …' });
        input.warpath = await client.call('warpath_triage');

        const outDir = path.join(root, 'reports', 'triumph');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'triumph-input.json'), JSON.stringify(input, null, 2) + '\n', 'utf8');
        const { mdPath, htmlPath } = writeReports(input, outDir);
        const pick = await vscode.window.showInformationMessage('TRIUMPH report written.', 'Open HTML', 'Open MD');
        if (pick === 'Open HTML') {
          const panel = vscode.window.createWebviewPanel('triumphReport', 'TRIUMPH 3-Court Report', vscode.ViewColumn.One, { enableScripts: true });
          panel.webview.html = fs.readFileSync(htmlPath, 'utf8');
        } else if (pick === 'Open MD') {
          const doc = await vscode.workspace.openTextDocument(mdPath);
          await vscode.window.showTextDocument(doc);
        }
      } catch (e) {
        vscode.window.showErrorMessage('TRIUMPH report: ' + (e && e.message ? e.message : e));
      } finally {
        client.dispose();
      }
    }
  );
}

async function cmdOpenReport() {
  const root = repoRoot();
  if (!root) return;
  const htmlPath = path.join(root, 'reports', 'triumph', 'triumph-report.html');
  if (!fs.existsSync(htmlPath)) return vscode.window.showWarningMessage('TRIUMPH: no report yet — run "Generate report".');
  const panel = vscode.window.createWebviewPanel('triumphReport', 'TRIUMPH 3-Court Report', vscode.ViewColumn.One, { enableScripts: true });
  panel.webview.html = fs.readFileSync(htmlPath, 'utf8');
}

/** TRIUMPH: Run courts and publish to the dashboard. */
async function cmdDashboardRun(context) {
  const root = repoRoot();
  if (!root) return vscode.window.showWarningMessage('TRIUMPH: open a workspace folder first.');
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'TRIUMPH: running courts → dashboard…', cancellable: false },
    async () => {
      try {
        const historyDir = path.join(context.globalStorageUri.fsPath, 'dashboard-history');
        fs.mkdirSync(historyDir, { recursive: true });
        const { url } = await dashboardCmd.runAndPublish(vscode, {
          root,
          enginePath: enginePath(),
          requested: ['redline', 'splitbrain', 'warpath'],
          existingRun: null,
          historyDir,
          openExternal: (u) => vscode.env.openExternal(vscode.Uri.parse(u)),
        });
        vscode.window.showInformationMessage(
          'TRIUMPH run published. Dashboard stays connected for this session — browser "Run again" re-runs the courts.',
          'Open in dashboard'
        ).then((p) => { if (p) vscode.env.openExternal(vscode.Uri.parse(url)); });
      } catch (e) {
        vscode.window.showErrorMessage('TRIUMPH dashboard: ' + (e && e.message ? e.message : e));
      }
    }
  );
}
/** Register the engine as an MCP server for VS Code chat (agent mode). */
function registerMcpProvider(context) {
  if (!vscode.lm || typeof vscode.lm.registerMcpServerDefinitionProvider !== 'function') {
    return; // older VS Code: the .vscode/mcp.json written by installCourts still wires it
  }
  context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('triumph-courts', {
    provideMcpServerDefinitions() {
      const root = repoRoot();
      if (!root) return [];
      return [new vscode.McpStdioServerDefinition('triumph-courts', 'node', [enginePath(), '--repo', root])];
    },
  }));
}

// ---------------------------------------------------------------------------
// Court state — populated whenever a court job settles so the status bar can
// show a live summary without polling. Keyed by lower-case court name.
// ---------------------------------------------------------------------------
const _courtState = {
  redline: null,   // { green, red, yellow, total } | null
  splitbrain: null, // { trustGap, honestMutationScore } | null
  warpath: null,   // { hasIncident: bool } | null
};

/** Set while any panel job runs — drives the active-court indicator and
 *  the amber "working" tint on the status bar. */
let _lastRun = null; // { label, startedAt } | null

/** Live SPLITBRAIN mutation metrics while (and after) a mutation job
 *  streams — { tested, total, killed, killRate, status } | null. */
let _mutationLive = null;

/**
 * Called from the panel's job completion hook (injected via onCourtResult) or
 * after cmdRunCourt / cmdGenerateReport settle. Updates the ambient court
 * summary and refreshes the status bar immediately.
 */
function notifyCourtResult(court, result) {
  if (!court || !result) return;
  const c = court.toLowerCase();
  if (c === 'redline' && result.summary) {
    _courtState.redline = { ...result.summary };
  } else if (c === 'splitbrain') {
    if (result.honestMutationScore != null || result.trustGap != null) {
      _courtState.splitbrain = {
        trustGap: result.trustGap,
        honestMutationScore: result.honestMutationScore,
      };
    }
  } else if (c === 'warpath') {
    _courtState.warpath = { hasIncident: Boolean(result.incidentWindow) };
  }
  updateStatusBar();
}

/** Build a compact status bar label from the current court state. */
function buildStatusText() {
  if (_lastRun) return '$(sync~spin) TRIUMPH: ' + shortJobLabel(_lastRun.label);
  if (_courtState.redline && _courtState.redline.red > 0) return '$(error) TRIUMPH: findings';
  if (_courtState.warpath && _courtState.warpath.hasIncident) return '$(warning) TRIUMPH: incident';
  if (_courtState.redline && _courtState.redline.yellow > 0) return '$(warning) TRIUMPH: incomplete';
  return '$(shield) TRIUMPH: open courts';
}

/** Trim a runJob label ("runCourt {…}") to a scannable status-bar token. */
function shortJobLabel(label) {
  if (!label) return 'working';
  if (label.startsWith('runCourt')) {
    const m = /"([^"]+)"/.exec(label);
    return m ? `running ${m[1]}` : 'running courts';
  }
  const head = label.split(' ')[0];
  return head.length > 18 ? head.slice(0, 17) + '…' : head;
}

/** Build tooltip text from current court state. */
function buildStatusTooltip() {
  const lines = ['TRIUMPH 3-Court Audit'];
  if (_courtState.redline) {
    const r = _courtState.redline;
    lines.push(`REDLINE: ${r.green} green · ${r.red} red · ${r.yellow} yellow of ${r.total}`);
  }
  if (_courtState.splitbrain) {
    const sb = _courtState.splitbrain;
    const score = sb.honestMutationScore != null ? `${Math.round(sb.honestMutationScore * 100)}%` : 'n/a';
    lines.push(`SPLITBRAIN: mutation score ${score}${sb.trustGap != null ? `  trust gap ${sb.trustGap} percentage points` : ''}`);
  }
  if (_courtState.warpath) {
    lines.push(`WARPATH: ${_courtState.warpath.hasIncident ? 'incident window detected' : 'no incident detected in last signal (not a verified clear)'}`);
  }
  if (_mutationLive && _mutationLive.status !== 'done') {
    const m = _mutationLive;
    lines.push(`MUTATION LIVE: ${m.tested != null ? m.tested : 0}${m.total != null ? `/${m.total}` : ''} tested` +
      (m.killRate != null ? ` — ${m.killRate}% kill rate` : ''));
  }
  if (dashboardCmd.isConnected()) lines.push('Local dashboard connected.');
  if (_lastRun) lines.push(`Running: ${_lastRun.label} (started ${new Date(_lastRun.startedAt).toLocaleTimeString()})`);
  if (lines.length === 1) lines.push('Click to run courts or open dashboard.');
  return lines.join('\n');
}

/** Status bar: shows persistent audit health summary, always visible once
 *  the extension activates. Color codes red/amber/green by audit state. */
let _status = null;
function updateStatusBar() {
  if (!_status) return;
  _status.text = buildStatusText();
  _status.tooltip = buildStatusTooltip();

  // Color coding: red if any REDLINE failures or critical trust gap.
  const hasRed = _courtState.redline && _courtState.redline.red > 0;
  const hasBadGap = _courtState.splitbrain && _courtState.splitbrain.trustGap > 20;
  const hasWarn = (_courtState.redline && (_courtState.redline.red === 0 && _courtState.redline.yellow > 0)) ||
    (_courtState.warpath && _courtState.warpath.hasIncident) ||
    Boolean(_lastRun); // a live job is an "in-flight" state: amber, not idle
  if (hasRed || hasBadGap) {
    _status.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (hasWarn) {
    _status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    _status.backgroundColor = undefined;
  }

  _status.show();
}

/** Construct + register the persistent panel's WebviewViewProvider, if this
 * VS Code build supports it (the test host mock does not, and must not be
 * broken by its absence). */
function registerPanel(context) {
  const provider = new TriumphPanelProvider({
    actions,
    repoRoot,
    enginePath,
    dashboardCmd,
    context,
    // Keep the status bar in sync with dashboardCmd.isConnected() after any
    // dashboardRun job settles, regardless of whether it was triggered from
    // the webview or from the triumph.dashboardRun command.
    onDashboardChange: updateStatusBar,
    // Update the ambient status bar metrics whenever a court result arrives
    // via the panel's runCourt or generateReport job.
    onCourtResult: notifyCourtResult,
    // Job slot transitions drive the active-court indicator; mutation
    // progress drives the live kill-rate counter.
    onJobChange: (job) => { _lastRun = job; if (!job) _mutationLive = null; updateStatusBar(); },
    onMutation: (event, signal) => {
      if (signal === 'done' || event == null) {
        _mutationLive = _mutationLive ? { ..._mutationLive, status: 'done' } : null;
      } else {
        const prev = _mutationLive || {};
        _mutationLive = {
          status: 'running',
          tested: event.tested != null ? event.tested : (prev.tested ?? null),
          total: event.total != null ? event.total : (prev.total ?? null),
          killed: event.killed != null ? event.killed : (prev.killed ?? null),
          killRate: event.killRate != null ? event.killRate : (prev.killRate ?? null),
        };
      }
      updateStatusBar();
    },
  });
  // Releases the provider's dashboard onConnectionChange listener on deactivate.
  context.subscriptions.push(provider);
  if (vscode.window && typeof vscode.window.registerWebviewViewProvider === 'function') {
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('triumph.panel', provider, {
      webviewOptions: { retainContextWhenHidden: false },
    }));
  } else {
    // No WebviewView support in this host (older VS Code, or the test
    // harness's vscode mock): the panel will never receive a `ready`
    // message, so reveal({dispatch}) would otherwise queue forever and the
    // command would silently do nothing. Treat the provider as already
    // "ready" — postState/focus just have nowhere to go, but dispatch still
    // runs (contract: commands must still perform their action).
    provider.markReady();
  }
  return provider;
}

/** The 6 commands are thin wrappers over provider.reveal(); every dispatch
 * goes through the same handleMessage router the webview itself uses. */
function activate(context) {
  const provider = registerPanel(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('triumph.detectConfig', () =>
      provider.reveal({ section: 'config', dispatch: () => handleMessage({ type: 'detectConfig' }, provider._deps()) })),
    vscode.commands.registerCommand('triumph.installCourts', async () => {
      const { HOSTS } = require('../lib/hosts');
      const choice = await vscode.window.showQuickPick(Object.keys(HOSTS).map(host => ({label: host, host})),
        { placeHolder: 'Select an agent host to preview integration files' });
      if (!choice) return;
      provider.reveal({ section: 'install', preselect: { host: choice.host },
        dispatch: () => handleMessage({ type: 'installPreview', host: choice.host }, provider._deps()) });
    }),
    vscode.commands.registerCommand('triumph.runCourt', async () => {
      const picked = await vscode.window.showQuickPick(['REDLINE', 'SPLITBRAIN', 'WARPATH'].map(court => ({label: court, court})),
        { placeHolder: 'Choose courts to run (local evidence is always saved)', canPickMany: true });
      if (!picked || !picked.length) return;
      const courts = picked.map(item => item.court);
      provider.reveal({ section: 'run', dispatch: () => handleMessage({ type: 'runCourt', courts, outputTarget: 'local' }, provider._deps()) });
    }),
    vscode.commands.registerCommand('triumph.generateReport', () =>
      provider.reveal({ section: 'run', dispatch: () => handleMessage({ type: 'generateReport' }, provider._deps()) })),
    vscode.commands.registerCommand('triumph.openReport', () =>
      provider.reveal({ section: 'report', dispatch: () => handleMessage({ type: 'openLastReport', format: 'html' }, provider._deps()) })),
    vscode.commands.registerCommand('triumph.dashboardRun', () =>
      provider.reveal({ section: 'dashboard', dispatch: () => handleMessage({ type: 'dashboardRun' }, provider._deps()) }))
  );
  if (vscode.window.createStatusBarItem) {
    _status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    _status.command = 'triumph.statusBarAction';
    context.subscriptions.push(_status);
  }

  // Register the status bar click handler.
  context.subscriptions.push(
    vscode.commands.registerCommand('triumph.statusBarAction', async () => {
      const dashConnected = dashboardCmd.isConnected();
      const dashUrl = provider.state && provider.state.dashboard && provider.state.dashboard.url;

      const items = [
        { label: '$(run) Run REDLINE',    action: 'redline' },
        { label: '$(beaker) Run SPLITBRAIN', action: 'splitbrain' },
        { label: '$(warning) Run WARPATH',  action: 'warpath' },
        { label: '$(checklist) Run all courts', action: 'all' },
        dashConnected && dashUrl
          ? { label: '$(radio-tower) Open Dashboard', action: 'openDashboard' }
          : { label: '$(graph) Open Dashboard (not connected)', action: 'dashboardRun' },
        { label: '$(preview) Open Last Report', action: 'report' },
      ].filter(Boolean);

      const pick = await vscode.window.showQuickPick(items, { placeHolder: 'TRIUMPH: choose an action' });
      if (!pick) return;

      if (pick.action === 'redline' || pick.action === 'splitbrain' || pick.action === 'warpath' || pick.action === 'all') {
        const selected = pick.action === 'all' ? ['REDLINE', 'SPLITBRAIN', 'WARPATH'] : [pick.action.toUpperCase()];
        provider.reveal({
          section: 'run',
          dispatch: () => handleMessage({ type: 'runCourt', courts: selected }, provider._deps()),
        });
      } else if (pick.action === 'openDashboard') {
        if (dashUrl) vscode.env.openExternal(vscode.Uri.parse(dashUrl));
      } else if (pick.action === 'dashboardRun') {
        provider.reveal({ section: 'dashboard', dispatch: () => handleMessage({ type: 'dashboardRun' }, provider._deps()) });
      } else if (pick.action === 'report') {
        provider.reveal({ section: 'report', dispatch: () => handleMessage({ type: 'openLastReport', format: 'html' }, provider._deps()) });
      }
    })
  );

  // No polling: dashboard.js notifies on session start / server exit /
  // stopAll, so the status bar reflects connection drops immediately.
  context.subscriptions.push(dashboardCmd.onConnectionChange(updateStatusBar));

  // Show idle state immediately on activation (before any court has run).
  updateStatusBar();

  registerMcpProvider(context);
}

function deactivate() {
  // Clean dashboard shutdown: interrupt unfinished runs, drop the connection.
  const p = dashboardCmd.stopSession();
  if (_status) { _status.hide(); }
  return Promise.resolve(p).then(updateStatusBar);
}

module.exports = { activate, deactivate };

'use strict';
/**
 * src/extension.js — Gaia 3-Court VS Code extension host.
 *
 * Three roles, zero model calls:
 *   1. Setup orchestrator — "Install courts for this repo" materializes the
 *      court subagent prompts + MCP wiring into the user's agent host(s).
 *   2. Tool/engine server — exposes the model-free MCP engine (court.js) to
 *      VS Code via an MCP server definition provider, so Copilot/agent-mode
 *      chat can call witness_* / trustgap_* / triage_* with its own model.
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
const { GaiaPanelProvider, handleMessage } = require('./panel');

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
  const override = vscode.workspace.getConfiguration('gaia').get('enginePath');
  return (override && fs.existsSync(override)) ? override : ENGINE_ENTRY;
}

async function cmdDetectConfig() {
  const root = repoRoot();
  if (!root) return vscode.window.showWarningMessage('Gaia: open a workspace folder first.');
  const { config, notes } = detect(root);
  const dest = path.join(root, '.gaia.yml');
  if (fs.existsSync(dest)) {
    const choice = await vscode.window.showWarningMessage(
      'Gaia: .gaia.yml already exists. Overwriting discards any hand-tuned paths.',
      { modal: true }, 'Overwrite');
    if (choice !== 'Overwrite') return;
  }
  const header = '# Gaia 3-court repo adapter. See schemas/gaia-config.schema.json in the extension.\n';
  fs.writeFileSync(dest, header + toYaml(config) + '\n', 'utf8');
  const doc = await vscode.workspace.openTextDocument(dest);
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage('Gaia: .gaia.yml written. ' + notes.join(' · '));
}

async function cmdInstallCourts() {
  const root = repoRoot();
  if (!root) return vscode.window.showWarningMessage('Gaia: open a workspace folder first.');

  // Ensure config exists first (auto-detect if missing).
  const hasConfig = ['.gaia.yml', '.gaia.yaml', '.gaia.json'].some((n) => fs.existsSync(path.join(root, n)));
  if (!hasConfig) await cmdDetectConfig();

  const cfgDefault = vscode.workspace.getConfiguration('gaia').get('defaultHost') || 'all';
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
      vscode.window.showErrorMessage(`Gaia ${h}: ${e.message}`);
    }
  }
  const extVersion = require('../package.json').version;
  const choice = await vscode.window.showInformationMessage(
    `Gaia courts installed (${hosts.join(', ')}) — extension v${extVersion}. ${written.length} files written. ` +
    `If you expected skills/rules/modes and only see agents+mcp.json, reload the window (Developer: Reload Window) so the host picks up the current extension build.`,
    'Show files'
  );
  if (choice === 'Show files') {
    vscode.window.showQuickPick(written, { placeHolder: 'Installed files' });
  }
}

async function cmdRunCourt() {
  const root = repoRoot();
  if (!root) return vscode.window.showWarningMessage('Gaia: open a workspace folder first.');
  const court = await vscode.window.showQuickPick([
    { label: 'WITNESS', description: 'spec-witness verdicts per clause' },
    { label: 'TRUSTGAP', description: 'honesty audit (mutation vs claimed coverage)' },
    { label: 'TRIAGE', description: 'incident forensics triage' },
  ], { placeHolder: 'Which court?' });
  if (!court) return;

  const client = new McpClient(enginePath(), root);
  try {
    await client.start();
    let result;
    if (court.label === 'WITNESS') {
      result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'WITNESS running witness suites…' }, () => client.call('witness_verdict_all'));
    } else if (court.label === 'TRUSTGAP') {
      const start = await client.call('trustgap_mutate');
      if (start.status === 'started') {
        vscode.window.showInformationMessage(`TRUSTGAP mutation running (job ${start.job_id}). Poll: trustgap_status.`);
        result = start;
      } else {
        result = await client.call('trustgap_report');
      }
    } else {
      result = await client.call('triage_run');
    }
    const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(result, null, 2), language: 'json' });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (e) {
    vscode.window.showErrorMessage('Gaia: ' + (e && e.message ? e.message : e));
  } finally {
    client.dispose();
  }
}

async function cmdGenerateReport() {
  const root = repoRoot();
  if (!root) return vscode.window.showWarningMessage('Gaia: open a workspace folder first.');
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Gaia: running courts…', cancellable: false },
    async (progress) => {
      const client = new McpClient(enginePath(), root);
      try {
        await client.start();
        const input = { repo: path.basename(root), repoRootAbs: root, generated: new Date().toISOString() };
        progress.report({ message: 'WITNESS …' });
        input.witness = await client.call('witness_verdict_all');
        progress.report({ message: 'TRUSTGAP …' });
        input.trustgap = await client.call('trustgap_report');
        progress.report({ message: 'TRIAGE …' });
        input.triage = await client.call('triage_run');

        const outDir = path.join(root, 'reports', 'gaia');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'gaia-input.json'), JSON.stringify(input, null, 2) + '\n', 'utf8');
        const { mdPath, htmlPath } = writeReports(input, outDir);
        const pick = await vscode.window.showInformationMessage('Gaia report written.', 'Open HTML', 'Open MD');
        if (pick === 'Open HTML') {
          const panel = vscode.window.createWebviewPanel('gaiaReport', 'Gaia 3-Court Report', vscode.ViewColumn.One, { enableScripts: true });
          panel.webview.html = fs.readFileSync(htmlPath, 'utf8');
        } else if (pick === 'Open MD') {
          const doc = await vscode.workspace.openTextDocument(mdPath);
          await vscode.window.showTextDocument(doc);
        }
      } catch (e) {
        vscode.window.showErrorMessage('Gaia report: ' + (e && e.message ? e.message : e));
      } finally {
        client.dispose();
      }
    }
  );
}

async function cmdOpenReport() {
  const root = repoRoot();
  if (!root) return;
  const htmlPath = path.join(root, 'reports', 'gaia', 'gaia-report.html');
  if (!fs.existsSync(htmlPath)) return vscode.window.showWarningMessage('Gaia: no report yet — run "Generate report".');
  const panel = vscode.window.createWebviewPanel('gaiaReport', 'Gaia 3-Court Report', vscode.ViewColumn.One, { enableScripts: true });
  panel.webview.html = fs.readFileSync(htmlPath, 'utf8');
}

/** Gaia: Run courts and publish to the dashboard. */
async function cmdDashboardRun(context) {
  const root = repoRoot();
  if (!root) return vscode.window.showWarningMessage('Gaia: open a workspace folder first.');
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Gaia: running courts → dashboard…', cancellable: false },
    async () => {
      try {
        const historyDir = path.join(context.globalStorageUri.fsPath, 'dashboard-history');
        fs.mkdirSync(historyDir, { recursive: true });
        const { url } = await dashboardCmd.runAndPublish(vscode, {
          root,
          enginePath: enginePath(),
          requested: ['witness', 'trustgap', 'triage'],
          existingRun: null,
          historyDir,
          openExternal: (u) => vscode.env.openExternal(vscode.Uri.parse(u)),
        });
        vscode.window.showInformationMessage(
          'Gaia run published. Dashboard stays connected for this session — browser "Run again" re-runs the courts.',
          'Open in dashboard'
        ).then((p) => { if (p) vscode.env.openExternal(vscode.Uri.parse(url)); });
      } catch (e) {
        vscode.window.showErrorMessage('Gaia dashboard: ' + (e && e.message ? e.message : e));
      }
    }
  );
}
/** Register the engine as an MCP server for VS Code chat (agent mode). */
function registerMcpProvider(context) {
  if (!vscode.lm || typeof vscode.lm.registerMcpServerDefinitionProvider !== 'function') {
    return; // older VS Code: the .vscode/mcp.json written by installCourts still wires it
  }
  context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('gaia-courts', {
    provideMcpServerDefinitions() {
      const root = repoRoot();
      if (!root) return [];
      return [new vscode.McpStdioServerDefinition('gaia-courts', 'node', [enginePath(), '--repo', root])];
    },
  }));
}

// ---------------------------------------------------------------------------
// Court state — populated whenever a court job settles so the status bar can
// show a live summary without polling. Keyed by lower-case court name.
// ---------------------------------------------------------------------------
const _courtState = {
  witness: null,   // { green, red, yellow, total } | null
  trustgap: null, // { trustGap, honestMutationScore } | null
  triage: null,   // { hasIncident: bool } | null
};

/**
 * Called from the panel's job completion hook (injected via onCourtResult) or
 * after cmdRunCourt / cmdGenerateReport settle. Updates the ambient court
 * summary and refreshes the status bar immediately.
 */
function notifyCourtResult(court, result) {
  if (!court || !result) return;
  const c = court.toLowerCase();
  if (c === 'witness' && result.summary) {
    _courtState.witness = { ...result.summary };
  } else if (c === 'trustgap') {
    if (result.honestMutationScore != null || result.trustGap != null) {
      _courtState.trustgap = {
        trustGap: result.trustGap,
        honestMutationScore: result.honestMutationScore,
      };
    }
  } else if (c === 'triage') {
    _courtState.triage = { hasIncident: Boolean(result.incidentWindow) };
  }
  updateStatusBar();
}

/** Build a compact status bar label from the current court state. */
function buildStatusText() {
  const parts = [];

  if (_courtState.witness) {
    const r = _courtState.witness;
    const icon = r.red > 0 ? '$(error)' : r.yellow > 0 ? '$(warning)' : '$(pass)';
    parts.push(`${icon} R:${r.green}↑${r.red}↓`);
  }

  if (_courtState.trustgap) {
    const sb = _courtState.trustgap;
    const score = sb.honestMutationScore != null ? Math.round(sb.honestMutationScore * 100) : null;
    const gap = sb.trustGap != null ? sb.trustGap : null;
    if (score != null) {
      const icon = score >= 80 ? '$(shield)' : score >= 50 ? '$(warning)' : '$(error)';
      parts.push(`${icon} SB:${score}%`);
    }
    if (gap != null && gap > 0) parts.push(`$(diff) gap:${gap}`);
  }

  if (_courtState.triage) {
    const icon = _courtState.triage.hasIncident ? '$(flame)' : '$(check)';
    parts.push(`${icon} WP`);
  }

  if (dashboardCmd.isConnected()) parts.push('$(radio-tower)');

  if (parts.length === 0) return '$(shield) Gaia';
  return '$(shield) ' + parts.join('  ');
}

/** Build tooltip text from current court state. */
function buildStatusTooltip() {
  const lines = ['Gaia 3-Court Audit'];
  if (_courtState.witness) {
    const r = _courtState.witness;
    lines.push(`WITNESS: ${r.green} green · ${r.red} red · ${r.yellow} yellow of ${r.total}`);
  }
  if (_courtState.trustgap) {
    const sb = _courtState.trustgap;
    const score = sb.honestMutationScore != null ? `${Math.round(sb.honestMutationScore * 100)}%` : 'n/a';
    lines.push(`TRUSTGAP: mutation score ${score}${sb.trustGap != null ? `  trust gap ${sb.trustGap}` : ''}`);
  }
  if (_courtState.triage) {
    lines.push(`TRIAGE: ${_courtState.triage.hasIncident ? 'incident window active' : 'clear'}`);
  }
  if (dashboardCmd.isConnected()) lines.push('Dashboard connected — browser "Run again" is live.');
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

  // Color coding: red if any WITNESS failures or critical trust gap.
  const hasRed = _courtState.witness && _courtState.witness.red > 0;
  const hasBadGap = _courtState.trustgap && _courtState.trustgap.trustGap > 20;
  const hasWarn = _courtState.witness && (_courtState.witness.red === 0 && _courtState.witness.yellow > 0);
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
  const provider = new GaiaPanelProvider({
    actions,
    repoRoot,
    enginePath,
    dashboardCmd,
    context,
    // Keep the status bar in sync with dashboardCmd.isConnected() after any
    // dashboardRun job settles, regardless of whether it was triggered from
    // the webview or from the gaia.dashboardRun command.
    onDashboardChange: updateStatusBar,
    // Update the ambient status bar metrics whenever a court result arrives
    // via the panel's runCourt or generateReport job.
    onCourtResult: notifyCourtResult,
  });
  // Releases the provider's dashboard onConnectionChange listener on deactivate.
  context.subscriptions.push(provider);
  if (vscode.window && typeof vscode.window.registerWebviewViewProvider === 'function') {
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('gaia.panel', provider, {
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
    vscode.commands.registerCommand('gaia.detectConfig', () =>
      provider.reveal({ section: 'config', dispatch: () => handleMessage({ type: 'detectConfig' }, provider._deps()) })),
    vscode.commands.registerCommand('gaia.installCourts', () => {
      const defaultHost = vscode.workspace.getConfiguration('gaia').get('defaultHost') || 'all';
      provider.reveal({ section: 'install', preselect: { host: defaultHost } });
    }),
    vscode.commands.registerCommand('gaia.runCourt', () =>
      provider.reveal({ section: 'run' })),
    vscode.commands.registerCommand('gaia.generateReport', () =>
      provider.reveal({ section: 'run', dispatch: () => handleMessage({ type: 'generateReport' }, provider._deps()) })),
    vscode.commands.registerCommand('gaia.openReport', () =>
      provider.reveal({ section: 'report', dispatch: () => handleMessage({ type: 'openLastReport', format: 'html' }, provider._deps()) })),
    vscode.commands.registerCommand('gaia.dashboardRun', () =>
      provider.reveal({ section: 'dashboard', dispatch: () => handleMessage({ type: 'dashboardRun' }, provider._deps()) }))
  );
  if (vscode.window.createStatusBarItem) {
    _status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    _status.command = 'gaia.statusBarAction';
    context.subscriptions.push(_status);
  }

  // Register the status bar click handler.
  context.subscriptions.push(
    vscode.commands.registerCommand('gaia.statusBarAction', async () => {
      const dashConnected = dashboardCmd.isConnected();
      const dashUrl = provider.state && provider.state.dashboard && provider.state.dashboard.url;

      const items = [
        { label: '$(run) Run WITNESS',    action: 'witness' },
        { label: '$(beaker) Run TRUSTGAP', action: 'trustgap' },
        { label: '$(warning) Run TRIAGE',  action: 'triage' },
        dashConnected && dashUrl
          ? { label: '$(radio-tower) Open Dashboard', action: 'openDashboard' }
          : { label: '$(graph) Open Dashboard (not connected)', action: 'dashboardRun' },
        { label: '$(preview) Open Last Report', action: 'report' },
      ].filter(Boolean);

      const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Gaia: choose an action' });
      if (!pick) return;

      if (pick.action === 'witness' || pick.action === 'trustgap' || pick.action === 'triage') {
        provider.reveal({
          section: 'run',
          dispatch: () => handleMessage({ type: 'runCourt', court: pick.action.toUpperCase() }, provider._deps()),
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

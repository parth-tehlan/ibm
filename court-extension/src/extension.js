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

/** Status bar: shows dashboard connection state (browser Run-again live). */
let _status = null;
function updateStatusBar() {
  if (!_status) return;
  if (dashboardCmd.isConnected()) {
    _status.text = '$(radio-tower) TRIUMPH dashboard';
    _status.tooltip = 'Dashboard connected — browser "Run again" is live.';
    _status.show();
  } else {
    _status.hide();
  }
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
    vscode.commands.registerCommand('triumph.installCourts', () => {
      const defaultHost = vscode.workspace.getConfiguration('triumph').get('defaultHost') || 'all';
      provider.reveal({ section: 'install', preselect: { host: defaultHost } });
    }),
    vscode.commands.registerCommand('triumph.runCourt', () =>
      provider.reveal({ section: 'run' })),
    vscode.commands.registerCommand('triumph.generateReport', () =>
      provider.reveal({ section: 'run', dispatch: () => handleMessage({ type: 'generateReport' }, provider._deps()) })),
    vscode.commands.registerCommand('triumph.openReport', () =>
      provider.reveal({ section: 'report', dispatch: () => handleMessage({ type: 'openLastReport', format: 'html' }, provider._deps()) })),
    vscode.commands.registerCommand('triumph.dashboardRun', () =>
      provider.reveal({ section: 'dashboard', dispatch: () => handleMessage({ type: 'dashboardRun' }, provider._deps()) }))
  );
  if (vscode.window.createStatusBarItem) {
    _status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    context.subscriptions.push(_status);
  }
  // No polling: dashboard.js notifies on session start / server exit /
  // stopAll, so the status bar reflects connection drops immediately.
  context.subscriptions.push(dashboardCmd.onConnectionChange(updateStatusBar));
  registerMcpProvider(context);
}

function deactivate() {
  // Clean dashboard shutdown: interrupt unfinished runs, drop the connection.
  const p = dashboardCmd.stopSession();
  if (_status) { _status.hide(); }
  return Promise.resolve(p).then(updateStatusBar);
}

module.exports = { activate, deactivate };

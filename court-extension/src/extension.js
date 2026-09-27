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

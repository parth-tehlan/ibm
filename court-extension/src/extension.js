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

const { detect, toYaml } = require('../lib/detect');
const { installHost, HOSTS, ENGINE_ENTRY } = require('../lib/hosts');
const { writeReports } = require('../lib/render');
const { McpClient } = require('./mcp-client');
const dashboardCmd = require('./dashboard');

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
  const header = '# TRIUMPH 3-court repo adapter. See schemas/triumph-config.schema.json in the extension.\n';
  fs.writeFileSync(dest, header + toYaml(config) + '\n', 'utf8');
  const doc = await vscode.workspace.openTextDocument(dest);
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage('TRIUMPH: .triumph.yml written. ' + notes.join(' · '));
}

async function cmdInstallCourts() {
  const root = repoRoot();
  if (!root) return vscode.window.showWarningMessage('TRIUMPH: open a workspace folder first.');

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
  const hasConfig = ['.triumph.yml', '.triumph.yaml', '.triumph.json'].some((n) => fs.existsSync(path.join(root, n)));
  if (!hasConfig) await cmdDetectConfig();

  const written = [];
  const backups = [];
  const failures = [];
  for (const h of hosts) {
    try {
      const r = installHost(h, root);
      written.push(...r.files.map((f) => path.relative(root, f)));
      backups.push(...(r.backups || []).map((f) => path.relative(root, f)));
    } catch (e) {
      failures.push(`${h}: ${e.message}`);
      vscode.window.showErrorMessage(`TRIUMPH ${h}: ${e.message}`);
    }
  }
  if (!written.length) return;
  const extVersion = require('../package.json').version;
  const choice = await vscode.window.showInformationMessage(
    `TRIUMPH installed ${hosts.length - failures.length}/${hosts.length} hosts — extension v${extVersion}. ` +
    `${backups.length} previous files backed up. Reload the window to pick up new skills, rules and modes.`,
    'Show files and backups'
  );
  if (choice === 'Show files and backups') {
    vscode.window.showQuickPick([...written, ...backups.map((f) => `backup: ${f}`)], { placeHolder: 'Installed files and restorable backups' });
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
        result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'SPLITBRAIN mutation running…', cancellable: false },
          async () => {
            const timeout = Date.now() + 20 * 60_000;
            let job;
            do {
              if (Date.now() > timeout) throw new Error('SPLITBRAIN mutation timed out');
              await new Promise((resolve) => setTimeout(resolve, 1000));
              job = await client.call('splitbrain_status', { job_id: start.job_id });
            } while (job.status === 'running');
            if (job.status !== 'done') throw new Error(job.error || `SPLITBRAIN mutation ${job.status}`);
            return client.call('splitbrain_trustgap');
          }
        );
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
        await dashboardCmd.runAndPublish(vscode, {
          root,
          enginePath: enginePath(),
          requested: ['redline', 'splitbrain', 'warpath'],
          existingRun: null,
          historyDir,
          openExternal: (u) => vscode.env.openExternal(vscode.Uri.parse(u)),
          onError: (e) => vscode.window.showErrorMessage('TRIUMPH rerun: ' + e.message),
        });
        vscode.window.showInformationMessage('TRIUMPH run published. Dashboard stays available for reruns.');
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

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('triumph.installCourts', cmdInstallCourts),
    vscode.commands.registerCommand('triumph.detectConfig', cmdDetectConfig),
    vscode.commands.registerCommand('triumph.runCourt', cmdRunCourt),
    vscode.commands.registerCommand('triumph.generateReport', cmdGenerateReport),
    vscode.commands.registerCommand('triumph.openReport', cmdOpenReport),
    vscode.commands.registerCommand('triumph.dashboardRun', () => cmdDashboardRun(context))
  );
  registerMcpProvider(context);
}

function deactivate() { return dashboardCmd.stopAll(); }

module.exports = { activate, deactivate };

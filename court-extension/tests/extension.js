#!/usr/bin/env node
/* Headless check of the VS Code extension host: commands wired, MCP provider
 * registered, and the extension never touches a model. Mocks `vscode`. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const EXT = path.resolve(__dirname, '..');

// --- Mock vscode ---
const registered = { commands: [], handlers: {}, mcpProviders: [], opened: [] };
const vscode = {
  workspace: {
    workspaceFolders: [{ uri: { fsPath: path.resolve(EXT, '..', 'northstar') } }],
    getConfiguration: () => ({ get: () => '' }),
    openTextDocument: async (x) => ({ content: x }),
    getWorkspaceFolder: (uri) => vscode.workspace.workspaceFolders.find((f) => f.uri.fsPath === uri.fsPath),
  },
  window: {
    showWarningMessage: (m) => { throw new Error('warn: ' + m); },
    showInformationMessage: async () => undefined,
    showErrorMessage: (m) => { throw new Error('err: ' + m); },
    showQuickPick: async (items) => items && items[0],
    showTextDocument: async () => {},
    withProgress: async (_o, fn) => fn({ report: () => {} }),
    createWebviewPanel: () => ({ webview: { set html(v) { registered.webviewHtml = v; } } }),
    activeTextEditor: null,
  },
  commands: {
    registerCommand: (id, fn) => { registered.commands.push(id); registered.handlers[id] = fn; return { dispose() {} }; },
  },
  lm: {
    registerMcpServerDefinitionProvider: (id, provider) => { registered.mcpProviders.push({ id, provider }); return { dispose() {} }; },
  },
  McpStdioServerDefinition: class { constructor(label, command, args) { Object.assign(this, { label, command, args }); } },
  ProgressLocation: { Notification: 1 },
  ViewColumn: { One: 1 },
  Uri: { parse: (u) => u },
  env: { openExternal: async (u) => { registered.opened.push(u); } },
};

// Intercept require('vscode') inside extension.js.
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return origLoad.apply(this, arguments);
};

let passed = 0, failed = 0;
const t = (n, f) => Promise.resolve().then(f).then(() => { passed++; console.log('  ok  ' + n); }).catch((e) => { failed++; console.error('  FAIL ' + n + ' — ' + e.message); });

(async () => {
  console.log('extension host checks\n');

  const ext = require('../src/extension.js');

  await t('activate registers all 5 commands', () => {
    const context = { subscriptions: [] };
    ext.activate(context);
    for (const c of ['triumph.installCourts', 'triumph.detectConfig', 'triumph.runCourt', 'triumph.generateReport', 'triumph.openReport', 'triumph.dashboardRun']) {
      assert.ok(registered.commands.includes(c), 'missing command ' + c);
    }
  });

  await t('dashboard command selects active folder, opens connected URL once and deactivates', async () => {
    const dashboard = require('../src/dashboard');
    const run = dashboard.runAndPublish, stop = dashboard.stopAll;
    const root = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'triumph-cmd-'));
    const folder = { uri: { fsPath: root } };
    const originalFolders = vscode.workspace.workspaceFolders;
    let options; let stopped = false;
    try {
      vscode.workspace.workspaceFolders = [originalFolders[0], folder];
      vscode.window.activeTextEditor = { document: { uri: folder.uri } };
      dashboard.runAndPublish = async (_v, o) => { options = o; await o.openExternal('http://127.0.0.1:1234/projects/id/runs/run'); return { runId: 'run', url: 'http://127.0.0.1:1234/projects/id/runs/run' }; };
      dashboard.stopAll = async () => { stopped = true; };
      const ctx = { subscriptions: [], globalStorageUri: { fsPath: root } };
      ext.activate(ctx);
      await registered.handlers['triumph.dashboardRun']();
      assert.strictEqual(options.root, root);
      assert.strictEqual(registered.opened.length, 1);
      await ext.deactivate();
      assert.ok(stopped);
    } finally {
      dashboard.runAndPublish = run; dashboard.stopAll = stop;
      vscode.workspace.workspaceFolders = originalFolders; vscode.window.activeTextEditor = null;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t('MCP server definition provider registered + points at engine', () => {
    assert.ok(registered.mcpProviders.length >= 1);
    const defs = registered.mcpProviders[0].provider.provideMcpServerDefinitions();
    assert.ok(defs.length === 1);
    assert.strictEqual(defs[0].command, 'node');
    assert.ok(defs[0].args[0].endsWith('court.js'), 'provider not pointing at engine');
    assert.deepStrictEqual(defs[0].args.slice(1), ['--repo', path.resolve(EXT, '..', 'northstar')]);
  });

  await t('extension.js never imports a model SDK', () => {
    const src = fs.readFileSync(path.join(EXT, 'src', 'extension.js'), 'utf8');
    assert.ok(!/require\(['"](openai|@anthropic|@ibm-cloud)/.test(src));
    assert.ok(!/process\.env\.[A-Z_]*API_KEY/.test(src));
  });

  await t('generateReport renders a webview from engine JSON', async () => {
    // run the command's core: writeReports on collected input.
    const { writeReports } = require('../lib/render');
    const os = require('os');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-ext-'));
    const input = { repo: 'n', repoRootAbs: '/r', generated: 'g', redline: { summary: { green: 0, red: 1, yellow: 0, total: 1 }, results: [{ clause: 'W1', status: 'red', passed: 0, failed: 1, total: 1, test: 't', spec_anchor: 's', failures: [] }] } };
    const { mdPath, htmlPath } = writeReports(input, out);
    assert.ok(fs.existsSync(mdPath) && fs.existsSync(htmlPath));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

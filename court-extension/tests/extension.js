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
const registered = { commands: [], mcpProviders: [] };
const vscode = {
  workspace: {
    workspaceFolders: [{ uri: { fsPath: path.resolve(EXT, '..', 'northstar') } }],
    getConfiguration: () => ({ get: () => '' }),
    openTextDocument: async (x) => ({ content: x }),
  },
  window: {
    showWarningMessage: (m) => { throw new Error('warn: ' + m); },
    showInformationMessage: async () => undefined,
    showErrorMessage: (m) => { throw new Error('err: ' + m); },
    showQuickPick: async (items) => items && items[0],
    showTextDocument: async () => {},
    withProgress: async (_o, fn) => fn({ report: () => {} }),
    createWebviewPanel: () => ({ webview: { set html(v) { registered.webviewHtml = v; } } }),
    createStatusBarItem: () => { const it = { show: () => { it.visible = true; }, hide: () => { it.visible = false; }, text: '', tooltip: '' }; registered.statusBar = it; return it; },
  },
  commands: {
    registerCommand: (id, fn) => { registered.commands.push(id); return { dispose() {} }; },
  },
  lm: {
    registerMcpServerDefinitionProvider: (id, provider) => { registered.mcpProviders.push({ id, provider }); return { dispose() {} }; },
  },
  McpStdioServerDefinition: class { constructor(label, command, args) { Object.assign(this, { label, command, args }); } },
  ProgressLocation: { Notification: 1 },
  ViewColumn: { One: 1 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class { constructor(id) { this.id = id; } },
};

// Intercept require('vscode') inside extension.js.
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return origLoad.apply(this, arguments);
};

let passed = 0, failed = 0;
const t = (n, f) => Promise.resolve().then(f).then(() => { passed++; console.log('  ok  ' + n); }).catch((e) => { failed++; console.error('  FAIL ' + n + ' — ' + e.message); });

// --- helpers for the persistent-panel tests (subtask 6): a fresh, isolated
// require of extension.js (+ its panel.js dependency) bound to a private
// vscode mock, so these tests never share state with the 7 checks above and
// never touch the real ../northstar workspace or filesystem. ---------------

function mkVscode(opts = {}) {
  const rec = { commands: [], commandFns: {}, executed: [], webviewProviders: [], quickPicks: [], opened: [], createdPanels: [] };
  const configGet = opts.configGet || (() => undefined);
  const vscode = {
    workspace: {
      workspaceFolders: opts.workspaceFolders !== undefined ? opts.workspaceFolders : [{ uri: { fsPath: opts.root || '/repo' } }],
      getConfiguration: (section) => ({ get: (key) => configGet(section, key) }),
      openTextDocument: async (x) => ({ __doc: x }),
      getWorkspaceFolder: () => null,
    },
    window: {
      activeTextEditor: undefined,
      showQuickPick: async (items) => { rec.quickPicks.push(items); return items && items[0]; },
      showTextDocument: async (doc, o) => { rec.opened.push({ doc, opts: o }); },
      showWarningMessage: (m) => { throw new Error('warn: ' + m); },
      showErrorMessage: (m) => { throw new Error('err: ' + m); },
      showInformationMessage: async () => undefined,
      withProgress: async (_o, fn) => fn({ report: () => {} }),
      createWebviewPanel: (viewType, title) => {
        const p = { webview: { html: '' }, revealed: [], viewType, title };
        p.reveal = (c) => p.revealed.push(c);
        p.onDidDispose = (fn) => { p._disposeHandler = fn; return { dispose() {} }; };
        rec.createdPanels.push(p);
        return p;
      },
      createStatusBarItem: () => { const it = { show: () => { it.visible = true; }, hide: () => { it.visible = false; }, text: '', tooltip: '' }; rec.statusBar = it; return it; },
      registerWebviewViewProvider: (id, provider, options) => { rec.webviewProviders.push({ id, provider, options }); return { dispose() {} }; },
    },
    commands: {
      registerCommand: (id, fn) => { rec.commands.push(id); rec.commandFns[id] = fn; return { dispose() {} }; },
      executeCommand: async (id, ...args) => { rec.executed.push({ id, args }); },
    },
    env: { openExternal: async (uri) => { rec.opened.push({ external: uri }); } },
    Uri: {
      joinPath: (base, ...segs) => ({ fsPath: [base && (base.fsPath || base), ...segs].join('/') }),
      parse: (s) => ({ toString: () => s, __uri: s }),
    },
    lm: { registerMcpServerDefinitionProvider: (id, provider) => { rec.mcpProviders = rec.mcpProviders || []; rec.mcpProviders.push({ id, provider }); return { dispose() {} }; } },
    McpStdioServerDefinition: class { constructor(label, command, args) { Object.assign(this, { label, command, args }); } },
    ProgressLocation: { Notification: 1 },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ThemeColor: class { constructor(id) { this.id = id; } },
  };
  return { vscode, rec };
}

/** Cache-bust extension.js + panel.js and re-require extension.js under a
 * private vscode mock (and, optionally, a private ./actions replacement),
 * so this never contaminates the shared top-level `ext`/`vscode`/`registered`
 * used by the 7 checks above. Module._load is restored synchronously before
 * this function returns (all nested requires happen inside the require()
 * call, which is synchronous). */
function freshExtension(vscodeMock, extraLoad) {
  const extAbs = require.resolve('../src/extension.js');
  const panelAbs = require.resolve('../src/panel.js');
  delete require.cache[extAbs];
  delete require.cache[panelAbs];
  const localOrig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscodeMock;
    if (extraLoad) {
      const r = extraLoad(request, parent, isMain);
      if (r !== undefined) return r;
    }
    return localOrig.apply(this, arguments);
  };
  try {
    return require('../src/extension.js');
  } finally {
    Module._load = localOrig;
    // Leave extension.js/panel.js re-requirable with the REAL vscode mock
    // too, in case anything after this reloads them.
    delete require.cache[extAbs];
    delete require.cache[panelAbs];
  }
}

/** The 6 commands fire-and-forget provider.reveal() (it does not return the
 * dispatch promise), and a dispatched job hops several microtasks (its own
 * internal awaits, plus runJob's) before state.job clears in `finally`. Wait
 * for that to settle before asserting / firing the next command, so two
 * job-dispatching commands run back-to-back never race the single-flight
 * slot. */
function waitForJobClear(provider, maxTicks = 200) {
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      if (!provider.state.job || ++i >= maxTicks) return resolve();
      setImmediate(step);
    };
    setImmediate(step);
  });
}

function fakeWebviewView(posted) {
  return {
    webview: {
      options: null, html: '', cspSource: 'x',
      asWebviewUri: (u) => ({ toString: () => String((u && u.fsPath) || u) }),
      postMessage: (m) => { posted.push(m); return Promise.resolve(true); },
      onDidReceiveMessage: () => ({ dispose() {} }),
    },
    visible: true,
    onDidDispose: () => ({ dispose() {} }),
    onDidChangeVisibility: () => ({ dispose() {} }),
  };
}

(async () => {
  console.log('extension host checks\n');

  const ext = require('../src/extension.js');

  const activateContext = { subscriptions: [] };
  await t('activate registers all commands including statusBarAction', () => {
    ext.activate(activateContext);
    for (const c of ['triumph.installCourts', 'triumph.detectConfig', 'triumph.runCourt', 'triumph.generateReport', 'triumph.openReport', 'triumph.dashboardRun', 'triumph.statusBarAction']) {
      assert.ok(registered.commands.includes(c), 'missing command ' + c);
    }
  });

  await t('panel provider is a context subscription and dispose() releases its dashboard listener', async () => {
    const provider = activateContext.subscriptions.find((s) => s && typeof s.resolveWebviewView === 'function');
    assert.ok(provider, 'provider must be pushed to context.subscriptions so deactivate disposes it');
    assert.ok(provider._connectionSub, 'provider should hold an onConnectionChange subscription');
    let calls = 0;
    const orig = provider._onConnectionChange;
    provider._onConnectionChange = function () { calls++; return orig.apply(this, arguments); };
    provider.dispose();
    assert.strictEqual(provider._connectionSub, null);
    await require('../src/dashboard.js').stopSession(); // notifies every registered listener
    assert.strictEqual(calls, 0, 'disposed provider must not receive connection changes');
  });

  await t('MCP server definition provider registered + points at engine', () => {
    assert.strictEqual(registered.mcpProviders.length, 1);
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

  await t('status bar item created and always visible (ambient audit health indicator)', () => {
    assert.ok(registered.statusBar, 'a status bar item should be created on activate');
    assert.ok(registered.statusBar.visible, 'always shown — idle state shown before first court run');
    assert.ok(registered.statusBar.text, 'status bar text must be non-empty');
  });

  await t('deactivate() resolves and stopSession is safe + idempotent', async () => {
    const dash = require('../src/dashboard.js');
    assert.strictEqual(typeof dash.stopSession, 'function', 'stopSession must be exported');
    await dash.stopSession(); // no active session → must not throw
    await dash.stopSession(); // idempotent
    await ext.deactivate();   // must resolve (returns stopSession())
    await ext.deactivate();   // idempotent deactivate
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

  await t('installed bundle is in sync with source (catches stale-host regressions)', () => {
    const os = require('os');
    const base = path.join(os.homedir(), '.local', 'share', 'code-server', 'extensions');
    if (!fs.existsSync(base)) { console.log('     (skipped: no code-server extensions dir)'); return; }
    const installs = fs.readdirSync(base).filter((d) => d.startsWith('triumph.triumph-courts-'));
    if (!installs.length) { console.log('     (skipped: extension not installed)'); return; }
    // Newest install dir.
    const newest = installs.map((d) => path.join(base, d)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    // 1. Version matches source package.json.
    const srcV = require('../package.json').version;
    const instV = require(path.join(newest, 'package.json')).version;
    assert.strictEqual(instV, srcV, `installed version ${instV} != source ${srcV}`);
    // 2. Installed lib/hosts.js matches source (the skills/rules regression vector).
    const srcHosts = fs.readFileSync(path.join(EXT, 'lib', 'hosts.js'), 'utf8');
    const instHosts = fs.readFileSync(path.join(newest, 'lib', 'hosts.js'), 'utf8');
    assert.strictEqual(instHosts, srcHosts, 'installed lib/hosts.js is stale — reinstall + reload the host');
    // 3. Skills + custom_modes present in the installed bundle.
    assert.ok(fs.existsSync(path.join(newest, 'agents', 'skills', 'redline-extract', 'SKILL.md')), 'skills missing from installed bundle');
    const cm = fs.readFileSync(path.join(newest, 'agents', 'bob', 'custom_modes.yaml'), 'utf8');
    assert.ok(/^customModes:/m.test(cm), 'installed custom_modes.yaml must be object-shaped');
  });

  // --- persistent panel: registration (subtask 6, contract A/G) -----------

  await t('registerWebviewViewProvider is called with "triumph.panel" and a resolveWebviewView provider', () => {
    const { vscode: v2, rec } = mkVscode();
    const ext2 = freshExtension(v2);
    ext2.activate({ subscriptions: [] });
    assert.strictEqual(rec.webviewProviders.length, 1, 'expected exactly one webview view provider registration');
    assert.strictEqual(rec.webviewProviders[0].id, 'triumph.panel');
    assert.strictEqual(typeof rec.webviewProviders[0].provider.resolveWebviewView, 'function');
  });

  await t('package.json contributes the triumph activitybar container + triumph.panel webview view; icon exists', () => {
    const pkg = require('../package.json');
    const containers = pkg.contributes.viewsContainers && pkg.contributes.viewsContainers.activitybar;
    assert.ok(Array.isArray(containers), 'contributes.viewsContainers.activitybar must be an array');
    const triumphContainer = containers.find((c) => c.id === 'triumph');
    assert.ok(triumphContainer, 'missing activitybar container with id "triumph"');
    assert.ok(triumphContainer.icon, 'activitybar container must declare an icon');
    assert.ok(fs.existsSync(path.join(EXT, triumphContainer.icon)), 'icon file must exist on disk: ' + triumphContainer.icon);
    const views = pkg.contributes.views && pkg.contributes.views.triumph;
    assert.ok(Array.isArray(views), 'contributes.views.triumph must be an array');
    assert.ok(views.some((v) => v.id === 'triumph.panel' && v.type === 'webview'),
      'contributes.views.triumph must contain a webview view with id "triumph.panel"');
  });

  // --- persistent panel: old commands still invoke the right logic (contract G) ---

  await t('old commands reach the underlying actions; installCourts/runCourt only preselect + focus (no dispatch, no quickpick)', async () => {
    const calls = [];
    const fakeActions = {
      COURTS: ['REDLINE', 'SPLITBRAIN', 'WARPATH'],
      configStatus: () => ({ exists: false, path: null, notes: [] }),
      detectConfig: async () => { calls.push('detectConfig'); return { path: '/repo/.triumph.yml', notes: [] }; },
      installCourts: async () => { throw new Error('installCourts must not be called by the bare command'); },
      runCourt: async () => { throw new Error('runCourt must not be called by the bare command'); },
      generateReport: async () => { calls.push('generateReport'); return { htmlPath: 'h', mdPath: 'm', generatedAt: 'now' }; },
      findLastReport: () => { calls.push('findLastReport'); return null; },
      dashboardRun: async () => { calls.push('dashboardRun'); return { url: 'http://dash/1' }; },
    };
    const { vscode: v2, rec } = mkVscode({
      configGet: (section, key) => (section === 'triumph' && key === 'defaultHost' ? 'claude' : undefined),
    });
    const ext2 = freshExtension(v2, (request, parent) => {
      if (request === './actions' && parent && parent.filename && /extension\.js$/.test(parent.filename)) return fakeActions;
      return undefined;
    });
    ext2.activate({ subscriptions: [] });

    const provider = rec.webviewProviders[0].provider;
    const posted = [];
    provider.resolveWebviewView(fakeWebviewView(posted));
    provider.markReady(); // simulate the webview having sent `ready`

    calls.length = 0; posted.length = 0;
    await rec.commandFns['triumph.detectConfig']();
    await waitForJobClear(provider);
    assert.ok(calls.includes('detectConfig'), 'triumph.detectConfig must reach actions.detectConfig');
    assert.ok(rec.executed.some((e) => e.id === 'triumph.panel.focus'), 'triumph.detectConfig must execute triumph.panel.focus');

    calls.length = 0; posted.length = 0;
    await rec.commandFns['triumph.installCourts']();
    assert.ok(rec.executed.some((e) => e.id === 'triumph.panel.focus'), 'triumph.installCourts must execute triumph.panel.focus');
    assert.deepStrictEqual(calls, [], 'triumph.installCourts must not call actions.installCourts');
    assert.strictEqual(rec.quickPicks.length, 0, 'triumph.installCourts must not use showQuickPick');
    const focusInstall = posted.find((m) => m.type === 'focus');
    assert.ok(focusInstall, 'expected a focus message for installCourts');
    assert.strictEqual(focusInstall.section, 'install');
    assert.deepStrictEqual(focusInstall.preselect, { host: 'claude' }, 'host must be preselected from triumph.defaultHost');

    calls.length = 0; posted.length = 0;
    await rec.commandFns['triumph.runCourt']();
    assert.ok(rec.executed.some((e) => e.id === 'triumph.panel.focus'), 'triumph.runCourt must execute triumph.panel.focus');
    assert.deepStrictEqual(calls, [], 'triumph.runCourt must not call actions.runCourt');
    assert.strictEqual(rec.quickPicks.length, 0, 'triumph.runCourt must not use showQuickPick');
    const focusRun = posted.find((m) => m.type === 'focus');
    assert.ok(focusRun, 'expected a focus message for runCourt');
    assert.strictEqual(focusRun.section, 'run');

    calls.length = 0; posted.length = 0;
    await rec.commandFns['triumph.generateReport']();
    await waitForJobClear(provider);
    assert.ok(calls.includes('generateReport'), 'triumph.generateReport must reach actions.generateReport');

    calls.length = 0; posted.length = 0;
    await rec.commandFns['triumph.openReport']();
    await waitForJobClear(provider);
    assert.ok(calls.includes('findLastReport'), 'triumph.openReport must reach actions.findLastReport');

    calls.length = 0; posted.length = 0;
    await rec.commandFns['triumph.dashboardRun']();
    await waitForJobClear(provider);
    assert.ok(calls.includes('dashboardRun'), 'triumph.dashboardRun must reach actions.dashboardRun');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

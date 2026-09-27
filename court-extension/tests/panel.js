#!/usr/bin/env node
/* Headless checks for src/panel.js (persistent panel provider + message
 * router) and the actions.js unit contracts it depends on. Mocks `vscode`
 * exactly like tests/extension.js: a plain node script, no test framework,
 * asserts, prints "N passed, M failed", exit code reflects failures.
 *
 * Every fs-touching test uses a temp dir (os.tmpdir()) — never the real
 * workspace — and every engine call goes through a fake McpClient, so no
 * real engine process is ever spawned. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const EXT = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
const t = (n, f) => Promise.resolve().then(f).then(() => { passed++; console.log('  ok  ' + n); }).catch((e) => { failed++; console.error('  FAIL ' + n + ' — ' + (e.stack || e.message)); });

// --- vscode mock + fresh-require helper (same convention as tests/extension.js) ---

function mkVscode(opts = {}) {
  const rec = { executed: [], opened: [], createdPanels: [], quickPicks: [] };
  const vscode = {
    workspace: {
      workspaceFolders: opts.workspaceFolders !== undefined ? opts.workspaceFolders : [],
      getConfiguration: () => ({ get: () => undefined }),
      openTextDocument: async (x) => ({ __doc: x }),
      getWorkspaceFolder: () => null,
    },
    window: {
      activeTextEditor: undefined,
      showTextDocument: async (doc, o) => { rec.opened.push({ doc, opts: o }); },
      showQuickPick: async (items) => { rec.quickPicks.push(items); return items && items[0]; },
      createWebviewPanel: (viewType, title) => {
        const p = { webview: { html: '' }, revealed: [], viewType, title };
        p.reveal = (c) => p.revealed.push(c);
        p.onDidDispose = (fn) => { p._disposeHandler = fn; return { dispose() {} }; };
        rec.createdPanels.push(p);
        return p;
      },
    },
    commands: { executeCommand: async (id, ...args) => { rec.executed.push({ id, args }); } },
    env: { openExternal: async (uri) => { rec.opened.push({ external: uri }); } },
    Uri: {
      joinPath: (base, ...segs) => ({ fsPath: [base && (base.fsPath || base), ...segs].join('/') }),
      parse: (s) => ({ toString: () => s, __uri: s }),
    },
    ViewColumn: { One: 1 },
  };
  return { vscode, rec };
}

/** Fresh, isolated require of panel.js bound to `vscodeMock`. Cache-busts
 * panel.js only (it has no sibling module state to worry about). */
function freshPanel(vscodeMock) {
  const panelAbs = require.resolve('../src/panel.js');
  delete require.cache[panelAbs];
  const localOrig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscodeMock;
    return localOrig.apply(this, arguments);
  };
  try {
    return require('../src/panel.js');
  } finally {
    Module._load = localOrig;
    delete require.cache[panelAbs];
  }
}

function makeFakeActions(overrides) {
  return Object.assign({
    COURTS: ['REDLINE', 'SPLITBRAIN', 'WARPATH'],
    configStatus: (root) => ({ exists: !!root, path: root ? root + '/.triumph.yml' : null, notes: [] }),
    detectConfig: async (ctx) => { ctx.emit({ level: 'info', text: 'detect done' }); return { path: ctx.root + '/.triumph.yml', notes: ['note1'] }; },
    installCourts: async (ctx, { host }) => { ctx.emit({ level: 'info', text: `installed ${host}` }); return { hosts: [host], files: ['a.md'], errors: [] }; },
    runCourt: async (ctx, params) => {
      const list = params.courts || (params.court ? [params.court] : []);
      ctx.emit({ level: 'info', text: `${list.join('+')} running` });
      const payload = { summary: { green: 1, red: 0, yellow: 0, total: 1 } };
      return { courts: Object.fromEntries(list.map((c) => [c, { kind: 'complete', payload }])) };
    },
    generateReport: async (ctx) => { ctx.emit({ level: 'info', text: 'report written: h, m' }); return { htmlPath: 'h.html', mdPath: 'm.md', generatedAt: 'now' }; },
    findLastReport: (root) => (root ? { htmlPath: root + '/h.html', mdPath: root + '/m.md', generatedAt: 'now', summary: null } : null),
    dashboardRun: async (ctx) => { ctx.emit({ level: 'info', text: 'publishing…' }); return { url: 'http://dash/1' }; },
  }, overrides);
}

(async () => {
  console.log('panel.js + actions.js checks\n');

  // =========================================================================
  // Group 1: resolveWebviewView — HTML/CSP shape, `ready` -> `state` (contract E/D)
  // =========================================================================

  await t('resolveWebviewView: CSP default-src none, script nonce matches, no inline script bodies, links panel.css/panel.js', () => {
    const { vscode } = mkVscode();
    const { TriumphPanelProvider } = freshPanel(vscode);
    const provider = new TriumphPanelProvider({
      repoRoot: () => null, enginePath: () => '/e.js',
      context: { extensionUri: { fsPath: '/ext' } },
    });
    const webview = {
      options: null, html: '', cspSource: 'vscode-resource://cspsrc',
      asWebviewUri: (u) => ({ toString: () => 'webview://' + (u && u.fsPath) }),
      postMessage: () => Promise.resolve(true),
      onDidReceiveMessage: () => ({ dispose() {} }),
    };
    const webviewView = { webview, visible: true, onDidDispose: () => ({ dispose() {} }), onDidChangeVisibility: () => ({ dispose() {} }) };
    provider.resolveWebviewView(webviewView);

    assert.strictEqual(webview.options.enableScripts, true);
    assert.ok(Array.isArray(webview.options.localResourceRoots));

    const html = webview.html;
    const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
    assert.ok(cspMatch, 'expected a CSP meta tag');
    assert.ok(/default-src 'none'/.test(cspMatch[1]), 'CSP must have default-src \'none\'');

    const scriptTags = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.strictEqual(scriptTags.length, 1, 'exactly one <script> tag (no inline scripts elsewhere)');
    const [, attrs, body] = scriptTags[0];
    assert.strictEqual(body.trim(), '', '<script> must have no inline body — src only');
    assert.ok(/\bsrc="/.test(attrs), '<script> must have a src attribute');
    const nonceMatch = attrs.match(/nonce="([^"]+)"/);
    assert.ok(nonceMatch, '<script> must carry a nonce attribute');
    assert.ok(cspMatch[1].includes(`'nonce-${nonceMatch[1]}'`), 'CSP script-src nonce must match the <script> nonce');

    assert.ok(/panel\.css/.test(html), 'must reference panel.css');
    assert.ok(/panel\.js/.test(html), 'must reference panel.js');
    assert.ok(!/style="/.test(html), 'no inline style attributes');
    assert.ok(!/\son[a-z]+="/i.test(html), 'no on*= inline event handler attributes');
  });

  await t('`ready` posts a `state` message whose shape matches the contract D snapshot', async () => {
    const { vscode } = mkVscode({ workspaceFolders: [{ uri: { fsPath: '/repo' } }] });
    const { TriumphPanelProvider } = freshPanel(vscode);
    const actions = makeFakeActions();
    const posted = [];
    const provider = new TriumphPanelProvider({
      actions, repoRoot: () => '/repo', enginePath: () => '/e.js',
      dashboardCmd: { isConnected: () => false },
      context: { extensionUri: { fsPath: '/ext' } },
    });
    let receive;
    const webview = {
      options: null, html: '', cspSource: 'x',
      asWebviewUri: () => ({ toString: () => 'x' }),
      postMessage: (m) => { posted.push(m); return Promise.resolve(true); },
      onDidReceiveMessage: (fn) => { receive = fn; return { dispose() {} }; },
    };
    provider.resolveWebviewView({ webview, visible: true, onDidDispose: () => ({ dispose() {} }), onDidChangeVisibility: () => ({ dispose() {} }) });

    await receive({ type: 'ready' });
    const stateMsg = posted.find((m) => m.type === 'state');
    assert.ok(stateMsg, 'expected a state message after ready');
    const s = stateMsg.state;
    for (const key of ['workspace', 'config', 'hosts', 'lastReport', 'dashboard', 'job', 'log']) {
      assert.ok(Object.prototype.hasOwnProperty.call(s, key), 'state snapshot missing key: ' + key);
    }
    assert.strictEqual(s.workspace.root, '/repo');
    assert.deepStrictEqual(s.hosts.available, ['all', 'claude', 'bob', 'codex', 'vscode', 'generic']);
  });

  // =========================================================================
  // Group 2: handleMessage router dispatch (contract C) — adapted from the
  // subtask-6 scratchpad verification (verify-panel-dispatch.js)
  // =========================================================================

  const { vscode: routerVscode, rec: routerRec } = mkVscode();
  const { TriumphPanelProvider, handleMessage } = freshPanel(routerVscode);

  await t('detectConfig job: calls actions.detectConfig, opens doc, updates state.config, clears job', async () => {
    const actions = makeFakeActions();
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    routerRec.opened.length = 0;
    await handleMessage({ type: 'detectConfig' }, { provider, actions });
    assert.strictEqual(provider.state.config.path, '/repo/.triumph.yml');
    assert.deepStrictEqual(provider.state.config.notes, ['note1']);
    assert.strictEqual(routerRec.opened.length, 1, 'should open the written config in an editor');
    assert.ok(provider.state.log.some((l) => l.text === 'detect done'));
    assert.strictEqual(provider.state.job, null, 'job slot cleared after completion');
  });

  await t('installCourts job: valid host reaches actions.installCourts, refreshes config', async () => {
    const actions = makeFakeActions();
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    await handleMessage({ type: 'installCourts', host: 'all' }, { provider, actions });
    assert.ok(provider.state.log.some((l) => l.text === 'installed all'));
    assert.strictEqual(provider.state.config.exists, true);
  });

  await t('installCourts: invalid host -> error message, action never called', async () => {
    const actions = makeFakeActions({ installCourts: async () => { throw new Error('should not be called'); } });
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    await handleMessage({ type: 'installCourts', host: 'bogus-host' }, { provider, actions });
    assert.ok(provider.state.log.some((l) => l.level === 'error' && /host must be one of/.test(l.text)));
  });

  await t('installCourts: specMissing in result posts specPrompt to webview', async () => {
    const actions = makeFakeActions({
      installCourts: async (ctx, { host }) => {
        ctx.emit({ level: 'info', text: `installed ${host}` });
        return { hosts: [host], files: [], errors: [], specMissing: true, specPath: 'docs/spec.md' };
      },
    });
    const posted = [];
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    provider._view = { webview: { postMessage: (m) => { posted.push(m); return Promise.resolve(true); } } };
    await handleMessage({ type: 'installCourts', host: 'all' }, { provider, actions });
    const prompt = posted.find((m) => m.type === 'specPrompt');
    assert.ok(prompt, 'expected a specPrompt message when specMissing is true');
    assert.strictEqual(prompt.specPath, 'docs/spec.md');
  });

  await t('installCourts: no specPrompt posted when specMissing is false', async () => {
    const actions = makeFakeActions({
      installCourts: async (ctx, { host }) => {
        ctx.emit({ level: 'info', text: `installed ${host}` });
        return { hosts: [host], files: [], errors: [], specMissing: false, specPath: null };
      },
    });
    const posted = [];
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    provider._view = { webview: { postMessage: (m) => { posted.push(m); return Promise.resolve(true); } } };
    await handleMessage({ type: 'installCourts', host: 'all' }, { provider, actions });
    assert.ok(!posted.some((m) => m.type === 'specPrompt'), 'no specPrompt when spec exists');
  });

  await t('runCourt job: legacy single court opens JSON result doc + logs one-line summary', async () => {
    const actions = makeFakeActions();
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    routerRec.opened.length = 0;
    await handleMessage({ type: 'runCourt', court: 'REDLINE' }, { provider, actions });
    assert.strictEqual(routerRec.opened.length, 1);
    assert.ok(provider.state.log.some((l) => l.text.includes('REDLINE: 1 green / 0 red / 0 yellow of 1')));
  });

  await t('runCourt job: multi-court form forwards params (courts, outputTarget, timeoutSeconds)', async () => {
    let seen = null;
    const actions = makeFakeActions({
      runCourt: async (ctx, params) => { seen = params; return { courts: Object.fromEntries(params.courts.map((c) => [c, { kind: 'complete', payload: { summary: { green: 1, red: 0, yellow: 0, total: 1 } } }])) };
      },
    });
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    routerRec.opened.length = 0;
    await handleMessage({ type: 'runCourt', courts: ['REDLINE', 'WARPATH'], outputTarget: 'local', timeoutSeconds: 120 }, { provider, actions });
    assert.ok(seen, 'runCourt action must be called');
    assert.deepStrictEqual(seen.courts, ['REDLINE', 'WARPATH']);
    assert.strictEqual(seen.outputTarget, 'local');
    assert.strictEqual(seen.timeoutSeconds, 120);
    assert.strictEqual(routerRec.opened.length, 1);
    // Job slot transitions must surface via onJobChange when wired.
  });

  await t('runCourt: invalid courts selection -> error message, action never called', async () => {
    const actions = makeFakeActions({ runCourt: async () => { throw new Error('should not be called'); } });
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    await handleMessage({ type: 'runCourt', court: 'NOPE' }, { provider, actions });
    assert.ok(provider.state.log.some((l) => l.level === 'error' && /court must be one of/.test(l.text)));
    await handleMessage({ type: 'runCourt', courts: [] }, { provider, actions });
    assert.ok(provider.state.log.some((l) => l.level === 'error' && /non-empty distinct subset/.test(l.text)));
    await handleMessage({ type: 'runCourt', courts: ['REDLINE', 'REDLINE'] }, { provider, actions });
    assert.ok(provider.state.log.filter((l) => l.level === 'error' && /non-empty distinct subset/.test(l.text)).length >= 2);
    await handleMessage({ type: 'runCourt', courts: ['REDLINE'], outputTarget: 'cloud' }, { provider, actions });
    assert.ok(provider.state.log.some((l) => l.level === 'error' && /outputTarget must be/.test(l.text)));
    await handleMessage({ type: 'runCourt', courts: ['REDLINE'], timeoutSeconds: -5 }, { provider, actions });
    assert.ok(provider.state.log.some((l) => l.level === 'error' && /timeoutSeconds must be a positive number/.test(l.text)));
  });

  await t('generateReport job: updates state.lastReport via findLastReport', async () => {
    const actions = makeFakeActions();
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    await handleMessage({ type: 'generateReport' }, { provider, actions });
    assert.strictEqual(provider.state.lastReport.htmlPath, '/repo/h.html');
    assert.ok(provider.state.log.some((l) => l.text === 'report written: h, m'));
  });

  await t('openLastReport html: opens/reuses the singleton triumphReport WebviewPanel', async () => {
    const actions = makeFakeActions();
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    const origRead = fs.readFileSync;
    fs.readFileSync = (p, enc) => (String(p).endsWith('.html') ? '<html>ok</html>' : origRead(p, enc));
    try {
      routerRec.createdPanels.length = 0;
      await handleMessage({ type: 'openLastReport', format: 'html' }, { provider, actions });
      assert.strictEqual(routerRec.createdPanels.length, 1, 'first call creates the panel');
      await handleMessage({ type: 'openLastReport', format: 'html' }, { provider, actions });
      assert.strictEqual(routerRec.createdPanels.length, 1, 'second call reuses the singleton, not a new panel');
      assert.strictEqual(routerRec.createdPanels[0].revealed.length, 1, 'reused panel is revealed');
    } finally { fs.readFileSync = origRead; }
  });

  await t('openLastReport md: opens the markdown file in an editor', async () => {
    const actions = makeFakeActions();
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    routerRec.opened.length = 0;
    await handleMessage({ type: 'openLastReport', format: 'md' }, { provider, actions });
    assert.strictEqual(routerRec.opened.length, 1);
  });

  await t('openLastReport: invalid format -> error, no dispatch', async () => {
    const actions = makeFakeActions({ findLastReport: () => { throw new Error('should not be called'); } });
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    await handleMessage({ type: 'openLastReport', format: 'pdf' }, { provider, actions });
    assert.ok(provider.state.log.some((l) => l.level === 'error' && /format must be/.test(l.text)));
  });

  await t('openLastReport: no report yet -> error, no throw', async () => {
    const actions = makeFakeActions({ findLastReport: () => null });
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    await handleMessage({ type: 'openLastReport', format: 'html' }, { provider, actions });
    assert.ok(provider.state.log.some((l) => l.level === 'error' && /no report yet/.test(l.text)));
  });

  await t('openLastReport: no workspace -> "Open a workspace folder first." error', async () => {
    const actions = makeFakeActions();
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => null, enginePath: () => '/e.js' });
    await handleMessage({ type: 'openLastReport', format: 'html' }, { provider, actions });
    assert.ok(provider.state.log.some((l) => l.level === 'error' && l.text === 'Open a workspace folder first.'));
  });

  await t('dashboardRun job: updates state.dashboard.url', async () => {
    const actions = makeFakeActions();
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js', dashboardCmd: { isConnected: () => true } });
    await handleMessage({ type: 'dashboardRun' }, { provider, actions });
    assert.strictEqual(provider.state.dashboard.url, 'http://dash/1');
  });

  await t('dashboardOpen: no url set -> error, no throw', async () => {
    const actions = makeFakeActions();
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    await handleMessage({ type: 'dashboardOpen' }, { provider, actions });
    assert.ok(provider.state.log.some((l) => l.level === 'error' && /no dashboard run yet/.test(l.text)));
  });

  await t('dashboardOpen: url set -> openExternal called', async () => {
    const actions = makeFakeActions();
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    provider.state.dashboard.url = 'http://dash/9';
    routerRec.opened.length = 0;
    await handleMessage({ type: 'dashboardOpen' }, { provider, actions });
    assert.strictEqual(routerRec.opened.length, 1);
  });

  await t('dashboardStatus: refreshes connected + posts state, no job', async () => {
    const actions = makeFakeActions();
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js', dashboardCmd: { isConnected: () => true } });
    await handleMessage({ type: 'dashboardStatus' }, { provider, actions });
    assert.strictEqual(provider.state.dashboard.connected, true);
    assert.strictEqual(provider.state.job, null);
  });

  await t('openConfig: no workspace -> "Open a workspace folder first." error', async () => {
    const actions = makeFakeActions();
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => null, enginePath: () => '/e.js' });
    await handleMessage({ type: 'openConfig' }, { provider, actions });
    assert.ok(provider.state.log.some((l) => l.level === 'error' && l.text === 'Open a workspace folder first.'));
  });

  await t('openConfig: config exists -> opens it in an editor', async () => {
    const actions = makeFakeActions();
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    routerRec.opened.length = 0;
    await handleMessage({ type: 'openConfig' }, { provider, actions });
    assert.strictEqual(routerRec.opened.length, 1);
  });

  await t('unknown message type is dropped with a warn log, nothing dispatched', async () => {
    const actions = makeFakeActions({
      detectConfig: async () => { throw new Error('must not dispatch anything'); },
    });
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    await handleMessage({ type: 'notAThing' }, { provider, actions });
    assert.ok(provider.state.log.some((l) => l.level === 'warn' && /unknown message type/.test(l.text)));
  });

  await t('no actions module wired: job message is dropped (warn), never throws', async () => {
    const provider = new TriumphPanelProvider({ repoRoot: () => '/repo', enginePath: () => '/e.js' });
    await handleMessage({ type: 'detectConfig' }, { provider, actions: null });
    assert.ok(provider.state.log.some((l) => l.level === 'warn' && /no actions module wired/.test(l.text)));
  });

  await t('single-flight: second job while one is running gets "already running" error, second action not called', async () => {
    let resolveFirst;
    let secondCalled = false;
    const actions = makeFakeActions({
      detectConfig: async () => new Promise((res) => { resolveFirst = res; }),
      generateReport: async () => { secondCalled = true; return { htmlPath: 'h', mdPath: 'm', generatedAt: 'x' }; },
    });
    const provider = new TriumphPanelProvider({ actions, repoRoot: () => '/repo', enginePath: () => '/e.js' });
    const p1 = handleMessage({ type: 'detectConfig' }, { provider, actions });
    await handleMessage({ type: 'generateReport' }, { provider, actions }); // should bounce immediately
    assert.ok(provider.state.log.some((l) => l.level === 'error' && /already running/.test(l.text)));
    assert.strictEqual(secondCalled, false, 'generateReport must not run while detectConfig job is in flight');
    resolveFirst({ path: '/repo/.triumph.yml', notes: [] });
    await p1;
  });

  // =========================================================================
  // Group 3: src/actions.js unit checks with a fake McpClient (contract B)
  // =========================================================================

  const actionsMod = require('../src/actions.js');

  function makeFakeMcpClient(behavior) {
    const calls = [];
    let disposed = false;
    class FakeMcpClient {
      constructor(enginePath, root) { this.enginePath = enginePath; this.root = root; }
      async start() { if (behavior.startError) throw behavior.startError; }
      async call(name, args) {
        calls.push(name);
        if (behavior.callError && behavior.callError[name]) throw behavior.callError[name];
        return (behavior.responses && behavior.responses[name]) || {};
      }
      dispose() { disposed = true; }
    }
    return { FakeMcpClient, calls, isDisposed: () => disposed };
  }

  await t('runCourt REDLINE: calls redline_verdict_all, disposes the client, writes a local report', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-run-'));
    try {
      const { FakeMcpClient, calls, isDisposed } = makeFakeMcpClient({ responses: { redline_verdict_all: { summary: { green: 1, red: 0, yellow: 0, total: 1 }, results: [] } } });
      const emitted = [];
      const steps = [];
      const result = await actionsMod.runCourt(
        { root: tmp, enginePath: '/e.js', emit: (e) => emitted.push(e), emitStep: (s) => steps.push(s), McpClient: FakeMcpClient },
        { court: 'REDLINE' }
      );
      assert.deepStrictEqual(calls, ['redline_verdict_all']);
      assert.ok(isDisposed(), 'client must be disposed');
      assert.strictEqual(result.courts.REDLINE.kind, 'complete');
      assert.strictEqual(result.courts.REDLINE.payload.summary.green, 1);
      // Local target: report artifacts written, JSON input included by default.
      assert.ok(result.report && fs.existsSync(path.join(tmp, 'reports', 'triumph', 'triumph-input.json')));
      assert.ok(steps.some((s) => s.status === 'success' && /clause tests complete/.test(s.text)), 'step feed must narrate the run');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await t('runCourt REDLINE: engine failure is contained per-court and the client is still disposed', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-run-'));
    try {
      const { FakeMcpClient, isDisposed } = makeFakeMcpClient({ callError: { redline_verdict_all: new Error('engine boom') } });
      const result = await actionsMod.runCourt(
        { root: tmp, enginePath: '/e.js', emit: () => {}, McpClient: FakeMcpClient }, { court: 'REDLINE' });
      assert.ok(isDisposed(), 'client must be disposed even on failure');
      assert.strictEqual(result.courts.REDLINE.kind, 'error');
      assert.match(result.courts.REDLINE.error, /engine boom/);
      assert.ok(Array.isArray(result.errors) && result.errors.length === 1);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await t('runCourt SPLITBRAIN: status "started" -> polls splitbrain_status, streams mutation events, then trustgap', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-run-'));
    try {
      const responses = {
        splitbrain_mutate: { status: 'started', job_id: 'j1' },
        splitbrain_status: { status: 'done', progress: [{ tested: 3, total: 4, line: '3/4 Mutants' }], elapsedSeconds: 2 },
        splitbrain_trustgap: { status: 'ok', trustGap: 0.25, honestMutationScore: 0.75 },
      };
      const { FakeMcpClient, calls } = makeFakeMcpClient({ responses });
      const mutations = [];
      const steps = [];
      const result = await actionsMod.runCourt(
        { root: tmp, enginePath: '/e.js', emit: () => {}, emitStep: (s) => steps.push(s), emitMutation: (e, sig) => mutations.push({ e, sig }), McpClient: FakeMcpClient },
        { court: 'SPLITBRAIN' }
      );
      assert.deepStrictEqual(calls, ['splitbrain_mutate', 'splitbrain_status', 'splitbrain_trustgap']);
      assert.strictEqual(result.courts.SPLITBRAIN.kind, 'complete');
      assert.strictEqual(result.courts.SPLITBRAIN.payload.trustGap, 0.25);
      assert.ok(mutations.some((m) => m.e && m.e.tested === 3), 'progress events must stream live');
      assert.ok(mutations.some((m) => m.sig === 'done'), 'a done signal must terminate the stream');
      assert.ok(steps.some((s) => /Mutation job j1 started/.test(s.text)));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await t('runCourt SPLITBRAIN: mutation job error -> per-court error, no trustgap evidence', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-run-'));
    try {
      const responses = {
        splitbrain_mutate: { status: 'started', job_id: 'j2' },
        splitbrain_status: { status: 'error', error: 'runner exploded', progress: [] },
      };
      const { FakeMcpClient, calls } = makeFakeMcpClient({ responses });
      const result = await actionsMod.runCourt(
        { root: tmp, enginePath: '/e.js', emit: () => {}, McpClient: FakeMcpClient },
        { court: 'SPLITBRAIN' }
      );
      assert.deepStrictEqual(calls, ['splitbrain_mutate', 'splitbrain_status']);
      assert.strictEqual(result.courts.SPLITBRAIN.kind, 'error');
      assert.match(result.courts.SPLITBRAIN.error, /runner exploded/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await t('runCourt SPLITBRAIN: status not "started" -> falls through to precomputed trustgap', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-run-'));
    try {
      const { FakeMcpClient, calls } = makeFakeMcpClient({ responses: { splitbrain_mutate: { status: 'skipped' }, splitbrain_trustgap: { trustGap: 0.1 } } });
      const result = await actionsMod.runCourt(
        { root: tmp, enginePath: '/e.js', emit: () => {}, McpClient: FakeMcpClient },
        { court: 'SPLITBRAIN' }
      );
      assert.deepStrictEqual(calls, ['splitbrain_mutate', 'splitbrain_trustgap']);
      assert.strictEqual(result.courts.SPLITBRAIN.payload.trustGap, 0.1);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await t('runCourt: multiple courts run in selection order; one failure never blocks the rest', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-run-'));
    try {
      const { FakeMcpClient, calls } = makeFakeMcpClient({
        responses: { redline_verdict_all: { summary: { green: 2, red: 0, yellow: 0, total: 2 } }, warpath_triage: { incidentWindow: null } },
        callError: { splitbrain_mutate: new Error('mutator down') },
      });
      const result = await actionsMod.runCourt(
        { root: tmp, enginePath: '/e.js', emit: () => {}, McpClient: FakeMcpClient },
        { courts: ['REDLINE', 'SPLITBRAIN', 'WARPATH'] });
      assert.deepStrictEqual(calls, ['redline_verdict_all', 'splitbrain_mutate', 'warpath_triage']);
      assert.strictEqual(result.courts.REDLINE.kind, 'complete');
      assert.strictEqual(result.courts.SPLITBRAIN.kind, 'error');
      assert.strictEqual(result.courts.WARPATH.kind, 'complete');
      assert.strictEqual(result.errors.length, 1);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await t('runCourt: report formats honored (json only -> no html/md)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-run-'));
    try {
      const { FakeMcpClient } = makeFakeMcpClient({ responses: { redline_verdict_all: { summary: { green: 1, red: 0, yellow: 0, total: 1 }, results: [] } } });
      const result = await actionsMod.runCourt(
        { root: tmp, enginePath: '/e.js', emit: () => {}, McpClient: FakeMcpClient },
        { court: 'REDLINE', formats: ['json'] });
      const outDir = path.join(tmp, 'reports', 'triumph');
      assert.ok(fs.existsSync(path.join(outDir, 'triumph-input.json')));
      assert.ok(!fs.existsSync(path.join(outDir, 'triumph-report.html')), 'html must not be written when unchecked');
      assert.ok(!fs.existsSync(path.join(outDir, 'triumph-report.md')), 'md must not be written when unchecked');
      assert.strictEqual(result.report.htmlPath, null);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await t('runCourt: no root -> throws "Open a workspace folder first.", never starts a client', async () => {
    let started = false;
    class SpyMcpClient { async start() { started = true; } async call() { return {}; } dispose() {} }
    await assert.rejects(
      actionsMod.runCourt({ root: null, enginePath: '/e.js', emit: () => {}, McpClient: SpyMcpClient }, { court: 'REDLINE' }),
      /Open a workspace folder first\./
    );
    assert.strictEqual(started, false);
  });

  for (const fn of ['detectConfig', 'installCourts', 'generateReport', 'dashboardRun']) {
    await t(`${fn}: no root -> throws "Open a workspace folder first."`, async () => {
      await assert.rejects(
        actionsMod[fn]({ root: null, enginePath: '/e.js', emit: () => {} }, {}),
        /Open a workspace folder first\./
      );
    });
  }

  await t('findLastReport: no reports/triumph dir yet -> null', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-panel-test-'));
    try {
      assert.strictEqual(actionsMod.findLastReport(tmp), null);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await t('findLastReport: null root -> null (no fs access)', () => {
    assert.strictEqual(actionsMod.findLastReport(null), null);
  });

  await t('findLastReport: html+md+triumph-input.json present -> summary + paths + per-court verdicts + ISO generatedAt', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-panel-test-'));
    try {
      const outDir = path.join(tmp, 'reports', 'triumph');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'triumph-report.html'), '<html></html>', 'utf8');
      fs.writeFileSync(path.join(outDir, 'triumph-report.md'), '# report', 'utf8');
      fs.writeFileSync(path.join(outDir, 'triumph-input.json'), JSON.stringify({
        redline: { summary: { green: 2, red: 1, yellow: 0, total: 3 } },
        splitbrain: { trustGap: 0.12, honestMutationScore: 0.8 },
        warpath: { incidentWindow: '2026-09-25T20:00Z' },
      }), 'utf8');
      const report = actionsMod.findLastReport(tmp);
      assert.ok(report);
      assert.strictEqual(report.htmlPath, path.join(outDir, 'triumph-report.html'));
      assert.strictEqual(report.mdPath, path.join(outDir, 'triumph-report.md'));
      assert.ok(!isNaN(Date.parse(report.generatedAt)), 'generatedAt must be a parseable ISO date');
      assert.deepStrictEqual(report.summary, { green: 2, red: 1, yellow: 0, total: 3 });
      // Verdict scorecard data: per-court payloads exposed verbatim.
      assert.strictEqual(report.splitbrain.trustGap, 0.12);
      assert.strictEqual(report.warpath.incidentWindow, '2026-09-25T20:00Z');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await t('findLastReport: html present but no .md, no triumph-input.json -> mdPath null, summary null', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-panel-test-'));
    try {
      const outDir = path.join(tmp, 'reports', 'triumph');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'triumph-report.html'), '<html></html>', 'utf8');
      const report = actionsMod.findLastReport(tmp);
      assert.ok(report);
      assert.strictEqual(report.mdPath, null);
      assert.strictEqual(report.summary, null);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  // =========================================================================
  // Group 4: src/dashboard.js onConnectionChange (contract D — no polling)
  // =========================================================================

  await t('onConnectionChange listener fires with false when stopSession() runs with no active session', async () => {
    const dashboardCmd = require('../src/dashboard.js');
    assert.strictEqual(typeof dashboardCmd.onConnectionChange, 'function');
    const fired = [];
    const sub = dashboardCmd.onConnectionChange((connected) => fired.push(connected));
    try {
      await dashboardCmd.stopSession(); // no session registered — must not throw
      assert.ok(fired.length >= 1, 'listener must fire at least once from stopAll\'s finally');
      assert.strictEqual(fired[fired.length - 1], false);
      assert.strictEqual(dashboardCmd.isConnected(), false);
    } finally { sub.dispose(); }
  });

  await t('onConnectionChange: dispose() stops further notifications', async () => {
    const dashboardCmd = require('../src/dashboard.js');
    const fired = [];
    const sub = dashboardCmd.onConnectionChange((connected) => fired.push(connected));
    sub.dispose();
    await dashboardCmd.stopSession();
    assert.strictEqual(fired.length, 0, 'a disposed listener must not fire');
  });

  await t('panel provider: logs "dashboard disconnected" on true->false via a fake dashboardCmd, and stops on dispose()', () => {
    const { vscode } = mkVscode();
    const { TriumphPanelProvider } = freshPanel(vscode);
    const listeners = new Set();
    const fakeDashboardCmd = {
      isConnected: () => false,
      onConnectionChange: (fn) => { listeners.add(fn); return { dispose() { listeners.delete(fn); } }; },
    };
    const fire = (v) => { for (const fn of listeners) fn(v); };

    const posted = [];
    const provider = new TriumphPanelProvider({ repoRoot: () => null, enginePath: () => 'x', dashboardCmd: fakeDashboardCmd });
    provider._post = (msg) => posted.push(msg);

    assert.strictEqual(provider.state.dashboard.connected, false);

    posted.length = 0;
    fire(true);
    assert.strictEqual(provider.state.dashboard.connected, true);
    assert.ok(posted.some((m) => m.type === 'log' && m.entry.level === 'info' && m.entry.text === 'dashboard connected'));

    posted.length = 0;
    fire(false);
    assert.strictEqual(provider.state.dashboard.connected, false);
    assert.ok(posted.some((m) => m.type === 'log' && m.entry.level === 'warn' && m.entry.text === 'dashboard disconnected'));
    assert.ok(posted.some((m) => m.type === 'state' && m.state.dashboard.connected === false));

    posted.length = 0;
    fire(false); // no-op (same value) — must not post again
    assert.strictEqual(posted.length, 0);

    provider.dispose();
    posted.length = 0;
    fire(true);
    assert.strictEqual(posted.length, 0, 'after dispose(), connection changes must not reach the provider');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

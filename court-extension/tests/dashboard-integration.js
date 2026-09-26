'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { McpClient } = require('../src/mcp-client');
const integration = require('../src/dashboard');
const { projectId } = require('../lib/convert');

async function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      let raw = ''; res.on('data', (x) => raw += x); res.on('end', () => resolve({ code: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject); req.end(data);
  });
}
async function get(url) {
  const res = await fetch(url);
  return { code: res.status, body: await res.json() };
}
const waitFor = async (fn) => {
  for (let i = 0; i < 100; i++) { const result = await fn(); if (result) return result; await new Promise((r) => setTimeout(r, 75)); }
  throw new Error('Timed out waiting for dashboard rerun');
};
(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-integration-'));
  const root = path.join(base, 'project'); fs.mkdirSync(root);
  fs.mkdirSync(path.join(root, 'spec')); fs.writeFileSync(path.join(root, 'spec', 'contract.md'), '# spec');
  fs.mkdirSync(path.join(root, 'tests'));
  fs.mkdirSync(path.join(root, 'fixtures'));
  fs.writeFileSync(path.join(root, 'fixtures', 'metrics.json'), '{}');
  fs.writeFileSync(path.join(root, 'fixtures', 'deploy.json'), '{}');
  fs.writeFileSync(path.join(root, '.triumph.json'), JSON.stringify({ spec: { path: 'spec/contract.md' }, mutation: { command: null } }));
  const other = path.join(base, 'other'); fs.mkdirSync(other);
  const vscode = { workspace: { workspaceFolders: [{ uri: { fsPath: other, toString: () => 'file:///wrong' } },
    { uri: { fsPath: root, toString: () => 'file:///right' } }] } };
  assert.strictEqual(integration.projectFor(vscode, root).id, projectId(require('url').pathToFileURL(fs.realpathSync(root)).href));
  assert.notStrictEqual(integration.projectFor(vscode, root).id, integration.projectFor(vscode, other).id);
  assert.strictEqual(integration.outcome('splitbrain', { status: 'not-run' }).kind, 'unavailable');
  assert.strictEqual(integration.outcome('redline', { status: 'error', detail: 'no parse' }).kind, 'error');
  assert.strictEqual(integration.outcome('warpath', { status: 'no-signal-window' }).kind, 'unavailable');
  const cfg = integration.preflight(root);
  assert.ok(cfg.reasons.splitbrain && !cfg.reasons.redline && !cfg.reasons.warpath);
  const mutationCfg = { mutation: { command: 'mutate', timeoutSeconds: 2, absReport: path.join(root, 'mutation.json') }, evidence: { trustgap: path.join(root, 'absent.json') } };
  const mutationCalls = [];
  const mutation = await integration.collectCourts({ call: async (name) => {
    mutationCalls.push(name);
    if (name === 'splitbrain_mutate') return { status: 'started', job_id: 'job' };
    if (name === 'splitbrain_status') return { status: 'done' };
    throw Error('stale report should not be consumed');
  } }, root, ['splitbrain'], {}, mutationCfg);
  assert.strictEqual(mutation.splitbrain.kind, 'error');
  assert.match(mutation.splitbrain.errors[0], /fresh report/);
  assert.deepStrictEqual(mutationCalls, ['splitbrain_mutate', 'splitbrain_status']);
  const calls = [];
  const originals = [McpClient.prototype.start, McpClient.prototype.call, McpClient.prototype.dispose];
  McpClient.prototype.start = async function () {};
  McpClient.prototype.dispose = function () {};
  McpClient.prototype.call = async function (name) {
    calls.push(name);
    if (name === 'redline_verdict_all') return { court: 'REDLINE', summary: { green: 0, red: 1, total: 1 }, results: [{ clause: 'W1', status: 'red' }] };
    if (name === 'warpath_triage' && blockWarpath) { enteredWarpath = true; await blockWarpath; }
    if (name === 'warpath_triage') return { court: 'WARPATH', incidentWindow: '2026-01-01..2026-01-02', suspect: null };
    throw Error('unexpected tool ' + name);
  };
  const errors = []; let opened;
  let blockWarpath = null; let enteredWarpath = false;
  try {
    const options = { root, enginePath: '/unused', historyDir: path.join(base, 'history'), pollIntervalMs: 300,
      onError: (e) => errors.push(e), openExternal: async (url) => { opened = url; } };
    const first = await integration.runAndPublish(vscode, { ...options, requested: ['redline', 'splitbrain', 'warpath'] });
    const session = await integration.startSession(vscode, options);
    assert.strictEqual(session.dash.connected, true, 'child must survive publication');
    assert.strictEqual(opened, first.url);
    const original = await get(first.url.replace(/\/projects\/.*/, `/api/projects/${session.project.id}/runs/${first.runId}`));
    assert.strictEqual(original.code, 200);
    const request = await post(`${session.dash.url}/api/projects/${session.project.id}/run`, { courts: ['warpath'] });
    assert.strictEqual(request.code, 202);
    const placeholder = await get(`${session.dash.url}/api/projects/${session.project.id}/runs/${request.body.runId}`);
    assert.strictEqual(placeholder.body.state, 'running');
    const completed = await waitFor(async () => {
      const r = await get(`${session.dash.url}/api/projects/${session.project.id}/runs/${request.body.runId}`);
      return r.body?.state === 'complete' ? r.body : null;
    });
    assert.strictEqual(completed.revision, 1);
    assert.strictEqual(completed.createdAt, placeholder.body.createdAt);
    assert.strictEqual(completed.redline.state, 'not_run');
    assert.strictEqual(completed.warpath.state, 'complete');
    assert.deepStrictEqual(calls, ['redline_verdict_all', 'warpath_triage', 'warpath_triage']);
    assert.deepStrictEqual(errors, []);

    // A real second editor project must join the same child, not open the
    // history a second time and recover A's browser placeholder as interrupted.
    const rootB = path.join(base, 'second-project');
    fs.cpSync(root, rootB, { recursive: true });
    let release;
    blockWarpath = new Promise((resolve) => { release = resolve; });
    try {
      const aRequest = await post(`${session.dash.url}/api/projects/${session.project.id}/run`, { courts: ['warpath'] });
      assert.strictEqual(aRequest.code, 202);
      await waitFor(async () => enteredWarpath);
      const b = await integration.startSession(vscode, { ...options, root: rootB });
      assert.strictEqual(b.dash.child, session.dash.child, 'only one dashboard process');
      assert.strictEqual(b.dash.url, session.dash.url, 'both projects share a browser URL');
      assert.notStrictEqual(b.dash.token, session.dash.token, 'credentials are per project');
      const aPending = await get(`${b.dash.url}/api/projects/${session.project.id}/runs/${aRequest.body.runId}`);
      assert.strictEqual(aPending.body.state, 'running', 'B registration must not recover A as interrupted');
      const listed = await get(`${b.dash.url}/api/projects`);
      assert.ok(listed.body.some((p) => p.id === session.project.id && p.connected));
      assert.ok(listed.body.some((p) => p.id === b.project.id && p.connected));
      const bRun = await integration.runAndPublish(vscode, { ...options, root: rootB, requested: ['redline'] });
      assert.ok(bRun.url.startsWith(`${session.dash.url}/projects/${b.project.id}/`));
      const bRequest = await post(`${session.dash.url}/api/projects/${b.project.id}/run`, { courts: ['redline'] });
      assert.strictEqual(bRequest.code, 202);
      const bComplete = await waitFor(async () => {
        const result = await get(`${session.dash.url}/api/projects/${b.project.id}/runs/${bRequest.body.runId}`);
        return result.body?.state === 'complete' ? result.body : null;
      });
      assert.strictEqual(bComplete.revision, 1);
      assert.strictEqual(bComplete.project.id, b.project.id);
      assert.strictEqual((await get(`${session.dash.url}/api/projects/${session.project.id}/runs/${aRequest.body.runId}`)).body.state, 'running');
      const bPendingRequest = await post(`${session.dash.url}/api/projects/${b.project.id}/run`, { courts: ['redline'] });
      assert.strictEqual(bPendingRequest.code, 202);
      clearInterval(b.timer);
      b.controller.abort();
      await b.dash.stop();
      const interruptedB = await get(`${session.dash.url}/api/projects/${b.project.id}/runs/${bPendingRequest.body.runId}`);
      assert.strictEqual(interruptedB.body.state, 'interrupted', 'only disconnected B is interrupted');
      const stillRunningA = await get(`${session.dash.url}/api/projects/${session.project.id}/runs/${aRequest.body.runId}`);
      assert.strictEqual(stillRunningA.body.state, 'running');
      release(); blockWarpath = null;
      const aComplete = await waitFor(async () => {
        const result = await get(`${b.dash.url}/api/projects/${session.project.id}/runs/${aRequest.body.runId}`);
        return result.body?.state === 'complete' ? result.body : null;
      });
      assert.strictEqual(aComplete.revision, 1);
      assert.strictEqual(aComplete.project.id, session.project.id);
      const after = await get(`${session.dash.url}/api/projects`);
      assert.strictEqual(after.body.find((p) => p.id === b.project.id).connected, false);
      assert.strictEqual(after.body.find((p) => p.id === session.project.id).connected, true);
      assert.strictEqual((await post(`${session.dash.url}/api/projects/${b.project.id}/run`, { courts: ['redline'] })).code, 409);
      assert.strictEqual((await post(`${b.dash.url}/api/projects/${session.project.id}/run`, { courts: ['redline'] })).code, 202,
        'browser opened from B can still request A');
      assert.deepStrictEqual(errors, []);
      await integration.stopAll();
      const [reopenedA, reopenedB] = await Promise.all([
        integration.startSession(vscode, options),
        integration.startSession(vscode, { ...options, root: rootB }),
      ]);
      assert.strictEqual(reopenedA.dash.child, reopenedB.dash.child, 'concurrent registrations fork once');
      assert.strictEqual(reopenedA.dash.url, reopenedB.dash.url);
      assert.strictEqual((await reopenedA.dash.heartbeat()).connected, true);
      assert.strictEqual((await reopenedB.dash.heartbeat()).connected, true);
      await integration.stopAll();
    } finally { release(); blockWarpath = null; }
    console.log('  ok  two extension projects, one child/port, pending A survives B, per-project requests and disconnect');
    console.log('  ok  live child, selected-project identity, real evidence, browser rerun and revisions');
  } finally {
    await integration.stopAll();
    [McpClient.prototype.start, McpClient.prototype.call, McpClient.prototype.dispose] = originals;
    fs.rmSync(base, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });

#!/usr/bin/env node
// Test the actual VSIX as a clean checkout would: extract it away from source,
// boot only the shipped dashboard, exercise IPC + HTTP + rerun + persisted history.
import { fork, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const archive = path.resolve(process.argv[2] || path.join(here, '../court-extension/triumph-courts.vsix'));
const dir = mkdtempSync(path.join(tmpdir(), 'triumph-vsix-test-'));
const entry = path.join(dir, 'extension/dashboard/server/index.js');
const project = { id: randomUUID(), name: 'isolated-vsix-fixture' };
const runId = randomUUID();
let child;
function waitFor(type, requestId, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${type}`)); }, timeout);
    const onMessage = (message) => {
      if (message?.type === type && (requestId === undefined || message.requestId === requestId)) { cleanup(); resolve(message); }
      if (message?.type === 'triumph.registrationError' && message.requestId === requestId) { cleanup(); reject(new Error(message.error)); }
    };
    const onExit = (code) => { cleanup(); reject(new Error(`Dashboard exited ${code} before ${type}`)); };
    const cleanup = () => { clearTimeout(timer); child.off('message', onMessage); child.off('exit', onExit); };
    child.on('message', onMessage); child.on('exit', onExit);
  });
}
async function start() {
  child = fork(entry, [], {
    cwd: path.dirname(path.dirname(entry)), stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, PORT: '0', TRIUMPH_HOST: '127.0.0.1', XDG_DATA_HOME: path.join(dir, 'history') },
  });
  let error = '';
  child.stderr.on('data', (chunk) => { error += chunk; });
  const ready = await waitFor('triumph.ready').catch((e) => { throw new Error(`${e.message}\n${error}`); });
  assert.match(ready.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const requestId = randomUUID();
  const registered = waitFor('triumph.registered', requestId);
  child.send({ type: 'triumph.register', requestId, project });
  const { token } = await registered;
  assert.match(token, /^[0-9a-f]{64}$/);
  return { url: ready.url, token };
}
async function stop() {
  if (!child) return;
  const old = child; child = undefined;
  const exited = new Promise((resolve) => {
    if (old.exitCode !== null) return resolve();
    old.once('exit', resolve);
    setTimeout(() => { try { old.kill('SIGKILL'); } catch {} resolve(); }, 5000).unref();
  });
  old.kill(); await exited;
}
function snapshot(revision, createdAt, id = runId) {
  const empty = { state: 'not_run', collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] };
  const now = new Date().toISOString();
  return {
    schemaVersion: 2, project, runId: id, createdAt, updatedAt: now, revision, state: 'complete',
    checkedOutCommit: null, branch: null, workingTreeDirty: null,
    producer: { name: 'isolated-vsix-test', version: '1' },
    redline: { state: 'complete', collectedAt: now, sourceGeneratedAt: null, payload: { summary: { red: 1, green: 0 }, results: [{ clause: 'W1', status: 'red' }] }, errors: [] },
    splitbrain: empty, warpath: empty,
  };
}
async function request(base, route, method = 'GET', body, token) {
  const response = await fetch(base + route, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
  });
  const content = await response.text();
  let data = null;
  try { data = JSON.parse(content); } catch {}
  return { status: response.status, data };
}
try {
  if (!existsSync(archive)) throw new Error(`VSIX missing: ${archive}`);
  execFileSync('unzip', ['-q', archive, '-d', dir]);
  if (!existsSync(entry)) throw new Error('VSIX has no dashboard server');
  const first = await start();
  const createdAt = new Date().toISOString();
  assert.equal((await request(first.url, `/api/extension/${project.id}/runs`, 'POST', snapshot(0, createdAt))).status, 403);
  assert.equal((await request(first.url, `/api/extension/${project.id}/runs`, 'POST', snapshot(0, createdAt), first.token)).status, 201);
  const detail = await request(first.url, `/api/projects/${project.id}/runs/${runId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.redline.payload.results[0].status, 'red');
  assert.equal((await request(first.url, `/api/projects/${project.id}/run`, 'POST', { courts: ['redline'] })).status, 202);
  const pending = await request(first.url, `/api/extension/${project.id}/requests`, 'GET', undefined, first.token);
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.data.request.courts, ['redline']);
  const rerun = pending.data.request;
  assert.equal((await request(first.url, `/api/extension/${project.id}/requests/${rerun.requestId}/ack`, 'POST', {}, first.token)).status, 200);
  assert.equal((await request(first.url, `/api/extension/${project.id}/runs`, 'POST', snapshot(1, rerun.createdAt, rerun.runId), first.token)).status, 201);
  assert.equal((await request(first.url, `/api/projects/${project.id}/runs/${rerun.runId}`)).data.revision, 1);
  await stop();
  const second = await start();
  assert.equal((await request(second.url, `/api/projects/${project.id}/runs/${runId}`)).data.redline.payload.summary.red, 1);
  const runs = await request(second.url, `/api/projects/${project.id}/runs`);
  assert.equal(runs.status, 200);
  assert.equal(runs.data.length, 2);
  await stop();

  // Load the shipped extension integration itself from the extracted archive;
  // no sibling checkout, source import or globally installed module is allowed.
  const extensionRoot = path.join(dir, 'extension');
  const require = createRequire(path.join(extensionRoot, 'package.json'));
  const integration = require('./src/dashboard.js');
  const root = path.join(dir, 'unrelated-project');
  mkdirSync(root);
  const identity = integration.projectFor(null, root);
  let opened;
  const opts = { root, enginePath: path.join(extensionRoot, 'court.js'),
    historyDir: path.join(dir, 'extension-history'), pollIntervalMs: 50,
    openExternal: async (url) => { opened = url; } };
  const vscode = { workspace: { workspaceFolders: [{ uri: { fsPath: root } }] } };
  try {
    const initial = await integration.runAndPublish(vscode, opts);
    assert.equal(opened, initial.url);
    const browser = (await integration.startSession(vscode, opts)).dash.url;
    const report = await request(browser, `/api/projects/${identity.id}/runs/${initial.runId}`);
    assert.equal(report.status, 200);
    for (const court of ['redline', 'splitbrain', 'warpath']) {
      assert.equal(report.data[court].state, 'unavailable', `missing ${court} evidence must never pass`);
      assert.equal(report.data[court].payload, null);
    }
    const rerun = await request(browser, `/api/projects/${identity.id}/run`, 'POST', { courts: ['redline'] });
    assert.equal(rerun.status, 202);
    let completed;
    for (let n = 0; n < 100; n++) {
      const next = await request(browser, `/api/projects/${identity.id}/runs/${rerun.data.runId}`);
      if (next.data?.state === 'complete') { completed = next.data; break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(completed, 'shipped extension did not process browser rerun');
    assert.equal(completed.revision, 1);
    assert.equal(completed.redline.state, 'unavailable');
    assert.equal(completed.splitbrain.state, 'not_run');
    await integration.stopAll();
    const reopened = await integration.runAndPublish(vscode, opts);
    const base = new URL(reopened.url).origin;
    assert.equal((await request(base, `/api/projects/${identity.id}/runs/${initial.runId}`)).data.redline.state, 'unavailable');
  } finally { await integration.stopAll(); }
  console.log('PASS: isolated VSIX server and shipped extension boot; auth, red/missing evidence, browser rerun and restart history work');
} finally {
  await stop();
  rmSync(dir, { recursive: true, force: true });
}

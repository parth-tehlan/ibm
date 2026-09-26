import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const empty = () => ({ state: 'not_run', collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] });
function fixture(project) {
  const createdAt = new Date().toISOString();
  return { schemaVersion: 2, project, runId: randomUUID(), createdAt, updatedAt: createdAt,
    revision: 0, state: 'complete', checkedOutCommit: null, branch: null, workingTreeDirty: null,
    producer: { name: 'ipc-test', version: '1' }, redline: empty(), splitbrain: empty(), warpath: empty() };
}

function waitMessage(child, type, requestId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${type}`)); }, 5000);
    const onExit = () => { cleanup(); reject(new Error('Dashboard process exited before IPC reply')); };
    const onMessage = (message) => {
      if (message?.type !== type || (requestId && message.requestId !== requestId)) return;
      cleanup(); resolve(message);
    };
    function cleanup() { clearTimeout(timer); child.off('message', onMessage); child.off('exit', onExit); }
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

test('editor-launched dashboard registers over private IPC; HTTP never grants credentials', async (t) => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'triumph-ipc-'));
  const entry = process.env.TRIUMPH_RUNTIME_DIR
    ? path.resolve(process.env.TRIUMPH_RUNTIME_DIR, 'server/index.js')
    : fileURLToPath(new URL('../index.js', import.meta.url));
  const child = fork(entry, [], {
    execArgv: [], env: { ...process.env, PORT: '0', TRIUMPH_HOST: '127.0.0.1', XDG_DATA_HOME: data, TRIUMPH_LEGACY_DIR: path.join(data, 'no-legacy') }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  t.after(async () => {
    child.kill(); await new Promise((resolve) => child.once('exit', resolve));
    await rm(data, { recursive: true, force: true });
  });
  const { url } = await waitMessage(child, 'triumph.ready');
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /TRIUMPH/);
  const project = { id: randomUUID(), name: 'Any repository' };
  const publicReply = await fetch(`${url}/api/extension/${project.id}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }) });
  assert.equal(publicReply.status, 404);
  const requestId = randomUUID();
  const registered = waitMessage(child, 'triumph.registered', requestId);
  child.send({ type: 'triumph.register', requestId, project });
  const { token } = await registered;
  assert.match(token, /^[0-9a-f]{64}$/);
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const heartbeat = await fetch(`${url}/api/extension/${project.id}/heartbeat`, { method: 'POST', headers: auth, body: '{}' });
  assert.equal(heartbeat.status, 200);
  const report = { ...fixture(project), state: 'complete' };
  const submitted = await fetch(`${url}/api/extension/${project.id}/runs`, { method: 'POST', headers: auth, body: JSON.stringify(report) });
  assert.equal(submitted.status, 201);
  const run = await fetch(`${url}/api/projects/${project.id}/runs/${report.runId}`);
  assert.equal(run.status, 200);
  assert.equal((await run.json()).project.name, project.name);
  const projects = await (await fetch(`${url}/api/projects`)).json();
  const connected = projects.find((item) => item.id === project.id);
  assert.equal(connected?.connected, true);
  assert.equal(connected?.runCount, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../index.js', import.meta.url));
function message(child, type, requestId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out: ${type}`)); }, 10000);
    const exited = () => { cleanup(); reject(new Error(`Process died waiting for ${type}`)); };
    const received = (value) => { if (value?.type === type && (!requestId || value.requestId === requestId)) { cleanup(); resolve(value); } };
    function cleanup() { clearTimeout(timer); child.off('message', received); child.off('exit', exited); }
    child.on('message', received); child.once('exit', exited);
  });
}
async function launch(data) {
  const child = fork(entry, [], { execArgv: [], env: { ...process.env, PORT: '0', GAIA_HOST: '127.0.0.1', XDG_DATA_HOME: data, GAIA_LEGACY_DIR: path.join(data, 'unused') }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const ready = message(child, 'gaia.ready');
  try { return { child, url: (await ready).url }; }
  catch (error) { child.kill('SIGKILL'); throw error; }
}
async function stop(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill(signal); await exited;
}
async function register(server, project) {
  const requestId = randomUUID();
  const reply = message(server.child, 'gaia.registered', requestId);
  server.child.send({ type: 'gaia.register', requestId, project });
  return (await reply).token;
}
async function getRun(server, project, runId) {
  const res = await fetch(`${server.url}/api/projects/${project.id}/runs/${runId}`);
  assert.equal(res.status, 200);
  return res.json();
}

test('two independent server processes preserve live ownership; killed owner is recovered, revision remains monotonic', async (t) => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'gaia-two-windows-'));
  const children = [];
  t.after(async () => { await Promise.all(children.map(({ child }) => stop(child))); await rm(data, { recursive: true, force: true }); });
  const one = await launch(data); children.push(one);
  const project = { id: randomUUID(), name: 'two-windows' };
  const token = await register(one, project);
  const created = await fetch(`${one.url}/api/projects/${project.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courts: ['witness'] }) });
  assert.equal(created.status, 202);
  const { runId, requestId } = await created.json();
  const auth = { Authorization: `Bearer ${token}` };
  assert.equal((await (await fetch(`${one.url}/api/extension/${project.id}/requests`, { headers: auth })).json()).request.requestId, requestId);
  const two = await launch(data); children.push(two);
  assert.equal((await getRun(two, project, runId)).state, 'running');
  assert.equal((await getRun(one, project, runId)).revision, 0);
  await stop(one.child, 'SIGKILL');
  const three = await launch(data); children.push(three);
  const recovered = await getRun(two, project, runId);
  assert.equal(recovered.state, 'interrupted');
  assert.equal(recovered.revision, 1);
  assert.equal(recovered.witness.state, 'error');
  const stale = { ...recovered, state: 'complete', revision: 1 };
  const { createHistory } = await import('../history.js');
  await assert.rejects(createHistory({ dir: path.join(data, 'gaia-dashboard') }).save(stale), { code: 'CONFLICT' });
  assert.equal((await getRun(three, project, runId)).revision, 1);
});

test('lost ack expires back to pollable request and publication clears it over HTTP', async (t) => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'gaia-ack-'));
  const server = await launch(data);
  t.after(async () => { await stop(server.child); await rm(data, { recursive: true, force: true }); });
  const project = { id: randomUUID(), name: 'ack-recovery' };
  const token = await register(server, project);
  const endpoint = `${server.url}/api/extension/${project.id}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const create = await fetch(`${server.url}/api/projects/${project.id}/run`, { method: 'POST', headers, body: JSON.stringify({ courts: ['witness'] }) });
  assert.equal(create.status, 202);
  const { runId, requestId } = await create.json();
  assert.equal((await fetch(`${endpoint}/requests/${requestId}/ack`, { method: 'POST', headers, body: '{}' })).status, 200);
  assert.equal((await (await fetch(`${endpoint}/requests`, { headers })).json()).request, null);
  await new Promise((resolve) => setTimeout(resolve, 5100));
  assert.equal((await (await fetch(`${endpoint}/requests`, { headers })).json()).request.runId, runId);
  const run = await getRun(server, project, runId);
  const final = { ...run, state: 'complete', revision: 1, updatedAt: new Date().toISOString(), witness: { state: 'error', collectedAt: new Date().toISOString(), sourceGeneratedAt: null, payload: null, errors: ['collection failed'] } };
  assert.equal((await fetch(`${endpoint}/runs`, { method: 'POST', headers, body: JSON.stringify(final) })).status, 201);
  assert.equal((await fetch(`${endpoint}/runs`, { method: 'POST', headers, body: JSON.stringify(final) })).status, 201);
  assert.equal((await (await fetch(`${endpoint}/requests`, { headers })).json()).request, null);
  assert.equal((await getRun(server, project, runId)).revision, 1);
});

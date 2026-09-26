import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { createBridge } from '../bridge.js';
import { createHistory } from '../history.js';

const empty = (state = 'not_run') => ({ state, collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] });
async function setup(t) {
  const data = await mkdtemp(path.join(os.tmpdir(), 'triumph-rerun-recovery-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const history = createHistory({ dir: data });
  let clock = Date.now();
  const bridge = createBridge({ history, heartbeatTimeoutMs: 100, now: () => clock });
  const app = createApp({ history, bridge });
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, bridge, history, advance: (ms) => { clock += ms; } };
}

test('failed publication and expired ack interrupt the durable placeholder; fresh registration can rerun', async (t) => {
  const { url, bridge, history, advance } = await setup(t);
  const project = { id: randomUUID(), name: 'retry' };
  const firstToken = bridge.registerProject({ project }).token;
  const create = await fetch(`${url}/api/projects/${project.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courts: ['redline'] }) });
  assert.equal(create.status, 202);
  const { runId, requestId } = await create.json();
  const api = `${url}/api/extension/${project.id}`;
  const auth = { Authorization: `Bearer ${firstToken}`, 'Content-Type': 'application/json' };
  const ack = await fetch(`${api}/requests/${requestId}/ack`, { method: 'POST', headers: auth, body: '{}' });
  assert.equal(ack.status, 200);
  const run = await history.load(project.id, runId);
  const badPublish = await fetch(`${api}/runs`, { method: 'POST', headers: auth, body: JSON.stringify({ ...run, revision: 1, project: { ...project, name: 'wrong' } }) });
  assert.equal(badPublish.status, 403);
  assert.equal((await history.load(project.id, runId)).state, 'running');
  advance(101);
  // Sweep via browser listing even if the editor's heartbeat timer has stopped.
  assert.equal((await fetch(`${url}/api/projects`)).status, 200);
  const interrupted = await history.load(project.id, runId);
  assert.equal(interrupted.state, 'interrupted');
  assert.equal(interrupted.revision, 1);
  assert.equal(interrupted.redline.state, 'error');
  assert.equal((await fetch(`${api}/requests`, { headers: auth })).status, 403);
  const fresh = bridge.registerProject({ project }).token;
  const retry = await fetch(`${url}/api/projects/${project.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courts: ['redline'] }) });
  assert.equal(retry.status, 202);
  const second = await retry.json();
  assert.notEqual(second.runId, runId);
  assert.equal((await (await fetch(`${api}/requests`, { headers: { Authorization: `Bearer ${fresh}` } })).json()).request.runId, second.runId);
  // Replaying a previously acknowledged snapshot must not reopen an interrupted run.
  const replay = await fetch(`${api}/runs`, { method: 'POST', headers: { Authorization: `Bearer ${fresh}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...run, state: 'complete', revision: 2, updatedAt: new Date().toISOString(), redline: empty('error') }) });
  assert.equal(replay.status, 403);
  assert.equal((await history.load(project.id, runId)).revision, 1);
});

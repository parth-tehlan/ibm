import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { createHistory } from '../history.js';

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gaia-api-'));
  const history = createHistory({ dir });
  const app = createApp({ history });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  return { app, history, base: `http://127.0.0.1:${server.address().port}` };
}
const post = (base, url, body, headers = {}) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('browser routes reject malformed requests and unconnected projects', async (t) => {
  const { base } = await setup(t);
  const id = randomUUID();
  for (const body of ['{}', '{', '[]', { courts: [] }, { courts: ['witness', 'witness'] }, { courts: ['../triage'] }, { courts: ['witness'], command: 'rm' }]) {
    assert.equal((await post(base, `/api/projects/${id}/run`, body)).status, 400, `body: ${JSON.stringify(body)}`);
  }
  assert.equal((await post(base, `/api/projects/${id}/run`, { courts: ['witness'] })).status, 409);
  assert.equal((await post(base, `/api/projects/${id}/run`, { courts: ['witness'] }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(`${base}/api/projects/not-an-id/runs`)).status, 404);
  assert.equal((await fetch(`${base}/api/projects/${id}/runs/${randomUUID()}`)).status, 404);
  assert.equal((await fetch(`${base}/api/runs/${id}/export?format=json`)).status, 404);
  assert.equal((await post(base, `/api/extension/${id}/runs`, {})).status, 403);
});

test('extension request is queued, acknowledged, persisted and opened by project ID; imports remain detached', async (t) => {
  const { base, app } = await setup(t);
  const project = { id: randomUUID(), name: 'Another project' };
  const { token } = app.locals.bridge.registerProject({ project });
  const auth = { authorization: `Bearer ${token}` };
  const projects = await (await fetch(`${base}/api/projects`)).json();
  assert.equal(projects[0].name, project.name);
  assert.equal(projects[0].connected, true);
  const started = await post(base, `/api/projects/${project.id}/run`, { courts: ['witness'] });
  assert.equal(started.status, 202);
  const { runId, requestId } = await started.json();
  assert.equal((await post(base, `/api/projects/${project.id}/run`, { courts: ['triage'] })).status, 409);
  const initial = await (await fetch(`${base}/api/projects/${project.id}/runs/${runId}`)).json();
  assert.equal(initial.state, 'running');
  assert.equal(initial.witness.state, 'running');
  assert.equal(initial.triage.state, 'not_run');
  assert.equal((await fetch(`${base}/api/runs/${runId}/export?format=json&projectId=${project.id}`)).status, 409);
  const pending = await (await fetch(`${base}/api/extension/${project.id}/requests`, { headers: auth })).json();
  assert.equal(pending.request.requestId, requestId);
  assert.equal(pending.request.runId, runId);
  assert.equal((await post(base, `/api/extension/${project.id}/requests/${requestId}/ack`, {}, auth)).status, 200);
  const completed = { ...initial, revision: 1, updatedAt: new Date().toISOString(), state: 'complete', producer: { name: 'extension', version: '1' }, witness: { state: 'complete', collectedAt: new Date().toISOString(), sourceGeneratedAt: null, payload: { court: 'WITNESS', results: [{ clause: 'REQ-X', status: 'red', passed: 0, failed: 1, total: 1, spec_anchor: 'spec#x', failures: [] }], summary: { green: 0, red: 1, total: 1 } }, errors: [] } };
  assert.equal((await post(base, `/api/extension/${project.id}/runs`, completed, auth)).status, 201);
  const read = await (await fetch(`${base}/api/projects/${project.id}/runs/${runId}`)).json();
  assert.equal(read.witness.payload.results[0].clause, 'REQ-X');
  assert.equal((await fetch(`${base}/api/runs/${runId}/export?format=html&projectId=${project.id}`)).status, 200);
  assert.equal((await post(base, `/api/extension/${project.id}/runs`, { ...completed, runId: randomUUID() }, auth)).status, 201); // independent extension-initiated run
  const imported = await post(base, '/api/import', completed);
  assert.equal(imported.status, 201);
  const { importId } = await imported.json();
  assert.equal((await fetch(`${base}/api/imports/${importId}`)).status, 200);
  assert.equal((await fetch(`${base}/api/runs/${runId}/export?format=md&importId=${importId}`)).status, 200);
  assert.equal((await fetch(`${base}/api/projects/${project.id}/runs`)).status, 200);
  assert.equal((await post(base, `/api/extension/${project.id}/disconnect`, {}, auth)).status, 204);
  assert.equal((await post(base, `/api/projects/${project.id}/run`, { courts: ['witness'] })).status, 409);
});

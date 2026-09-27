import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../app.js';
import { createHistory } from '../history.js';

const send = (base, url, body, token) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

test('concurrent projects have separate requests, credentials, history, and failure isolation', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gaia-two-projects-'));
  const app = createApp({ history: createHistory({ dir, legacyDir: path.join(dir, 'no-legacy') }) });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const a = { id: randomUUID(), name: 'A' }, b = { id: randomUUID(), name: 'B' };
  const ta = app.locals.bridge.registerProject({ project: a }).token;
  const tb = app.locals.bridge.registerProject({ project: b }).token;
  const [ra, rb] = await Promise.all([
    send(base, `/api/projects/${a.id}/run`, { courts: ['witness'] }),
    send(base, `/api/projects/${b.id}/run`, { courts: ['triage'] }),
  ]);
  assert.equal(ra.status, 202); assert.equal(rb.status, 202);
  const { runId: ia } = await ra.json(), { runId: ib } = await rb.json();
  assert.notEqual(ia, ib);
  assert.equal((await (await fetch(`${base}/api/extension/${a.id}/requests`, { headers: { Authorization: `Bearer ${ta}` } })).json()).request.runId, ia);
  assert.equal((await (await fetch(`${base}/api/extension/${b.id}/requests`, { headers: { Authorization: `Bearer ${tb}` } })).json()).request.runId, ib);
  assert.equal((await fetch(`${base}/api/extension/${a.id}/requests`, { headers: { Authorization: `Bearer ${tb}` } })).status, 403);
  assert.equal((await fetch(`${base}/api/projects/${b.id}/runs/${ia}`)).status, 404);
  assert.equal((await fetch(`${base}/api/runs/${ia}/export?format=json&projectId=${b.id}`)).status, 404);
  const pendingA = await (await fetch(`${base}/api/projects/${a.id}/runs/${ia}`)).json();
  assert.equal((await send(base, `/api/extension/${b.id}/runs`, { ...pendingA, revision: 1 }, tb)).status, 403);
  assert.equal((await send(base, `/api/extension/${a.id}/disconnect`, {}, ta)).status, 204);
  assert.equal((await (await fetch(`${base}/api/projects/${a.id}/runs/${ia}`)).json()).state, 'interrupted');
  assert.equal((await (await fetch(`${base}/api/projects/${b.id}/runs/${ib}`)).json()).state, 'running');
  assert.equal((await send(base, `/api/extension/${b.id}/heartbeat`, {}, tb)).status, 200);
  const projects = await (await fetch(`${base}/api/projects`)).json();
  assert.equal(projects.find((p) => p.id === a.id).connected, false);
  assert.equal(projects.find((p) => p.id === b.id).connected, true);
});

test('browser host/origin and extension token never expose registration or permit foreign writes', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gaia-security-'));
  const app = createApp({ history: createHistory({ dir, legacyDir: path.join(dir, 'no-legacy') }) });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(async () => { await new Promise((r) => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const project = { id: randomUUID(), name: 'Secret' };
  const token = app.locals.bridge.registerProject({ project }).token;
  const forgedHost = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/projects`, { headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(forgedHost, 403);
  assert.equal((await fetch(`${base}/api/projects`, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await send(base, `/api/projects/${project.id}/run`, { courts: ['witness'] })).status, 202);
  const publicProjects = await (await fetch(`${base}/api/projects`)).text();
  assert.equal(publicProjects.includes(token), false);
  const publicRun = await (await fetch(`${base}/api/projects/${project.id}/runs`)).text();
  assert.equal(publicRun.includes(token), false);
  assert.equal((await send(base, `/api/extension/${project.id}/register`, { project })).status, 404);
  assert.equal((await send(base, `/api/extension/${project.id}/disconnect`, {}, '0'.repeat(64))).status, 403);
  assert.equal((await fetch(`${base}/api/extension/${project.id}/requests`, { headers: { Authorization: `Bearer ${token}`, origin: 'https://evil.example' } })).status, 403);
});

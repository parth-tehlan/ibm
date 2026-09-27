import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHistory } from '../history.js';
import { createBridge } from '../bridge.js';

const court = () => ({ state: 'not_run', collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] });
const snapshot = (project, runId) => ({ schemaVersion: 2, project, runId,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 0,
  state: 'running', checkedOutCommit: null, branch: null, workingTreeDirty: null,
  producer: { name: 'extension', version: '1' }, witness: court(), trustgap: court(), triage: court() });
async function setup(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dashboard-bridge-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const history = createHistory({ dir });
  return { history, bridge: createBridge({ history, ...options }) };
}

test('browser cannot run unconnected projects or derive extension credential from imports', async (t) => {
  const { history, bridge } = await setup(t);
  const project = { id: randomUUID(), name: 'Repo' };
  await history.importReport(snapshot(project, randomUUID()));
  await assert.rejects(bridge.requestRun({ projectId: project.id, courts: ['witness'] }), { code: 'NOT_CONNECTED' });
  const { token } = bridge.registerProject({ project });
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.throws(() => bridge.registerProject({ project }), { code: 'CONFLICT' });
  assert.throws(() => bridge.poll({ projectId: project.id, token: 'bad' }), { code: 'FORBIDDEN' });
  const second = createBridge({ history });
  assert.throws(() => second.heartbeat({ projectId: project.id, token }), { code: 'FORBIDDEN' });
  await assert.rejects(second.requestRun({ projectId: project.id, courts: ['witness'] }), { code: 'NOT_CONNECTED' });
  await assert.rejects(bridge.requestRun({ projectId: project.id, courts: ['witness', 'witness'] }));
});

test('poll/ack and authenticated submissions enforce project and run isolation', async (t) => {
  const { bridge, history } = await setup(t);
  const a = { id: randomUUID(), name: 'A' }, b = { id: randomUUID(), name: 'B' };
  const ta = bridge.registerProject({ project: a }).token;
  const tb = bridge.registerProject({ project: b }).token;
  const req = await bridge.requestRun({ projectId: a.id, courts: ['triage'] });
  assert.deepEqual(bridge.poll({ projectId: a.id, token: ta }), req);
  assert.equal(bridge.poll({ projectId: b.id, token: tb }), null);
  assert.throws(() => bridge.poll({ projectId: a.id, token: tb }), { code: 'FORBIDDEN' });
  assert.throws(() => bridge.acknowledge({ projectId: a.id, token: ta, requestId: randomUUID() }), { code: 'NOT_FOUND' });
  bridge.acknowledge({ projectId: a.id, token: ta, requestId: req.requestId });
  assert.equal(bridge.poll({ projectId: a.id, token: ta }), null);
  await assert.rejects(bridge.submit({ projectId: a.id, token: tb, snapshot: snapshot(a, req.runId) }), { code: 'FORBIDDEN' });
  await assert.rejects(bridge.submit({ projectId: a.id, token: ta, snapshot: snapshot(b, req.runId) }), { code: 'FORBIDDEN' });
  await assert.rejects(bridge.submit({ projectId: a.id, token: ta, snapshot: snapshot(a, randomUUID()) }), { code: 'FORBIDDEN' });
  const run = snapshot(a, req.runId);
  await bridge.submit({ projectId: a.id, token: ta, snapshot: run });
  await bridge.submit({ projectId: a.id, token: ta, snapshot: run });
  await assert.rejects(bridge.submit({ projectId: a.id, token: ta, snapshot: { ...run, branch: 'different' } }), { code: 'CONFLICT' });
  await bridge.submit({ projectId: a.id, token: ta, snapshot: { ...run, revision: 1, state: 'complete' } });
  assert.equal((await history.load(a.id, req.runId)).state, 'complete');
  assert.equal(bridge.isConnected(a.id), true);
  const next = await bridge.requestRun({ projectId: a.id, courts: ['witness'] });
  assert.notEqual(next.runId, req.runId);
});

test('a pending browser request is not pollable until its placeholder is durable', async (t) => {
  const { bridge, history } = await setup(t);
  const project = { id: randomUUID(), name: 'Concurrent' };
  const { token } = bridge.registerProject({ project });
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let writing;
  const reached = new Promise((resolve) => { writing = resolve; });
  const started = bridge.requestRun({ projectId: project.id, courts: ['witness'], prepare: async (request) => {
    writing(request); await pending;
    await history.save({ ...snapshot(project, request.runId), createdAt: request.createdAt, updatedAt: request.createdAt });
  } });
  const request = await reached;
  assert.equal(bridge.poll({ projectId: project.id, token }), null);
  await assert.rejects(bridge.requestRun({ projectId: project.id, courts: ['triage'] }), { code: 'CONFLICT' });
  release(); await started;
  assert.equal(bridge.poll({ projectId: project.id, token }).runId, request.runId);
  assert.equal((await history.load(project.id, request.runId)).revision, 0);
});

test('expiration and disconnect fail closed, interrupt persisted running run', async (t) => {
  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  const { bridge, history } = await setup(t, { now: () => clock, heartbeatTimeoutMs: 100 });
  const project = { id: randomUUID(), name: 'Timeout' };
  const { token } = bridge.registerProject({ project });
  const req = await bridge.requestRun({ projectId: project.id, courts: ['witness'] });
  await bridge.submit({ projectId: project.id, token, snapshot: { ...snapshot(project, req.runId), witness: { ...court(), state: 'running' } } });
  clock += 101;
  assert.equal(bridge.isConnected(project.id), false);
  await assert.rejects(bridge.requestRun({ projectId: project.id, courts: ['witness'] }), { code: 'NOT_CONNECTED' });
  const stopped = await history.load(project.id, req.runId);
  assert.equal(stopped.state, 'interrupted');
  assert.equal(stopped.revision, 1);
  assert.equal(stopped.witness.state, 'error');
  assert.throws(() => bridge.heartbeat({ projectId: project.id, token }), { code: 'FORBIDDEN' });
  const fresh = bridge.registerProject({ project });
  const queued = await bridge.requestRun({ projectId: project.id, courts: ['witness'] });
  await bridge.disconnect({ projectId: project.id, token: fresh.token });
  assert.equal(await history.load(project.id, queued.runId), null);
  await assert.rejects(bridge.requestRun({ projectId: project.id, courts: ['witness'] }), { code: 'NOT_CONNECTED' });
});

test('disconnect interrupts unsolicited authenticated runs without registering imported reports', async (t) => {
  const { bridge, history } = await setup(t);
  const project = { id: randomUUID(), name: 'Extension' };
  const { token } = bridge.registerProject({ project });
  const run = snapshot(project, randomUUID());
  await bridge.submit({ projectId: project.id, token, snapshot: run });
  await bridge.disconnect({ projectId: project.id, token });
  assert.equal((await history.load(project.id, run.runId)).state, 'interrupted');
  assert.equal(bridge.isConnected(project.id), false);
});

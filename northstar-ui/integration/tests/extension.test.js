import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startExtension } from '../extension.js';
import { createHistory } from '../../server/history.js';

const empty = (state = 'not_run') => ({ state, collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] });
const report = (project, runId, overrides = {}) => ({
  schemaVersion: 2, project, runId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  revision: 0, state: 'complete', checkedOutCommit: null, branch: null, workingTreeDirty: null,
  producer: { name: 'editor-test', version: '1' }, witness: empty(), trustgap: empty(), triage: empty(), ...overrides,
});
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'extension-sdk-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, project: { id: randomUUID(), name: 'Local editor project' } };
}
async function eventually(fn) {
  for (let i = 0; i < 100; i++) {
    const result = await fn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for extension callback');
}

test('local server, URL mapper/browser hook, trusted registration, and unsolicited publication', async (t) => {
  const { dir, project } = await fixture(t);
  let opened;
  const sdk = await startExtension({ dir, project, pollIntervalMs: 20,
    mapUrl: (url) => `https://editor.example/forward?target=${encodeURIComponent(url)}`,
    openBrowser: (url) => { opened = url; },
  });
  t.after(() => sdk.stop());
  assert.match(sdk.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(opened, sdk.browserUrl);
  assert.equal(new URL(opened).searchParams.get('target'), sdk.url);
  assert.equal(sdk.bridge.isConnected(project.id), true);
  assert.equal('token' in sdk, false);
  const projects = await (await fetch(`${sdk.url}/api/projects`)).json();
  assert.equal(projects.find((entry) => entry.id === project.id).connected, true);
  const snapshot = report(project, randomUUID());
  assert.deepEqual(await sdk.publish(snapshot), snapshot);
  assert.equal((await sdk.history.load(project.id, snapshot.runId)).state, 'complete');
  await assert.rejects(sdk.publish(report({ id: randomUUID(), name: project.name }, randomUUID())), { code: 'FORBIDDEN' });
  await sdk.stop();
  await sdk.stop();
  assert.equal(sdk.bridge.isConnected(project.id), false);
  await assert.rejects(sdk.publish(snapshot), /stopped/);
});

test('browser run request is acknowledged; callback submits only actual evidence', async (t) => {
  const { dir, project } = await fixture(t);
  const calls = [];
  const sdk = await startExtension({ dir, project, pollIntervalMs: 20, onRun: async (request, { submit, signal }) => {
    assert.equal(signal.aborted, false);
    calls.push(request);
    assert.throws(() => submit(report(project, randomUUID())), /runId/);
    await submit(report(project, request.runId, {
      createdAt: request.createdAt, updatedAt: request.createdAt, revision: 1,
      witness: { state: 'complete', collectedAt: request.createdAt, sourceGeneratedAt: null,
        payload: { observed: 'from-real-collector' }, errors: [] },
    }));
  } });
  t.after(() => sdk.stop());
  const response = await fetch(`${sdk.url}/api/projects/${project.id}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ courts: ['witness'] }),
  });
  assert.equal(response.status, 202);
  const { runId, requestId } = await response.json();
  await eventually(async () => (await sdk.history.load(project.id, runId))?.state === 'complete');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestId, requestId);
  assert.deepEqual(calls[0].courts, ['witness']);
  assert.equal((await sdk.history.load(project.id, runId)).witness.payload.observed, 'from-real-collector');
  assert.throws(() => sdk.bridge.poll({ projectId: project.id, token: 'bad' }), { code: 'FORBIDDEN' });
});

test('callback return value submits a snapshot once, without synthesizing evidence', async (t) => {
  const { dir, project } = await fixture(t);
  const sdk = await startExtension({ dir, project, pollIntervalMs: 10, onRun: async (request) =>
    report(project, request.runId, { revision: 1, createdAt: request.createdAt,
      updatedAt: request.createdAt, trustgap: {
        state: 'unavailable', collectedAt: request.createdAt, sourceGeneratedAt: null,
        payload: null, errors: ['No mutation report was produced.'],
      } }),
  });
  t.after(() => sdk.stop());
  const response = await fetch(`${sdk.url}/api/projects/${project.id}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ courts: ['trustgap'] }),
  });
  assert.equal(response.status, 202);
  const { runId } = await response.json();
  await eventually(async () => (await sdk.history.load(project.id, runId))?.revision === 1);
  const stored = await sdk.history.load(project.id, runId);
  assert.equal(stored.trustgap.state, 'unavailable');
  assert.equal(stored.witness.state, 'not_run');
});

test('callback errors do not manufacture success; stop interrupts running work', async (t) => {
  const { dir, project } = await fixture(t);
  const errors = [];
  const sdk = await startExtension({ dir, project, pollIntervalMs: 10,
    onError: (error) => errors.push(error), onRun: () => { throw new Error('court unavailable'); },
  });
  t.after(() => sdk.stop());
  const response = await fetch(`${sdk.url}/api/projects/${project.id}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ courts: ['triage'] }),
  });
  assert.equal(response.status, 202);
  const { runId } = await response.json();
  await eventually(() => errors.length > 0);
  assert.match(errors[0].message, /court unavailable/);
  assert.equal((await sdk.history.load(project.id, runId)).state, 'running');
  await sdk.stop();
  const interrupted = await sdk.history.load(project.id, runId);
  assert.equal(interrupted.state, 'interrupted');
  assert.notEqual(interrupted.triage.state, 'complete');
});

test('restart recovers interrupted reports before accepting new connections', async (t) => {
  const { dir, project } = await fixture(t);
  const history = createHistory({ dir });
  const running = report(project, randomUUID(), { state: 'running', witness: empty('running') });
  await history.save(running);
  const sdk = await startExtension({ project, history });
  t.after(() => sdk.stop());
  const restored = await history.load(project.id, running.runId);
  assert.equal(restored.state, 'interrupted');
  assert.equal(restored.revision, 1);
  assert.equal(restored.witness.state, 'error');
  assert.deepEqual(restored.witness.errors, ['Extension connection lost on server restart.']);
});

test('startup failure rolls back registration and listener', async (t) => {
  const { dir, project } = await fixture(t);
  const history = createHistory({ dir });
  let registeredBridge;
  const { createBridge } = await import('../../server/bridge.js');
  registeredBridge = createBridge({ history });
  await assert.rejects(startExtension({ project, history, bridge: registeredBridge,
    openBrowser: () => { throw new Error('editor cannot open browser'); },
  }), /editor cannot open browser/);
  assert.equal(registeredBridge.isConnected(project.id), false);
  const sdk = await startExtension({ project, history, bridge: registeredBridge });
  await sdk.stop();
});

test('stop aborts in-flight callback; subsequent submit is rejected', async (t) => {
  const { dir, project } = await fixture(t);
  let context;
  const sdk = await startExtension({ dir, project, pollIntervalMs: 10, onRun: (_request, ctx) => {
    context = ctx;
    return new Promise(() => {});
  } });
  t.after(() => sdk.stop());
  const request = await sdk.bridge.requestRun({ projectId: project.id, courts: ['witness'] });
  await sdk.pollNow();
  await eventually(() => context);
  await sdk.stop();
  assert.equal(context.signal.aborted, true);
  await assert.rejects(context.submit(report(project, request.runId)), /stopped/);
});

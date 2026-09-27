import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { createHistory } from '../history.js';
import { createBridge } from '../bridge.js';

const require = createRequire(import.meta.url);
const { DashboardClient } = require('../../../court-extension/lib/dashboard.js');
const empty = (state = 'not_run') => ({ state, collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] });

test('client retries an uncertain publication without changing the revision and re-registers on expiry', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gaia-client-retry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const history = createHistory({ dir });
  let clock = Date.now();
  const bridge = createBridge({ history, now: () => clock, heartbeatTimeoutMs: 100 });
  const app = createApp({ history, bridge });
  const listener = await new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  const project = { id: randomUUID(), name: 'client-retry' };
  const child = new EventEmitter(); child.connected = true;
  const server = { child, url: `http://127.0.0.1:${listener.address().port}`, async register(identity) {
    await bridge.sweep();
    return bridge.registerProject({ project: identity }).token;
  } };
  const client = new DashboardClient({ project, server });
  await client.start();
  t.after(() => client.stop());
  const oldToken = client.token;
  const runId = randomUUID(), createdAt = new Date().toISOString();
  const run = { schemaVersion: 2, project, runId, createdAt, updatedAt: createdAt, revision: 0,
    state: 'complete', checkedOutCommit: null, branch: null, workingTreeDirty: null,
    producer: { name: 'client-test', version: '1' }, witness: empty(), trustgap: empty(), triage: empty() };
  // The first attempt commits but the caller observes a lost response. Replaying
  // the exact bytes must return the same immutable revision, not a conflict.
  const request = client._request.bind(client);
  let dropped = false;
  client._request = async (...args) => {
    const result = await request(...args);
    if (args[1] === '/runs' && !dropped) { dropped = true; throw new Error('Lost publication response'); }
    return result;
  };
  const first = await client.publish(run);
  assert.equal(dropped, true);
  assert.equal(first.revision, 0);
  assert.equal((await client.publish(run)).revision, 0);
  clock += 101;
  assert.equal((await client.poll()), null);
  assert.notEqual(client.token, oldToken);
  assert.equal(bridge.isConnected(project.id), true);
  assert.equal((await history.load(project.id, runId)).revision, 0);
});

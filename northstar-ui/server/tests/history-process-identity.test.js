import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { processStart, createHistory } from '../history.js';

test('macOS/BSD process start identity is available through ps (not /proc)', { skip: process.platform === 'win32' }, async () => {
  const first = await processStart(process.pid, 'darwin');
  const second = await processStart(process.pid, 'darwin');
  assert.ok(first, 'live process should have a start identity');
  assert.equal(first, second, 'process identity should be stable between lease checks');
});

test('live process identity remains available through Linux procfs', { skip: process.platform !== 'linux' }, async () => {
  assert.ok(await processStart(process.pid, 'linux'));
});

test('claim and ownership validation succeed with macOS process identity', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'triumph-macos-ownership-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const history = createHistory({ dir, processPlatform: 'darwin' });
  const projectId = randomUUID();
  const runId = randomUUID();
  await history.claimRun(projectId, runId);
  await history.assertOwned(projectId, runId);
});

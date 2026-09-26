import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { newSnapshot, store, load, recoverInterrupted } from '../snapshot.js';

test('restart marks interrupted courts as errors without claiming a verdict', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'northstar-recovery-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const original = newSnapshot(['redline', 'warpath']);
  await store(original, dir);
  await recoverInterrupted(dir);
  const recovered = await load(original.runId, dir);
  assert.equal(recovered.state, 'complete');
  assert.equal(recovered.redline.state, 'error');
  assert.equal(recovered.warpath.state, 'error');
  assert.equal(recovered.splitbrain.state, 'not_run');
  assert.equal(recovered.redline.payload, null);
  assert.match(recovered.redline.errors[0], /interrupted/);
});

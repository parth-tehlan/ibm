import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { collectCourt, load, newSnapshot, store } from '../snapshot.js';

const temporary = () => mkdtemp(path.join(os.tmpdir(), 'northstar-snapshot-'));

test('snapshot storage is private, atomic, and rejects untrusted IDs/content', async (t) => {
  const dir = await temporary();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const snapshot = newSnapshot(['redline']);
  await store(snapshot, dir);
  assert.deepEqual(await load(snapshot.runId, dir), snapshot);
  assert.equal(await readFile(path.join(dir, '.gitignore'), 'utf8'), '*\n');
  assert.deepEqual((await readdir(dir)).sort(), ['.gitignore', `${snapshot.runId}.json`]);
  if (process.platform !== 'win32') assert.equal((await stat(path.join(dir, `${snapshot.runId}.json`))).mode & 0o077, 0);
  for (const id of ['../secret', '%2e%2e%2fsecret', `${snapshot.runId}/../secret`, 'not-a-uuid']) {
    assert.equal(await load(id, dir), null, `unsafe id ${id}`);
  }
  assert.equal(await load(randomUUID(), dir), null);
  const tampered = randomUUID();
  await writeFile(path.join(dir, `${tampered}.json`), JSON.stringify({ ...snapshot, runId: tampered, state: 'passed' }));
  await assert.rejects(load(tampered, dir), /invalid|validation|state|enum/i);
  await assert.rejects(store({ ...snapshot, runId: '../escape' }, dir));
});

test('absent warpath fixture is unavailable, never a fabricated passing verdict', async (t) => {
  const root = await temporary();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'fixtures'));
  await writeFile(path.join(root, 'fixtures', 'deploy.json'), '{}');
  let calls = 0;
  const result = await collectCourt('warpath', { fixtureRoot: root, client: async () => { calls++; return {}; } });
  assert.equal(calls, 0);
  assert.equal(result.state, 'unavailable');
  assert.equal(result.payload, null);
  assert.deepEqual(result.errors, ['Missing fixture: fixtures/metrics.json', 'Missing fixture: fixtures/logs.json']);
  assert.equal(result.sourceGeneratedAt, null);
});

test('unknown court cannot invoke an MCP client', async () => {
  let called = false;
  await assert.rejects(collectCourt('../warpath', { client: async () => { called = true; } }), /Unknown court/);
  assert.equal(called, false);
});

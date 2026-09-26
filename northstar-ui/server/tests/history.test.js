import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHistory, defaultHistoryDir } from '../history.js';

const envelope = () => ({ state: 'not_run', collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] });
export const fixture = (project = { id: randomUUID(), name: 'A' }, runId = randomUUID()) => ({
  schemaVersion: 2, project, runId, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  revision: 0, state: 'running', checkedOutCommit: null, branch: null, workingTreeDirty: null,
  producer: { name: 'test', version: '1' }, redline: envelope(), splitbrain: envelope(), warpath: envelope(),
});
async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dashboard-history-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, history: createHistory({ dir }) };
}

test('private revisioned storage, project isolation, stale and conflicting revisions', async (t) => {
  const { dir, history } = await setup(t);
  const a = fixture(); const b = fixture({ id: randomUUID(), name: 'B' }, a.runId);
  await history.save(a); await history.save(b);
  assert.deepEqual(await history.save(a), a);
  assert.deepEqual(await history.load(a.project.id, a.runId), a);
  assert.deepEqual(await history.listRuns(b.project.id), [b]);
  assert.equal((await history.listProjects()).length, 2);
  const newer = { ...a, revision: 1, updatedAt: '2026-01-02T00:00:00.000Z', state: 'complete' };
  await history.save(newer);
  assert.deepEqual(await history.load(a.project.id, a.runId), newer);
  await assert.rejects(history.save(a), { code: 'CONFLICT' });
  await assert.rejects(history.save({ ...newer, branch: 'forged' }), { code: 'CONFLICT' });
  await assert.rejects(history.save({ ...newer, revision: 2, project: { ...a.project, name: 'Changed' } }), { code: 'CONFLICT' });
  const file = path.join(dir, 'projects', a.project.id, 'runs', a.runId, '1.json');
  assert.equal((await stat(file)).mode & 0o077, 0);
  assert.deepEqual((await readdir(path.dirname(file))).sort(), ['0.json', '1.json']);
});

test('independent history instances cannot overwrite committed revisions', async (t) => {
  const { dir, history } = await setup(t);
  const other = createHistory({ dir });
  const base = fixture();
  await history.save(base);
  const a = { ...base, revision: 1, branch: 'a' };
  const b = { ...base, revision: 1, branch: 'b' };
  const settled = await Promise.allSettled([history.save(a), other.save(b)]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((item) => item.status === 'rejected').length, 1);
  assert.ok(['a', 'b'].includes((await history.load(base.project.id, base.runId)).branch));
});

test('imports remain detached; invalid IDs and symlink tricks cannot escape store', async (t) => {
  const { dir, history } = await setup(t);
  const run = fixture();
  const imported = await history.importReport(run);
  assert.deepEqual(await history.loadImport(imported.id), run);
  assert.deepEqual(await history.listImports(), [imported]);
  assert.deepEqual(await history.listProjects(), []);
  assert.equal(await history.load(run.project.id, run.runId), null);
  for (const unsafe of ['../escape', '%2e%2e', 'nope']) {
    await assert.rejects(history.load(unsafe, run.runId));
    await assert.rejects(history.listRuns(unsafe));
    await assert.rejects(history.loadImport(unsafe));
  }
  await assert.rejects(history.save({ ...run, runId: '../escape' }));
  const external = path.join(dir, 'external.json');
  await writeFile(external, JSON.stringify(run));
  const link = path.join(dir, 'imports', `${randomUUID()}.json`);
  await symlink(external, link);
  await assert.rejects(history.loadImport(path.basename(link, '.json')));
  const projectLink = randomUUID();
  await symlink(dir, path.join(dir, 'projects', projectLink)).catch(async (error) => {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(path.join(dir, 'projects'));
    await symlink(dir, path.join(dir, 'projects', projectLink));
  });
  await assert.rejects(history.listRuns(projectLink), /Unsafe history directory/);
});

test('restart recovery interrupts only running runs with a new durable revision', async (t) => {
  const { dir, history } = await setup(t);
  const run = { ...fixture(), redline: { ...envelope(), state: 'running' } };
  await history.save(run);
  const afterRestart = createHistory({ dir });
  const recovered = await afterRestart.recoverInterrupted();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].redline.state, 'error');
  assert.equal((await history.load(run.project.id, run.runId)).revision, 1);
  assert.deepEqual(await afterRestart.recoverInterrupted(), []);
});

test('non-destructive explicit legacy migration and configurable default', async (t) => {
  const { dir } = await setup(t);
  const legacyDir = path.join(dir, 'old'); await mkdir(legacyDir);
  const run = fixture();
  const v1 = { schemaVersion: 1, repository: 'northstar', runId: run.runId,
    checkedOutCommit: null, workingTreeDirty: false, createdAt: run.createdAt, state: 'running',
    redline: run.redline, splitbrain: run.splitbrain, warpath: run.warpath };
  const original = JSON.stringify(v1);
  await writeFile(path.join(legacyDir, `${run.runId}.json`), original);
  const history = createHistory({ dir: path.join(dir, 'new'), legacyDir });
  assert.deepEqual(await history.migrateLegacy(), [run.runId]);
  assert.equal((await history.listProjects())[0].lastRun.state, 'interrupted');
  assert.equal(await readFile(path.join(legacyDir, `${run.runId}.json`), 'utf8'), original);
  const prior = process.env.XDG_DATA_HOME;
  try { process.env.XDG_DATA_HOME = dir; assert.equal(defaultHistoryDir(), path.join(dir, 'triumph-dashboard')); }
  finally { if (prior === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = prior; }
});

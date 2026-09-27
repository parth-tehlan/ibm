'use strict';
/** Local run evidence is write-once. Publication state is a separate mutable
 * sidecar; retrying transport can never change the evidence being published. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function canonicalRoot(value) {
  const root = typeof value === 'string' ? value : value && value.root;
  if (!root) throw Object.assign(new Error('Open a workspace folder first.'), { code: 'NO_WORKSPACE' });
  return fs.realpathSync(root);
}
function directory(root) { return path.join(canonicalRoot(root), 'reports', 'triumph'); }
function runDirectory(root, id) {
  if (!UUID.test(id || '')) throw Object.assign(new Error('Invalid run ID'), { code: 'INVALID_REQUEST' });
  return path.join(directory(root), 'runs', id);
}
function safeDirectory(dir) {
  const parent = path.dirname(dir);
  if (parent !== dir) safeDirectory(parent);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe report directory: ${dir}`);
}
function atomic(file, value) {
  safeDirectory(path.dirname(file));
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function summary(run) {
  return { schemaVersion: 1, runId: run.runId, workspaceId: run.workspaceId,
    requestedCourts: run.requestedCourts, trigger: run.trigger, startedAt: run.startedAt,
    finishedAt: run.finishedAt, phase: run.phase, lifecycle: run.lifecycle,
    courts: Object.fromEntries(Object.entries(run.courts).map(([c, o]) => [c, { execution: o.execution, verdict: o.verdict, evidenceSource: o.evidenceSource, evidenceFreshness: o.evidenceFreshness, errors: o.errors, metrics: o.metrics }])),
    publication: run.publication, artifacts: run.artifacts };
}
function checkpoint(root, run) { atomic(path.join(runDirectory(root, run.runId), 'pending.json'), run); }
function saveRun(root, run) {
  const dir = runDirectory(root, run.runId);
  safeDirectory(dir);
  // Link an already-complete temporary file into place: atomic AND exclusive.
  const tmp = path.join(dir, crypto.randomUUID() + '.tmp');
  try {
    fs.writeFileSync(tmp, JSON.stringify(run, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.linkSync(tmp, path.join(dir, 'run.json'));
  } finally { fs.rmSync(tmp, { force: true }); }
  atomic(path.join(dir, 'manifest.json'), summary(run));
  fs.rmSync(path.join(dir, 'pending.json'), { force: true });
  atomic(path.join(directory(root), 'latest.json'), { runId: run.runId });
  return readRun(root, run.runId);
}
function readRun(root, id) {
  const dir = runDirectory(root, id);
  let run;
  try { run = json(path.join(dir, 'run.json')); }
  catch (e) { if (e.code === 'ENOENT') throw Object.assign(new Error('Run not found'), { code: 'NOT_FOUND' }); throw e; }
  if (run.schemaVersion !== 1 || run.runId !== id) throw new Error('Invalid stored run');
  try { run.publication = json(path.join(dir, 'publication.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return run;
}
function updatePublication(root, id, publication) {
  const run = readRun(root, id);
  atomic(path.join(runDirectory(root, id), 'publication.json'), publication);
  run.publication = publication;
  atomic(path.join(runDirectory(root, id), 'manifest.json'), summary(run));
  return run;
}
function latestRun(root) {
  try { return readRun(root, json(path.join(directory(root), 'latest.json')).runId); }
  catch (e) { if (e.code === 'ENOENT' || e.code === 'NOT_FOUND') return null; throw e; }
}
function listRuns(root, { limit = 10, offset = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new Error('Invalid history pagination');
  const dir = path.join(directory(root), 'runs');
  if (!fs.existsSync(dir)) return [];
  // Read small manifests only, never mutation payloads.
  return fs.readdirSync(dir).filter(id => UUID.test(id)).flatMap(id => {
    try { return [json(path.join(dir, id, 'manifest.json'))]; } catch { return []; }
  }).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.runId.localeCompare(a.runId)).slice(offset, offset + limit);
}
function selectRun(root, id) { const run = readRun(root, id); atomic(path.join(directory(root), 'selected.json'), { runId: id }); return run; }
function selectedRun(root) {
  try { return readRun(root, json(path.join(directory(root), 'selected.json')).runId); }
  catch (e) { if (e.code === 'ENOENT' || e.code === 'NOT_FOUND') return latestRun(root); throw e; }
}
module.exports = { canonicalRoot, directory, runDirectory, safeDirectory, atomic, checkpoint, saveRun, readRun, latestRun, listRuns, selectRun, selectedRun, updatePublication, summary };

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeReport, snapshotSchema } from '../contracts/report.js';

// The data root is intentionally outside the checkout. IDs are validated before
// they can become path components; every on-disk snapshot is immutable.
export function defaultHistoryDir() {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'triumph-dashboard');
}
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function validId(id) { if (!uuid(id)) throw new TypeError('Expected UUID'); return id.toLowerCase(); }
function validRevision(n) { return Number.isSafeInteger(n) && n >= 0; }
function conflict(message) { const error = new Error(message); error.code = 'CONFLICT'; return error; }
function missing(error) { if (error.code === 'ENOENT') return true; throw error; }
async function directory(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe history directory');
}
async function entries(dir) {
  try {
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe history directory');
    return await fs.readdir(dir);
  } catch (error) { if (missing(error)) return []; }
}
async function readJson(file) {
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (!(await handle.stat()).isFile()) throw new Error('Unsafe history file');
    return JSON.parse(await handle.readFile('utf8'));
  } catch (error) { if (missing(error)) return null; } finally { await handle?.close(); }
}
async function atomicCreate(file, value) {
  const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    // link fails with EEXIST instead of replacing a newer writer's revision.
    await fs.link(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}
function parse(input) {
  const snapshot = snapshotSchema.parse(normalizeReport(input));
  if (!validRevision(snapshot.revision) || !uuid(snapshot.runId) || !uuid(snapshot.project.id)) throw new TypeError('Invalid snapshot identity/revision');
  return snapshot;
}
function legacyV2(old, project) {
  const createdAt = old.createdAt;
  return {
    schemaVersion: 2, project, runId: old.runId, createdAt, updatedAt: createdAt,
    revision: 0, state: old.state === 'running' ? 'interrupted' : 'complete',
    checkedOutCommit: old.checkedOutCommit ?? null, branch: null,
    workingTreeDirty: old.workingTreeDirty ?? null,
    producer: { name: 'northstar-legacy', version: '1' },
    redline: old.redline, splitbrain: old.splitbrain, warpath: old.warpath,
  };
}

/** createHistory({dir?, legacyDir?}) -> {save, load, listProjects, listRuns,
 * importReport, listImports, loadImport, migrateLegacy}. All methods async.
 * save(snapshot) returns the stored v2 snapshot; equal revision + identical data
 * is idempotent. An imported report is detached in `imports/`, NEVER a project
 * connection or a writable project run. No automatic trust is granted by history.
 * Revisions are immutable files: readers choose the highest committed revision.
 */
export function createHistory({ dir = defaultHistoryDir(), legacyDir = fileURLToPath(new URL('../.data/', import.meta.url)) } = {}) {
  const root = path.resolve(dir);
  const projectsDir = path.join(root, 'projects');
  const importsDir = path.join(root, 'imports');
  const owned = new Set();
  const ownerToken = randomUUID();
  const leaseMs = 45_000;
  const ownerFile = (projectId, runId) => path.join(runDir(projectId, runId), '.owner.json');
  async function processStart(pid) {
    try {
      const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]; // field 22, pid reuse guard
    } catch { return null; }
  }
  const started = processStart(process.pid);
  async function ownerAlive(owner, file) {
    if (!owner || !uuid(owner.token) || !Number.isSafeInteger(owner.pid) || typeof owner.start !== 'string') return false;
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe history owner');
    if (Date.now() - info.mtimeMs > leaseMs) return false;
    // On Linux a dead process (or reused PID) is abandoned immediately.
    const actual = await processStart(owner.pid);
    return actual === null ? false : actual === owner.start;
  }
  async function ownership(projectId, runId) {
    const file = ownerFile(projectId, runId);
    if (!(await safeDirectoryChain(path.dirname(file)))) return null;
    const record = await readJson(file);
    return record ? { record, alive: await ownerAlive(record, file) } : null;
  }
  async function claimRun(projectId, runId) {
    const folder = runDir(projectId, runId);
    await directory(root); await directory(projectsDir);
    await directory(path.join(projectsDir, validId(projectId)));
    await directory(path.join(projectsDir, validId(projectId), 'runs'));
    await directory(folder);
    const file = ownerFile(projectId, runId);
    const existing = await ownership(projectId, runId);
    if (existing) {
      if (existing.record.token === ownerToken && existing.alive) return;
      throw conflict('Run is owned by another server or awaiting recovery');
    }
    if (await load(projectId, runId)) throw conflict('Existing run cannot be claimed by a new server');
    try { await atomicCreate(file, { token: ownerToken, pid: process.pid, start: await started }); }
    catch (e) { if (e.code === 'EEXIST') throw conflict('Run is already owned'); throw e; }
    owned.add(`${validId(projectId)}/${validId(runId)}`);
  }
  async function renewOwned() {
    for (const key of owned) {
      const [projectId, runId] = key.split('/');
      const file = ownerFile(projectId, runId);
      const record = await ownership(projectId, runId);
      if (record?.record.token !== ownerToken || !record.alive) { owned.delete(key); continue; }
      const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        if (!(await handle.stat()).isFile()) throw new Error('Unsafe history owner');
        const now = new Date();
        await handle.utimes(now, now); // never follow a swapped symlink
      } finally { await handle.close(); }
    }
  }
  async function assertOwned(projectId, runId) {
    const key = `${validId(projectId)}/${validId(runId)}`;
    const holder = owned.has(key) ? await ownership(projectId, runId) : null;
    if (!holder?.alive || holder.record.token !== ownerToken) throw conflict('Run ownership expired');
  }

  const runDir = (projectId, runId) => path.join(projectsDir, validId(projectId), 'runs', validId(runId));
  async function safeDirectoryChain(target) {
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe history path');
    let current = root;
    for (const component of ['', ...relative.split(path.sep).filter(Boolean)]) {
      if (component) current = path.join(current, component);
      try {
        const stat = await fs.lstat(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe history directory');
      } catch (error) { if (missing(error)) return false; }
    }
    return true;
  }
  async function revisions(projectId, runId) {
    const folder = runDir(projectId, runId);
    if (!(await safeDirectoryChain(folder))) return [];
    const names = await entries(folder);
    return names.filter((name) => /^(0|[1-9]\d*)\.json$/.test(name) && validRevision(Number(name.slice(0, -5))))
      .map((name) => Number(name.slice(0, -5))).sort((a, b) => b - a);
  }
  async function load(projectId, runId) {
    const revs = await revisions(projectId, runId);
    if (!revs.length) return null;
    const snapshot = parse(await readJson(path.join(runDir(projectId, runId), `${revs[0]}.json`)));
    if (snapshot.project.id.toLowerCase() !== validId(projectId) || snapshot.runId.toLowerCase() !== validId(runId) || snapshot.revision !== revs[0]) throw new Error('History identity mismatch');
    return snapshot;
  }
  async function save(input) {
    const snapshot = parse(input);
    const folder = runDir(snapshot.project.id, snapshot.runId);
    await directory(root); await directory(projectsDir);
    await directory(path.join(projectsDir, validId(snapshot.project.id)));
    await directory(path.join(projectsDir, validId(snapshot.project.id), 'runs'));
    await directory(folder);
    const current = await load(snapshot.project.id, snapshot.runId);
    if (current) {
      if (current.project.name !== snapshot.project.name || current.createdAt !== snapshot.createdAt) throw conflict('Run identity cannot change');
      if (current.revision > snapshot.revision) throw conflict('Stale snapshot revision');
      if (current.revision < snapshot.revision && current.state !== 'running') throw conflict('Finished runs cannot be reopened or revised');
      if (current.revision < snapshot.revision && Date.parse(snapshot.updatedAt) < Date.parse(current.updatedAt)) throw conflict('Snapshot timestamp moved backwards');
      if (current.revision === snapshot.revision) {
        if (JSON.stringify(current) !== JSON.stringify(snapshot)) throw conflict('Conflicting snapshot revision');
        return current;
      }
    }
    try { await atomicCreate(path.join(folder, `${snapshot.revision}.json`), snapshot); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readJson(path.join(folder, `${snapshot.revision}.json`));
      if (JSON.stringify(existing) !== JSON.stringify(snapshot)) throw conflict('Conflicting snapshot revision');
    }
    // A concurrent writer may have committed a higher revision. This one is
    // still retained as an immutable historical revision, never a stale overwrite.
    return snapshot;
  }
  async function listRuns(projectId) {
    const id = validId(projectId);
    const runs = [];
    if (!(await safeDirectoryChain(path.join(projectsDir, id, 'runs')))) return runs;
    for (const name of await entries(path.join(projectsDir, id, 'runs'))) {
      if (!uuid(name)) continue;
      const run = await load(id, name);
      if (run) runs.push(run);
    }
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.runId.localeCompare(a.runId));
  }
  async function listProjects() {
    const projects = [];
    if (!(await safeDirectoryChain(projectsDir))) return projects;
    for (const name of await entries(projectsDir)) {
      if (!uuid(name)) continue;
      const [lastRun] = await listRuns(name);
      if (lastRun) projects.push({ project: lastRun.project, lastRun });
    }
    return projects.sort((a, b) => b.lastRun.createdAt.localeCompare(a.lastRun.createdAt) || a.project.id.localeCompare(b.project.id));
  }
  async function importReport(input) {
    const snapshot = parse(input);
    await directory(root); await directory(importsDir);
    const id = randomUUID();
    await atomicCreate(path.join(importsDir, `${id}.json`), snapshot);
    return { id, snapshot };
  }
  async function loadImport(id) {
    validId(id);
    if (!(await safeDirectoryChain(importsDir))) return null;
    const snapshot = await readJson(path.join(importsDir, `${validId(id)}.json`));
    return snapshot === null ? null : parse(snapshot);
  }
  async function listImports() {
    const result = [];
    if (!(await safeDirectoryChain(importsDir))) return result;
    for (const name of await entries(importsDir)) {
      if (!uuid(name.slice(0, -5)) || !name.endsWith('.json')) continue;
      result.push({ id: name.slice(0, -5), snapshot: await loadImport(name.slice(0, -5)) });
    }
    return result;
  }
  // Only orphaned runs are recovered. A live owner in another dashboard window
  // remains untouched. A timed-out owner is fenced from further submissions.
  async function recoverInterrupted({ ownedOnly = false, force = false } = {}) {
    const recovered = [];
    for (const { project } of await listProjects()) {
      for (const listed of await listRuns(project.id)) {
        if (listed.state !== 'running') continue;
        const key = `${validId(project.id)}/${validId(listed.runId)}`;
        if (ownedOnly && !owned.has(key)) continue;
        const holder = await ownership(project.id, listed.runId);
        if (!force && holder?.alive) continue;
        // Reload after checking ownership; retries handle competing recovery
        // processes committing the same revision via atomicCreate.
        for (let attempt = 0; attempt < 8; attempt++) {
          const run = await load(project.id, listed.runId);
          if (run?.state !== 'running') break;
          if (!force && (await ownership(project.id, run.runId))?.alive) break;
          const updatedAt = new Date(Math.max(Date.now(), Date.parse(run.updatedAt))).toISOString();
          const next = { ...run, revision: run.revision + 1, updatedAt, state: 'interrupted' };
          for (const court of ['redline', 'splitbrain', 'warpath']) {
            if (next[court].state === 'running') next[court] = {
              state: 'error', collectedAt: updatedAt, sourceGeneratedAt: null, payload: null,
              errors: ['Extension connection lost on server restart.'],
            };
          }
          try {
            await save(next);
            if ((await load(project.id, run.runId)).state === 'interrupted') recovered.push(next);
            break;
          } catch (error) { if (error.code !== 'CONFLICT') throw error; }
        }
        if (force) owned.delete(key);
      }
    }
    return recovered;
  }
  // Explicit, non-destructive conversion of the old single-repository store.
  // Originals remain byte-for-byte untouched in legacyDir.
  async function migrateLegacy(project = { id: '93b0a8ac-d126-4f61-8323-946773fd40d2', name: 'Northstar' }) {
    validId(project.id);
    const migrated = [];
    for (const name of await entries(legacyDir)) {
      if (!name.endsWith('.json') || !uuid(name.slice(0, -5))) continue;
      const old = await readJson(path.join(legacyDir, name));
      if (old?.schemaVersion !== 1 || old.runId?.toLowerCase() !== name.slice(0, -5).toLowerCase()) continue;
      const snapshot = legacyV2(old, project);
      await save(snapshot);
      migrated.push(snapshot.runId);
    }
    return migrated;
  }
  return { dir: root, save, load, listProjects, listRuns, importReport, loadImport, listImports, migrateLegacy, recoverInterrupted, claimRun, assertOwned, renewOwned };
}

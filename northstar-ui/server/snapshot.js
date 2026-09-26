import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { withCourtClient, ALLOWED_TOOLS } from './mcp.js';

const root = fileURLToPath(new URL('../../northstar/', import.meta.url));
export const dataDir = fileURLToPath(new URL('../.data/', import.meta.url));
export const courts = ['redline', 'splitbrain', 'warpath'];
const courtState = z.object({
  state: z.enum(['not_run', 'running', 'complete', 'error', 'unavailable']),
  collectedAt: z.string().datetime().nullable(), sourceGeneratedAt: z.string().datetime().nullable(),
  payload: z.record(z.unknown()).nullable(), errors: z.array(z.string()),
}).strict();
export const snapshotSchema = z.object({
  schemaVersion: z.literal(1), runId: z.string().uuid(), repository: z.literal('northstar'),
  checkedOutCommit: z.string().nullable(), workingTreeDirty: z.boolean().nullable(),
  createdAt: z.string().datetime(), state: z.enum(['running', 'complete']),
  redline: courtState, splitbrain: courtState, warpath: courtState,
}).strict();
export const requestSchema = z.object({ courts: z.array(z.enum(courts)).min(1).max(3).refine((v) => new Set(v).size === v.length, 'courts must be unique') }).strict();
function git(args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 }).trim(); }
  catch { return null; }
}
const empty = () => ({ state: 'not_run', collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] });
export function newSnapshot(selected, id = randomUUID()) {
  const status = git(['status', '--porcelain', '--untracked-files=normal', '--', '.']);
  return {
    schemaVersion: 1, runId: id, repository: 'northstar',
    checkedOutCommit: git(['rev-parse', 'HEAD']), workingTreeDirty: status === null ? null : status.length > 0,
    createdAt: new Date().toISOString(), state: 'running',
    ...Object.fromEntries(courts.map((court) => [court, { ...empty(), state: selected.includes(court) ? 'running' : 'not_run' }])),
  };
}
export async function store(snapshot, dir = dataDir) {
  snapshotSchema.parse(snapshot);
  await fs.mkdir(dir, { recursive: true });
  // Git ignores every generated file, including this marker. No repository files are modified.
  await fs.writeFile(path.join(dir, '.gitignore'), '*\n');
  const destination = path.join(dir, `${snapshot.runId}.json`);
  const temp = path.join(dir, `.${snapshot.runId}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, destination);
  } finally { await fs.rm(temp, { force: true }); }
}
export async function recoverInterrupted(dir = dataDir) {
  let names;
  try { names = await fs.readdir(dir); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const name of names) {
    if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
    const snapshot = await load(name.slice(0, -5), dir);
    if (!snapshot || snapshot.state !== 'running') continue;
    for (const court of courts) {
      if (snapshot[court].state === 'running') snapshot[court] = {
        state: 'error', collectedAt: new Date().toISOString(), sourceGeneratedAt: null,
        payload: null, errors: ['Collection interrupted by server restart; re-run to collect evidence.'],
      };
    }
    snapshot.state = 'complete';
    await store(snapshot, dir);
  }
}
export async function load(id, dir = dataDir) {
  if (!z.string().uuid().safeParse(id).success) return null;
  try { return snapshotSchema.parse(JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function splitbrainSource() {
  try {
    const source = JSON.parse(await fs.readFile(path.join(root, 'trustgap/TrustGap.json'), 'utf8'));
    const time = source.generated;
    return typeof time === 'string' && !isNaN(Date.parse(time)) ? new Date(time).toISOString() : null;
  } catch { return null; }
}
async function specClauses() {
  const doc = await fs.readFile(path.join(root, 'docs', 'api-spec.md'), 'utf8');
  const sections = [...doc.matchAll(/^## (W[1-8])\s+[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
  return Object.fromEntries(sections.map((match) => [match[1], match[0].trim()]));
}
export async function collectCourt(court, { client = withCourtClient, fixtureRoot = root } = {}) {
  if (!ALLOWED_TOOLS[court]) throw new Error('Unknown court');
  const at = new Date().toISOString();
  const result = { state: 'complete', collectedAt: at, sourceGeneratedAt: null, payload: null, errors: [] };
  if (court === 'warpath') {
    const missing = ['deploy.json', 'metrics.json', 'logs.json'].map((name) => path.join(fixtureRoot, 'fixtures', name));
    const absent = [];
    for (const file of missing) { try { await fs.access(file); } catch { absent.push(path.relative(fixtureRoot, file)); } }
    if (absent.length) return { ...result, state: 'unavailable', errors: absent.map((file) => `Missing fixture: ${file}`) };
  }
  if (court === 'splitbrain') {
    result.sourceGeneratedAt = await splitbrainSource();
    if (result.sourceGeneratedAt === null) return { ...result, state: 'unavailable', errors: ['trustgap/TrustGap.json missing or has no valid generated date'] };
  }
  try {
    result.payload = await client(async (call) => {
      if (court === 'warpath') return { context: await call('warpath_context'), triage: await call('warpath_triage') };
      return call(ALLOWED_TOOLS[court][0]);
    });
    const status = court === 'warpath' ? result.payload.triage?.status : result.payload.status;
    if (status === 'error' || status === 'no-signal-window') {
      result.state = 'error'; result.errors.push(String((court === 'warpath' ? result.payload.triage?.detail : result.payload.detail) || status));
    }
    if (status === 'not-run') {
      result.state = 'unavailable'; result.errors.push(String(result.payload.note || 'No generated trust gap'));
    }
    if (court === 'redline') {
      if (!Array.isArray(result.payload.results)) {
        result.state = 'error'; result.errors.push(String(result.payload.detail || 'REDLINE returned no results')); result.payload = null;
      } else if (result.payload.results.length === 0) {
        result.state = 'unavailable'; result.errors.push('No clause suites were reported; no REDLINE verdict is available.'); result.payload = null;
      } else {
        const clauses = await specClauses();
        result.payload = { ...result.payload, results: result.payload.results.map((entry) => ({
          ...entry, spec_text: clauses[entry.clause] || null,
        })) };
      }
    }
    if (court === 'splitbrain' && result.state === 'complete') {
      const source = JSON.parse(await fs.readFile(path.join(root, 'trustgap/TrustGap.json'), 'utf8'));
      const commitTime = git(['log', '-1', '--format=%cI', 'HEAD', '--', 'src', 'tests']);
      const stale = Boolean(commitTime && Date.parse(result.sourceGeneratedAt) < Date.parse(commitTime));
      const dirtyCode = git(['status', '--porcelain', '--', 'src', 'tests']);
      result.payload = { ...result.payload, itLedger: source.itLedger || [], summary: source.summary || null,
        suiteLevelTotals: source._suiteLevelTotals || null, sourceGeneratedAt: result.sourceGeneratedAt,
        codeCommitAt: commitTime || null, stale, warnings: [
          'Existing TrustGap.json artifact; no Stryker run was executed for this dashboard request.',
          ...(stale ? ['Trust gap predates the latest committed src/tests change.'] : []),
          ...(dirtyCode ? ['Uncommitted src/tests changes exist; this artifact may not reflect the current checkout.'] : []),
        ] };
    }
  } catch (error) { result.state = 'error'; result.errors.push(String(error.message || error)); }
  return result;
}

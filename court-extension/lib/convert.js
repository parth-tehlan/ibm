'use strict';
/**
 * lib/convert.js — convert REAL Gaia engine evidence into the dashboard's
 * version-2 snapshot (contracts/report.js). Pure and dependency-free so it can
 * be unit-tested without zod. The dashboard validates the result on submit; we
 * additionally validate here to fail fast and never ship a malformed run.
 *
 * Approved state mapping (dashboard owner sign-off):
 *   not_run     — the court was not requested this run.
 *   unavailable — a verified preflight condition prevents the court running.
 *   error       — the court was attempted but failed / timed out / unusable.
 *   complete    — collection finished (NOT a pass; real evidence preserved).
 *
 * Top-level run state is "complete" when collection finished, even if a court
 * is error/unavailable. Missing evidence never becomes a pass.
 */

const crypto = require('crypto');

const COURTS = ['witness', 'trustgap', 'triage'];

/** RFC 4122 UUID v5 (SHA-1, name-based) — stable per canonical workspace URI. */
function uuidv5(name) {
  // namespace: URL (6ba7b811-9dad-11d1-80b4-00c04fd430c8)
  const ns = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
  const hash = crypto.createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant
  const h = hash.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// NOTE: renaming this namespace changes the deterministic project id for
// every existing workspace (intentional as part of the full TRIUMPH->Gaia
// rename — any previously persisted dashboard history keyed by the old id
// becomes unreachable under the new one; workspaces re-register on next run).
const projectId = (workspaceUri) => uuidv5(`gaia:workspace:${workspaceUri}`);

/** Extract the court's own source timestamp, or null if absent/invalid. */
function sourceGeneratedAt(court, engineResult) {
  if (!engineResult || typeof engineResult !== 'object') return null;
  const candidates = [
    engineResult.generated,           // trustgap / clause-wall
    engineResult.finishedAt,          // mutate job
    engineResult.updatedAt,
    engineResult.createdAt,
    engineResult.at,                  // triage deploy
    engineResult.timestamp,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && Number.isFinite(new Date(c).getTime())) return new Date(c).toISOString();
    if (typeof c === 'string') { const t = Date.parse(c); if (!Number.isNaN(t)) return new Date(t).toISOString(); }
  }
  return null;
}

/**
 * Build one court envelope.
 *   outcome: { kind: 'not_run' | 'unavailable' | 'error' | 'complete',
 *              payload?: object, errors?: string[] }
 * collectedAt: ISO timestamp for when the extension obtained this result.
 */
function courtEnvelope(court, outcome, collectedAt) {
  const env = { state: outcome.kind, collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] };
  if (outcome.kind === 'complete') {
    env.collectedAt = collectedAt;
    env.sourceGeneratedAt = sourceGeneratedAt(court, outcome.payload);
    env.payload = outcome.payload;
    env.errors = outcome.errors || [];
  } else if (outcome.kind === 'error' || outcome.kind === 'unavailable') {
    env.collectedAt = collectedAt;
    env.payload = outcome.payload && typeof outcome.payload === 'object' && !Array.isArray(outcome.payload) ? outcome.payload : null;
    env.sourceGeneratedAt = sourceGeneratedAt(court, env.payload);
    env.errors = outcome.errors && outcome.errors.length ? outcome.errors : [outcome.kind === 'error' ? 'court failed' : 'court unavailable']; // preserve failure evidence when available.
  }
  // not_run: everything stays null/[]
  return env;
}

/**
 * Assemble a v2 snapshot.
 *   meta: { projectId, projectName, runId, createdAt, revision, state,
 *           checkedOutCommit, branch, workingTreeDirty, producer:{name,version} }
 *   courts: { witness: outcome, trustgap: outcome, triage: outcome }
 *   now: ISO timestamp for collectedAt/updatedAt.
 */
function toSnapshot(meta, courts, now) {
  const snap = {
    schemaVersion: 2,
    project: { id: meta.projectId, name: meta.projectName },
    runId: meta.runId,
    createdAt: meta.createdAt,
    updatedAt: now,
    revision: meta.revision,
    state: meta.state,
    checkedOutCommit: meta.checkedOutCommit ?? null,
    branch: meta.branch ?? null,
    workingTreeDirty: meta.workingTreeDirty ?? null,
    producer: meta.producer,
    witness: courtEnvelope('witness', courts.witness, now),
    trustgap: courtEnvelope('trustgap', courts.trustgap, now),
    triage: courtEnvelope('triage', courts.triage, now),
  };
  validate(snap);
  return snap;
}

/** Fail-fast structural validation (mirrors contracts/report.js, no zod dep). */
function validate(s) {
  const uuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  const iso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
  if (s.schemaVersion !== 2) throw new Error('schemaVersion must be 2');
  if (!uuid(s.project?.id)) throw new Error('project.id must be a UUID');
  if (!s.project?.name) throw new Error('project.name required');
  if (!uuid(s.runId)) throw new Error('runId must be a UUID');
  if (!iso(s.createdAt) || !iso(s.updatedAt)) throw new Error('createdAt/updatedAt must be ISO timestamps');
  if (!Number.isInteger(s.revision) || s.revision < 0) throw new Error('revision must be a non-negative int');
  if (!['running', 'complete', 'interrupted'].includes(s.state)) throw new Error('bad run state');
  if (!s.producer?.name || !s.producer?.version) throw new Error('producer required');
  for (const c of COURTS) {
    const e = s[c];
    if (!e || !['not_run', 'running', 'complete', 'error', 'unavailable'].includes(e.state)) throw new Error(`${c}: bad state`);
    if (e.collectedAt !== null && !iso(e.collectedAt)) throw new Error(`${c}: collectedAt invalid`);
    if (e.sourceGeneratedAt !== null && !iso(e.sourceGeneratedAt)) throw new Error(`${c}: sourceGeneratedAt invalid`);
    if (e.payload !== null && (typeof e.payload !== 'object' || Array.isArray(e.payload))) throw new Error(`${c}: payload must be object|null`);
    if (!Array.isArray(e.errors)) throw new Error(`${c}: errors must be an array`);
  }
}

module.exports = { projectId, toSnapshot, validate, sourceGeneratedAt, COURTS };

#!/usr/bin/env node
'use strict';
/**
 * tests/validator-parity.js — drift guard between the extension's hand-rolled
 * snapshot validator (lib/convert.js, zero-dep by design) and the dashboard's
 * authoritative zod schema (northstar-ui/contracts/report.js).
 *
 * Path-1 forbids a zod dependency in the extension runtime, so the two
 * validators are maintained as separate implementations. This suite asserts
 * they accept/reject identically on a shared corpus of valid + invalid
 * snapshots, so silent drift becomes a failing test instead of a 400 from
 * the dashboard after the extension already believed a run was valid.
 *
 * Skips (exit 0) when the dashboard checkout is not a sibling — CI/package
 * environments that only have the extension tree still run the full suite.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const contractPath = path.resolve(__dirname, '..', '..', 'northstar-ui', 'contracts', 'report.js');
if (!fs.existsSync(contractPath)) {
  console.log('ok 1 validator parity skipped (northstar-ui checkout not present)');
  process.exit(0);
}

const { validate, projectId, toSnapshot } = require('../lib/convert');

const uuid = () => require('crypto').randomUUID();
const ISO = '2026-09-26T12:00:00.000Z';
const env = (state) => ({ state, collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] });

function valid() {
  return {
    schemaVersion: 2,
    project: { id: projectId('file:///repo/parity'), name: 'parity-project' },
    runId: uuid(), createdAt: ISO, updatedAt: ISO, revision: 0, state: 'complete',
    checkedOutCommit: null, branch: null, workingTreeDirty: null,
    producer: { name: 'parity', version: '1' },
    redline: { ...env('complete'), collectedAt: ISO, payload: { results: [{ clause: 'W1', status: 'red' }] } },
    splitbrain: env('unavailable'),
    warpath: env('not_run'),
  };
}

const cases = [
  ['valid: complete run', valid(), true],
  ['valid: running state', { ...valid(), state: 'running' }, true],
  ['valid: interrupted state', { ...valid(), state: 'interrupted' }, true],
  ['valid: court state running', (() => { const s = valid(); s.redline = env('running'); return s; })(), true],
  ['invalid: schemaVersion 1', { ...valid(), schemaVersion: 1 }, false],
  ['invalid: project.id not uuid', (() => { const s = valid(); s.project = { ...s.project, id: 'not-a-uuid' }; return s; })(), false],
  ['invalid: project.name empty', (() => { const s = valid(); s.project = { ...s.project, name: '' }; return s; })(), false],
  ['invalid: runId not uuid', { ...valid(), runId: 'nope' }, false],
  ['invalid: createdAt garbage', { ...valid(), createdAt: 'not a date' }, false],
  ['invalid: revision negative', { ...valid(), revision: -1 }, false],
  ['invalid: revision fractional', { ...valid(), revision: 1.5 }, false],
  ['invalid: bad run state', { ...valid(), state: 'exploded' }, false],
  ['invalid: bad court state', (() => { const s = valid(); s.redline = env('bogus'); return s; })(), false],
  ['invalid: collectedAt unparsable', (() => { const s = valid(); s.redline = { ...s.redline, collectedAt: 'zzz' }; return s; })(), false],
  ['invalid: payload array', (() => { const s = valid(); s.redline = { ...s.redline, payload: [] }; return s; })(), false],
  ['invalid: errors not array', (() => { const s = valid(); s.redline = { ...s.redline, errors: 'boom' }; return s; })(), false],
  ['invalid: missing producer version', (() => { const s = valid(); s.producer = { name: 'parity' }; return s; })(), false],
];

(async () => {
  const { normalizeReport } = await import(pathToFileURL(contractPath).href);
  let failures = 0;
  let n = 0;
  for (const [name, snap, expectValid] of cases) {
    n++;
    let extensionOk = true;
    try { validate(snap); } catch { extensionOk = false; }
    const dashboardOk = (() => { try { normalizeReport(snap); return true; } catch { return false; } })();
    const agreed = extensionOk === dashboardOk;
    const correct = extensionOk === expectValid;
    if (!agreed || !correct) {
      failures++;
      console.error(`not ok ${n} ${name} — extension=${extensionOk} dashboard=${dashboardOk} expected=${expectValid}`);
    } else {
      console.log(`ok ${n} ${name}`);
    }
  }
  // toSnapshot must produce something both validators accept.
  n++;
  const now = new Date().toISOString();
  const built = toSnapshot(
    { projectId: projectId('file:///repo/parity'), projectName: 'parity-project', runId: uuid(),
      createdAt: now, revision: 0, state: 'complete', producer: { name: 'parity', version: '1' } },
    { redline: { kind: 'complete', payload: { summary: 'ok' } },
      splitbrain: { kind: 'unavailable', errors: ['no report'] },
      warpath: { kind: 'not_run' } },
    now);
  try { normalizeReport(built); console.log(`ok ${n} toSnapshot output accepted by dashboard schema`); }
  catch (e) { failures++; console.error(`not ok ${n} toSnapshot output rejected by dashboard schema: ${e.message}`); }
  if (failures) { console.error(`# ${failures} parity failure(s)`); process.exit(1); }
  console.log(`# validator parity: ${n} checks green`);
  // Explicit exit: a lingering handle from the imported zod tree can otherwise
  // trip an abort in this sandbox's Node teardown. 0 = suite outcome above.
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

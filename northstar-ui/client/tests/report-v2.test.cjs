const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../snapshot.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const moduleExports = {};
vm.runInNewContext(outputText, { exports: moduleExports, TextEncoder }, { filename: 'snapshot.cjs' });
const { isV2Snapshot, normalizeSnapshot, legacyProjectId, validateSnapshot } = moduleExports;
const id = 'fedeb523-55ca-463e-b7b5-6af408303ea0';
const time = '2026-09-26T09:45:06.986Z';
const empty = () => ({ state: 'not_run', collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] });
const base = () => ({ schemaVersion: 2, project: { id, name: 'Any Project' }, runId: 'abdc8131-4390-48ba-a075-2d426283f77a', createdAt: time, updatedAt: time, revision: 0, state: 'interrupted', checkedOutCommit: null, branch: null, workingTreeDirty: null, producer: { name: 'extension', version: '2' }, redline: empty(), splitbrain: empty(), warpath: empty() });
test('validates generic v2 report and rejects broken report metadata or mismatched evidence', () => {
  const report = base();
  assert.equal(isV2Snapshot(report), true);
  assert.equal(normalizeSnapshot(report), report);
  report.revision = -1;
  assert.equal(isV2Snapshot(report), false);
  report.revision = 0;
  report.redline = { ...empty(), state: 'complete', payload: { court: 'REDLINE', summary: { green: 1, red: 0, total: 1 }, results: [{ clause: 'Z99', status: 'green', passed: 1, failed: 0, total: 1, spec_anchor: 'spec#Z99', failures: [] }] } };
  assert.equal(isV2Snapshot(report), true);
  report.redline.payload.summary.total = 2;
  assert.equal(isV2Snapshot(report), false);
});
test('accepts zero-assertion yellow REDLINE evidence without inventing a pass', () => {
  const report = base();
  report.redline = { ...empty(), state: 'complete', payload: { court: 'REDLINE', summary: { green: 0, red: 0, yellow: 1, total: 1 }, results: [{ clause: 'W1', status: 'yellow', passed: 0, failed: 0, total: 0, spec_anchor: 'spec#W1', failures: [] }] } };
  assert.equal(isV2Snapshot(report), true);
  report.redline.payload.results[0].status = 'green';
  assert.equal(isV2Snapshot(report), false, 'zero tests cannot be reported green');
  report.redline.payload.results[0].status = 'red';
  assert.equal(isV2Snapshot(report), false, 'zero failures cannot be reported red');
});

test('opaque extension evidence is accepted for any project, without falsely accepting broken recognized verdicts', () => {
  const report = base();
  report.redline = { ...empty(), state: 'complete', payload: { assertions: [{ requirementId: 'Z-1', evidence: 'independent' }] } };
  assert.equal(isV2Snapshot(report), true);
  report.redline.payload = { court: 'REDLINE', assertions: [{ requirementId: 'Z-1', evidence: 'independent' }] };
  assert.equal(isV2Snapshot(report), true, 'court brand alone is not the dashboard verdict schema');
  report.redline.payload = { court: 'REDLINE', summary: { green: 1, red: 0, total: 1 }, results: [] };
  assert.equal(isV2Snapshot(report), false);
});

test('branded engine evidence stays opaque; recognized fractional verdicts still fail strict validation', () => {
  const report = base();
  report.state = 'complete';
  report.splitbrain = { ...empty(), state: 'complete', payload: {
    court: 'SPLITBRAIN', status: 'ok', schemaVersion: 1, claimedCoverage: null,
    honestMutationScore: 89.47, trustGap: null,
    dishonestTests: [{ testId: 'tests/weak.test.js', survivedMutants: ['m-2'] }],
    itLedger: [], survivors: [{ id: 'm-2' }], summary: 'Engine evidence',
  } };
  report.warpath = { ...empty(), state: 'complete', payload: { court: 'WARPATH', status: 'triaged', suspect: { id: 'deploy-1' }, evidence: [{ message: 'latency increased' }] } };
  assert.equal(isV2Snapshot(report), true);
  assert.equal(normalizeSnapshot(report).splitbrain.payload.honestMutationScore, 89.47);
  report.splitbrain.payload = { court: 'SPLITBRAIN', status: 'ok', claimedCoverage: 0.9, honestMutationScore: 89.47, trustGap: 0.01, dishonestTests: [], mutants: [] };
  assert.equal(isV2Snapshot(report), false, 'malformed known fractional shape must not use generic fallback');
  report.splitbrain.payload.claimedCoverage = null;
  assert.equal(isV2Snapshot(report), false, 'null coverage in known fractional shape is not a valid structured verdict');
});

test('browser and server derive the same legacy identity and provenance', async () => {
  const { normalizeReport } = await import('../../contracts/report.js');
  const old = { schemaVersion: 1, repository: 'another-project', runId: id, createdAt: time, state: 'complete', checkedOutCommit: null, workingTreeDirty: null, redline: empty(), splitbrain: empty(), warpath: empty() };
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeSnapshot(old))), JSON.parse(JSON.stringify(normalizeReport(old))));
});

test('legacy migration is deterministic, retains generic clause data, and does not alter the original', () => {
  const report = base();
  const old = { schemaVersion: 1, repository: 'another-project', runId: report.runId, createdAt: time, state: 'complete', checkedOutCommit: null, workingTreeDirty: null, redline: empty(), splitbrain: empty(), warpath: empty() };
  assert.equal(validateSnapshot(old), old);
  const first = normalizeSnapshot(old);
  const second = normalizeSnapshot({ ...old });
  assert.equal(first.project.id, legacyProjectId(old.repository));
  assert.equal(first.project.id, second.project.id);
  assert.notEqual(first.project.id, legacyProjectId('different-project'));
  assert.equal(first.project.name, 'another-project');
  assert.equal(first.redline, old.redline);
  assert.equal(first.branch, null);
  assert.equal(first.schemaVersion, 2);
  assert.equal(old.schemaVersion, 1);
});

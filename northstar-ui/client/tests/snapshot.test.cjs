// Run independently of the server suite: node --test client/tests/*.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../snapshot.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const moduleExports = {};
vm.runInNewContext(outputText, { exports: moduleExports, require }, { filename: 'snapshot.cjs' });
const { isSnapshot, validateSnapshot, prettyTime } = moduleExports;
const runId = 'fedeb523-55ca-463e-b7b5-6af408303ea0';
const empty = () => ({ state: 'not_run', collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] });
const base = () => ({ schemaVersion: 1, runId, repository: 'northstar', checkedOutCommit: null, workingTreeDirty: null, createdAt: '2026-09-26T09:45:06.986Z', state: 'complete', witness: empty(), trustgap: empty(), triage: empty() });
const clause = () => ({ clause: 'W1', status: 'green', passed: 1, failed: 0, total: 1, spec_anchor: 'docs/api-spec.md#W1', failures: [] });
const split = () => ({ court: 'TRUSTGAP', status: 'ok', claimedCoverage: 0.9166, honestMutationScore: 0.8947368421052632, trustGap: 0.021863157894736807, dishonestTests: ['tautology'], mutants: [], stale: true, warnings: ['Precomputed artifact'], summary: 'Evidence note', codeCommitAt: '2026-09-26T09:46:00Z', suiteLevelTotals: { killed: 17, survived: 2, timeout: 0, noCoverage: 1, totalMutants: 20, mutationScore: 0.85 }, itLedger: [{ itId: 'discount-case', honest: true, killed: 1, survived: 0, timeout: 0, noCoverage: 0 }] });

test('accepts live-style v1 snapshot and enriched mutation artifact', () => {
  const snapshot = base();
  snapshot.witness = { ...empty(), state: 'complete', payload: { court: 'WITNESS', summary: { green: 1, red: 0, total: 1 }, results: [clause()] } };
  snapshot.trustgap = { ...empty(), state: 'complete', payload: split() };
  snapshot.triage = { ...empty(), state: 'complete', payload: { context: { court: 'TRIAGE', deploys: [], metrics: {}, logWindow: [] }, triage: { court: 'TRIAGE', incidentWindow: 'reported' } } };
  assert.equal(validateSnapshot(snapshot), snapshot);
});

test('rejects misleading verdicts and impossible mutation percentages', () => {
  const snapshot = base();
  snapshot.witness = { ...empty(), state: 'complete', payload: { court: 'WITNESS', summary: { green: 1, red: 0, total: 1 }, results: [{ ...clause(), failed: 1 }] } };
  assert.equal(isSnapshot(snapshot), false);
  snapshot.witness.payload.results = [clause()];
  snapshot.witness.payload.summary.green = 0;
  assert.equal(isSnapshot(snapshot), false);
  snapshot.witness = empty();
  snapshot.trustgap = { ...empty(), state: 'complete', payload: { ...split(), claimedCoverage: 18 } };
  assert.equal(isSnapshot(snapshot), false);
  snapshot.trustgap.payload = { ...split(), trustGap: 0.99 };
  assert.equal(isSnapshot(snapshot), false);
});

test('refuses unsafe file IDs and malformed payloads; preserves error states from server', () => {
  const snapshot = base();
  snapshot.runId = '../unsafe.json';
  assert.throws(() => validateSnapshot(snapshot), /Invalid snapshot/);
  snapshot.runId = runId;
  snapshot.trustgap = { ...empty(), state: 'unavailable', payload: { court: 'TRUSTGAP', status: 'not-run' }, errors: ['No artifact'] };
  assert.equal(isSnapshot(snapshot), true);
  snapshot.trustgap.state = 'complete';
  assert.equal(isSnapshot(snapshot), false);
  assert.equal(prettyTime('invalid'), 'Invalid timestamp');
});

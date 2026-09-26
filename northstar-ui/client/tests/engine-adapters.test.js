import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { engineSplitbrain, engineWarpath, redline, splitbrain, warpath, isV2Snapshot } = await vite.ssrLoadModule('/client/snapshot.ts');
  const { EngineSplitbrainView, EngineWarpathView, RawEvidence } = await vite.ssrLoadModule('/client/EngineEvidence.tsx');
  const render = (Component, data) => renderToStaticMarkup(React.createElement(Component, { data }));
  test('engine mutation ledger: null is unknown, percent points are not fractions, survivors are actionable', () => {
    const ledger = { court: 'SPLITBRAIN', status: 'ok', schemaVersion: 1, generated: '2026-09-26T09:45:06Z', claimedCoverage: null, honestMutationScore: 89.47, trustGap: null, attribution: 'per-test', totals: { mutants: 20, survived: 2 }, dishonestTests: [{ testId: 't-1', testName: 'weak assertion', survivedMutants: ['m-2'] }], mutants: [{ id: 'm-2', status: 'Survived' }] };
    assert.equal(engineSplitbrain(ledger), true);
    assert.equal(splitbrain(ledger), false);
    const html = render(EngineSplitbrainView, ledger);
    assert.match(html, /89\.47%/); assert.doesNotMatch(html, /8947\.0%/);
    assert.match(html, /Not recorded/); assert.match(html, /weak assertion/); assert.match(html, /m-2/);
    assert.match(html, /Raw court JSON/); assert.match(html, /&quot;claimedCoverage&quot;: null/);
    assert.doesNotMatch(html, /every covered mutant was killed|all tests are honest|green/i);
    assert.equal(engineSplitbrain({ ...ledger, dishonestTests: [] }), true);
    assert.match(render(EngineSplitbrainView, { ...ledger, dishonestTests: [], attribution: 'unresolved' }), /does not establish that tests are honest/);
    assert.equal(engineSplitbrain({ ...ledger, honestMutationScore: 8947 }), false);
  });
  test('engine top-level incident triage shows rule and original timestamps without inventing a cause', () => {
    const triage = { court: 'WARPATH', incidentWindow: '2026-09-26T09:00:00Z..2026-09-26T09:30:00Z', suspect: { id: 'deploy-7', reason: 'last deploy before the window opened' }, breakerSnapshot: { state: 'open', consecutiveFailures: 2, openThreshold: 3 }, evidence: [{ t: '2026-09-26T09:12:00Z', level: 'error', msg: 'breaker tripped', spec: 'S-2' }], clearedDeploys: [{ id: 'deploy-6' }], rule: 'S-2: breaker SHALL NOT trip below openThreshold' };
    assert.equal(engineWarpath(triage), true); assert.equal(warpath(triage), false);
    const html = render(EngineWarpathView, triage);
    for (const evidence of ['deploy-7', 'breaker tripped', 'consecutiveFailures', 'S-2', 'deploy-6', 'Raw court JSON']) assert.ok(html.includes(evidence), evidence);
    assert.match(html, /candidate, not confirmed cause/);
    assert.equal(engineWarpath({ ...triage, suspect: null, rule: null, evidence: [] }), true);
    assert.match(render(EngineWarpathView, { ...triage, suspect: null, rule: null, evidence: [] }), /No signals supplied; this does not prove/);
    assert.equal(engineWarpath({ court: 'WARPATH', status: 'no-signal-window' }), false);
  });
  test('red clauses stay red; raw JSON remains available without assigning passes to unknown evidence', () => {
    const clause = { clause: 'S-2', status: 'red', passed: 0, failed: 1, total: 1, spec_anchor: 'spec#S-2', failures: [{ title: 'breaker', message: 'opened too early' }] };
    const payload = { court: 'REDLINE', summary: { red: 1, green: 0, total: 1 }, results: [clause] };
    assert.equal(redline(payload), true);
    assert.equal(redline({ ...payload, summary: { red: 0, green: 1, total: 1 } }), false);
    assert.equal(redline({ ...payload, results: [{ ...clause, status: 'green' }] }), false);
    assert.match(renderToStaticMarkup(React.createElement(RawEvidence, { payload })), /&quot;status&quot;: &quot;red&quot;/);
    const time = '2026-09-26T09:45:06Z', empty = { state: 'not_run', collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] };
    const report = { schemaVersion: 2, project: { id: 'fedeb523-55ca-463e-b7b5-6af408303ea0', name: 'Example' }, runId: 'abdc8131-4390-48ba-a075-2d426283f77a', createdAt: time, updatedAt: time, revision: 0, state: 'complete', checkedOutCommit: null, branch: null, workingTreeDirty: null, producer: { name: 'engine', version: '1' }, redline: { ...empty, state: 'complete', payload }, splitbrain: empty, warpath: empty };
    assert.equal(isV2Snapshot(report), true);
    assert.equal(isV2Snapshot({ ...report, redline: { ...report.redline, payload: { ...payload, summary: { red: 0, green: 1, total: 1 } } } }), false);
  });
} finally { await vite.close(); }

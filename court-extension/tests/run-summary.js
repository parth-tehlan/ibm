'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeCourt, summarizeRun, formatMetric } = require('../lib/run-summary');
const { renderHtml, renderMarkdown } = require('../lib/render');
const fixtures = require('./fixtures/summary-evidence.json');
const freeze = (x) => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
freeze(fixtures);
const red = (payload) => summarizeCourt('REDLINE', payload);
const run = (courts, extra = {}) => ({ requestedCourts: Object.keys(courts), courts, lifecycle: 'completed', ...extra });

test('zero executed tests override green badges and duplicate discovery, without changing raw evidence', () => {
  const s = red(fixtures.zeroTests);
  assert.equal(s.execution, 'complete'); assert.equal(s.verdict, 'inconclusive'); assert.equal(s.tone, 'yellow');
  assert.deepEqual(s.counts, { green: 0, red: 0, yellow: 1, total: 1 });
  assert.equal(s.payload, fixtures.zeroTests);
  assert.equal(s.clauses[0].payload.status, 'green'); assert.equal(s.clauses[0].status, 'yellow');
  assert.equal(s.metrics.find(m => m.name === 'testsExecuted').value, 0);
  const duplicated = { ...fixtures.zeroTests, results: [...fixtures.zeroTests.results, ...fixtures.zeroTests.results] };
  assert.equal(red(duplicated).verdict, 'inconclusive');
});
test('affirmative executed assertions pass; actual failures are findings, not execution failures', () => {
  assert.equal(red(fixtures.passed).verdict, 'pass');
  const s = red(fixtures.failed); assert.equal(s.execution, 'complete'); assert.equal(s.verdict, 'findings');
  assert.equal(summarizeRun(run({ REDLINE: fixtures.failed })).execution, 'complete');
  assert.equal(summarizeRun(run({ REDLINE: fixtures.failed })).hasErrors, false);
  for (const payload of [{}, { results: [] }, { summary: { green: 2, total: 2 } }, { ...fixtures.passed, summary: { total: 2, green: 2 } }, { ...fixtures.passed, summary: { total: 1, green: 1, yellow: 1 } }]) assert.notEqual(red(payload).verdict, 'pass');
});
test('execution failures retain diagnostics, partial payload, provenance and findings without passing', () => {
  const s = summarizeCourt('splitbrain', fixtures.mutationError);
  assert.equal(s.execution, 'error'); assert.equal(s.verdict, 'unknown'); assert.equal(s.tone, 'red');
  assert.equal(s.payload, fixtures.mutationError.payload); assert.equal(s.payload.exitCode, 1);
  assert.match(s.errors[0], /fresh report/);
  const partial = red({ execution: 'error', payload: fixtures.failed });
  assert.equal(partial.execution, 'error'); assert.equal(partial.verdict, 'findings');
  assert.equal(summarizeRun(run({ SPLITBRAIN: fixtures.mutationError })).execution, 'error');
});
test('native engine units never use numeric magnitude to guess fractions, including 0–1 and negative values', () => {
  for (const value of [0, 0.02, 0.4, 1, 2.19, 89.47, 100, -2.19, -100]) {
    assert.equal(formatMetric(value, 'percent'), `${value}%`);
    assert.equal(formatMetric({ value, unit: 'percentage_points' }), `${value} pp`);
  }
  for (const value of [null, undefined, NaN, Infinity, '0.5']) assert.equal(formatMetric(value, 'percent'), 'Not recorded');
  assert.equal(formatMetric(0.5), 'Not recorded');
  const s = summarizeCourt('SPLITBRAIN', fixtures.precomputed);
  assert.deepEqual(s.metrics.map(formatMetric), ['0.9%', '0.5%', '0.4 pp']);
  assert.equal(s.evidenceSource, 'precomputed'); assert.equal(s.evidenceFreshness, 'unknown');
  assert.equal(s.sourceGeneratedAt, '2026-01-01T00:00:00Z'); assert.equal(s.collectedAt, null);
  assert.equal(s.payload, fixtures.precomputed.payload); assert.equal(s.verdict, 'findings');
});
test('no invented gap verdict thresholds; zero mutants and missing attribution are not passes', () => {
  for (const trustGap of [-10, 0, 0.05, 5, 15, 100, null]) {
    const s = summarizeCourt('SPLITBRAIN', { claimedCoverage: 100, honestMutationScore: 100, trustGap, dishonestTests: [], mutants: [], totals: { counted: 0 } });
    assert.equal(s.verdict, 'inconclusive'); assert.equal(s.tone, 'yellow');
    assert.match(s.detail, /zero counted mutants/);
  }
  const actual = require('../../northstar/trustgap/TrustGap.json');
  const s = summarizeCourt('SPLITBRAIN', actual);
  assert.equal(s.payload, actual); assert.equal(s.verdict, 'findings');
  assert.equal(formatMetric(s.metrics[1]), '89.47%');
});
test('WARPATH absence or empty clearance is never all-clear, signal means findings not confirmed cause', () => {
  for (const payload of [{}, fixtures.noSignal, { clearedDeploys: [{id:'d'}], evidence: [] }, { suspect: null, incidentWindow: '' }, {context:{}, triage:{status:'no-signal-window'}}]) {
    const s = summarizeCourt('WARPATH', payload); assert.notEqual(s.verdict, 'pass'); assert.equal(s.tone, 'yellow');
    assert.match(s.detail, /no clearance/);
  }
  assert.equal(summarizeCourt('WARPATH', fixtures.noSignal).execution, 'unavailable');
  const s = summarizeCourt('WARPATH', { suspect: {id:'d'}, evidence: [] });
  assert.equal(s.verdict, 'findings'); assert.match(s.detail, /unconfirmed/);
});
test('selected subset, stale evidence, interrupted run, artifacts and publication are separate', () => {
  const base = run({ REDLINE: fixtures.passed, WARPATH: fixtures.noSignal }, {requestedCourts:['REDLINE']});
  let s = summarizeRun(base);
  assert.equal(s.verdict, 'pass'); assert.equal(s.courts.WARPATH.execution, 'not_run'); assert.equal(s.courts.SPLITBRAIN.execution, 'not_run');
  s = summarizeRun({...base, publication:{state:'failed', error:'offline'}});
  assert.equal(s.verdict, 'pass'); assert.equal(s.execution, 'complete'); assert.equal(s.tone, 'yellow'); assert.match(s.label, /publish failed/);
  s = summarizeRun({...base, artifacts:[{status:'failed',error:'disk full'}]}); assert.equal(s.tone, 'yellow'); assert.match(s.label, /save failed/);
  s = summarizeRun({...base, lifecycle:'interrupted'}); assert.equal(s.execution, 'interrupted'); assert.equal(s.tone, 'yellow');
  assert.equal(red({execution:'complete', evidenceFreshness:'stale', payload:fixtures.passed}).verdict, 'inconclusive');
  assert.equal(red(fixtures.passed).evidenceFreshness, 'unknown');
  assert.equal(summarizeRun({}).verdict, 'inconclusive');
});
test('all execution states remain distinct; missing evidence never defaults to pass', () => {
  for (const execution of ['not_run','queued','running','unavailable','error','cancelled']) {
    const s = red({execution, payload:null}); assert.equal(s.execution, execution); assert.equal(s.verdict, 'unknown');
  }
  assert.equal(red({execution:'complete', verdict:'pass', payload:null}).verdict, 'inconclusive');
  assert.equal(summarizeRun(run({ REDLINE:{execution:'queued', payload:null} }, {lifecycle:'running'})).execution, 'running');
});
test('persisted manifest reuses derived verdict and typed metrics, without inventing evidence', () => {
  const s = red({execution:'complete', verdict:'pass', metrics:[{name:'clauses',value:1,unit:'count'}]});
  assert.equal(s.verdict,'pass'); assert.equal(s.payload,null); assert.equal(s.metrics[0].value,1);
});
test('reports use honest clause summaries, explicit native units and opaque raw evidence', () => {
  const input = {repo:'fixture', generated:'unknown', redline:fixtures.zeroTests, splitbrain:fixtures.precomputed.payload, warpath:fixtures.noSignal};
  const html = renderHtml(input); const md = renderMarkdown(input);
  for (const output of [html, md]) {
    assert.match(output, /0\.9%/); assert.match(output, /0\.5%/); assert.match(output, /0\.4 pp/);
    assert.doesNotMatch(output, /40%|90%|50%|every covered mutant was killed|honest ✅|dishonest ❌/);
    assert.match(output, /0 green \/ 0 red \/ 1 yellow/); assert.match(output, /notToBeDropped/);
  }
  assert.match(html, /class="clause-row yellow"/);
  const negative = renderMarkdown({...input, splitbrain:{claimedCoverage:87.28, honestMutationScore:89.47, trustGap:-2.19}});
  assert.match(negative, /-2\.19 pp/);
});

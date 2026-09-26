import test from 'node:test';
import assert from 'node:assert/strict';
import { evidence, exportHtml, exportMarkdown, exportJson, exportSnapshot } from '../export.js';

const empty = (state = 'not_run', errors = []) => ({ state, collectedAt: null, sourceGeneratedAt: null, payload: null, errors });
function fixture() {
  return {
    schemaVersion: 1, runId: 'b9bed1a0-fb76-4ac0-8557-b36af9ae7311', repository: 'northstar',
    checkedOutCommit: 'abc123', workingTreeDirty: true, createdAt: '2026-09-26T12:00:00.000Z', state: 'complete',
    redline: { ...empty('complete'), payload: { summary: { green: 0, red: 1, total: 1 }, results: [
      { clause: 'C-1', status: 'red', test: 'tests/pay.test.js', passed: 1, failed: 1, total: 2,
        spec_anchor: 'spec/pay.md#1', failures: [{ title: 'Failed assertion', message: 'expected 1\nreceived 2' }] },
    ] } },
    splitbrain: { ...empty('complete'), sourceGeneratedAt: '2026-09-25T00:00:00.000Z', payload: {
      claimedCoverage: 0.9, honestMutationScore: 0.4, trustGap: 0.5,
      stale: true, codeCommitAt: '2026-09-26T00:00:00.000Z', warnings: ['artifact is stale'],
      dishonestTests: ['tests/refund.test.js'], mutants: [{ id: 'M1', status: 'Survived' }],
      itLedger: [{ itId: 'IT-1', reason: 'unverified' }], summary: { total: 1 }, suiteLevelTotals: { survived: 1 },
    } },
    warpath: { ...empty('complete'), payload: { context: { deploys: [{ id: 'deploy-7', at: '2026-09-26T00:00:00Z' }], metrics: { window: '15 min' }, logWindow: [{ message: 'checkout failed' }] }, triage: {
      incidentWindow: '15 min', status: 'investigating', suspect: { id: 'deploy-7' }, breakerSnapshot: { state: 'open' }, rule: 'Rollback only with evidence', clearedDeploys: [{ id: 'deploy-6' }], evidence: [{ message: '500s spiked' }], detail: 'Still investigating',
    } } },
  };
}

test('JSON is the same snapshot, not the report projection; standalone exports are reusable and deterministic', () => {
  const snapshot = fixture();
  const before = structuredClone(snapshot);
  assert.deepEqual(JSON.parse(exportJson(snapshot)), snapshot);
  for (const [format, fn] of [['json', exportJson], ['md', exportMarkdown], ['html', exportHtml]]) {
    assert.equal(exportSnapshot(snapshot, format), fn(snapshot));
    assert.equal(fn(snapshot), fn(snapshot));
  }
  assert.deepEqual(snapshot, before);
  assert.throws(() => exportSnapshot(snapshot, 'pdf'), /Unsupported/);
  assert.throws(() => exportJson({ ...snapshot, schemaVersion: 2 }));
});

test('HTML offers offline court controls and expandable clause testimony with no scripts or remote assets', () => {
  const page = exportHtml(fixture());
  for (const tab of ['overview', 'redline', 'splitbrain', 'warpath']) {
    assert.match(page, new RegExp(`id="tab-${tab}"`));
    assert.match(page, new RegExp(`for="tab-${tab}"`));
    assert.match(page, new RegExp(`#tab-${tab}:checked ~ #panel-${tab}`));
    assert.match(page, new RegExp(`id="panel-${tab}"`));
  }
  assert.match(page, /id="tab-overview" checked/);
  assert.match(page, /<details class="clause"><summary>C-1/);
  assert.match(page, /Failed assertion/);
  assert.match(page, /expected 1\nreceived 2/);
  assert.doesNotMatch(page, /<script|<link|<iframe|<img|\bonclick=/i);
});

test('all court evidence survives projection into both human-readable formats', () => {
  const snapshot = fixture();
  const report = evidence(snapshot);
  assert.deepEqual(report.sections.map((s) => s.court), ['redline', 'splitbrain', 'warpath']);
  for (const value of ['C-1', 'spec/pay.md#1', 'Failed assertion', 'artifact is stale', 'IT-1', 'Survived', 'deploy-7', 'checkout failed', '500s spiked', 'Rollback only with evidence']) {
    assert.ok(exportHtml(snapshot).includes(value), `HTML omitted ${value}`);
    assert.ok(exportMarkdown(snapshot).includes(value.replace(/[.!#-]/g, (c) => `\\${c}`)), `Markdown omitted ${value}`);
  }
});

test('missing and failed evidence remain explicit, not passing results', () => {
  const snapshot = fixture();
  snapshot.redline = empty('unavailable', ['Missing fixture: spec.md']);
  snapshot.splitbrain = empty('error', ['TrustGap.json missing']);
  snapshot.warpath = empty('not_run');
  for (const format of ['html', 'md']) {
    const report = exportSnapshot(snapshot, format);
    for (const expected of ['Missing fixture: spec', 'TrustGap', 'Evidence unavailable or incomplete', format === 'md' ? 'not\\_run' : 'not_run']) assert.ok(report.includes(expected), `${format} omitted ${expected}`);
    assert.doesNotMatch(report, /No failure messages recorded/);
  }
  assert.deepEqual(JSON.parse(exportJson(snapshot)), snapshot);
});

test('untrusted values cannot escape HTML or inject Markdown blocks or raw HTML', () => {
  const snapshot = fixture();
  const attack = '</style><script>alert(1)</script><svg onload="alert(2)">&\'\n## Forged verdict\n- **Passed:** yes';
  snapshot.redline.payload.results[0].clause = attack;
  snapshot.redline.payload.results[0].failures[0].message = attack;
  snapshot.redline.errors.push(attack);
  snapshot.splitbrain.payload.mutants.push({ injection: attack });
  snapshot.warpath.payload.triage.rule = attack;
  const page = exportHtml(snapshot);
  assert.doesNotMatch(page, /<script>|<svg|<\/style><script>/);
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(page, /&quot;alert\(2\)&quot;/);
  assert.match(page, /&#39;/);
  assert.equal((page.match(/<\/style>/g) || []).length, 1);
  const markdown = exportMarkdown(snapshot);
  assert.doesNotMatch(markdown, /<script>|<svg|\n## Forged verdict|\n- \*\*Passed:/);
  assert.match(markdown, /&lt;script&gt;/);
  assert.match(markdown, / \/ \\#\\# Forged verdict/);
});

test('schema-valid but malformed payload records remain renderable', () => {
  const snapshot = fixture();
  snapshot.redline.payload.results.push(null, { failures: [null] });
  snapshot.splitbrain.payload.itLedger.push(null);
  assert.match(exportHtml(snapshot), /Clause record \(unusable\)/);
  assert.ok(exportMarkdown(snapshot).includes('Failure record \\(unusable\\)'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotSchema, courtResultSchema, normalizeReport } from '../report.js';
import { evidence, exportSnapshot, exportHtml, exportMarkdown, exportJson } from '../../reports/export.js';

const empty = () => ({ state: 'not_run', collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] });
const runId = 'b9bed1a0-fb76-4ac0-8557-b36af9ae7311';
const projectId = '43f7af66-752f-4e9c-888e-07c245692a30';
function legacy() {
  return {
    schemaVersion: 1, repository: 'another-project', runId, createdAt: '2026-09-26T12:00:00.000Z',
    checkedOutCommit: 'abc123', workingTreeDirty: true, state: 'complete',
    redline: { ...empty(), state: 'complete', payload: { results: [{ requirementId: 'REQ-B', spec_text: 'source evidence', failures: [{ message: 'failed' }] }], custom: { deeply: ['preserved'] } } },
    splitbrain: { ...empty(), state: 'error', errors: ['No source'], sourceGeneratedAt: '2026-09-25T00:00:00.000Z' },
    warpath: { ...empty(), state: 'complete', payload: { context: { deploys: [{ id: 'd1' }] }, triage: { status: 'suspect' } } },
  };
}
function v2() {
  const old = legacy();
  return { schemaVersion: 2, project: { id: projectId, name: 'General project' }, runId,
    createdAt: old.createdAt, updatedAt: old.createdAt, revision: 2, state: 'interrupted',
    checkedOutCommit: old.checkedOutCommit, branch: 'feature/a', workingTreeDirty: false,
    producer: { name: 'worker', version: '2.0' }, redline: old.redline, splitbrain: old.splitbrain, warpath: old.warpath };
}

test('v2 strict envelope, valid interrupted state, court states and opaque payloads', () => {
  const report = v2();
  assert.deepEqual(snapshotSchema.parse(report), report);
  assert.deepEqual(normalizeReport(report), report);
  assert.deepEqual(courtResultSchema.parse(report.redline), report.redline);
  for (const bad of [
    { revision: -1 }, { revision: 1.5 }, { state: 'passed' }, { project: { id: 'wrong', name: 'project' } },
    { producer: { name: 'x', version: '1', arbitrary: true } }, { updatedAt: 'not a date' },
    { branch: 42 }, { extraneous: true },
    { redline: { ...empty(), payload: [] } },
    { redline: { ...empty(), state: 'green' } },
    { redline: { ...empty(), unexpected: 'field' } },
    { redline: { ...empty(), errors: [42] } },
  ]) assert.equal(snapshotSchema.safeParse({ ...report, ...bad }).success, false, JSON.stringify(bad));
});

test('legacy v1 migration is deterministic, retains source evidence and never mutates input', () => {
  const source = legacy();
  const before = structuredClone(source);
  const report = normalizeReport(source);
  assert.equal(snapshotSchema.safeParse(report).success, true);
  assert.equal(report.project.name, source.repository);
  assert.match(report.project.id, /^[\da-f-]{36}$/);
  assert.equal(report.project.id, normalizeReport(legacy()).project.id);
  assert.equal(report.revision, 0);
  assert.equal(report.branch, null);
  assert.equal(report.updatedAt, source.createdAt);
  assert.deepEqual(report.producer, { name: 'legacy-snapshot', version: '1' });
  for (const court of ['redline', 'splitbrain', 'warpath']) assert.deepEqual(report[court], source[court]);
  assert.deepEqual(source, before);
  assert.notEqual(normalizeReport({ ...source, repository: 'different' }).project.id, report.project.id);
  assert.throws(() => normalizeReport({ ...source, redline: { ...empty(), state: 'invalid' } }));
  assert.throws(() => normalizeReport({ ...source, repository: '' }));
  assert.throws(() => normalizeReport({ ...source, injected: 'not legacy' }));
});

test('JSON exports complete v2 evidence from either version; text and HTML are generic and offline', () => {
  const report = v2();
  const before = structuredClone(report);
  assert.deepEqual(JSON.parse(exportJson(report)), report);
  assert.deepEqual(JSON.parse(exportSnapshot(legacy(), 'json')), normalizeReport(legacy()));
  assert.deepEqual(report, before);
  assert.deepEqual(evidence(report).sections.map((s) => s.court), ['redline', 'splitbrain', 'warpath']);
  for (const format of ['md', 'html']) {
    const output = exportSnapshot(report, format);
    const readable = format === 'md' ? output.replace(/\\/g, '') : output;
    for (const string of ['General project', 'REQ-B', 'source evidence', 'deeply', 'd1', 'No source', 'Evidence unavailable or incomplete']) assert.ok(readable.includes(string), `${format}: ${string}`);
    assert.doesNotMatch(output, /Northstar|TrustGap|Stryker/);
  }
  assert.doesNotMatch(exportHtml(report), /<script|<link|<iframe|<img|\bonclick=/i);
  assert.throws(() => exportSnapshot(report, 'pdf'), /Unsupported/);
});

test('untrusted project names, errors, keys and nested evidence cannot inject HTML or Markdown blocks', () => {
  const report = v2();
  const attack = '</style><script>alert(1)</script><svg onload="bad">\n## Fake verdict\n- **Safe:** yes';
  report.project.name = attack;
  report.redline.errors = [attack];
  report.redline.payload = { [attack]: { nested: [attack] } };
  const page = exportHtml(report);
  assert.doesNotMatch(page, /<script|<svg|<\/style><script/i);
  assert.match(page, /&lt;script&gt;/);
  assert.equal((page.match(/<\/style>/g) || []).length, 1);
  const markdown = exportMarkdown(report);
  assert.doesNotMatch(markdown, /<script|<svg|\n## Fake verdict|\n- \*\*Safe:/i);
  assert.match(markdown, /&lt;script&gt;/);
  assert.match(markdown, / \/ \\#\\# Fake verdict/);
});

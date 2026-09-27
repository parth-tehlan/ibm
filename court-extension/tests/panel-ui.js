#!/usr/bin/env node
'use strict';
/** DOM interaction tests. Run `node tests/panel-ui.js` with dev-only jsdom.
 * No VS Code, engine, filesystem writes, mutation jobs or full suite required.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../media/panel.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../media/panel.css'), 'utf8');
const fixtures = require('./panel-ui-fixtures');
let passed = 0;
function harness(persisted = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { runScripts: 'outside-only', url: 'https://webview.test/' });
  const messages = [], errors = [];
  let saved = persisted;
  dom.window.acquireVsCodeApi = () => ({ getState: () => saved, setState: v => { saved = v; }, postMessage: m => messages.push(JSON.parse(JSON.stringify(m))) });
  dom.window.addEventListener('error', e => errors.push(e.error));
  dom.window.eval(source);
  const d = dom.window.document;
  return {
    dom, d, messages, errors, get saved() { return saved; },
    send(m) { dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: m })); assert.deepEqual(errors, []); },
    state(s = fixtures.ready()) { this.send({ type: 'state', state: s }); },
    click(id) { const n = d.getElementById(id); assert.ok(n, 'Missing #' + id); n.click(); assert.deepEqual(errors, []); },
    last(type) { return messages.filter(m => m.type === type).at(-1); },
    response(type, data, status = 'ok') { const p = this.last(type); assert.ok(p, 'Request ' + type); this.send({ type: 'response', requestId: p.requestId, status, data }); },
    close() { dom.window.close(); },
  };
}
function test(name, fn) {
  const h = harness();
  try { fn(h); passed++; console.log('  ok ' + name); }
  finally { h.close(); }
}
test('two main tabs and secondary Setup/Dashboard routes', h => {
  h.state(); assert.equal(h.d.querySelectorAll('[role=tab]').length, 2);
  assert.deepEqual([...h.d.querySelectorAll('[role=tab]')].map(n => n.getAttribute('aria-label')), ['Run', 'Evidence']);
  h.click('setup-nav'); assert.equal(h.d.getElementById('panel-setup').hidden, false);
  assert.equal(h.d.querySelectorAll('[role=tab]:not([hidden])').length, 2);
  h.click('back-nav'); assert.equal(h.d.getElementById('panel-run').hidden, false);
  h.click('tab-evidence'); h.click('dashboard-nav'); h.click('back-nav');
  assert.equal(h.d.getElementById('panel-evidence').hidden, false);
  for (const [section, id] of [['report','evidence'], ['dashboard','dashboard']]) { h.send({ type: 'focus', section }); assert.equal(h.d.getElementById('panel-' + id).hidden, false); }
  h.send({ type: 'focus', section: 'install', preselect: { host: 'bob' } }); assert.equal(h.d.getElementById('host-select').value, 'bob');
});
test('arrow keys and Home/End implement roving tab focus', h => {
  h.state(); const tab = h.d.getElementById('tab-run'); tab.focus();
  tab.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(h.d.activeElement.id, 'tab-evidence'); assert.equal(h.d.getElementById('tab-run').tabIndex, -1);
  h.d.activeElement.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true })); assert.equal(h.d.activeElement.id, 'tab-run');
});
test('first run is WITNESS only, publication off, exact subset request', h => {
  h.state(); assert.equal(h.d.getElementById('court-WITNESS').checked, true);
  assert.equal(h.d.getElementById('court-TRUSTGAP').checked, false); assert.equal(h.d.getElementById('publish-toggle').checked, false);
  h.click('court-TRIAGE'); h.click('publish-toggle'); h.click('run-btn');
  assert.deepEqual(h.last('runCourt').courts, ['WITNESS', 'TRIAGE']); assert.equal(h.last('runCourt').outputTarget, 'dashboard');
  assert.equal(h.d.getElementById('run-btn').disabled, true); h.click('run-btn'); assert.equal(h.messages.filter(m => m.type === 'runCourt').length, 1);
});
test('unavailable first court selects nothing; remembered unavailable court requires review', h => {
  const s = fixtures.ready(); s.readiness.courts.WITNESS = { ready: false, reason: 'No clause fixtures' };
  h.state(s); assert.equal(h.d.getElementById('court-WITNESS').checked, false); assert.equal(h.d.getElementById('run-btn').disabled, true);
  h.click('court-TRIAGE'); s.readiness.courts.TRIAGE = { ready: false, reason: 'No incident inputs' }; h.state(s);
  assert.equal(h.d.getElementById('court-TRIAGE').checked, true); assert.equal(h.d.getElementById('court-TRIAGE').disabled, false); assert.equal(h.d.getElementById('run-btn').disabled, true);
  h.click('court-TRIAGE'); assert.equal(h.d.getElementById('court-TRIAGE').checked, false);
});
test('workspace-scoped selections, publication and timeout do not bleed', h => {
  h.state(); h.click('court-TRUSTGAP'); h.click('publish-toggle');
  h.state(fixtures.ready({ workspace: { root: '/other', name: 'Other', trusted: true } }));
  assert.equal(h.d.getElementById('court-TRUSTGAP').checked, false); assert.equal(h.d.getElementById('publish-toggle').checked, false);
  h.state(); assert.equal(h.d.getElementById('court-TRUSTGAP').checked, true); assert.equal(h.d.getElementById('publish-toggle').checked, true);
});
test('legacy preferences migrate without implicit dashboard publication', h => {
  const other = harness({ tab: 'report', courts: ['TRIAGE'], outputTarget: 'dashboard' });
  try { other.state(); assert.equal(other.d.getElementById('panel-evidence').hidden, false); other.click('tab-run'); assert.equal(other.d.getElementById('court-TRIAGE').checked, true); assert.equal(other.d.getElementById('publish-toggle').checked, false); assert.equal(other.saved.version, 2); } finally { other.close(); }
});
test('unsupported timeout overrides cannot be submitted or silently ignored', h => {
  h.state(); const input = h.d.getElementById('timeout-input'); assert.equal(input.disabled, true);
  input.value = '120'; input.dispatchEvent(new h.dom.window.Event('input'));
  assert.equal(h.d.getElementById('run-btn').disabled, true);
  assert.match(h.d.body.textContent, /Per-run timeout overrides are unavailable/);
});
test('supported timeout override validates a positive whole number', h => {
  h.state(fixtures.ready({capabilities: {...fixtures.capabilities, timeoutOverride: true}}));
  const input = h.d.getElementById('timeout-input'); input.value = '-1'; input.dispatchEvent(new h.dom.window.Event('input'));
  assert.equal(h.d.getElementById('run-btn').disabled, true);
  input.value = '120'; input.dispatchEvent(new h.dom.window.Event('input')); h.click('run-btn'); assert.equal(h.last('runCourt').timeoutSeconds, 120);
});
test('progress freezes controls, distinguishes queued, only real denominator yields progress', h => {
  const run = fixtures.running(); h.state(fixtures.ready({ activeRun: run }));
  assert.equal(h.d.getElementById('court-WITNESS').disabled, true); assert.equal(h.d.getElementById('publish-toggle').disabled, true);
  assert.match(h.d.body.textContent, /TRIAGE · queued/); assert.equal(h.d.querySelector('progress').max, 120);
  run.courts.TRUSTGAP.progress.total = null; h.state(fixtures.ready({ activeRun: run })); assert.equal(h.d.querySelector('progress'), null);
  assert.equal(h.d.getElementById('stop-run'), null);
  h.state(fixtures.ready({ activeRun: run, capabilities: { ...fixtures.capabilities, cancelRun: true } })); h.click('stop-run'); assert.equal(h.last('cancelRun').runId, run.runId);
  assert.match(h.d.body.textContent, /Stopping/); assert.equal(h.d.getElementById('court-WITNESS').disabled, true);
});
test('completion stays on Run and never opens dashboard or reruns', h => {
  h.state(fixtures.ready({ activeRun: fixtures.running() }));
  h.state(fixtures.ready({ activeRun: null, recentRuns: [fixtures.evidence()] }));
  assert.equal(h.d.getElementById('panel-run').hidden, false); assert.ok(h.d.getElementById('view-evidence'));
  assert.equal(h.last('dashboardOpen'), undefined); assert.equal(h.last('runCourt'), undefined);
});
test('zero tests remain inconclusive and missing TRIAGE signal never means clear', h => {
  h.state(fixtures.ready({ selectedRun: fixtures.evidence() })); h.click('tab-evidence');
  const red = h.d.getElementById('evidence-WITNESS'), war = h.d.getElementById('evidence-TRIAGE');
  assert.match(red.textContent, /zero tests executed/); assert.equal(red.querySelector('.pass'), null);
  assert.match(war.textContent, /insufficient incident signal/); assert.equal(war.querySelector('.pass'), null);
});
test('percent values are not multiplied; pp including negatives are preserved', h => {
  const run = fixtures.evidence(); run.courts.TRUSTGAP.payload.trustGap = -2.19;
  h.state(fixtures.ready({ selectedRun: run })); h.click('tab-evidence'); const t = h.d.getElementById('evidence-TRUSTGAP').textContent;
  assert.match(t, /Claimed coverage 88.5%/); assert.match(t, /Mutation score 90.69%/); assert.match(t, /Trust gap -2.19 pp/); assert.doesNotMatch(t, /219%|8850%/);
});
test('mutation command error remains error even when old metrics exist', h => {
  const run = fixtures.evidence(); run.courts.TRUSTGAP.execution = 'error'; run.courts.TRUSTGAP.errors = [{ message: 'Exit 1; no fresh report' }];
  h.state(fixtures.ready({ selectedRun: run })); h.click('tab-evidence'); assert.match(h.d.body.textContent, /Finished with execution errors/); assert.match(h.d.getElementById('evidence-TRUSTGAP').textContent, /Exit 1; no fresh report/);
});
test('export, publication retry and recent selection never start courts', h => {
  const run = fixtures.evidence(); h.state(fixtures.ready({ selectedRun: run, recentRuns: [run] })); h.click('tab-evidence');
  h.click('export-json'); assert.equal(h.last('openArtifact').artifactId, 'canonical'); assert.equal(h.last('openArtifact').runId, run.runId);
  assert.equal(h.d.getElementById('export-md').disabled, true);
  h.click('evidence-publish'); assert.equal(h.last('publishRun').runId, run.runId);
  h.click('recent-0'); assert.equal(h.last('selectRun').runId, run.runId); assert.equal(h.last('runCourt'), undefined);
});
test('logs use host Output action when available and safe bounded legacy fallback otherwise', h => {
  const run = fixtures.evidence(); h.state(fixtures.ready({ selectedRun: run })); h.click('tab-evidence'); h.click('logs-' + run.runId); assert.equal(h.last('openLogs').runId, run.runId);
  h.state(fixtures.ready({ capabilities: {}, log: [{ level: 'error', text: '<script>bad()</script>' }], selectedRun: run })); h.click('logs-' + run.runId);
  assert.match(h.d.getElementById('legacy-logs').textContent, /<script>/); assert.equal(h.d.querySelector('script'), null);
});
test('Setup validates read-only, preview requires confirmation and exact revision', h => {
  h.state(); h.click('setup-nav'); h.click('config-validate'); assert.ok(h.last('configValidate')); assert.equal(h.last('detectConfig'), undefined);
  h.response('configValidate', { valid: true }); h.click('config-preview'); h.response('configPreview', fixtures.preview());
  assert.equal(h.d.getElementById('config-apply').disabled, true); h.click('config-confirm'); h.click('config-apply');
  assert.equal(h.last('configApply').previewId, 'preview-config-1'); assert.equal(h.last('configApply').expectedConfigRevision, 'revision-1');
  h.response('configApply', { message: 'Configuration written' }); assert.equal(h.d.getElementById('config-apply'), null); assert.equal(h.last('runCourt'), undefined);
});
test('stale preview and untrusted workspace cannot apply', h => {
  h.state(fixtures.ready({ configPreview: fixtures.preview() })); h.click('setup-nav'); h.click('config-confirm');
  h.state(fixtures.ready({ config: { exists: true, revision: 'revision-2' }, configPreview: fixtures.preview() }));
  assert.equal(h.d.getElementById('config-apply').disabled, true); assert.match(h.d.body.textContent, /preview is stale/);
  h.state(fixtures.ready({ workspace: { root: '/work', trusted: false }, configPreview: fixtures.preview() }));
  assert.equal(h.d.getElementById('config-confirm').disabled, true); assert.equal(h.d.getElementById('install-preview').disabled, true); assert.equal(h.last('configApply'), undefined);
});
test('agent host is explicit; integration preview/install reports partial failures', h => {
  h.state(); h.click('setup-nav'); assert.equal(h.d.getElementById('host-select').value, ''); assert.equal(h.d.getElementById('install-preview').disabled, true);
  const select = h.d.getElementById('host-select'); select.value = 'bob'; select.dispatchEvent(new h.dom.window.Event('change'));
  h.click('install-preview'); assert.equal(h.last('installPreview').host, 'bob');
  h.response('installPreview', { ...fixtures.preview(), host: 'bob', previewId: 'integration-1' }); h.click('install-confirm'); h.click('install-apply'); assert.equal(h.last('installApply').previewId, 'integration-1');
  h.response('installApply', { partial: true, failures: [{ message: 'Cannot write MCP configuration' }], files: [{ path: '.bob/prompt.md', status: 'written' }] });
  assert.match(h.d.body.textContent, /Partial installation/); assert.match(h.d.body.textContent, /Cannot write MCP configuration/); assert.equal(h.last('installCourts'), undefined);
});
test('no workspace gates run and install, offers native folder action', h => {
  h.state(fixtures.ready({ workspace: { root: null } })); assert.equal(h.d.getElementById('run-btn').disabled, true); h.click('open-folder'); assert.ok(h.last('openFolder'));
  h.click('setup-nav'); assert.equal(h.d.getElementById('config-preview').disabled, true); assert.equal(h.d.getElementById('install-preview').disabled, true);
});
test('focus and disclosure are preserved on host snapshots', h => {
  const supported = fixtures.ready({capabilities: {...fixtures.capabilities, timeoutOverride: true}});
  h.state(supported); h.d.getElementById('advanced').open = true; h.d.getElementById('timeout-input').focus(); h.state(supported);
  assert.equal(h.d.activeElement.id, 'timeout-input'); assert.equal(h.d.getElementById('advanced').open, true);
});
test('host strings render as text, never HTML or executable URLs', h => {
  const run = fixtures.evidence(); run.summary = { courts: { TRIAGE: { label: '<img src=x onerror=alert(1)>', verdict: 'inconclusive' } } };
  h.state(fixtures.ready({ selectedRun: run })); h.click('tab-evidence'); assert.equal(h.d.querySelector('img'), null); assert.match(h.d.body.textContent, /<img/);
});
test('old state remains usable with safe disabled write upgrades', h => {
  h.state({ workspace: { root: '/legacy' }, config: { exists: true }, hosts: { default: 'all', available: ['all'] }, lastReport: { witness: { summary: { green: 2, red: 0, yellow: 0 } }, triage: {}, htmlPath: '/reports/latest.html' } });
  assert.equal(h.d.getElementById('run-btn').disabled, false); h.click('tab-evidence'); assert.equal(h.d.querySelector('.pass'), null);
  h.click('export-html'); assert.equal(h.last('openLastReport').format, 'html'); h.click('setup-nav'); assert.equal(h.d.getElementById('config-preview').disabled, true);
});
test('live step timeline and raw console drawer retain honest statuses and count', h => {
  h.state();
  assert.equal(h.d.getElementById('console-log').open, false);
  h.send({type: 'step', step: {status: 'running', text: 'Testing mutations', ts: '2025-01-01T00:00:00Z'}});
  h.send({type: 'step', step: {status: 'warn', text: 'Zero tests executed', ts: '2025-01-01T00:00:01Z'}});
  h.send({type: 'log', entry: {level: 'error', text: '<script>exit 1</script>', ts: '2025-01-01T00:00:02Z'}});
  assert.equal(h.d.querySelectorAll('#activity-feed .activity-step').length, 2);
  assert.equal(h.d.querySelectorAll('.step-success').length, 0);
  assert.match(h.d.getElementById('console-log').textContent, /1 entries/);
  assert.equal(h.d.querySelector('script'), null);
  h.d.getElementById('console-log').open = true;
  h.state(fixtures.ready({steps: [{status: 'error', text: 'Mutation command exited 1'}], log: [{level: 'error', text: 'exit 1'}]}));
  assert.equal(h.d.getElementById('console-log').open, true);
  assert.match(h.d.getElementById('activity-feed').textContent, /Mutation command exited 1/);
});
test('dashboard recovery does not dispatch a court run', h => {
  h.state(fixtures.ready({dashboard: {connected: false, url: 'http://stale'}}));
  h.click('dashboard-nav'); assert.equal(h.d.getElementById('dashboard-open').disabled, true);
  h.click('dashboard-start'); assert.equal(h.last('dashboardStart').type, 'dashboardStart');
  assert.equal(h.last('runCourt'), undefined);
});
test('theme styling uses horizontal tabs and reduced motion', () => {
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(css, /prefers-reduced-motion/); assert.match(css, /forced-colors/);
  assert.match(css, /\.tabs \{ display: flex; width: 100%/); assert.doesNotMatch(css, /\.app-shell/);
});
console.log(`\n${passed} panel DOM tests passed`);

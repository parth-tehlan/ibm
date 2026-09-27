'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const actions = require('../src/actions');
const coordinator = require('../src/run-coordinator');
const store = require('../lib/run-store');
const dashboard = require('../src/dashboard');
const {validate} = require('../lib/convert');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-coordinator-'));
const calls = [];
function fixture(name) {
  const root = path.join(base, name); fs.mkdirSync(root);
  fs.mkdirSync(path.join(root, 'docs')); fs.mkdirSync(path.join(root, 'tests'));
  fs.mkdirSync(path.join(root, 'fixtures')); fs.mkdirSync(path.join(root, 'trustgap'));
  fs.writeFileSync(path.join(root, 'docs/api-spec.md'), '# Spec');
  for (const f of ['deploy', 'metrics']) fs.writeFileSync(path.join(root, 'fixtures', f + '.json'), '{}');
  fs.writeFileSync(path.join(root, 'trustgap/TrustGap.json'), '{}');
  fs.writeFileSync(path.join(root, '.gaia.json'), JSON.stringify({version: 1}));
  return root;
}
const witness = {summary: {green: 1, red: 0, yellow: 0, total: 1}, results: [{clause: 'W1', status: 'green', total: 0, passed: 0, failed: 0}]};
class Client {
  async start() { calls.push('start'); }
  async call(name) {
    calls.push(name);
    if (name === 'witness_verdict_all') return witness;
    if (name === 'trustgap_report') return {status: 'ok', claimedCoverage: 92, honestMutationScore: 95, trustGap: -3};
    if (name === 'triage_run') return {status: 'no-signal-window'};
    throw new Error('unexpected tool ' + name);
  }
  dispose() {calls.push('dispose');}
}
(async () => {
  const root = fixture('project');
  const events = [];
  const subscription = coordinator.onRunEvent(e => events.push(e));
  let publications = 0, fail = true, snapshot;
  const ctx = {root, McpClient: Client, dashboardCmd: {async publishEvidence(vscode, opts) {
    publications++;
    if (fail) throw new Error('offline');
    snapshot = opts.run;
    return {url: `http://127.0.0.1:1234/runs/${opts.run.runId}`};
  }}};
  const result = await actions.runCourt(ctx, {courts: ['WITNESS'], outputTarget: 'dashboard'});
  assert.deepStrictEqual(calls, ['start', 'witness_verdict_all', 'dispose']);
  assert.equal(result.run.publication.state, 'failed');
  assert.equal(result.run.courts.TRUSTGAP.execution, 'not_run');
  assert.equal(result.run.courts.WITNESS.verdict, 'inconclusive');
  assert.equal(result.run.courts.WITNESS.evidenceFreshness, 'fresh');
  assert(fs.existsSync(result.report.htmlPath)); assert(fs.existsSync(result.report.mdPath));
  const canonical = path.join(store.runDirectory(root, result.runId), 'run.json');
  const immutable = fs.readFileSync(canonical, 'utf8');
  fail = false;
  const published = await actions.publishRun(ctx, {runId: result.runId});
  assert.equal(published.publication.state, 'published'); assert.equal(publications, 2);
  assert.deepStrictEqual(calls, ['start', 'witness_verdict_all', 'dispose']);
  assert.equal(fs.readFileSync(canonical, 'utf8'), immutable);
  assert.equal(snapshot.runId, result.runId);
  assert.equal(actions.findLastReport(root).runId, result.runId);
  assert.equal(actions.listRuns(root)[0].publication.state, 'published');
  assert(!('payload' in actions.listRuns(root)[0].courts.WITNESS));
  assert.equal(actions.selectRun(root, result.runId).runId, result.runId);
  assert.throws(() => store.saveRun(root, result.run), /EEXIST/);
  assert.throws(() => actions.readRun(root, '../escape'), /Invalid run ID/);
  // The strict v2 adapter consumes saved evidence without creating an MCP client.
  await dashboard.publishEvidence(null, {root, run: published, session: {
    controller: new AbortController(), project: {id: published.workspaceId, name: 'project'},
    dash: {async publish(snap) { validate(snap); assert.equal(snap.runId, published.runId); assert.equal(snap.trustgap.state, 'not_run'); assert.equal(snap.witness.collectedAt, published.courts.WITNESS.collectedAt); return snap; }, runUrl: id => 'http://localhost/' + id}
  }});
  // Requested order, precomputed evidence, no fabricated TRIAGE clearance.
  calls.length = 0;
  const subset = await actions.runCourt(ctx, {courts: ['TRIAGE', 'TRUSTGAP'], formats: []});
  assert.deepStrictEqual(calls, ['start', 'triage_run', 'trustgap_report', 'dispose']);
  assert.equal(subset.run.courts.TRIAGE.execution, 'unavailable');
  assert.equal(subset.run.courts.TRUSTGAP.evidenceSource, 'precomputed');
  assert.equal(subset.run.courts.TRUSTGAP.evidenceFreshness, 'unknown');
  assert.equal(subset.run.courts.TRUSTGAP.metrics.find(m => m.name === 'trustGap').value, -3);
  assert(subset.errors.length); assert.equal(subset.report.htmlPath, null);
  assert(!fs.existsSync(path.join(root, 'reports/gaia/gaia-report.html')));
  assert.equal(actions.findLastReport(root).witness, null);
  assert.equal(actions.selectedRun(root).runId, result.runId);
  // Canonical realpath lock covers adapters and duplicate request IDs.
  let release, entered;
  const ready = new Promise(r => entered = r);
  class Blocking extends Client {async call(name) { entered(); await new Promise(r => release = r); return super.call(name); }}
  const alias = path.join(base, 'alias'); fs.symlinkSync(root, alias);
  const pending = actions.runCourt({...ctx, McpClient: Blocking}, {court: 'WITNESS', requestId: 'once', formats: []});
  const duplicate = actions.runCourt({...ctx, McpClient: Blocking}, {court: 'WITNESS', requestId: 'once', formats: []});
  assert.strictEqual(pending, duplicate);
  await ready;
  assert.equal(actions.getActiveRun(alias).courts.WITNESS.execution, 'running');
  await assert.rejects(actions.runCourt({...ctx, root: alias}, {court: 'TRIAGE'}), e => e.code === 'BUSY');
  await assert.rejects(actions.generateReport(ctx), e => e.code === 'BUSY');
  assert.throws(() => actions.cancelRun(ctx), e => e.code === 'NOT_SUPPORTED');
  release(); await pending;
  assert.equal(actions.getActiveRun(root), null);
  const sequences = events.filter(e => e.runId === result.runId).map(e => e.sequence);
  assert(events.some(e => e.kind === 'settled'));
  // All errors and startup failure still persist canonical evidence.
  class Dead extends Client { async start() {throw new Error('engine died');} }
  const dead = await actions.runCourt({...ctx, McpClient: Dead}, {courts: ['WITNESS', 'TRIAGE'], formats: []});
  assert.equal(dead.errors.length, 2); assert.equal(actions.readRun(root, dead.runId).courts.WITNESS.execution, 'error');
  await assert.rejects(actions.runCourt({...ctx, isTrusted: false}, {court: 'WITNESS'}), e => e.code === 'UNTRUSTED_WORKSPACE');
  await assert.rejects(actions.runCourt(ctx, {court: 'TRUSTGAP', timeoutSeconds: 5}), e => e.code === 'NOT_SUPPORTED');
  // Strong mutation freshness: even a recent unchanged report is not fresh.
  const report = path.join(root, 'mutation.json'); fs.writeFileSync(report, '{}');
  const cfg = {mutation: {command: 'fake', absReport: report, timeoutSeconds: 1}};
  const mutationCalls = [];
  const stale = await coordinator.collectCourts({async call(name) {mutationCalls.push(name); return name === 'trustgap_mutate' ? {status: 'started', job_id: 'job'} : {status: 'done', commandResult: {exitCode: 0}};}}, root, ['trustgap'], {}, cfg, null, null, {pollIntervalMs: 0});
  assert.equal(stale.trustgap.kind, 'error'); assert.match(stale.trustgap.errors[0], /fresh report/);
  assert.deepStrictEqual(mutationCalls, ['trustgap_mutate', 'trustgap_status']);
  const failedCommand = await coordinator.collectCourts({async call(name) {
    if (name === 'trustgap_mutate') return {status: 'started', job_id: 'failed'};
    fs.writeFileSync(report, '{"new":true}');
    return {status: 'done', commandResult: {exitCode: 1, stdout: '', stderr: 'mutation runner failed'}};
  }}, root, ['trustgap'], {}, cfg, null, null, {pollIntervalMs: 0});
  assert.equal(failedCommand.trustgap.kind, 'error');
  assert.match(failedCommand.trustgap.errors[0], /exited 1.*mutation runner failed/);
  // Read-only setup, stale preview protection and recoverable replacement.
  const original = fs.readFileSync(path.join(root, '.gaia.json'), 'utf8');
  const preview = actions.previewConfig(ctx);
  assert.equal(fs.readFileSync(preview.path, 'utf8'), original);
  await assert.rejects(actions.detectConfig(ctx), e => e.code === 'CONFIRM_REPLACE');
  assert.throws(() => actions.applyConfig(ctx, {...preview}), /confirmation/);
  fs.appendFileSync(preview.path, '\n');
  assert.throws(() => actions.applyConfig(ctx, {...preview, confirmReplace: true}), e => e.code === 'STALE_PREVIEW');
  const current = actions.previewConfig(ctx);
  const applied = actions.applyConfig(ctx, {...current, confirmReplace: true});
  assert.equal(fs.readFileSync(applied.backupPath, 'utf8'), original + '\n');
  assert.throws(() => actions.previewInstall(ctx), /Choose/);
  const install = actions.previewInstall(ctx, {host: 'vscode'});
  assert(!fs.existsSync(path.join(root, '.vscode')));
  const installed = await actions.installCourts(ctx, {previewId: install.previewId});
  assert.equal(installed.errors.length, 0); assert(installed.files.length > 1);
  const noConfig = path.join(base, 'empty'); fs.mkdirSync(noConfig);
  const unavailable = await actions.runCourt({root: noConfig, McpClient: Dead}, {court: 'WITNESS', formats: []});
  assert.equal(unavailable.run.courts.WITNESS.execution, 'unavailable');
  subscription.dispose();
  console.log('ok shared coordinator: exact selection, immutable storage, publish retry, locks, errors, freshness, setup');
})().catch(e => {console.error(e); process.exitCode = 1;}).finally(() => {fs.rmSync(base, {recursive: true, force: true});});

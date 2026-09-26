'use strict';
/**
 * tests/dashboard.js — converter invariants + child-process handoff end-to-end
 * (isolated: PORT=0, temp history, loopback only). Run: node tests/dashboard.js
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { projectId, toSnapshot, validate } = require('../lib/convert');
const { DashboardClient } = require('../lib/dashboard');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok ', name); }
  catch (e) { failed++; console.error('  FAIL', name, '\n   ', e && e.message); }
}

const META = (pid, runId, projectName = 'northstar') => ({
  projectId: pid, projectName, runId, createdAt: new Date().toISOString(),
  revision: 0, state: 'complete', checkedOutCommit: null, branch: 'main',
  workingTreeDirty: false, producer: { name: 'triumph-courts', version: '0.2.0' },
});
const full = (r, s, w) => ({ redline: r, splitbrain: s, warpath: w });

(async () => {
  await t('projectId is a stable RFC-4122 v5 UUID per workspace URI', () => {
    const a = projectId('file:///home/ubuntu/ibm-bob/northstar');
    const b = projectId('file:///home/ubuntu/ibm-bob/northstar');
    const c = projectId('file:///other/workspace');
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, c);
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  await t('complete court preserves real evidence + source timestamp', () => {
    const pid = projectId('file:///x'); const runId = crypto.randomUUID();
    const gen = new Date('2026-09-26T09:00:00Z').toISOString();
    const snap = toSnapshot(META(pid, runId), full(
      { kind: 'complete', payload: { court: 'REDLINE', summary: { green: 0, red: 8 }, generated: gen } },
      { kind: 'not_run' },
      { kind: 'not_run' }), new Date().toISOString());
    assert.strictEqual(snap.redline.state, 'complete');
    assert.strictEqual(snap.redline.payload.summary.red, 8, 'evidence must pass through verbatim');
    assert.strictEqual(snap.redline.sourceGeneratedAt, gen, 'source timestamp mapped from generated');
    validate(snap);
  });

  await t('unavailable court has null payload + a reason (never a pass)', () => {
    const pid = projectId('file:///x'); const runId = crypto.randomUUID();
    const snap = toSnapshot(META(pid, runId), full(
      { kind: 'unavailable', errors: ['spec.path missing'] },
      { kind: 'unavailable', errors: ['no mutation.command'] },
      { kind: 'not_run' }), new Date().toISOString());
    assert.strictEqual(snap.redline.state, 'unavailable');
    assert.strictEqual(snap.redline.payload, null);
    assert.ok(snap.redline.errors.length > 0);
    assert.strictEqual(snap.state, 'complete', 'run completes even with unavailable courts');
    validate(snap);
  });

  await t('missing source timestamp → null, evidence retained', () => {
    const pid = projectId('file:///x'); const runId = crypto.randomUUID();
    const snap = toSnapshot(META(pid, runId), full(
      { kind: 'complete', payload: { court: 'WARPATH', suspect: { id: 'd1' } } }, // no timestamp field
      { kind: 'not_run' }, { kind: 'not_run' }), new Date().toISOString());
    assert.strictEqual(snap.redline.sourceGeneratedAt, null);
    assert.ok(snap.redline.payload.suspect);
    validate(snap);
  });

  await t('malformed snapshot is rejected (fail fast)', () => {
    const pid = projectId('file:///x');
    assert.throws(() => toSnapshot({ ...META(pid, 'not-a-uuid') }, full({kind:'not_run'},{kind:'not_run'},{kind:'not_run'}), new Date().toISOString()));
    assert.throws(() => toSnapshot({ ...META(pid, crypto.randomUUID()), revision: -1 }, full({kind:'not_run'},{kind:'not_run'},{kind:'not_run'}), new Date().toISOString()));
  });

  await t('handoff e2e: isolated child, register, publish, run-again, stop', async () => {
    const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-hist-'));
    const pid = projectId('file:///tmp/triumph-e2e');
    const client = new DashboardClient({ project: { id: pid, name: 'e2e' }, historyDir });
    await client.start();
    try {
      assert.match(client.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.match(client.token, /^[0-9a-f]{64}$/);
      // unsolicited run
      const runId = crypto.randomUUID();
      const now = new Date().toISOString();
      const snap = toSnapshot(META(pid, runId, 'e2e'), full(
        { kind: 'complete', payload: { court: 'REDLINE', summary: { green: 0, red: 8 }, generated: now } },
        { kind: 'not_run' }, { kind: 'not_run' }), now);
      const r = await client.publish(snap);
      assert.strictEqual(r.revision, 0);
      // browser "Run again" → placeholder rev 0 → extension submits rev 1
      const browserReq = await new Promise((res, rej) => {
        const u = new URL(client.url + '/api/projects/' + pid + '/run');
        const d = Buffer.from(JSON.stringify({ courts: ['redline'] }));
        const rq = require('http').request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': d.length } }, (x) => { let b = ''; x.on('data', c => b += c); x.on('end', () => res({ status: x.statusCode })); });
        rq.on('error', rej); rq.write(d); rq.end();
      });
      assert.strictEqual(browserReq.status, 202);
      let pending = null;
      for (let i = 0; i < 12 && !pending; i++) { await new Promise(r => setTimeout(r, 400)); pending = await client.poll(); }
      assert.ok(pending, 'no pending run request surfaced');
      assert.deepStrictEqual(pending.courts, ['redline']);
      await client.acknowledge(pending.requestId);
      const rerun = toSnapshot(
        { ...META(pid, pending.runId, 'e2e'), createdAt: pending.createdAt, revision: 1 },
        full({ kind: 'complete', payload: { court: 'REDLINE', summary: { green: 1, red: 7 } } }, { kind: 'not_run' }, { kind: 'not_run' }),
        new Date().toISOString());
      const pub = await client.publish(rerun);
      assert.strictEqual(pub.revision, 1);
      assert.strictEqual(pub.runId, pending.runId);
    } finally {
      await client.stop();
    }
  });

  await t('git provenance: real repo yields commit/branch/dirty; non-repo is null', async () => {
    const { gitProvenance } = require('../src/dashboard');
    const real = await gitProvenance('/home/ubuntu/ibm-bob/northstar');
    assert.match(real.checkedOutCommit, /^[0-9a-f]{40}$/, 'commit should be a full SHA');
    assert.strictEqual(typeof real.branch, 'string');
    assert.strictEqual(typeof real.workingTreeDirty, 'boolean');
    const none = await gitProvenance(fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-')));
    assert.deepStrictEqual(none, { checkedOutCommit: null, branch: null, workingTreeDirty: null });
  });

  await t('session: one dashboard serves an unsolicited run then a browser run-again', async () => {
    const vscode = { workspace: { workspaceFolders: [{ uri: { toString: () => 'file:///tmp/triumph-sess' } }] } };
    const { ensureSession, stopSession } = require('../src/dashboard');
    const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-sess-'));
    // Stub enginePath with a repo that has no courts — proves session+polling plumbing
    // without needing a full court run. We only check the session stays connected and
    // a browser request surfaces on poll().
    const session = await ensureSession(vscode, { root: '/tmp', enginePath: require('path').join(__dirname, '..', 'court.js'), historyDir });
    try {
      assert.ok(session.dash.connected, 'session should be connected');
      const again = await ensureSession(vscode, { root: '/tmp', enginePath: session.enginePath, historyDir });
      assert.strictEqual(again, session, 'same project must reuse the live session (no second process)');
      // Browser run-again surfaces via the persistent session's poll.
      const http = require('http');
      await new Promise((res, rej) => {
        const u = new URL(session.dash.url + '/api/projects/' + session.project.id + '/run');
        const d = Buffer.from(JSON.stringify({ courts: ['warpath'] }));
        const rq = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': d.length } }, (x) => { x.resume(); x.on('end', res); });
        rq.on('error', rej); rq.write(d); rq.end();
      });
      let pending = null;
      for (let i = 0; i < 12 && !pending; i++) { await new Promise(r => setTimeout(r, 400)); pending = await session.dash.poll(); }
      assert.ok(pending && pending.runId, 'browser run-again should surface on the persistent session');
      assert.deepStrictEqual(pending.courts, ['warpath']);
      await session.dash.acknowledge(pending.requestId);
    } finally {
      await stopSession();
    }
  });

  await t('re-register the same project after a clean disconnect', async () => {
    const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-hist-'));
    const pid = projectId('file:///tmp/triumph-reconn');
    const c1 = new DashboardClient({ project: { id: pid, name: 'e2e' }, historyDir });
    await c1.start();
    const t1 = c1.token;
    await c1.stop();
    const c2 = new DashboardClient({ project: { id: pid, name: 'e2e' }, historyDir });
    await c2.start();
    assert.notStrictEqual(c2.token, t1, 'a fresh token per connection');
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    const r = await c2.publish(toSnapshot(META(pid, runId, 'e2e'), full({ kind: 'not_run' }, { kind: 'not_run' }, { kind: 'not_run' }), now));
    assert.strictEqual(r.revision, 0);
    await c2.stop();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

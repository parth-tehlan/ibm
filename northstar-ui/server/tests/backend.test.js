import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { newSnapshot, store, load, collectCourt, requestSchema } from '../snapshot.js';
import { exportSnapshot } from '../export.js';
import { withCourtClient } from '../mcp.js';

const temp = () => mkdtemp(path.join(os.tmpdir(), 'northstar-dashboard-'));
test('Zod request schema rejects duplicates, extra keys and arbitrary tools', () => {
  assert.equal(requestSchema.safeParse({ courts: ['redline', 'redline'] }).success, false);
  assert.equal(requestSchema.safeParse({ courts: ['warpath_postmortem'] }).success, false);
  assert.equal(requestSchema.safeParse({ courts: ['redline'], command: 'rm' }).success, false);
});
test('store/load round trip, path guard, deterministic escaped exports with detailed evidence', async () => {
  const dir = await temp();
  try {
    const s = newSnapshot(['redline', 'splitbrain', 'warpath']);
    s.state = 'complete';
    for (const court of ['redline', 'splitbrain', 'warpath']) s[court].state = 'complete';
    s.redline.payload = { summary: { red: 1 }, results: [{ clause: 'W1', status: 'red', test: 'clause-W1.test.ts', failed: 1, failures: [{ title: '<img src=x onerror=alert(1)>', message: 'expected <green> & got red' }] }] };
    s.splitbrain.payload = { claimedCoverage: 0.91, honestMutationScore: 0.8, trustGap: 0.11, dishonestTests: ['fake'], itLedger: [{ itId: 'fake', survived: 2 }] };
    s.warpath.payload = { context: { deploys: [{ id: 'D1' }], metrics: { window: 'day' }, logWindow: [{ message: 'breaker OPEN' }] }, triage: { suspect: { id: 'D1' }, evidence: [{ message: 'breaker OPEN' }] } };
    await store(s, dir);
    assert.deepEqual(await load(s.runId, dir), s);
    assert.equal(await load('../etc/passwd', dir), null);
    const report = exportSnapshot(s, 'html');
    assert.equal(report, exportSnapshot(s, 'html'));
    assert.match(report, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(report, /<img/);
    assert.match(report, /breaker OPEN/);
    assert.match(exportSnapshot(s, 'md'), /Flagged test/);
    assert.match(exportSnapshot(s, 'md'), /clause\\-W1/);
    assert.deepEqual(JSON.parse(exportSnapshot(s, 'json')), s);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('missing fixture paths mark warpath unavailable without MCP call', async () => {
  const dir = await temp();
  try {
    let called = false;
    const result = await collectCourt('warpath', { fixtureRoot: dir, client: async () => { called = true; } });
    assert.equal(result.state, 'unavailable');
    assert.equal(result.errors.length, 3);
    assert.match(result.errors[0], /fixtures\/deploy.json/);
    assert.equal(called, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('MCP handshake and allowlist against real engine', async () => {
  const about = await withCourtClient(async (call) => {
    await assert.rejects(call('warpath_postmortem'), /not allowed/);
    return await call('splitbrain_trustgap');
  }, { timeoutMs: 12000 });
  assert.equal(about.court, 'SPLITBRAIN');
  const split = await collectCourt('splitbrain');
  assert.equal(split.state, 'complete');
  assert.ok(split.payload.itLedger.length);
  assert.match(split.payload.warnings[0], /no Stryker run/);
});
test('MCP timeout kills hung process', async () => {
  const dir = await temp();
  try {
    const script = path.join(dir, 'stall.cjs');
    await writeFile(script, 'setInterval(() => {}, 1000);\n');
    await assert.rejects(withCourtClient(async () => {}, { engine: script, timeoutMs: 100 }), /timeout/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
// The v1 collection API has been retired; the new browser/extension HTTP contract
// is exercised in api.test.js. These tests retain coverage of the legacy importer.

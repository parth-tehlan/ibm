#!/usr/bin/env node
/** Opt-in only: starts real mutation testing against ../northstar. NOT safe for npm test/CI. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const ENGINE = path.resolve(__dirname, '..', 'court.js');
const NORTHSTAR = path.resolve(__dirname, '..', '..', 'northstar');

// Job ids live in the engine process, so start and status must share a session.
function engineSession(repo) {
  const child = spawn(process.execPath, [ENGINE, '--repo', repo]);
  const rl = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let id = 0;
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  rl.on('line', (line) => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  child.on('error', (err) => { for (const reject of pending.values()) reject(err, true); pending.clear(); });
  child.on('close', (code) => {
    for (const reject of pending.values()) reject(new Error(`engine exited ${code}: ${stderr.slice(0, 400)}`), true);
    pending.clear();
  });
  const call = (name, args) => new Promise((resolve, reject) => {
    const rid = ++id;
    pending.set(rid, (msg, error = false) => {
      if (error) return reject(msg);
      if (msg.error) return reject(new Error(msg.error.message));
      try { resolve(JSON.parse(msg.result.content[0].text)); } catch (e) { reject(e); }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method: 'tools/call', params: { name, arguments: args || {} } }) + '\n');
  });
  return { call, kill: () => child.kill('SIGKILL') };
}

(async () => {
  console.log('LIVE Northstar mutation test (opt-in; may write generated reports in Northstar)');
  const sess = engineSession(NORTHSTAR);
  try {
    const t0 = Date.now();
    const start = await sess.call('trustgap_mutate', { claimed_coverage: 91.66 });
    const elapsed = Date.now() - t0;
    assert.equal(start.status, 'started');
    assert.ok(start.job_id, 'no job_id');
    assert.ok(elapsed < 5000, 'mutate blocked for ' + elapsed + 'ms');
    let st, tries = 0;
    do {
      await new Promise((r) => setTimeout(r, 1500));
      st = await sess.call('trustgap_status', { job_id: start.job_id });
      tries++;
    } while (st.status === 'running' && tries < 90);
    assert.equal(st.status, 'done', 'job did not finish: ' + JSON.stringify(st).slice(0, 200));
    assert.ok(st.result && typeof st.result.trustGap === 'number', 'completed job missing trustGap');
    assert.ok(st.result.trustGap > 0, 'expected a positive trust gap on Northstar planted tautology');
    console.log('PASS: async mutation completed with trust gap');
  } finally { sess.kill(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });

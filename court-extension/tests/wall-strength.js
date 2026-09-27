#!/usr/bin/env node
/* Wall-strength: the WITNESS wall must hold even if the model misbehaves. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const ENGINE = path.resolve(__dirname, '..', 'court.js');
const NORTHSTAR = path.resolve(__dirname, '..', '..', 'northstar');

let passed = 0, failed = 0;
const t = (n, f) => Promise.resolve().then(f).then(() => { passed++; console.log('  ok  ' + n); }).catch((e) => { failed++; console.error('  FAIL ' + n + ' — ' + e.message); });

function calls(repo, list) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [ENGINE, '--repo', repo]);
    const rl = readline.createInterface({ input: child.stdout });
    const pend = new Map();
    rl.on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; } if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    let i = 0;
    const out = [];
    const next = () => {
      if (!list.length) { child.stdin.end(); return; }
      const c = list.shift(); const id = ++i;
      pend.set(id, (m) => { out.push(m); next(); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: c }) + '\n');
    };
    next();
    child.on('close', () => resolve(out));
    setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timeout')); }, 60_000);
  });
}

(async () => {
  console.log('wall-strength checks\n');

  // Clause-id injection attempts that must all be rejected.
  for (const bad of ['W4/../../src/circuit', 'W4\0', 'W4; rm -rf /', 'W4$(cat src/circuit.ts)', 'W4`id`', 'W4%0a']) {
    await t('rejects clause_id ' + JSON.stringify(bad), async () => {
      const [r] = await calls(NORTHSTAR, [{ name: 'witness_clause', arguments: { clause_id: bad } }]);
      const msg = r.error ? r.error.message : (JSON.parse(r.result.content[0].text).error || JSON.stringify(r.result));
      assert.ok(/invalid clause_id/.test(msg), 'not rejected: ' + msg.slice(0, 120));
    });
  }

  // The witness suite path can never be coerced into the wall via config
  // confusion: clauseTestFile stays under tests.dir.
  await t('clauseTestFile always lands under tests.dir', () => {
    const { loadConfig, clauseTestFile } = require('../lib/config');
    const cfg = loadConfig(NORTHSTAR);
    for (const id of ['W1', 'W8']) {
      const fp = clauseTestFile(cfg, id);
      assert.ok(fp.startsWith(cfg.tests.absDir), fp + ' escaped tests dir');
      assert.ok(!fp.startsWith(cfg.wall.denyGlobs && path.join(cfg.repoRoot, 'src')), 'landed in wall');
    }
  });

  // A repo whose denyGlobs would swallow tests/ must fail validation loudly.
  await t('config validation refuses a wall that swallows the tests dir', () => {
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-wall-'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.writeFileSync(path.join(dir, 'docs', 's.md'), '# s\n## W1 — x\n1. a MUST b\n');
    fs.writeFileSync(path.join(dir, '.gaia.yml'), 'version: 1\nspec: { path: docs/s.md }\nwall: { denyGlobs: ["**"] }\n');
    const { loadConfig } = require('../lib/config');
    let threw = null;
    try { loadConfig(dir); } catch (e) { threw = e; }
    assert.ok(threw, 'loadConfig should refuse a wall swallowing tests/');
    assert.ok(/must not match the tests dir|must not match spec\.path/.test(threw.message), 'wrong error: ' + threw.message);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * tests/verify-diff.js — integration test for the gaia_verify_diff tool.
 * Boots the real engine over stdio MCP against a scratch jest repo with a
 * planted diff, and asserts the killed/survived verdicts + repair hints.
 * Run: node tests/verify-diff.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ok', name); })
    .catch((e) => { failed++; console.error('  FAIL', name, '—', e.message); });
}

// ---------------------------------------------------------------------------
// Build a scratch repo: src/cart.ts + tests/cart.test.js (plain JS test so
// no ts-jest dependency), jest config, .gaia.yml.
// ---------------------------------------------------------------------------
function buildRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-verify-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'src', 'cart.js'), `'use strict';
// Shopping cart total with a minimum-order guard.
function totalCents(items, discountCents) {
  let sum = 0;
  for (const it of items) sum += it.priceCents * it.qty;
  if (sum < 500) {
    return sum; // no discount below $5.00
  }
  return Math.max(0, sum - discountCents);
}
module.exports = { totalCents };
`);

  // The honest test pins the boundary; the dishonest one is a tautology.
  fs.writeFileSync(path.join(dir, 'tests', 'cart.test.js'), `'use strict';
const { totalCents } = require('../src/cart');

test('returns a number (coverage-shaped tautology)', () => {
  const x = totalCents([{ priceCents: 100, qty: 1 }], 50);
  expect(x).toEqual(x); // never fails
});

test('no discount below the 500-cent minimum', () => {
  expect(totalCents([{ priceCents: 499, qty: 1 }], 100)).toBe(499);
  expect(totalCents([{ priceCents: 500, qty: 1 }], 100)).toBe(400);
});
`);

  fs.writeFileSync(path.join(dir, 'jest.config.js'), `module.exports = {
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/**/*.test.js'],
};
`);

  fs.writeFileSync(path.join(dir, 'docs', 'api-spec.md'), '## W1\nCart totals.\n');
  fs.writeFileSync(path.join(dir, '.gaia.yml'), `version: 1
spec: { path: docs/api-spec.md, clausePattern: '^## (W\\\\d+)', clauseIdPattern: '^W\\\\d+$' }
tests: { framework: jest, dir: tests, clauseTestPattern: 'clause-{{clause}}.test.js' }
wall: { denyGlobs: ['src/**'] }
`);

  // jest must be resolvable from the scratch repo: symlink the extension's
  // node_modules-less env is not enough — use the system npx cache by
  // installing a local link to the global jest if available, else rely on
  // npx fetching (sandbox has network). We write a minimal package.json.
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'scratch-verify', version: '0.0.0', private: true,
  }, null, 2));
  return dir;
}

// ---------------------------------------------------------------------------
// MCP client (newline-delimited JSON-RPC over stdio)
// ---------------------------------------------------------------------------
function mcpCall(child, id, method, params) {
  return new Promise((resolve, reject) => {
    const onData = (buf) => {
      const lines = buf.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === id) {
          child.stdout.off('data', onData);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
          return;
        }
      }
    };
    child.stdout.on('data', onData);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { child.stdout.off('data', onData); reject(new Error('mcp timeout id=' + id)); }, 180_000);
  });
}

async function main() {
  const repo = buildRepo();
  console.log('  scratch repo:', repo);

  // gaia_verify_diff runs a real jest against the scratch repo. The repo has
  // no node_modules and the extension dir ships none, so point GAIA_TOOL_PATH
  // at the sibling northstar repo's node_modules (which carries a real jest).
  // The engine subprocess inherits this env; toolenv resolves jest from it.
  const nsToolDir = path.resolve(ROOT, '..', 'northstar', 'node_modules');
  const prevToolPath = process.env.GAIA_TOOL_PATH;
  if (fs.existsSync(nsToolDir)) process.env.GAIA_TOOL_PATH = nsToolDir;

  const child = spawn('node', [path.join(ROOT, 'court.js'), '--repo', repo], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  await mcpCall(child, 1, 'initialize', {});

  await t('tools/list advertises gaia_verify_diff', async () => {
    const r = await mcpCall(child, 2, 'tools/list', {});
    const names = r.tools.map((x) => x.name);
    assert.ok(names.includes('gaia_verify_diff'), 'missing tool');
  });

  // The diff: change the guard `if (sum < 500)` to `if (sum < 100)` — a real
  // semantic change the honest test MUST catch (499-cent cart now gets a
  // discount it should not). This is a killable boundary mutant.
  const diff = `diff --git a/src/cart.js b/src/cart.js
--- a/src/cart.js
+++ b/src/cart.js
@@ -3,7 +3,7 @@
 function totalCents(items, discountCents) {
   let sum = 0;
   for (const it of items) sum += it.priceCents * it.qty;
-  if (sum < 500) {
+  if (sum < 100) {
     return sum; // no discount below $5.00
   }
   return Math.max(0, sum - discountCents);
`;
  // Apply the diff to the working tree so the planner sees post-diff content.
  fs.writeFileSync(path.join(repo, 'src', 'cart.js'), `'use strict';
// Shopping cart total with a minimum-order guard.
function totalCents(items, discountCents) {
  let sum = 0;
  for (const it of items) sum += it.priceCents * it.qty;
  if (sum < 100) {
    return sum; // no discount below $5.00
  }
  return Math.max(0, sum - discountCents);
}
module.exports = { totalCents };
`);

  await t('gaia_verify_diff kills the boundary mutant via the honest test', async () => {
    const r = await mcpCall(child, 3, 'tools/call', {
      name: 'gaia_verify_diff', arguments: { diff },
    });
    const payload = JSON.parse(r.content[0].text);
    assert.strictEqual(payload.tool, 'gaia_verify_diff');
    assert.strictEqual(payload.diff.filesChanged, 1);
    assert.ok(payload.diff.mutantsGenerated >= 1, 'expected >=1 mutant');
    const file = payload.files[0];
    assert.strictEqual(file.status, 'passed', 'all mutants should be killed: ' + JSON.stringify(payload, null, 2).slice(0, 2000));
    assert.strictEqual(payload.status, 'passed');
    assert.strictEqual(payload.honest, true);
    assert.ok(file.killed.length >= 1);
    assert.ok(file.killed[0].killedBy.some((t) => /no discount below/.test(t)));
    assert.ok(payload.durationMs < 120_000);
    console.log('    (durationMs=' + payload.durationMs + ', mutants=' + payload.diff.mutantsGenerated + ')');
  });

  await t('survivor path: guard line NOT covered -> survivor + repair hint', async () => {
    // Break the honest boundary test so the mutant survives.
    fs.writeFileSync(path.join(repo, 'tests', 'cart.test.js'), `'use strict';
const { totalCents } = require('../src/cart');
test('returns a number (coverage-shaped tautology)', () => {
  const x = totalCents([{ priceCents: 100, qty: 1 }], 50);
  expect(x).toEqual(x);
});
test('above minimum gets a discount (never tests the boundary)', () => {
  expect(totalCents([{ priceCents: 1000, qty: 1 }], 100)).toBe(900);
});
`);
    const r = await mcpCall(child, 4, 'tools/call', {
      name: 'gaia_verify_diff', arguments: { diff },
    });
    const payload = JSON.parse(r.content[0].text);
    assert.strictEqual(payload.status, 'failed');
    assert.strictEqual(payload.honest, false);
    const surv = payload.files[0].survivors;
    assert.ok(surv.length >= 1, 'expected a survivor: ' + JSON.stringify(payload).slice(0, 1500));
    assert.strictEqual(surv[0].operator, 'boundary');
    assert.ok(surv[0].repair.explanation.length > 10);
    assert.ok(/boundary/i.test(surv[0].repair.suggestion));
    assert.ok(payload.retry_hint && payload.retry_hint.length > 0);
  });

  await t('no-git / empty diff errors honestly', async () => {
    const r = await mcpCall(child, 5, 'tools/call', { name: 'gaia_verify_diff', arguments: {} });
    const payload = JSON.parse(r.content[0].text);
    assert.strictEqual(payload.status, 'error');
  });

  await t('test-only diff is skipped, not silently green', async () => {
    const r = await mcpCall(child, 6, 'tools/call', {
      name: 'gaia_verify_diff',
      arguments: { diff: `diff --git a/tests/cart.test.js b/tests/cart.test.js
--- a/tests/cart.test.js
+++ b/tests/cart.test.js
@@ -1,2 +1,3 @@
 // a
+// b
 // c
` },
    });
    const payload = JSON.parse(r.content[0].text);
    assert.strictEqual(payload.status, 'skipped');
  });

  child.kill();
  fs.rmSync(repo, { recursive: true, force: true });
  // Restore the caller's GAIA_TOOL_PATH so nothing leaks beyond this test.
  if (prevToolPath === undefined) delete process.env.GAIA_TOOL_PATH;
  else process.env.GAIA_TOOL_PATH = prevToolPath;
  console.log(`\nverify-diff: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });

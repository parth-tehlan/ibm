#!/usr/bin/env node
/**
 * tests/micro.js — zero-dep tests for lib/micro.js (mutation planner).
 * Run: node tests/micro.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planFileMutants, maskSource, selectImpactedTests } = require('../lib/micro');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok', name); }
  catch (e) { failed++; console.error('  FAIL', name, '—', e.message); }
}

const SRC = [
  'export function reductionCents(amountCents: number, code: string): number {',   // 1
  '  switch (code) {',                                                              // 2
  "    case 'FIVE':",                                                               // 3
  '      return 500; // flat $5',                                                   // 4
  '    default:',                                                                   // 5
  '      return 0;',                                                                // 6
  '  }',                                                                            // 7
  '}',                                                                              // 8
  '',                                                                               // 9
  'export async function applyDiscount(amountCents: number, codes: string[]) {',    // 10
  '  if (amountCents < 500) {',                                                     // 11
  '    return amountCents;',                                                        // 12
  '  }',                                                                            // 13
  '  let best = 0;',                                                                // 14
  '  for (const code of codes) {',                                                  // 15
  '    best = Math.max(best, reductionCents(amountCents, code));',                  // 16
  '  }',                                                                            // 17
  '  return Math.max(0, amountCents - best);',                                      // 18
  '}',                                                                              // 19
].join('\n');

t('maskSource blanks strings and comments, keeps code + newlines', () => {
  const m = maskSource("const a = 'x > y'; // c >= d\nif (a > b) {}");
  assert.ok(!m.includes("'x > y'"));
  assert.ok(!m.includes('c >= d'));
  assert.ok(m.includes('if (a > b)'));
  assert.strictEqual(m.split('\n').length, 2);
});

t('boundary operator fires on guard line, carries repair hint', () => {
  const { mutants } = planFileMutants('src/x.ts', SRC, [11]);
  assert.strictEqual(mutants.length, 1);
  assert.strictEqual(mutants[0].operator, 'boundary');
  assert.strictEqual(mutants[0].before, '<');
  assert.strictEqual(mutants[0].after, '<=');
  assert.strictEqual(mutants[0].line, 11);
  assert.ok(mutants[0].repair.explanation.length > 0);
  // Whole-line swap payload is well-formed.
  assert.ok(mutants[0].lineAfter.includes('amountCents <= 500'));
});

t('return-literal operator fires on literal return line', () => {
  const { mutants } = planFileMutants('src/x.ts', SRC, [4]);
  assert.strictEqual(mutants.length, 1);
  assert.strictEqual(mutants[0].operator, 'return-literal');
  assert.strictEqual(mutants[0].before, '500');
  assert.strictEqual(mutants[0].after, '501');
});

t('comment-only and blank lines are skipped with reasons, never mutated', () => {
  const src = '// just a comment\n\nconst x = 1;\n';
  const { mutants, skipped } = planFileMutants('src/x.ts', src, [1, 2]);
  assert.strictEqual(mutants.length, 0);
  assert.strictEqual(skipped.length, 2);
});

t('operators never fire inside string literals', () => {
  const src = "const msg = 'a >= b && c';\n";
  const { mutants } = planFileMutants('src/x.ts', src, [1]);
  assert.strictEqual(mutants.length, 0);
});

t('equivalent mutation is never emitted (before === after)', () => {
  // A line whose only operator candidate would be a no-op is skipped.
  const src = 'const y = x;\n';
  const { mutants } = planFileMutants('src/x.ts', src, [1]);
  assert.strictEqual(mutants.length, 0);
});

t('arithmetic-sign fires on subtraction with identifier operands', () => {
  const { mutants } = planFileMutants('src/x.ts', SRC, [18]);
  assert.strictEqual(mutants.length, 1);
  assert.strictEqual(mutants[0].operator, 'arithmetic-sign');
  assert.ok(mutants[0].lineAfter.includes('amountCents + best'));
});

t('negation operator fires on simple if guard, preserves parens', () => {
  const src = '  if (ready) {\n    go();\n  }\n';
  const { mutants } = planFileMutants('src/x.ts', src, [1]);
  assert.strictEqual(mutants.length, 1);
  assert.strictEqual(mutants[0].operator, 'conditional-negation');
  assert.ok(mutants[0].lineAfter.includes('!(ready)'));
});

t('negation refused on mixed logical operators without full parens', () => {
  const src = '  if (a && b || c) {\n';
  const { mutants } = planFileMutants('src/x.ts', src, [1]);
  // logical-swap may still fire, but negation must not (precedence hazard).
  assert.ok(!mutants.some((m) => m.operator === 'conditional-negation'));
});

t('logical-swap fires on && condition', () => {
  const src = '  if (a > 0 && b > 0) {\n';
  const { mutants } = planFileMutants('src/x.ts', src, [1]);
  // boundary fires first (operator order), so check dedupe-by-line.
  assert.strictEqual(mutants.length, 1);
});

t('max 3 mutants per file, one operator per line, deterministic order', () => {
  const src = [
    'if (a > 1) { f(); }',   // 1 boundary
    'if (b > 2) { g(); }',   // 2 boundary
    'if (c > 3) { h(); }',   // 3 boundary
    'if (d > 4) { i(); }',   // 4 boundary (cut off)
  ].join('\n');
  const { mutants } = planFileMutants('src/x.ts', src, [1, 2, 3, 4]);
  assert.strictEqual(mutants.length, 3);
  assert.deepStrictEqual(mutants.map((m) => m.line), [1, 2, 3]);
  assert.deepStrictEqual(mutants.map((m) => m.id), ['mm-1', 'mm-2', 'mm-3']);
});

t('out-of-range added lines are skipped with stale-diff reason', () => {
  const { mutants, skipped } = planFileMutants('src/x.ts', 'const a = 1;\n', [99]);
  assert.strictEqual(mutants.length, 0);
  assert.ok(/outside current file/.test(skipped[0].reason));
});

t('planner output is byte-applying: lineBefore + span -> lineAfter', () => {
  const { mutants } = planFileMutants('src/x.ts', SRC, [11]);
  const m = mutants[0];
  const idx = m.lineBefore.indexOf(m.before);
  assert.ok(idx >= 0);
  const rebuilt = m.lineBefore.slice(0, idx) + m.after + m.lineBefore.slice(idx + m.before.length);
  assert.strictEqual(rebuilt, m.lineAfter);
});

// --- impacted-test selection ---------------------------------------------
t('selectImpactedTests: static-import match beats basename, clause files excluded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-micro-'));
  const testsDir = path.join(dir, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });
  const direct = path.join(testsDir, 'unit-x.test.ts');
  const byName = path.join(testsDir, 'discounts.test.ts');
  const clause = path.join(testsDir, 'clause-W1.test.ts');
  fs.writeFileSync(direct, "import { f } from '../src/discounts';\ntest('x', () => {});\n");
  fs.writeFileSync(byName, "test('y', () => {});\n"); // no import; basename only
  fs.writeFileSync(clause, "import { f } from '../src/discounts';\ntest('w', () => {});\n");
  const cfg = {
    repoRoot: dir,
    tests: { absDir: testsDir, clauseTestPattern: 'clause-{{clause}}.test.ts' },
    spec: { clauseIdPattern: '^W\\d+$' },
  };
  const { impacted, reasons } = selectImpactedTests(cfg, 'src/discounts.ts', [direct, byName, clause]);
  assert.ok(impacted.includes(direct));
  assert.ok(impacted.includes(byName));
  assert.ok(!impacted.includes(clause)); // witness suites never judge micro-mutants
  assert.strictEqual(reasons[path.basename(direct)], 'static-import');
  assert.strictEqual(reasons[path.basename(byName)], 'basename');
});

t('selectImpactedTests: harness-seam binding discovered via bind() call', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-micro-'));
  const testsDir = path.join(dir, 'tests');
  const harnessDir = path.join(dir, 'harness');
  fs.mkdirSync(testsDir, { recursive: true });
  fs.mkdirSync(harnessDir, { recursive: true });
  fs.writeFileSync(path.join(harnessDir, 'bind-seams.cjs'),
    "bind('../src/discounts', { applyDiscount: 'applyDiscount' });\nmodule.exports = {};\n");
  const seamUser = path.join(testsDir, 'policy.test.ts');
  fs.writeFileSync(seamUser, "declare function applyDiscount(a:number,c:string[]):Promise<number>;\ntest('p', async () => { await applyDiscount(1, []); });\n");
  const unrelated = path.join(testsDir, 'other.test.ts');
  fs.writeFileSync(unrelated, "test('o', () => {});\n");
  const cfg = {
    repoRoot: dir,
    tests: { absDir: testsDir, clauseTestPattern: 'clause-{{clause}}.test.ts' },
    spec: { clauseIdPattern: '^W\\d+$' },
  };
  const { impacted, reasons } = selectImpactedTests(cfg, 'src/discounts.ts', [seamUser, unrelated]);
  assert.ok(impacted.includes(seamUser));
  assert.ok(!impacted.includes(unrelated));
  assert.strictEqual(reasons[path.basename(seamUser)], 'harness-seam');
});

console.log(`\nmicro: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

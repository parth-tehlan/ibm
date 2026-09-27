#!/usr/bin/env node
/**
 * tests/diff.js — zero-dep tests for lib/diff.js (unified-diff parser).
 * Run: node tests/diff.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseDiff, mutableFiles } = require('../lib/diff');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok', name); }
  catch (e) { failed++; console.error('  FAIL', name, '—', e.message); }
}

// Ground truth: verbatim `git diff` capture (tests/fixtures-git.diff).
// Hunk @@ -9,7 +9,10 @@: context at new 9,10,11; removal of old 12;
// additions at new 12,13,14,15; context at new 16,17,18.
const GIT_DIFF = fs.readFileSync(path.join(__dirname, 'fixtures-git.diff'), 'utf8');

t('git diff: two files, added-line new-file numbering matches git ground truth', () => {
  const p = parseDiff(GIT_DIFF);
  assert.strictEqual(p.stats.filesChanged, 2);
  assert.strictEqual(p.files[0].path, 'src/discounts.ts');
  assert.deepStrictEqual(p.files[0].addedLines, [12, 13, 14, 15]);
  assert.strictEqual(p.files[0].removedCount, 1);
  assert.strictEqual(p.files[1].path, 'tests/discounts.test.ts');
  assert.deepStrictEqual(p.files[1].addedLines, [2]);
});

t('new file (--- /dev/null) is kind=add, all + lines numbered from 1', () => {
  const d = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export const a = 1;
+export const b = 2;
+export const c = 3;
`;
  const p = parseDiff(d);
  assert.strictEqual(p.files.length, 1);
  assert.strictEqual(p.files[0].kind, 'add');
  assert.deepStrictEqual(p.files[0].addedLines, [1, 2, 3]);
});

t('deleted file is rejected with reason, not mutated', () => {
  const d = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const a = 1;
-export const b = 2;
`;
  const p = parseDiff(d);
  assert.strictEqual(p.files.length, 0);
  assert.strictEqual(p.rejected[0].reason, 'file deleted — nothing to mutate');
  assert.strictEqual(p.rejected[0].path, 'src/old.ts');
});

t('binary patch rejected', () => {
  const d = `diff --git a/assets/logo.png b/assets/logo.png
index 111..222 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
`;
  const p = parseDiff(d);
  assert.strictEqual(p.files.length, 0);
  assert.strictEqual(p.rejected[0].reason, 'binary patch');
  assert.strictEqual(p.rejected[0].path, 'assets/logo.png');
});

t('rename targets the new path', () => {
  const d = `diff --git a/src/a.ts b/src/b.ts
similarity index 90%
rename from src/a.ts
rename to src/b.ts
--- a/src/a.ts
+++ b/src/b.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
 const z = 3;
`;
  const p = parseDiff(d);
  assert.strictEqual(p.files[0].kind, 'rename');
  assert.strictEqual(p.files[0].path, 'src/b.ts');
  assert.strictEqual(p.files[0].oldPath, 'src/a.ts');
  assert.deepStrictEqual(p.files[0].addedLines, [2]);
});

t('bare patch without diff --git header parses', () => {
  const d = `--- a/src/x.js
+++ b/src/x.js
@@ -3,3 +3,4 @@
 line3
+line4added
 line5
 line6
`;
  const p = parseDiff(d);
  assert.strictEqual(p.files.length, 1);
  assert.strictEqual(p.files[0].path, 'src/x.js');
  assert.deepStrictEqual(p.files[0].addedLines, [4]);
});

t('pure-removal diff for a file is rejected (nothing new to verify)', () => {
  const d = `diff --git a/src/x.js b/src/x.js
--- a/src/x.js
+++ b/src/x.js
@@ -5,3 +5,2 @@
 keep
-gone
-gone2
 keep2
`;
  const p = parseDiff(d);
  assert.strictEqual(p.files.length, 0);
  assert.strictEqual(p.rejected[0].reason, 'no added lines in diff');
});

t('\\ No newline at end of file tolerated', () => {
  const d = `diff --git a/src/x.js b/src/x.js
--- a/src/x.js
+++ b/src/x.js
@@ -1 +1,2 @@
 a
+b
\\ No newline at end of file
`;
  const p = parseDiff(d);
  assert.deepStrictEqual(p.files[0].addedLines, [2]);
});

t('empty / garbage input is an honest error, not a crash', () => {
  assert.strictEqual(parseDiff('').error, 'empty diff');
  assert.strictEqual(parseDiff('hello world\nnot a diff').files.length, 0);
});

t('mutableFiles: tests, fixtures, md excluded; src kept', () => {
  const p = parseDiff(GIT_DIFF);
  const { mutable, skipped } = mutableFiles(p);
  assert.strictEqual(mutable.length, 1);
  assert.strictEqual(mutable[0].path, 'src/discounts.ts');
  assert.strictEqual(skipped.length, 1);
  assert.ok(/test/.test(skipped[0].reason));
});

t('multi-hunk single file accumulates added lines in order', () => {
  const d = `diff --git a/src/m.js b/src/m.js
--- a/src/m.js
+++ b/src/m.js
@@ -2,2 +2,3 @@
 a
+b1
 c
@@ -20,2 +21,3 @@
 x
+y1
 z
`;
  const p = parseDiff(d);
  assert.deepStrictEqual(p.files[0].addedLines, [3, 22]);
  assert.strictEqual(p.files[0].hunks.length, 2);
});

t('stats: linesAdded/linesRemoved aggregated from real git diff', () => {
  const p = parseDiff(GIT_DIFF);
  assert.strictEqual(p.stats.linesAdded, 5); // 4 in src + 1 in tests
  assert.strictEqual(p.stats.linesRemoved, 1);
});

console.log(`\ndiff: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

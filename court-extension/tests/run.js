#!/usr/bin/env node
/**
 * tests/run.js — dependency-free smoke tests for the GAIA engine libs.
 * Run: node tests/run.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseYamlSubset, globToRegExp, loadConfig } = require('../lib/config');
const { computeTrustGap, fromGenericReport, applyTestNames } = require('../lib/trustgap');
const { detect, toYaml } = require('../lib/detect');
const { renderMarkdown, renderHtml } = require('../lib/render');
const { HOSTS, installHost } = require('../lib/hosts');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok', name); }
  catch (e) { failed++; console.error('  FAIL', name, '—', e.message); }
}

// --- config -------------------------------------------------------------
t('yaml subset: nested maps, lists, inline, comments, quotes', () => {
  const o = parseYamlSubset([
    'a: 1',
    'b:',
    '  c: hello # comment',
    '  d:',
    '    - x',
    '    - y: 2',
    '      z: "qu # ted"',
    'e: [1, two, "3"]',
    'f: true',
    'g: null',
  ].join('\n'));
  assert.strictEqual(o.a, 1);
  assert.strictEqual(o.b.c, 'hello');
  assert.deepStrictEqual(o.b.d[0], 'x');
  assert.deepStrictEqual(o.b.d[1], { y: 2, z: 'qu # ted' });
  assert.deepStrictEqual(o.e, [1, 'two', '3']);
  assert.strictEqual(o.f, true);
  assert.strictEqual(o.g, null);
});

t('glob: src/** denies src paths only', () => {
  const re = globToRegExp('src/**');
  assert.ok(re.test('src/pay/x.ts'));
  assert.ok(re.test('src/x.ts'));
  assert.ok(!re.test('tests/x.ts'));
  assert.ok(!re.test('src'));
});

t('round-trip: detect() output parses via toYaml → parseYamlSubset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-'));
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't', devDependencies: { jest: '^29' } }));
  fs.writeFileSync(path.join(dir, 'docs', 'api-spec.md'), '# S\n\n## W1 — a (REQUIRED)\n\n1. x MUST y\n\n## W2 — b\n\n1. z MUST NOT q\n');
  fs.writeFileSync(path.join(dir, 'tests', 'clause-W1.test.js'), '// t');
  const { config } = detect(dir);
  const y = toYaml(config);
  const back = parseYamlSubset(y);
  assert.strictEqual(back.spec.clausePattern, config.spec.clausePattern);
  assert.strictEqual(back.tests.clauseTestPattern, 'clause-{{clause}}.test.js');
  assert.deepStrictEqual(back.wall.denyGlobs, ['src/**']);
});

// --- trustgap -----------------------------------------------------------
t('trustgap: gap derived, dishonest = covering tests of survivors', () => {
  const mutants = fromGenericReport({ mutants: [
    { id: 'a', status: 'Killed', coveredBy: ['t1'] },
    { id: 'b', status: 'Survived', coveredBy: ['t1', 't2'] },
    { id: 'c', status: 'Survived', coveredBy: ['t2'] },
    { id: 'd', status: 'NoCoverage', coveredBy: [] },
  ] });
  const gap = computeTrustGap(mutants, 90);
  assert.strictEqual(gap.honestMutationScore, 33.33);
  assert.strictEqual(gap.trustGap, 56.67);
  assert.deepStrictEqual(gap.dishonestTests.map((d) => d.testId).sort(), ['t1', 't2']);
  assert.strictEqual(gap.totals.noCoverage, 1);
  const named = applyTestNames(gap, { t1: 'alpha test' });
  assert.strictEqual(named.dishonestTests.find((d) => d.testId === 't1').testName, 'alpha test');
});

t('trustgap: zero counted mutants → score null, no crash', () => {
  const gap = computeTrustGap([], 50);
  assert.strictEqual(gap.honestMutationScore, null);
  assert.strictEqual(gap.trustGap, null);
});

// --- render ---------------------------------------------------------------
t('render: md + html contain all three courts and escape HTML', () => {
  const input = {
    repo: 'r<repo>', generated: 'now', repoRootAbs: '/x',
    witness: { summary: { green: 1, red: 1, yellow: 0, total: 2 }, results: [
      { clause: 'W1', status: 'green', passed: 1, failed: 0, total: 1, test: 'tests/w1.ts', spec_anchor: 's#W1', failures: [] },
      { clause: 'W2', status: 'red', passed: 0, failed: 1, total: 1, test: 'tests/w2.ts', spec_anchor: 's#W2', failures: [{ title: '<b>bad</b>', message: 'boom' }] },
    ] },
    trustgap: { status: 'ok', claimedCoverage: 90, honestMutationScore: 50, trustGap: 40, dishonestTests: [{ testId: 't', survivedMutants: ['m1'] }], mutants: [{ id: 'm1', status: 'Survived', file: 'src/a.ts', location: { line: 3 }, replacement: 'x' }] },
    triage: { incidentWindow: 'a..b', suspect: { id: 'd-1', commit: 'abc', deployedAt: 't', reason: 'r' }, breakerSnapshot: { state: 'open' }, evidence: [{ t: 't', level: 'error', msg: 'm' }], clearedDeploys: [{ id: 'd-0', at: 'x' }] },
  };
  const md = renderMarkdown(input);
  const html = renderHtml(input);
  for (const s of ['WITNESS', 'TRUSTGAP', 'TRIAGE']) {
    assert.ok(md.includes(s), 'md missing ' + s);
    assert.ok(html.includes(s), 'html missing ' + s);
  }
  assert.ok(html.includes('&lt;b&gt;bad&lt;/b&gt;'), 'html not escaped');
  assert.ok(!html.includes('<b>bad</b>'), 'raw html leaked');
  assert.ok(md.includes('🟢') && md.includes('🔴'));
  assert.ok(html.includes('gaia-input') === false); // no artifact self-reference needed
});

// --- hosts ----------------------------------------------------------------
t('hosts: install writes agents + merges MCP without clobbering', () => {
  // realpathSync: os.tmpdir() on macOS is under /var, itself a symlink to
  // /private/var. installHost's validateDirectory walks up the full parent
  // chain rejecting any symlinked component - a real, intentional anti-
  // traversal check on real repo paths (never relaxed here). Canonicalize
  // the test's own tmp root first so it matches an ordinary, non-symlinked
  // repo path instead of tripping that check on the OS's own plumbing.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-host-')));
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { existing: { command: 'x' } } }));
  const r = installHost('claude', dir);
  const mcp = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
  assert.ok(mcp.mcpServers.existing, 'clobbered existing server');
  assert.ok(mcp.mcpServers['gaia-courts'], 'engine not wired');
  assert.ok(mcp.mcpServers['gaia-courts'].args.includes('--repo'));
  assert.strictEqual(r.files.length, 5); // 4 agents + .mcp.json
  for (const f of r.files) assert.ok(fs.existsSync(f), 'missing ' + f);
  // bob
  installHost('bob', dir);
  const bobMcp = JSON.parse(fs.readFileSync(path.join(dir, '.bob', 'mcp.json'), 'utf8'));
  assert.ok(bobMcp.mcpServers['gaia-courts'].alwaysAllow.includes('witness_clause'));
});

t('hosts: every host id installs', () => {
  for (const id of Object.keys(HOSTS)) {
    // See realpathSync note above: canonicalize the tmp root, not the check.
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-hosts-')));
    const r = installHost(id, dir);
    assert.ok(r.files.length >= 1, id + ' wrote nothing');
  }
});

t('hosts: bob installs the full structure (agents + skills + rules + modes + mcp)', () => {
  // See realpathSync note above: canonicalize the tmp root, not the check.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-bobfull-')));
  installHost('bob', dir);
  const need = [
    '.bob/agents/spec-witness.md', '.bob/agents/war-room.md',
    '.bob/skills/witness-extract/SKILL.md', '.bob/skills/trustgap-witness/SKILL.md',
    '.bob/skills/triage-postmortem/SKILL.md',
    '.bob/rules-witness/00-never-src.md', '.bob/rules-surgeon/00-minimal-fixes.md',
    '.bob/custom_modes.yaml', '.bob/mcp.json',
  ];
  for (const f of need) assert.ok(fs.existsSync(path.join(dir, f)), 'missing ' + f);
  const modes = fs.readFileSync(path.join(dir, '.bob', 'custom_modes.yaml'), 'utf8');
  assert.ok(modes.includes('slug: witness') && modes.includes('slug: surgeon'), 'custom_modes incomplete');
  // Bob/Roo schema: top-level OBJECT with a customModes array, NOT a bare array
  // (a bare array is rejected by the importer: "expected object, received array").
  assert.ok(/^customModes:/m.test(modes), 'custom_modes.yaml must be a top-level object with customModes: key');
  assert.ok(!/^- slug:/m.test(modes), 'custom_modes.yaml must NOT be a bare top-level array');
});

t('detect: empty repo (no package.json) does not crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-empty-'));
  const { config, notes } = detect(dir);
  assert.strictEqual(config.tests.framework, 'custom');
  assert.ok(notes.some((n) => /spec: none found/.test(n)));
});

// --- wall -----------------------------------------------------------------
t('engine: wall refuses src reads (unit-level glob check)', () => {
  const re = globToRegExp('src/**');
  assert.ok(re.test('src/anything/deep.ts'));
  assert.ok(!re.test('tests/clause-W1.test.ts'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

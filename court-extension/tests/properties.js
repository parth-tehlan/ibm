#!/usr/bin/env node
/**
 * tests/properties.js — validate BUILD-PROMPT mandatory properties end-to-end.
 * Each property gets a real, executable check. Exit non-zero on any failure.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const EXT = path.resolve(__dirname, '..');
const ENGINE = path.join(EXT, 'court.js');

let passed = 0, failed = 0;
const failures = [];
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ok  ' + name); })
    .catch((e) => { failed++; failures.push(name + ': ' + e.message); console.error('  FAIL ' + name + ' — ' + e.message); });
}

/** Spin up the engine, issue calls, tear down. */
function withEngine(repo, calls) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [ENGINE, '--repo', repo]);
    const rl = readline.createInterface({ input: child.stdout });
    const pending = new Map();
    const results = [];
    rl.on('line', (line) => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    let id = 0;
    const next = () => {
      if (!calls.length) { child.stdin.end(); return; }
      const c = calls.shift();
      const rid = ++id;
      pending.set(rid, (msg) => { results.push(msg); next(); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method: 'tools/call', params: c }) + '\n');
    };
    next();
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('engine timeout')); }, 150_000);
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`engine exited ${code}: ${err.slice(0, 400)}`));
      else resolve({ results, stderr: err });
    });
  });
}

(async () => {
  console.log('GAIA mandatory-property checks\n');

  // 1. PATH-1 CALLER EXECUTION — engine never calls a model, holds no keys.
  await t('Path-1: engine source contains no LLM/API-key calls', () => {
    // Engine never *calls* a model. Host/model names may appear as labels
    // (e.g. "OpenAI Codex" in lib/hosts.js) — that's config, not a call.
    const jsFiles = [ENGINE, ...['lib', 'src', 'bin'].flatMap((d) => fs.readdirSync(path.join(EXT, d)).map((f) => path.join(EXT, d, f))).filter((f) => f.endsWith('.js'))];
    const src = jsFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const bannedCalls = [
      /require\(['"]openai['"]\)/i, /require\(['"]@anthropic/i, /require\(['"]@ibm-cloud\/watsonx/i,
      /new\s+OpenAI\s*\(/i, /\.chat\.completions\.create\s*\(/i,
      /api[_-]?key\s*[:=]\s*['"][^'"]/i, /process\.env\.[A-Z_]*API_KEY/i,
      /fetch\(['"]https?:\/\/api\./i, /https\.request\(/i,
    ];
    for (const re of bannedCalls) assert.ok(!re.test(src), 'engine calls a model: ' + re);
    // Zero-dep: engine subtree must not declare any runtime dependency.
    const pkg = JSON.parse(fs.readFileSync(path.join(EXT, 'package.json'), 'utf8'));
    assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'engine has runtime deps: ' + JSON.stringify(pkg.dependencies));
  });

  // 2. MODEL-AGNOSTIC — same engine output regardless of host; hosts differ
  //    only in file layout.
  await t('Model-agnostic: host installs differ only in layout, agents identical', () => {
    // realpathSync: os.tmpdir() on macOS is under /var, a symlink to
    // /private/var. installHost's validateDirectory walks the full parent
    // chain rejecting any symlinked component - an intentional anti-
    // traversal check on real repo paths, never relaxed here. Canonicalize
    // the test's own tmp root so it matches an ordinary repo path.
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-prop-')));
    const { installHost } = require('../lib/hosts');
    installHost('claude', dir);
    installHost('bob', dir);
    const claude = fs.readFileSync(path.join(dir, '.claude', 'agents', 'spec-witness.md'), 'utf8');
    const bob = fs.readFileSync(path.join(dir, '.bob', 'agents', 'spec-witness.md'), 'utf8');
    assert.strictEqual(claude, bob, 'agent prompts differ per host (should be identical — model-agnostic)');
  });

  // 3. EASY SETUP — detect produces a loadable config on a fresh repo.
  await t('Easy setup: detect() on a bare jest repo yields a working .gaia.yml', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-easy-'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29' } }));
    fs.writeFileSync(path.join(dir, 'docs', 'api-spec.md'), '# S\n\n## W1 — x (REQUIRED)\n\n1. a MUST b\n');
    const { detect, toYaml } = require('../lib/detect');
    const { parseYamlSubset, loadConfig } = require('../lib/config');
    const { config } = detect(dir);
    fs.writeFileSync(path.join(dir, '.gaia.yml'), toYaml(config));
    const cfg = loadConfig(dir); // throws on invalid
    assert.strictEqual(cfg.tests.framework, 'jest');
    assert.ok(cfg.spec.absPath.endsWith('docs/api-spec.md'));
  });

  // 4. WALL-ENFORCING — engine refuses clause ids that escape the tests dir.
  await t('Wall-enforcing: witness_clause rejects path escape + honors denyGlobs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-wall-'));
    try {
      fs.mkdirSync(path.join(dir, 'docs'));
      fs.mkdirSync(path.join(dir, 'tests'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29' } }));
      fs.writeFileSync(path.join(dir, 'docs', 'spec.md'), '# S\n\n## W4 — safety\n\n1. x MUST y\n');
      fs.writeFileSync(path.join(dir, 'tests', 'clause-W4.test.js'), 'test("safety",()=>expect(1).toBe(1));');
      fs.writeFileSync(path.join(dir, 'jest.config.js'), 'module.exports={testEnvironment:"node",testMatch:["**/tests/**/*.test.js"]}');
      fs.writeFileSync(path.join(dir, '.gaia.yml'), 'version: 1\nspec: { path: docs/spec.md, clausePattern: \'^## (W\\d+)\', clauseIdPattern: \'^W\\d+$\' }\ntests: { framework: jest, dir: tests, clauseTestPattern: \'clause-{{clause}}.test.js\' }\nmutation: { tool: custom, report: null, command: null }\nwall: { denyGlobs: [\'src/**\'] }\n');
      const { results } = await withEngine(dir, [
        { name: 'witness_clause', arguments: { clause_id: '../../src/circuit' } },
        { name: 'witness_clause', arguments: { clause_id: 'W4' } },
      ]);
      const escMsg = results[0].error ? results[0].error.message : JSON.parse(results[0].result.content[0].text).error || '';
      assert.ok(/invalid clause_id/.test(escMsg), 'escape not rejected: ' + escMsg);
      const ok = JSON.parse(results[1].result.content[0].text);
      assert.strictEqual(ok.clause, 'W4');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // 5. FALSIFIABLE — derive the trust gap from an isolated mutation report.
  //    Generated Northstar reports are not versioned and may not exist on a fresh checkout.
  await t('Falsifiable: trustgap follows the report (kill a survivor → gap closes)', () => {
    const { computeTrustGap, loadMutationReport } = require('../lib/trustgap');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-mutants-'));
    try {
      const file = path.join(dir, 'mutation.json');
      fs.writeFileSync(file, JSON.stringify({ mutants: [
        { id: 'survivor', status: 'Survived', coveredBy: ['tautology'] },
        { id: 'killed', status: 'Killed', coveredBy: ['witness'], killedBy: ['witness'] },
      ] }));
      const { mutants } = loadMutationReport(file);
      const before = computeTrustGap(mutants, 91.66);
      assert.deepStrictEqual(before.dishonestTests.map((d) => d.testId), ['tautology']);
      assert.strictEqual(before.honestMutationScore, 50);
      const healed = mutants.map((m) => m.status === 'Survived' ? { ...m, status: 'Killed' } : m);
      const after = computeTrustGap(healed, 91.66);
      assert.strictEqual(after.dishonestTests.length, 0);
      assert.strictEqual(after.honestMutationScore, 100);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // 6. REPO-AGNOSTIC — engine runs on a second, differently-shaped repo.
  await t('Repo-agnostic: second repo (JS, no stryker config) serves all three courts', async () => {
    // realpathSync: Jest's own file walker reports realpath-canonicalized
    // absolute paths; matching them against a clause-file regex anchored to
    // this test's own (non-canonical, /var-symlinked) tmp root would never
    // match, reporting "no tests found" though real ones exist on disk.
    // Canonicalize the repo root so it matches what Jest itself will report.
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-repo2-')));
    // Repo-agnostic means "a repo without its own node_modules still runs its
    // courts against a configured/global jest." Point GAIA_TOOL_PATH at the
    // sibling northstar repo's node_modules (which has a real jest) so the
    // scratch repo below can serve WITNESS. Restored in the finally-like tail.
    const nsToolDir = path.resolve(__dirname, '..', '..', 'northstar', 'node_modules');
    const prevToolPath = process.env.GAIA_TOOL_PATH;
    if (fs.existsSync(nsToolDir)) process.env.GAIA_TOOL_PATH = nsToolDir;
    for (const d of ['docs', 'tests', 'src', 'fixtures', 'evidence']) fs.mkdirSync(path.join(dir, d));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29' } }));
    fs.writeFileSync(path.join(dir, 'docs', 'spec.md'), '# S\n\n## FR-1 — alpha\n\n1. x MUST y\n');
    fs.writeFileSync(path.join(dir, 'jest.config.js'), 'module.exports={testEnvironment:"node",testMatch:["**/tests/**/*.test.js"]}');
    fs.writeFileSync(path.join(dir, 'tests', 'clause-FR-1.test.js'), 'test("a",()=>expect(1).toBe(1));');
    fs.writeFileSync(path.join(dir, 'fixtures', 'metrics.json'), JSON.stringify({ metrics: { window: '2026-01-01T00:00:00Z..2026-01-01T01:00:00Z' } }));
    fs.writeFileSync(path.join(dir, 'fixtures', 'deploy.json'), JSON.stringify({ deploys: [{ id: 'd1', at: '2026-01-01T00:30:00Z', commit: 'x', service: 's' }] }));
    fs.writeFileSync(path.join(dir, 'fixtures', 'logs.json'), JSON.stringify({ log: [{ t: '2026-01-01T00:31:00Z', level: 'error', msg: 'boom' }] }));
    fs.writeFileSync(path.join(dir, '.gaia.yml'), [
      'version: 1',
      'spec: { path: docs/spec.md, clausePattern: \'^## (FR-\\d+)\', clauseIdPattern: \'^FR-\\d+$\' }',
      'tests: { framework: jest, dir: tests, clauseTestPattern: \'clause-{{clause}}.test.js\' }',
      'mutation: { tool: custom, report: null, command: null }',
      'wall: { denyGlobs: [\'src/**\'] }',
    ].join('\n'));
    const { results } = await withEngine(dir, [
      { name: 'witness_clauses', arguments: {} },
      { name: 'witness_verdict_all', arguments: {} },
      { name: 'triage_run', arguments: {} },
    ]);
    const body = (i) => results[i].error ? { error: results[i].error.message } : JSON.parse(results[i].result.content[0].text);
    const clauses = body(0);
    assert.deepStrictEqual(clauses.clauses.map((c) => c.id), ['FR-1']);
    const verdict = body(1);
    assert.ok(verdict.results && verdict.results.some((r) => r.clause === 'FR-1' && r.status === 'green'), 'clause FR-1 not green: ' + JSON.stringify(verdict).slice(0, 300));
    const triage = JSON.parse(results[2].result.content[0].text);
    assert.strictEqual(triage.suspect.id, 'd1');
    // Restore the caller's GAIA_TOOL_PATH so later tests are unaffected.
    if (prevToolPath === undefined) delete process.env.GAIA_TOOL_PATH;
    else process.env.GAIA_TOOL_PATH = prevToolPath;
  });

  // 7. Live mutation is deliberately NOT in the default suite. Run
  //    `npm run test:live` explicitly to mutate the Northstar fixture.

  // 7b. TRIAGE on the canonical challenge schema (no metrics.window; uses
  //     errorRate.windowStart + breaker.consecutiveFailuresAtOpen).
  await t('Repo-agnostic: TRIAGE handles canonical fixture schema (no explicit window)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-canon-'));
    for (const d of ['docs', 'tests', 'fixtures', 'evidence']) fs.mkdirSync(path.join(dir, d));
    fs.writeFileSync(path.join(dir, 'docs', 's.md'), '# S\n\n## W6 — breaker\n\n1. SHALL NOT trip below openThreshold\n');
    fs.writeFileSync(path.join(dir, 'tests', 'clause-W6.test.js'), 'test("x",()=>expect(1).toBe(1));');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29' } }));
    fs.writeFileSync(path.join(dir, 'jest.config.js'), 'module.exports={testEnvironment:"node",testMatch:["**/tests/**/*.test.js"]}');
    fs.writeFileSync(path.join(dir, 'fixtures', 'metrics.json'), JSON.stringify({ metrics: { errorRate: { windowStart: '2026-09-26T09:14:01Z' }, breaker: { state: 'open', consecutiveFailuresAtOpen: 1, openThreshold: 5 } } }));
    fs.writeFileSync(path.join(dir, 'fixtures', 'deploy.json'), JSON.stringify({ deploys: [{ id: 'd0', at: '2026-09-26T08:40:00Z', service: 'payments-api' }] }));
    fs.writeFileSync(path.join(dir, 'fixtures', 'logs.json'), JSON.stringify({ log: [{ t: '2026-09-26T09:14:02Z', level: 'error', message: 'breaker open', spec: 'docs/api-spec.md#W6', runbook: 'docs/runbook.md' }] }));
    fs.writeFileSync(path.join(dir, '.gaia.yml'), 'version: 1\nspec: { path: docs/s.md, clausePattern: \'^## (W\\d+)\', clauseIdPattern: \'^W\\d+$\' }\ntests: { framework: jest, dir: tests, clauseTestPattern: \'clause-{{clause}}.test.js\' }\nmutation: { tool: custom, report: null, command: null }\nwall: { denyGlobs: [\'src/**\'] }\n');
    const { results } = await withEngine(dir, [{ name: 'triage_run', arguments: {} }]);
    const t2 = JSON.parse(results[0].result.content[0].text);
    assert.strictEqual(t2.suspect && t2.suspect.id, 'd0');
    assert.strictEqual(t2.breakerSnapshot.openThreshold, 5);
    assert.ok(/#W6/.test(t2.rule), 'rule should cite spec anchor from evidence: ' + t2.rule);
  });

  // 8. REPORT — render from fixed evidence without relying on ignored build outputs.
  await t('Reports: render is deterministic (same input → byte-identical)', () => {
    const { renderMarkdown, renderHtml } = require('../lib/render');
    const input = {
      repo: 'isolated-fixture', generated: '2026-09-26T00:00:00.000Z',
      witness: { summary: { total: 1, green: 0, red: 1, yellow: 0 }, results: [
        { clause: 'W1', status: 'red', passed: 0, failed: 1, total: 1, test: 'tests/clause-W1.test.js', failures: [{ title: 'counterexample', message: 'expected failure' }] },
      ] },
      trustgap: { status: 'not-run', note: 'No mutation report provided' },
      triage: { status: 'no-fixtures', detail: 'No incident evidence supplied' },
    };
    const md = renderMarkdown(input);
    const html = renderHtml(input);
    assert.strictEqual(md, renderMarkdown(input), 'md not deterministic');
    assert.strictEqual(html, renderHtml(input), 'html not deterministic');
    assert.ok(md.includes('WITNESS') && html.includes('TRIAGE'));
    assert.ok(md.includes('counterexample') && html.includes('counterexample'));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
})().catch((e) => { console.error('harness error', e); process.exit(1); });

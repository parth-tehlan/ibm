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
const NORTHSTAR = path.resolve(EXT, '..', 'northstar');

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
    child.on('close', () => resolve({ results, stderr: err }));
    setTimeout(() => { child.kill('SIGKILL'); reject(new Error('engine timeout')); }, 150_000);
  });
}

/** Persistent engine session for multi-round interactions (async polling). */
function engineSession(repo) {
  const child = spawn('node', [ENGINE, '--repo', repo]);
  const rl = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  rl.on('line', (line) => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  let id = 0;
  const call = (name, args) => new Promise((resolve, reject) => {
    const rid = ++id;
    pending.set(rid, (msg) => {
      if (msg.error) return reject(new Error(msg.error.message));
      try { resolve(JSON.parse(msg.result.content[0].text)); } catch (e) { reject(e); }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method: 'tools/call', params: { name, arguments: args || {} } }) + '\n');
  });
  return { call, close: () => child.stdin.end(), kill: () => child.kill('SIGKILL') };
}

(async () => {
  console.log('TRIUMPH mandatory-property checks\n');

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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-prop-'));
    const { installHost } = require('../lib/hosts');
    installHost('claude', dir);
    installHost('bob', dir);
    const claude = fs.readFileSync(path.join(dir, '.claude', 'agents', 'spec-witness.md'), 'utf8');
    const bob = fs.readFileSync(path.join(dir, '.bob', 'agents', 'spec-witness.md'), 'utf8');
    assert.strictEqual(claude, bob, 'agent prompts differ per host (should be identical — model-agnostic)');
  });

  // 3. EASY SETUP — detect produces a loadable config on a fresh repo.
  await t('Easy setup: detect() on a bare jest repo yields a working .triumph.yml', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-easy-'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29' } }));
    fs.writeFileSync(path.join(dir, 'docs', 'api-spec.md'), '# S\n\n## W1 — x (REQUIRED)\n\n1. a MUST b\n');
    const { detect, toYaml } = require('../lib/detect');
    const { parseYamlSubset, loadConfig } = require('../lib/config');
    const { config } = detect(dir);
    fs.writeFileSync(path.join(dir, '.triumph.yml'), toYaml(config));
    const cfg = loadConfig(dir); // throws on invalid
    assert.strictEqual(cfg.tests.framework, 'jest');
    assert.ok(cfg.spec.absPath.endsWith('docs/api-spec.md'));
  });

  // 4. WALL-ENFORCING — engine refuses clause ids that escape the tests dir.
  await t('Wall-enforcing: redline_clause rejects path escape + honors denyGlobs', async () => {
    const { results } = await withEngine(NORTHSTAR, [
      { name: 'redline_clause', arguments: { clause_id: '../../src/circuit' } },
      { name: 'redline_clause', arguments: { clause_id: 'W4' } },
    ]);
    const escMsg = results[0].error ? results[0].error.message : JSON.parse(results[0].result.content[0].text).error || '';
    assert.ok(/invalid clause_id/.test(escMsg), 'escape not rejected: ' + escMsg);
    const ok = JSON.parse(results[1].result.content[0].text);
    assert.strictEqual(ok.clause, 'W4');
  });

  // 5. FALSIFIABLE — trust gap is derived from the report, dishonest tests
  //    named; a doctored report changes the verdict.
  await t('Falsifiable: trustgap follows the report (kill a survivor → gap closes)', () => {
    const { computeTrustGap, loadMutationReport } = require('../lib/trustgap');
    const { mutants } = loadMutationReport(path.join(NORTHSTAR, 'reports', 'mutation', 'mutation.json'));
    const before = computeTrustGap(mutants, 91.66);
    assert.ok(before.dishonestTests.length > 0, 'expected dishonest tests in real report');
    // Flip survivors to killed — the gap must close.
    const healed = mutants.map((m) => m.status === 'Survived' ? { ...m, status: 'Killed' } : m);
    const after = computeTrustGap(healed, 91.66);
    assert.strictEqual(after.dishonestTests.length, 0);
    assert.ok(after.honestMutationScore > before.honestMutationScore, 'score did not rise after healing survivors');
  });

  // 6. REPO-AGNOSTIC — engine runs on a second, differently-shaped repo.
  await t('Repo-agnostic: second repo (JS, no stryker config) serves all three courts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-repo2-'));
    for (const d of ['docs', 'tests', 'src', 'fixtures', 'evidence']) fs.mkdirSync(path.join(dir, d));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29' } }));
    fs.writeFileSync(path.join(dir, 'docs', 'spec.md'), '# S\n\n## FR-1 — alpha\n\n1. x MUST y\n');
    fs.writeFileSync(path.join(dir, 'jest.config.js'), 'module.exports={testEnvironment:"node",testMatch:["**/tests/**/*.test.js"]}');
    fs.writeFileSync(path.join(dir, 'tests', 'clause-FR-1.test.js'), 'test("a",()=>expect(1).toBe(1));');
    fs.writeFileSync(path.join(dir, 'fixtures', 'metrics.json'), JSON.stringify({ metrics: { window: '2026-01-01T00:00:00Z..2026-01-01T01:00:00Z' } }));
    fs.writeFileSync(path.join(dir, 'fixtures', 'deploy.json'), JSON.stringify({ deploys: [{ id: 'd1', at: '2026-01-01T00:30:00Z', commit: 'x', service: 's' }] }));
    fs.writeFileSync(path.join(dir, 'fixtures', 'logs.json'), JSON.stringify({ log: [{ t: '2026-01-01T00:31:00Z', level: 'error', msg: 'boom' }] }));
    fs.writeFileSync(path.join(dir, '.triumph.yml'), [
      'version: 1',
      'spec: { path: docs/spec.md, clausePattern: \'^## (FR-\\d+)\', clauseIdPattern: \'^FR-\\d+$\' }',
      'tests: { framework: jest, dir: tests, clauseTestPattern: \'clause-{{clause}}.test.js\' }',
      'mutation: { tool: custom, report: null, command: null }',
      'wall: { denyGlobs: [\'src/**\'] }',
    ].join('\n'));
    const { results } = await withEngine(dir, [
      { name: 'redline_clauses', arguments: {} },
      { name: 'redline_verdict_all', arguments: {} },
      { name: 'warpath_triage', arguments: {} },
    ]);
    const body = (i) => results[i].error ? { error: results[i].error.message } : JSON.parse(results[i].result.content[0].text);
    const clauses = body(0);
    assert.deepStrictEqual(clauses.clauses.map((c) => c.id), ['FR-1']);
    const verdict = body(1);
    assert.ok(verdict.results && verdict.results.some((r) => r.clause === 'FR-1' && r.status === 'green'), 'clause FR-1 not green: ' + JSON.stringify(verdict).slice(0, 300));
    const triage = JSON.parse(results[2].result.content[0].text);
    assert.strictEqual(triage.suspect.id, 'd1');
  });

  // 7. INCREMENTAL FOR CHAT — splitbrain_mutate returns immediately, status
  //    polls, and a completed job (with claimed_coverage) carries the gap.
  await t('Incremental: splitbrain_mutate non-blocking; completed job carries trust gap', async () => {
    const sess = engineSession(NORTHSTAR);
    try {
      const t0 = Date.now();
      const start = await sess.call('splitbrain_mutate', { claimed_coverage: 91.66 });
      const elapsed = Date.now() - t0;
      assert.ok(start.status === 'started', 'expected started, got ' + start.status);
      assert.ok(start.job_id, 'no job_id');
      assert.ok(elapsed < 5000, 'mutate blocked for ' + elapsed + 'ms');
      // Poll on the SAME session (jobs are in-memory per process).
      let st, tries = 0;
      do {
        await new Promise((r) => setTimeout(r, 1500));
        st = await sess.call('splitbrain_status', { job_id: start.job_id });
        tries++;
      } while (st.status === 'running' && tries < 90);
      assert.strictEqual(st.status, 'done', 'job did not finish: ' + JSON.stringify(st).slice(0, 200));
      assert.ok(st.result && typeof st.result.trustGap === 'number', 'completed job missing trustGap: ' + JSON.stringify(st.result).slice(0, 200));
      assert.ok(st.result.trustGap > 0, 'expected a positive trust gap on northstar (planted tautology), got ' + st.result.trustGap);
    } finally {
      sess.kill();
    }
  });

  // 7b. WARPATH on the canonical challenge schema (no metrics.window; uses
  //     errorRate.windowStart + breaker.consecutiveFailuresAtOpen).
  await t('Repo-agnostic: WARPATH handles canonical fixture schema (no explicit window)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triumph-canon-'));
    for (const d of ['docs', 'tests', 'fixtures', 'evidence']) fs.mkdirSync(path.join(dir, d));
    fs.writeFileSync(path.join(dir, 'docs', 's.md'), '# S\n\n## W6 — breaker\n\n1. SHALL NOT trip below openThreshold\n');
    fs.writeFileSync(path.join(dir, 'tests', 'clause-W6.test.js'), 'test("x",()=>expect(1).toBe(1));');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29' } }));
    fs.writeFileSync(path.join(dir, 'jest.config.js'), 'module.exports={testEnvironment:"node",testMatch:["**/tests/**/*.test.js"]}');
    fs.writeFileSync(path.join(dir, 'fixtures', 'metrics.json'), JSON.stringify({ metrics: { errorRate: { windowStart: '2026-09-26T09:14:01Z' }, breaker: { state: 'open', consecutiveFailuresAtOpen: 1, openThreshold: 5 } } }));
    fs.writeFileSync(path.join(dir, 'fixtures', 'deploy.json'), JSON.stringify({ deploys: [{ id: 'd0', at: '2026-09-26T08:40:00Z', service: 'payments-api' }] }));
    fs.writeFileSync(path.join(dir, 'fixtures', 'logs.json'), JSON.stringify({ log: [{ t: '2026-09-26T09:14:02Z', level: 'error', message: 'breaker open', spec: 'docs/api-spec.md#W6', runbook: 'docs/runbook.md' }] }));
    fs.writeFileSync(path.join(dir, '.triumph.yml'), 'version: 1\nspec: { path: docs/s.md, clausePattern: \'^## (W\\d+)\', clauseIdPattern: \'^W\\d+$\' }\ntests: { framework: jest, dir: tests, clauseTestPattern: \'clause-{{clause}}.test.js\' }\nmutation: { tool: custom, report: null, command: null }\nwall: { denyGlobs: [\'src/**\'] }\n');
    const { results } = await withEngine(dir, [{ name: 'warpath_triage', arguments: {} }]);
    const t2 = JSON.parse(results[0].result.content[0].text);
    assert.strictEqual(t2.suspect && t2.suspect.id, 'd0');
    assert.strictEqual(t2.breakerSnapshot.openThreshold, 5);
    assert.ok(/#W6/.test(t2.rule), 'rule should cite spec anchor from evidence: ' + t2.rule);
  });

  // 8. REPORT — both artifacts render deterministically from engine JSON.
  await t('Reports: render is deterministic (same input → byte-identical)', () => {
    const { renderMarkdown, renderHtml } = require('../lib/render');
    const input = JSON.parse(fs.readFileSync(path.join(NORTHSTAR, 'reports', 'triumph', 'triumph-input.json'), 'utf8'));
    assert.strictEqual(renderMarkdown(input), renderMarkdown(input), 'md not deterministic');
    assert.strictEqual(renderHtml(input), renderHtml(input), 'html not deterministic');
    assert.ok(renderMarkdown(input).includes('REDLINE') && renderHtml(input).includes('WARPATH'));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
})().catch((e) => { console.error('harness error', e); process.exit(1); });

#!/usr/bin/env node
/**
 * lib/detect.js — TRIUMPH repo auto-detector.
 *
 * Inspects an open workspace and fills a `.triumph.yml` draft:
 *   - test framework (jest / vitest / mocha / pytest / custom)
 *   - mutation tool (stryker / mutmut / custom) + report paths + command
 *   - spec path + clause-ID pattern (inferred from markdown headings)
 *   - fixtures + evidence dirs
 *   - wall deny globs (src/**, lib/**, app/** when present)
 *
 * Zero deps; best-effort with confidence notes for every guess.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}
function readJsonSafe(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}
function* walk(root, maxDepth, depth = 0) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.') && e.name !== '.github') continue;
    const fp = path.join(root, e.name);
    if (e.isDirectory()) { yield { dir: fp, depth }; yield* walk(fp, maxDepth, depth + 1); }
  }
}

/** Candidate spec docs, in priority order. */
const SPEC_CANDIDATES = [
  'docs/api-spec.md', 'docs/SPEC.md', 'docs/spec.md', 'SPEC.md', 'spec.md',
  'docs/requirements.md', 'REQUIREMENTS.md', 'docs/contract.md',
];

function detectClausePattern(specAbs) {
  // Scan markdown headings, infer a clause-ID prefix. Returns {pattern, idPattern, sample}
  let text;
  try { text = fs.readFileSync(specAbs, 'utf8'); } catch { return null; }
  const headings = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^##\s+([A-Z]+-?\d+)/.exec(line.trim());
    if (m) headings.push(m[1]);
  }
  if (headings.length === 0) return null;
  // Find common prefix shape, e.g. W1..W8 → W(\d+), FR-1.. → FR-(\d+)
  const first = headings[0];
  const shape = /^([A-Z]+-?)(\d+)$/.exec(first);
  if (!shape) return null;
  const prefix = shape[1];
  const consistent = headings.filter((h) => h.startsWith(prefix)).length >= Math.max(2, headings.length / 2);
  if (!consistent) return null;
  return {
    clausePattern: `^## (${prefix.replace('-', '\\-')}\\d+)`,
    clauseIdPattern: `^${prefix.replace('-', '\\-')}\\d+$`,
    sample: headings.slice(0, 10),
  };
}

function detectTestFramework(root, pkg) {
  const dev = { ...(pkg && pkg.devDependencies), ...(pkg && pkg.dependencies) };
  const scripts = pkg && pkg.scripts ? JSON.stringify(pkg.scripts) : '';
  if (dev.jest || scripts.includes('jest')) {
    return { framework: 'jest', confidence: 'high' };
  }
  if (dev.vitest) return { framework: 'vitest', confidence: 'high' };
  if (dev.mocha) return { framework: 'mocha', confidence: 'medium' };
  if (exists(root, 'pytest.ini') || exists(root, 'pyproject.toml') || exists(root, 'setup.cfg')) {
    return { framework: 'pytest', confidence: 'medium' };
  }
  return { framework: 'custom', confidence: 'low', note: 'no known test framework detected — set tests.runAll/runClause' };
}

function detectTestDir(root, framework) {
  const cands = framework === 'pytest' ? ['tests', 'test'] : ['tests', 'test', '__tests__', 'spec'];
  for (const c of cands) if (exists(root, c)) return c;
  return 'tests';
}

/** Sample the tests dir for file extensions, e.g. ['ts','js']. */
function testExtensions(root, dir) {
  const found = new Set();
  try {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      const m = /\.(ts|tsx|js|jsx|mjs|py)$/.exec(f);
      if (m) found.add(m[1]);
    }
  } catch { /* empty dir */ }
  return found;
}

/** Pick the clause test filename template from what the repo actually uses. */
function clauseTestPatternFor(root, dir, framework) {
  const exts = testExtensions(root, dir);
  const ext = exts.has('ts') ? 'ts' : exts.has('js') ? 'js' : exts.has('py') ? 'py' : (framework === 'pytest' ? 'py' : 'ts');
  if (framework === 'pytest') return 'test_clause_{{clause}}.py';
  return `clause-{{clause}}.test.${ext}`;
}

function detectMutation(root, pkg) {
  const dev = { ...(pkg && pkg.devDependencies), ...(pkg && pkg.dependencies) };
  const hasStryker = dev && Object.keys(dev).some((k) => k.startsWith('@stryker-mutator/'));
  const strykerConf = ['stryker.conf.json', 'stryker.config.json', 'stryker.conf.js', 'stryker.config.mjs']
    .find((f) => exists(root, f));
  if (hasStryker || strykerConf) {
    let report = 'reports/mutation/mutation.json';
    let command = 'npm run mutation';
    if (strykerConf && strykerConf.endsWith('.json')) {
      const conf = readJsonSafe(path.join(root, strykerConf));
      if (conf && conf.jsonReporter && conf.jsonReporter.fileName) report = conf.jsonReporter.fileName;
    }
    if (pkg && pkg.scripts && pkg.scripts.mutation) command = 'npm run mutation';
    else if (hasStryker) command = 'npx stryker run';
    return { tool: 'stryker', report, command, confidence: strykerConf ? 'high' : 'medium' };
  }
  if (exists(root, 'mutmut') || exists(root, 'setup.cfg')) {
    const cfg = exists(root, 'setup.cfg') ? fs.readFileSync(path.join(root, 'setup.cfg'), 'utf8') : '';
    if (cfg.includes('[mutmut]')) {
      return { tool: 'mutmut', report: null, command: 'mutmut run && mutmut junitxml > reports/mutation/mutation.xml', confidence: 'medium' };
    }
  }
  return { tool: 'custom', report: null, command: null, confidence: 'low', note: 'no mutation tool detected — set mutation.report to a precomputed JSON, or mutation.command' };
}

function detectClaimedCoverage(root) {
  const cands = ['coverage/coverage-summary.json', 'coverage/coverage-final.json'];
  for (const c of cands) if (exists(root, c)) return c;
  return null;
}

function detectWall(root) {
  const globs = [];
  for (const d of ['src', 'lib', 'app', 'pkg']) {
    if (exists(root, d)) globs.push(d + '/**');
  }
  if (globs.length === 0) globs.push('src/**');
  return globs;
}

/**
 * Run detection against a workspace root.
 * Returns { config: <triumph config draft>, notes: [human-readable explanations] }.
 */
function detect(repoRoot) {
  const root = path.resolve(repoRoot);
  const notes = [];
  const pkg = exists(root, 'package.json') ? readJsonSafe(path.join(root, 'package.json')) : null;

  // spec
  let specPath = SPEC_CANDIDATES.find((c) => exists(root, c)) || null;
  if (!specPath) {
    // last resort: first markdown under docs/
    try {
      const docs = fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md'));
      if (docs.length) specPath = 'docs/' + docs.sort()[0];
    } catch { /* no docs dir */ }
  }
  let clause = { clausePattern: '^(W\\d+)', clauseIdPattern: '^W\\d+$', note: 'fallback — no clause headings found' };
  if (specPath) {
    const inferred = detectClausePattern(path.join(root, specPath));
    if (inferred) clause = { ...inferred, note: null };
    notes.push(specPath
      ? `spec: using ${specPath}${inferred ? ` (clauses like ${inferred.sample.slice(0, 3).join(', ')})` : ' (no clause headings found — edit clausePattern)'}`
      : 'spec: none found — set spec.path manually');
  } else {
    notes.push('spec: none found — set spec.path manually');
  }

  const tf = detectTestFramework(root, pkg);
  const testDir = detectTestDir(root, tf.framework);
  notes.push(`tests: ${tf.framework} in ${testDir}/ (${tf.confidence} confidence)`);

  const mut = detectMutation(root, pkg);
  notes.push(`mutation: ${mut.tool}${mut.command ? ` via \`${mut.command}\`` : ''} (${mut.confidence} confidence)`);

  const claimed = detectClaimedCoverage(root);
  if (claimed) notes.push(`claimed coverage: ${claimed}`);

  const config = {
    version: 1,
    repo: { name: (pkg && pkg.name) || path.basename(root) },
    spec: {
      path: specPath || 'docs/api-spec.md',
      clausePattern: clause.clausePattern,
      clauseIdPattern: clause.clauseIdPattern,
    },
    tests: {
      framework: tf.framework,
      dir: testDir,
      clauseTestPattern: clauseTestPatternFor(root, testDir, tf.framework),
    },
    mutation: {
      tool: mut.tool,
      report: mut.report,
      claimedCoverageFrom: claimed,
      command: mut.command,
      timeoutSeconds: 900,
    },
    fixtures: {
      deploys: 'fixtures/deploy.json',
      metrics: 'fixtures/metrics.json',
      logs: 'fixtures/logs.json',
      mutants: 'fixtures/mutants.json',
    },
    evidence: { dir: 'evidence', trustgap: 'trustgap/TrustGap.json', incidentDir: 'incident', reportsDir: 'reports/triumph' },
    wall: { denyGlobs: detectWall(root) },
    waivers: 'evidence/waivers.json',
  };
  return { config, notes };
}

/** Serialize a config object to the YAML subset our loader accepts. */
function toYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) { lines.push(`${pad}${k}: null`); continue; }
    if (Array.isArray(v)) {
      if (v.length === 0) { lines.push(`${pad}${k}: []`); continue; }
      lines.push(`${pad}${k}:`);
      for (const item of v) {
        if (typeof item === 'object' && item !== null) {
          const keys = Object.entries(item);
          lines.push(`${pad}  - ${keys[0][0]}: ${scalarYaml(keys[0][1])}`);
          for (const [ik, iv] of keys.slice(1)) lines.push(`${pad}    ${ik}: ${scalarYaml(iv)}`);
        } else {
          lines.push(`${pad}  - ${scalarYaml(item)}`);
        }
      }
    } else if (typeof v === 'object') {
      lines.push(`${pad}${k}:`);
      lines.push(toYaml(v, indent + 1));
    } else {
      lines.push(`${pad}${k}: ${scalarYaml(v)}`);
    }
  }
  return lines.filter((l) => l !== '').join('\n');
}

function scalarYaml(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (/[:#\[\]{}'",&*!|>%@`]/.test(s) || s !== s.trim() || s === '') return JSON.stringify(s);
  return s;
}

module.exports = { detect, toYaml, detectClausePattern };

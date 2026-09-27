#!/usr/bin/env node
/**
 * lib/verify.js — in-loop adversarial verification executor.
 *
 * Executes the micro-mutants planned by lib/micro.js against the repo's own
 * jest, using a tmp-mirror + jest.mock redirect so the repo's src/ is never
 * written. One mutant at a time; the suite's behavior on the mutant decides
 * killed vs survived.
 *
 * Execution model (zero-config, works with the repo's own jest.config):
 *
 *   .gaia/tmp/verify-<ts>/
 *     mirror/src/x.js          stripTypes(src/x.ts) with ONE mutant applied
 *     wrappers/<test>.test.js  jest.mock('<abs repo src>', () => require(mirror))
 *                              + require('<abs original test>')
 *
 *   jest --config <tmp>/jest.gaia.json <wrappers...>
 *     - rootDir stays the REPO (module resolution, ts-jest, harness intact)
 *     - testMatch pointed at the tmp wrappers only
 *     - setupFiles inherits the repo config (bind-seams installs globals
 *       from the MOCKED module -> the mutant is what gets bound)
 *
 * Safety invariants:
 *   - repo src/ is never modified (mirror-only mutation)
 *   - the wall (assertNotWalled) applies to WITNESS only; TRUSTGAP reads
 *     src/ by design — it is the honesty court, not the witness
 *   - every artifact lands under .gaia/tmp/ (gitignored, TTL-swept)
 *   - a run that errors mid-way never leaves the repo dirty
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const runners = require('./runners');

const TMP_DIR_NAME = path.join('.gaia', 'tmp');
const TMP_TTL_MS = 60 * 60_000; // sweep verify dirs older than 1h

// ---------------------------------------------------------------------------
// Mirror language strategy: the mirror keeps the SOURCE's own extension
// (.ts stays .ts) so the repo's own transform (ts-jest, babel, etc.) compiles
// the mutant with exactly the semantics the real suite runs under. No
// in-engine transpile, no strip-types dependency — zero-dep, zero semantics
// drift. (An earlier draft stripped types in-engine via Node's Amaro; that
// tied correctness to the engine's Node version instead of the repo's own
// toolchain, so it was removed.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tmp workspace management
// ---------------------------------------------------------------------------
function tmpRoot(cfg) {
  return path.join(cfg.repoRoot, TMP_DIR_NAME);
}

function sweepTmp(cfg) {
  const root = tmpRoot(cfg);
  if (!fs.existsSync(root)) return;
  const now = Date.now();
  for (const e of fs.readdirSync(root)) {
    if (!e.startsWith('verify-')) continue;
    const fp = path.join(root, e);
    try {
      const st = fs.statSync(fp);
      if (now - st.mtimeMs > TMP_TTL_MS) fs.rmSync(fp, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}

function freshVerifyDir(cfg) {
  sweepTmp(cfg);
  const dir = path.join(tmpRoot(cfg), 'verify-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  fs.mkdirSync(path.join(dir, 'mirror'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'wrappers'), { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Mutant application
// ---------------------------------------------------------------------------
/**
 * Apply one planned mutant to source text. Whole-line swap; refuses (null)
 * when the current line does not exactly match the plan's lineBefore — that
 * is the stale-plan guard that keeps a mutated byte stream honest.
 */
function applyMutant(srcText, mutant) {
  const lines = srcText.split('\n');
  const idx = mutant.line - 1;
  if (idx < 0 || idx >= lines.length) return null;
  if (lines[idx] !== mutant.lineBefore) return null;
  lines[idx] = mutant.lineAfter;
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Wrapper + jest config generation
// ---------------------------------------------------------------------------
/**
 * The mock must be registered BEFORE the repo's own setupFiles run — the
 * harness (bind-seams.cjs) requires the src module at setup time and binds
 * its exports onto globalThis. jest.mock() inside the wrapper module would
 * register too late (setup files run first). So the mock registration is
 * itself a setup file, prepended ahead of the repo's setupFiles. Each mutant
 * run writes its own mock-setup file naming the mirror for THAT mutant.
 */
function mockSetupSource(absRepoSrc, absMirrorFile) {
  return `'use strict';
// Gaia generated — registers the mutant mirror in place of the repo src.
jest.mock(${JSON.stringify(absRepoSrc)}, () => require(${JSON.stringify(absMirrorFile)}));
`;
}

function wrapperSource(absTestFile) {
  return `'use strict';
require(${JSON.stringify(absTestFile)});
`;
}

function jestConfigSource(cfg, verifyDir, mockSetupAbs) {
  // Inherit the repo's own jest.config.js wholesale; override ONLY test
  // discovery (testMatch -> wrappers) and prepend our mock setup file ahead
  // of the repo's setupFiles so the harness binds the MUTANT's exports.
  // rootDir stays the repo: every relative path in the repo config (transform,
  // tsconfig, the repo's own setupFiles entries) keeps resolving.
  const repoConfig = path.join(cfg.repoRoot, 'jest.config.js');
  const wrappersGlob = path.join(verifyDir, 'wrappers', '**', '*.test.js').split(path.sep).join('/');
  return `'use strict';
const base = require(${JSON.stringify(repoConfig)});
const priorSetup = base.setupFiles || [];
module.exports = {
  ...base,
  rootDir: ${JSON.stringify(cfg.repoRoot)},
  setupFiles: [${JSON.stringify(mockSetupAbs)}, ...priorSetup],
  testMatch: [${JSON.stringify(wrappersGlob)}],
  testPathIgnorePatterns: [],
};
`;
}

// ---------------------------------------------------------------------------
// Verdict extraction
// ---------------------------------------------------------------------------
function extractFailingTitles(suites) {
  const out = [];
  for (const s of suites || []) {
    for (const a of s.assertions || []) {
      if (a.status === 'failed') out.push(a.title);
    }
  }
  return out;
}

function extractPassingTitles(suites) {
  const out = [];
  for (const s of suites || []) {
    for (const a of s.assertions || []) {
      if (a.status === 'passed') out.push(a.title);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Verify a set of planned mutants for ONE source file against impacted tests.
 *
 * @param cfg        resolved .gaia.yml config
 * @param srcAbs     absolute path to the current source file
 * @param srcRel     repo-relative source path
 * @param mutants    planned mutants from lib/micro.planFileMutants
 * @param testsAbs   impacted test files (absolute)
 * @returns { results: [...], durationMs, error? }
 */
async function executeMutants(cfg, srcAbs, srcRel, mutants, testsAbs) {
  const started = Date.now();
  const verifyDir = freshVerifyDir(cfg);
  const results = [];

  const srcText = fs.readFileSync(srcAbs, 'utf8');

  for (const mutant of mutants) {
    const mutatedText = applyMutant(srcText, mutant);
    if (mutatedText === null) {
      results.push({ ...mutant, status: 'error', detail: 'stale plan: current line does not match lineBefore' });
      continue;
    }

    // Mirror keeps the source's extension so the repo's transform compiles
    // the mutant identically to the real module. jest.mock redirects the
    // ABSOLUTE repo path to the mirror — resolution goes through the repo's
    // own resolver/transform, so .ts mirrors get ts-jest exactly like src/.
    const mirrorAbs = path.join(verifyDir, 'mirror', srcRel);
    fs.mkdirSync(path.dirname(mirrorAbs), { recursive: true });
    fs.writeFileSync(mirrorAbs, mutatedText, 'utf8');

    const mockSetupAbs = path.join(verifyDir, 'mock-setup.js');
    fs.writeFileSync(mockSetupAbs, mockSetupSource(srcAbs, mirrorAbs), 'utf8');

    const cfgPath = path.join(verifyDir, 'jest.gaia.config.js');
    fs.writeFileSync(cfgPath, jestConfigSource(cfg, verifyDir, mockSetupAbs), 'utf8');

    const wrapperFiles = [];
    for (const t of testsAbs) {
      const wName = path.basename(t).replace(/\.[^.]+$/, '') + '.test.js';
      const wAbs = path.join(verifyDir, 'wrappers', wName);
      fs.writeFileSync(wAbs, wrapperSource(t), 'utf8');
      wrapperFiles.push(wAbs);
    }

    // Run jest against the wrappers (via the repo's resolved jest CLI —
    // no npx/shell, so argv reaches jest intact on every platform).
    const relWrappers = wrapperFiles.map((w) => path.relative(cfg.repoRoot, w).split(path.sep).join('/'));
    const run = await runners.runJestCli(cfg.repoRoot, ['--json', '--config', cfgPath, ...relWrappers], {
      cwd: cfg.repoRoot,
      timeoutMs: 120_000,
    });
    const parsed = runners.extractJson(run.stdout);

    if (!parsed) {
      results.push({
        ...mutant, status: 'error',
        detail: 'jest produced no JSON (' + (run.error || 'exit ' + run.code) + ')',
        stderr: (run.stderr || '').split('\n').slice(-8),
      });
      continue;
    }
    const suites = (parsed.testResults || []).map((tr) => ({
      file: tr.name,
      assertions: (tr.assertionResults || []).map((a) => ({
        title: a.title, status: a.status, failureMessages: a.failureMessages || [],
      })),
    }));
    const failedTitles = extractFailingTitles(suites);
    const passedTitles = extractPassingTitles(suites);
    const runtimeErrors = parsed.numRuntimeErrorTestSuites || 0;

    if (failedTitles.length > 0) {
      results.push({ ...mutant, status: 'killed', killedBy: failedTitles });
    } else if (runtimeErrors > 0 || suites.length === 0) {
      // A mutant that crashes the suite is KILLED (the change was caught),
      // but a wrapper that could not even load is an execution error. The
      // difference: suites.length > 0 with runtime error = the mutant broke
      // module load => killed; suites.length === 0 = wrapper/config broken.
      if (suites.length > 0) {
        results.push({ ...mutant, status: 'killed', killedBy: ['(suite runtime error — mutant broke module load)'] });
      } else {
        results.push({
          ...mutant, status: 'error',
          detail: 'no test suites executed (wrapper/config failure)',
          stderr: (run.stderr || '').split('\n').slice(-8),
        });
      }
    } else {
      results.push({ ...mutant, status: 'survived', coveredBy: passedTitles });
    }
  }

  return { results, durationMs: Date.now() - started, verifyDir: path.relative(cfg.repoRoot, verifyDir) };
}

module.exports = { executeMutants, applyMutant, TMP_DIR_NAME };

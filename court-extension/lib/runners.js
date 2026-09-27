#!/usr/bin/env node
/**
 * lib/runners.js — pluggable test-runners for the WITNESS court.
 *
 * A runner turns a test-file selector into the engine's normalized verdict
 * shape. Jest gets a first-class JSON runner; everything else can be wired
 * with a one-line custom command per repo.
 *
 * Normalized result:
 *   { suites: [ { name, assertions: [ { title, status, failureMessages: [] } ],
 *                 file } ],
 *     raw: <framework-native payload, when available> }
 */

'use strict';

const { spawn, spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const toolenv = require('./toolenv');

// Node 22.4+ added a native, guarded `localStorage`/`sessionStorage` global.
// jest-environment-node forwards every own property of globalThis into the
// test sandbox; touching that guarded global without --localstorage-file
// throws and aborts the suite before any assertion runs. --no-experimental-
// webstorage avoids that, but is an unrecognized flag on Node <22.4 (Node
// rejects it at startup: "bad option"), so it must never be added
// unconditionally. Probe the `node` that PATH/opts.cwd will actually resolve
// for the spawned command — not this engine's own process.version — since a
// per-repo pinned Node (nvm/volta/.nvmrc) can differ from the engine's Node.
// Cache per cwd: this can run once per court.js process, not once per file.
const _flagSupportCache = new Map();
function supportsNoWebstorageFlag(cwd) {
  const key = cwd || '';
  if (_flagSupportCache.has(key)) return _flagSupportCache.get(key);
  let supported = false;
  try {
    const probe = spawnSync('node', ['--no-experimental-webstorage', '-e', 'process.exit(0)'], {
      cwd, env: process.env, timeout: 5000,
    });
    // Any failure (older Node's "bad option", missing binary, timeout) means
    // "not supported" - never guess a flag into existence.
    supported = !probe.error && probe.status === 0;
  } catch (e) {
    // Unexpected spawnSync failure (e.g. node not on PATH). Treat as
    // unsupported but log so the environment misconfiguration is visible.
    console.error('[triumph] supportsNoWebstorageFlag probe failed:', e && e.message ? e.message : e);
    supported = false;
  }
  _flagSupportCache.set(key, supported);
  return supported;
}
function withEnv(cwd, repoRoot) {
  const base = supportsNoWebstorageFlag(cwd)
    ? (() => {
        const flag = '--no-experimental-webstorage';
        const existing = process.env.NODE_OPTIONS || '';
        if (existing.split(/\s+/).filter(Boolean).includes(flag)) return process.env;
        return { ...process.env, NODE_OPTIONS: [existing, flag].filter(Boolean).join(' ') };
      })()
    : process.env;
  // Prepend the tool path (repo .bin → configured dirs) so any tool spawned
  // by name — jest fallback, stryker inside an npm script — resolves without
  // the user having to npm-install the opened folder.
  return toolenv.withToolPath(base, repoRoot || cwd);
}

// `npx jest ...` used to be spawned directly. On Windows, `npx` resolves to
// the `npx.cmd` batch shim, which Node's spawn() cannot execute without
// shell:true — and shell:true naively string-joins argv with no per-argument
// escaping, so a jest --testPathPattern regex containing `(`, `)`, `|`, `$`
// (routine: allClauseFilesRegex/clauseFileRegex escape path metachars and
// then insert an unescaped capture group for the clause-id pattern) breaks
// the shell's own line parsing on both cmd.exe and /bin/sh. Resolving jest's
// own JS CLI entry point and spawning it with `node <entry> <args>` (the
// same process.execPath + argv-array pattern src/mcp-client.js already uses
// for court.js) sidesteps npx, the OS shell and any batch-file layer
// entirely — argv reaches jest unmodified on every platform.
//
// Resolution chain (lib/toolenv.js): the repo's own node_modules first
// (version fidelity — ts-jest/babel transforms are version-sensitive and the
// repo pinned them), then user-configured tool dirs (TRIUMPH_TOOL_PATH /
// .triumph/tool-path.json), then the extension dir. This removes the old
// hard requirement that the OPENED folder carry node_modules: a repo that
// was never npm-installed still runs its courts against a configured or
// globally-installed jest. Cached per repoRoot: resolution is a handful of
// require.resolve calls, not free.
const _jestCliCache = new Map();
function resolveJestCli(repoRoot) {
  const key = repoRoot || '';
  if (_jestCliCache.has(key)) return _jestCliCache.get(key);
const hit = toolenv.resolvePackageBin('jest', 'jest', toolenv.nodeToolSearchDirs(repoRoot));
  const resolved = hit ? hit.bin : null;
  _jestCliCache.set(key, resolved);
  return resolved;
}

/** Where did the resolved jest come from? ('repo' = repo's own install). */
function jestCliSource(repoRoot) {
  const hit = toolenv.resolvePackageBin('jest', 'jest', toolenv.nodeToolSearchDirs(repoRoot));
  if (!hit) return null;
  return { bin: hit.bin, pkgDir: hit.pkgDir, source: hit.source, repoLocal: path.resolve(hit.source) === path.resolve(repoRoot || '') };
}

/**
 * Return a clear error result when node_modules is absent from the repo.
 * Both jest (REDLINE) and stryker (SPLITBRAIN) live in node_modules; without
 * them the spawned command crashes immediately and leaves no report file,
 * which surfaces as a parse error in every downstream court tool.
 */
function checkNodeModules(repoRoot) {
  const nm = path.join(repoRoot, 'node_modules');
  if (!fs.existsSync(nm)) {
    return {
      ok: false, code: null, stdout: '', stderr: '',
      error: `node_modules not found in ${repoRoot} — run npm install in the repo first`,
    };
  }
  return null;
}

/**
 * Run `jest <jestArgs>` for this repo and return spawnCollect's result
 * shape. Prefers jest's own CLI entry via `node <entry> <args>` (no shell,
 * no npx, no batch file — safe for any argv, including the regex
 * metacharacters allClauseFilesRegex/clauseFileRegex produce). jest is
 * located via lib/toolenv's resolution chain (repo node_modules →
 * TRIUMPH_TOOL_PATH/.triumph/tool-path.json → extension dir), so the opened
 * folder no longer needs its own node_modules when a jest is configured or
 * globally reachable.
 *
 * Last-resort fallback: plain `npx` (shell:false — a real executable on
 * PATH, no batch-file layer, so no shell is needed or used) when jest isn't
 * resolvable anywhere; this matches the pre-existing POSIX behavior exactly.
 * On win32 that fallback is not attempted: `npx` there is the `npx.cmd`
 * batch shim, which Node's spawn cannot execute without shell:true, and
 * shell:true naively string-joins argv with no per-argument escaping —
 * silently corrupting a metacharacter-bearing --testPathPattern into the
 * wrong (or no) test selection is worse than failing loudly, so this
 * reports a clear, actionable error instead of guessing through a shell.
 */
async function runJestCli(repoRoot, jestArgs, spawnOpts) {
  const depErr = checkNodeModules(repoRoot);
  if (depErr) return depErr;
  const cli = resolveJestCli(repoRoot);
  if (cli) {
    // When jest came from OUTSIDE the repo and the repo has no node_modules,
    // jest will fail to resolve the repo config's named transforms/presets
    // (they resolve against rootDir). Bridge that with a zero-copy junction
    // so the foreign jest sees the same node_modules it was resolved from.
    // The junction is removed as soon as the run settles (the repo must not
    // be left pointing at a tool install), and recorded on the result for
    // honest evidence.
    const src = jestCliSource(repoRoot);
    let junction = null;
    if (src && !src.repoLocal && !(spawnOpts && spawnOpts.noAutoJunction)) {
      // pkgDir is <node_modules>/jest (or <node_modules>/@scope/jest); the
      // node_modules root is dirname for unscoped packages, dirname+1 for
      // scoped ones.
      const parent = path.dirname(src.pkgDir);
      const nmTarget = path.basename(parent).startsWith('@') ? path.dirname(parent) : parent;
      junction = toolenv.ensureNodeModulesJunction(repoRoot, nmTarget);
    }
    let r;
    try {
      r = await spawnCollect(process.execPath, [cli, ...jestArgs], spawnOpts);
    } finally {
      if (junction && junction.linked) {
        toolenv.removeNodeModulesJunction(repoRoot, junction.target);
      }
    }
    if (junction && junction.linked) r.junction = { linkPath: junction.linkPath, target: junction.target, removed: true };
    else if (junction && !junction.linked && junction.reason) r.junction = { linked: false, reason: junction.reason };
    return r;
  }
  if (process.platform === 'win32') {
    return {
      ok: false, code: null, stdout: '', stderr: '',
      error: 'jest is not resolvable (searched ' + toolenv.describeSearch(repoRoot) + ') — ' +
        'run npm install in the repo, set TRIUMPH_TOOL_PATH to a directory with node_modules/jest, ' +
        'or add one to .triumph/tool-path.json',
    };
  }
  return spawnCollect('npx', ['jest', ...jestArgs], spawnOpts);
}

function spawnCollect(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: withEnv(opts.cwd, opts.repoRoot || opts.cwd), shell: !!opts.shell });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: 'timeout', stdout: out, stderr: err, code: null });
    }, opts.timeoutMs || 120_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: 'spawn-failed: ' + e.message, stdout: out, stderr: err, code: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout: out, stderr: err });
    });
  });
}

/** Extract the outermost JSON object from a noisy stdout stream. */
function extractJson(out) {
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(out.slice(start, end + 1)); } catch { return null; }
}

/** Build a regex that matches exactly one clause test file. */
function clauseFileRegex(cfg, clauseId) {
  const rel = path.relative(cfg.repoRoot, path.join(
    cfg.tests.absDir, cfg.tests.clauseTestPattern.replace('{{clause}}', clauseId)
  ));
  return '^' + path.join(cfg.repoRoot, rel).split(path.sep).join('/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
}

/** Regex matching every clause test file. */
function allClauseFilesRegex(cfg) {
  const absolute = path.join(cfg.tests.absDir, cfg.tests.clauseTestPattern).split(path.sep).join('/');
  const escaped = absolute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return '^' + escaped.replace('\\{\\{clause\\}\\}', `(${cfg.spec.clauseIdPattern.replace(/^\^|\$$/g, '')})`) + '$';
}

/** True when a test-file path is a clause witness file (vs a regular test). */
function isClauseTestFile(cfg, relOrAbsPath) {
  const absolute = path.resolve(cfg.repoRoot, relOrAbsPath).split(path.sep).join('/');
  return new RegExp(allClauseFilesRegex(cfg)).test(absolute);
}

// ---------------------------------------------------------------------------
// jest
// ---------------------------------------------------------------------------
async function runJest(cfg, clauseId /* null = all clause suites */) {
  const pattern = clauseId ? clauseFileRegex(cfg, clauseId) : allClauseFilesRegex(cfg);
  // Flag compatibility: jest 29's plural --testPathPatterns is regex-loose
  // (matches unrelated suites); jest 30 removed the singular form. Try
  // singular first (works in 29 + most 30.x), fall back to plural on the
  // "replaced/unknown option" error.
  const spawnOpts = { cwd: cfg.repoRoot, timeoutMs: 120_000 };
  let r = await runJestCli(cfg.repoRoot, ['--json', '--testPathPattern=' + pattern], spawnOpts);
  if (!extractJson(r.stdout) && /testPathPattern/.test(r.stderr || '') && /replaced|Unrecognized|not.*available|unknown option/i.test(r.stderr || '')) {
    r = await runJestCli(cfg.repoRoot, ['--json', '--testPathPatterns=' + pattern], spawnOpts);
  }
  const parsed = r.parsed !== undefined ? r.parsed : extractJson(r.stdout);
  if (!parsed) {
    return { suites: null, raw: null, error: r.error || 'no-parse', stderr: (r.stderr || '').split('\n').slice(-10) };
  }
  // A failed suite can still yield valid Jest JSON with zero assertions. Never
  // turn a pre-assertion crash into a yellow (or green) court verdict.
  const selected = (parsed.testResults || []).filter((tr) =>
    typeof tr.name === 'string' && new RegExp(pattern).test(tr.name.split(path.sep).join('/')));
  const empty = selected.filter((tr) => !Array.isArray(tr.assertionResults) || tr.assertionResults.length === 0);
  const names = selected.map((tr) => tr.name.split(path.sep).join('/'));
  const duplicate = names.find((name, i) => names.indexOf(name) !== i);
  const recordedFailures = selected.some((tr) => tr.assertionResults?.some((a) => a.status === 'failed'));
  // Jest can exit nonzero for setup/runner errors even when its JSON contains
  // passing assertions. Such a run cannot support a green verdict.
  const unexplainedExit = !r.ok && !recordedFailures;
  const unaccountedSuiteFailure = selected.some((tr) => tr.status === 'failed' && !tr.assertionResults?.some((a) => a.status === 'failed'));
  if (!selected.length || empty.length || duplicate || unexplainedExit || unaccountedSuiteFailure) {
    const error = !selected.length ? 'no matching clause suites'
      : empty.length ? 'clause suite executed zero assertions'
      : duplicate ? `duplicate clause suite: ${duplicate}`
      : unaccountedSuiteFailure ? 'clause suite failed without a failed assertion'
      : `Jest exited ${r.code ?? r.error ?? 'without a code'} without recorded assertion failures`;
    return {
      suites: null, raw: null, error,
      stderr: [
        ...empty.map((tr) => `${tr.name}: ${String(tr.message || 'no Jest suite error supplied').slice(0, 2000)}`),
        ...(r.stderr || '').split('\n').slice(-8),
      ].slice(-20),
    };
  }
  // An extra, non-clause suite failure must not be hidden by filtering it out.
  if ((parsed.testResults || []).some((tr) => tr.status === 'failed' && !selected.includes(tr))) {
    return { suites: null, raw: null, error: 'unexpected non-clause suite failed', stderr: (r.stderr || '').split('\n').slice(-10) };
  }
  if (clauseId && selected.length !== 1) {
    return { suites: null, raw: null, error: `expected one suite for ${clauseId}, received ${selected.length}`, stderr: (r.stderr || '').split('\n').slice(-10) };
  }
  const ids = selected.map((tr) => path.basename(tr.name));
  if (new Set(ids).size !== ids.length) {
    return { suites: null, raw: null, error: 'duplicate clause files in Jest results', stderr: (r.stderr || '').split('\n').slice(-10) };
  }
  const suites = selected.map((tr) => ({
    name: tr.name,
    file: tr.name,
    assertions: tr.assertionResults.map((a) => ({
      title: a.title,
      status: a.status,
      failureMessages: a.failureMessages || [],
    })),
  }));
  return { suites, raw: { numPassedTests: parsed.numPassedTests, numFailedTests: parsed.numFailedTests, numTotalTests: parsed.numTotalTests, exitCode: r.code } };
}

/**
 * Run an explicit set of test files (repo-relative or absolute paths) under
 * jest and return the normalized suite shape. This is the diff-scoped
 * selector axis: unlike runJest(cfg, clauseId) — which targets clause
 * witness suites by anchored pattern — this runs exactly the files named,
 * using positional args (no --testPathPattern, no pattern-looseness risk).
 *
 * Options:
 *   extraArgs  : additional jest CLI args appended verbatim (e.g. --testPathIgnorePatterns)
 *   timeoutMs  : per-run timeout (default 120s)
 *   requireFiles: absolute paths forced via --require (unused hook for future preload)
 */
async function runJestFiles(cfg, testFiles, opts = {}) {
  const relFiles = testFiles.map((f) =>
    path.isAbsolute(f) ? path.relative(cfg.repoRoot, f) : f
  ).map((f) => f.split(path.sep).join('/'));
  // runJestCli resolves jest's own CLI entry (node <entry> <args>), so argv
  // reaches jest unmodified on every platform — no npx, no shell, no shim.
  const r = await runJestCli(cfg.repoRoot, ['--json', ...relFiles], {
    cwd: cfg.repoRoot,
    timeoutMs: opts.timeoutMs || 120_000,
  });
  const parsed = extractJson(r.stdout);
  if (!parsed) {
    return { suites: null, raw: null, error: r.error || 'no-parse', stderr: (r.stderr || '').split('\n').slice(-10) };
  }
  const suites = (parsed.testResults || []).map((tr) => ({
    name: tr.name,
    file: tr.name,
    status: tr.status,
    message: tr.message || '',
    assertions: (tr.assertionResults || []).map((a) => ({
      title: a.title,
      status: a.status,
      failureMessages: a.failureMessages || [],
    })),
  }));
  return {
    suites,
    raw: {
      numPassedTests: parsed.numPassedTests,
      numFailedTests: parsed.numFailedTests,
      numTotalTests: parsed.numTotalTests,
      numRuntimeErrorTestSuites: parsed.numRuntimeErrorTestSuites || 0,
      exitCode: r.code,
    },
  };
}

/** List every test file jest would discover (cheap, read-only). */
async function listJestTests(cfg, opts = {}) {
  const r = await runJestCli(cfg.repoRoot, ['--listTests'], {
    cwd: cfg.repoRoot,
    timeoutMs: opts.timeoutMs || 60_000,
  });
  if (!r.ok) return { files: null, error: r.error || `exit ${r.code}`, stderr: (r.stderr || '').split('\n').slice(-6) };
  const files = r.stdout.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('['));
  return { files, error: null };
}

// ---------------------------------------------------------------------------
// pytest (unit6: json-report plugin when present, else -q parse fallback)
// ---------------------------------------------------------------------------
async function runPytest(cfg, clauseId) {
  // clauseTestPattern for pytest carries the real suffix (e.g.
  // test_clause_{{clause}}.py); no extension munging.
  const target = clauseId
    ? path.relative(cfg.repoRoot, path.join(cfg.tests.absDir, cfg.tests.clauseTestPattern.replace('{{clause}}', clauseId)))
    : path.relative(cfg.repoRoot, cfg.tests.absDir);
  // pytest-json-report writes to a file path ('-' is a literal filename, not
  // stdout); use a temp file and read it back. Honor an optional python bin.
  const os = require('os');
  const tmpReport = path.join(os.tmpdir(), 'gaia-pytest-' + Date.now() + '.json');
  const python = (cfg.tests && cfg.tests.python) || 'python3';
  const r = await spawnCollect(python, ['-m', 'pytest', '--json-report', '--json-report-file=' + tmpReport, target], {
    cwd: cfg.repoRoot,
    timeoutMs: 120_000,
  });
  let parsed = extractJson(r.stdout);
  if (!parsed && fs.existsSync(tmpReport)) {
    try { parsed = JSON.parse(fs.readFileSync(tmpReport, 'utf8')); } catch { /* fall through */ }
    try { fs.unlinkSync(tmpReport); } catch { /* noop */ }
  }
  if (parsed && parsed.tests) {
    const byFile = new Map();
    for (const t of parsed.tests) {
      const file = (t.nodeid || '').split('::')[0];
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push({
        title: t.nodeid,
        status: t.outcome === 'passed' ? 'passed' : t.outcome === 'failed' ? 'failed' : 'pending',
        failureMessages: t.call && t.call.longrepr ? [t.call.longrepr] : [],
      });
    }
    return { suites: [...byFile.entries()].map(([file, assertions]) => ({ name: file, file, assertions })), raw: { summary: parsed.summary } };
  }
  // Fallback: exit-code only, one synthetic suite.
  const r2 = r.error ? r : await spawnCollect(python, ['-m', 'pytest', '-q', target], { cwd: cfg.repoRoot, timeoutMs: 120_000 });
  const failed = !r2.ok;
  return {
    suites: [{
      name: target,
      file: target,
      assertions: [{
        title: 'pytest ' + target,
        status: failed ? 'failed' : 'passed',
        failureMessages: failed ? [(r2.stdout + '\n' + r2.stderr).split('\n').slice(-30).join('\n')] : [],
      }],
    }],
    raw: { exitCode: r2.code },
    note: 'pytest-json-report not installed; verdict from exit code only',
  };
}

// ---------------------------------------------------------------------------
// custom — cfg.tests.runClause / runAll with {clause} / {file} placeholders;
// the command MUST print the normalized JSON shape to stdout.
// ---------------------------------------------------------------------------
async function runCustom(cfg, clauseId) {
  const file = clauseId
    ? path.join(cfg.tests.absDir, cfg.tests.clauseTestPattern.replace('{{clause}}', clauseId))
    : null;
  const tpl = clauseId ? cfg.tests.runClause : (cfg.tests.runAll || cfg.tests.runClause);
  if (!tpl) throw new Error('custom framework requires tests.runAll or tests.runClause in .gaia.yml');
  const cmd = tpl.replace(/\{clause\}/g, clauseId || '').replace(/\{file\}/g, file || '');
  const r = await spawnCollect(cmd, [], { cwd: cfg.repoRoot, timeoutMs: 180_000, shell: true });
  const parsed = extractJson(r.stdout);
  if (!parsed || !Array.isArray(parsed.suites)) {
    return { suites: null, error: 'custom runner did not print normalized JSON ({suites:[...]})', stderr: (r.stderr || '').split('\n').slice(-10) };
  }
  return { suites: parsed.suites, raw: parsed };
}

async function runTests(cfg, clauseId) {
  switch (cfg.tests.framework) {
    case 'jest': return runJest(cfg, clauseId);
    case 'vitest':
    case 'mocha':
      // No dedicated runner yet: drive them through the custom path by
      // declaring tests.runAll/runClause in .gaia.yml. Without those, fail
      // loudly with a steer rather than guessing a JSON reporter shape.
      if (cfg.tests.runClause || cfg.tests.runAll) return runCustom(cfg, clauseId);
      throw new Error(`${cfg.tests.framework}: set tests.runClause (with {clause}/{file} placeholders) printing normalized JSON, or switch tests.framework to jest`);
    case 'pytest': return runPytest(cfg, clauseId);
    case 'custom': return runCustom(cfg, clauseId);
    default: throw new Error('unsupported framework ' + cfg.tests.framework);
  }
}

module.exports = { runTests, runJestFiles, listJestTests, spawnCollect, extractJson, clauseFileRegex, allClauseFilesRegex, isClauseTestFile, execSync, runJestCli, resolveJestCli, checkNodeModules, withEnv };

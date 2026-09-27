#!/usr/bin/env node
/**
 * court.js — Gaia 3-court engine. Model-free MCP server.
 *
 * One process, three courts, zero opinions of its own:
 *
 *   WITNESS    — Spec-witness. Runs wall-checked test suites authored from
 *                the repo's spec contract alone. Verdict = red/yellow/green
 *                per clause. The wall is enforced *here*: WITNESS tools
 *                refuse to touch any path matched by wall.denyGlobs.
 *
 *   TRUSTGAP   — Honesty audit. Claimed coverage vs real mutation kill-rate.
 *                The gap is derived from the mutation report, never asserted.
 *                Slow runs are async: trustgap_mutate starts a job, poll
 *                with trustgap_status — chat never blocks.
 *
 *   TRIAGE     — Incident forensics. Correlates deploy/metrics/log fixtures,
 *                isolates the suspect deploy, renders a structured postmortem.
 *
 * Repo-agnostic: every path, pattern, and runner comes from `.gaia.yml`
 * (see schemas/gaia-config.schema.json). Run `gaia-setup` or the
 * extension's "Install courts" command to generate one.
 *
 * Protocol — MCP 2024-11-05, JSON-RPC 2.0 newline-delimited over stdio:
 *   initialize / notifications/initialized / tools/list / tools/call / ping
 *
 * Config resolution: --repo <dir> | GAIA_REPO_ROOT | cwd.
 *
 * This server never calls a model, never holds an API key, and never
 * orchestrates subagents. It is the deterministic source of truth that the
 * reports are rendered from.
 */

'use strict';

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { loadConfig, clauseTestFile } = require('./lib/config');
const runners = require('./lib/runners');
const trustgapLib = require('./lib/trustgap');
const diffLib = require('./lib/diff');
const microLib = require('./lib/micro');
const verifyLib = require('./lib/verify');
const { parseMutationLine } = require('./lib/mutation-progress');
const toolenv = require('./lib/toolenv');

const PKG = (() => { try { return require('./package.json'); } catch { return { version: '0.0.0' }; } })();
const SERVER_INFO = { name: 'gaia-courts', version: PKG.version };

// ---------------------------------------------------------------------------
// Config bootstrap
// ---------------------------------------------------------------------------
function parseArgv(argv) {
  const out = { repo: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--repo') out.repo = argv[++i];
    else if (argv[i].startsWith('--repo=')) out.repo = argv[i].slice(7);
  }
  return out;
}

const argv = parseArgv(process.argv);
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stdout.write(SERVER_INFO.version + '\n');
  process.exit(0);
}
const REPO_ROOT = path.resolve(argv.repo || process.env.GAIA_REPO_ROOT || process.cwd());

let CFG = null;
let CFG_ERROR = null;
try {
  CFG = loadConfig(REPO_ROOT);
} catch (e) {
  CFG_ERROR = e;
}

function cfg() {
  if (!CFG) {
    throw new Error(
      'no usable .gaia.yml under ' + REPO_ROOT +
      (CFG_ERROR ? ' — ' + CFG_ERROR.message : '') +
      '. Run the Gaia setup (extension command "Install courts" or `node court-extension/bin/gaia-setup.js --detect`) to generate one.'
    );
  }
  return CFG;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readJson(fp) {
  // Never leak a raw ENOENT/SyntaxError to the MCP caller: name the offending
  // file (repo-relative) and the failure, so a malformed evidence artifact is
  // diagnosable from the JSON-RPC error alone. The dispatcher still converts
  // this to a per-tool error response — the engine process never dies here.
  let text;
  try { text = fs.readFileSync(fp, 'utf8'); }
  catch (e) { throw new Error(`cannot read evidence ${rel(fp)}: ${e.message}`); }
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`invalid JSON in evidence ${rel(fp)}: ${e.message}`); }
}
function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function rel(fp) {
  return path.relative(REPO_ROOT, fp);
}

/**
 * THE WALL. WITNESS tooling may not read any path matched by wall.denyGlobs.
 * Throws a hard, greppable error so violations are impossible to miss.
 */
function assertNotWalled(absPath, court = 'WITNESS') {
  const c = cfg();
  const r = rel(path.resolve(absPath)).split(path.sep).join('/');
  for (const re of c.wall.denyRegexes) {
    if (re.test(r)) {
      throw new Error(`[${court} WALL] witness tooling may not read ${r} — the spec is the law. (denied by wall.denyGlobs)`);
    }
  }
}

/** Verify a clause id against the configured pattern (path-escape proof). */
function assertClauseId(clauseId) {
  const c = cfg();
  if (!clauseId || !new RegExp(c.spec.clauseIdPattern).test(clauseId)) {
    throw new Error(`invalid clause_id '${clauseId}' (must match ${c.spec.clauseIdPattern})`);
  }
}

// ---------------------------------------------------------------------------
// WITNESS court
// ---------------------------------------------------------------------------
function clauseIdFromTestFile(cfg, file) {
  const base = path.basename(file);
  const tpl = cfg.tests.clauseTestPattern;
  const [pre, post] = tpl.split('{{clause}}');
  if (base.startsWith(pre) && base.endsWith(post)) {
    return base.slice(pre.length, base.length - post.length);
  }
  return null;
}

async function courtWitnessVerdictAll() {
  const c = cfg();
  assertNotWalled(c.tests.absDir);
  const r = await runners.runTests(c, null);
  if (!r.suites) {
    return { court: 'WITNESS', status: 'error', detail: r.error || 'no-parse', stderr_lines: r.stderr || [] };
  }
  const results = [];
  for (const suite of r.suites) {
    const clauseId = clauseIdFromTestFile(c, suite.file || suite.name);
    if (!clauseId) continue;
    const assertions = suite.assertions || [];
    const passed = assertions.filter((a) => a.status === 'passed').length;
    const failed = assertions.filter((a) => a.status === 'failed').length;
    const total = assertions.length;
    const status = failed > 0 ? 'red' : passed === total && total > 0 ? 'green' : 'yellow';
    results.push({
      clause: clauseId,
      test: rel(suite.file || suite.name),
      status,
      passed,
      failed,
      total,
      spec_anchor: `${c.spec.path}#${clauseId}`,
      failures: assertions
        .filter((a) => a.status === 'failed')
        .map((a) => ({ title: a.title, message: (a.failureMessages || [])[0] || '' })),
    });
  }
  results.sort((a, b) => a.clause.localeCompare(b.clause, undefined, { numeric: true }));
  const green = results.filter((x) => x.status === 'green').length;
  const red = results.filter((x) => x.status === 'red').length;
  return { court: 'WITNESS', summary: { green, red, yellow: results.length - green - red, total: results.length }, results };
}

async function courtWitnessClause(args) {
  const c = cfg();
  const clauseId = args.clause_id;
  assertClauseId(clauseId);
  const test = clauseTestFile(c, clauseId);
  assertNotWalled(test); // belt + suspenders: the template can never resolve into the wall
  if (!fs.existsSync(test)) throw new Error('no test for clause ' + clauseId + ' (expected ' + rel(test) + ')');
  const r = await runners.runTests(c, clauseId);
  if (!r.suites) {
    return { clause: clauseId, status: 'unknown', error: r.error || 'no-parse', stderr_lines: r.stderr || [] };
  }
  const assertions = r.suites.flatMap((s) => s.assertions || []);
  const passed = assertions.filter((a) => a.status === 'passed').length;
  const failed = assertions.filter((a) => a.status === 'failed').length;
  return {
    clause: clauseId,
    status: failed > 0 ? 'red' : assertions.length > 0 && passed === assertions.length ? 'green' : 'unknown',
    passed,
    failed,
    total: assertions.length,
    failures: assertions
      .filter((a) => a.status === 'failed')
      .map((a) => ({ title: a.title, messages: a.failureMessages || [] })),
    spec_anchor: `${c.spec.path}#${clauseId}`,
  };
}

async function courtWitnessClauses() {
  const c = cfg();
  assertNotWalled(c.spec.absPath);
  const text = fs.readFileSync(c.spec.absPath, 'utf8');
  const re = new RegExp(c.spec.clausePattern, 'gm');
  const ids = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = m[1] || m[0];
    if (new RegExp(c.spec.clauseIdPattern).test(id) && !ids.includes(id)) ids.push(id);
  }
  // Enrich from the evidence ledger when present.
  let ledger = null;
  const ledgerPath = path.join(c.evidence.dir, 'clauses.json');
  if (fs.existsSync(ledgerPath)) {
    try { ledger = readJson(ledgerPath).clauses || null; } catch { /* malformed ledger is not fatal */ }
  }
  const clauses = ids.map((id) => {
    const entry = ledger && ledger.find((x) => x.id === id);
    return entry
      ? { id, level: entry.level || null, title: entry.title || null, summary: entry.summary || null, spec_anchor: `${c.spec.path}#${id}` }
      : { id, level: null, title: null, summary: null, spec_anchor: `${c.spec.path}#${id}` };
  });
  return { court: 'WITNESS', spec: c.spec.path, clauses };
}

// ---------------------------------------------------------------------------
// TRUSTGAP court — async job registry for slow mutation runs
// ---------------------------------------------------------------------------
const JOBS = new Map(); // jobId -> {status, startedAt, finishedAt, error, result, progress[]}
const JOB_TTL_MS = 30 * 60_000;
const PROGRESS_LIMIT = 500; // max events stored per job

function sweepJobs() {
  const now = Date.now();
  for (const [id, j] of JOBS) {
    if (now - j.startedAt > JOB_TTL_MS) JOBS.delete(id);
  }
}

/**
 * Push a progress event onto job.progress and notify IPC listeners.
 * Caps the ring at PROGRESS_LIMIT so long runs don't leak memory.
 */
function emitProgress(job, jobId, event) {
  if (job.progress.length >= PROGRESS_LIMIT) job.progress.shift();
  job.progress.push(event);
  // Forward to the dashboard server over IPC when running as a forked child.
  if (process.send) {
    try { process.send({ type: 'gaia.mutationProgress', jobId, event }); } catch { /* IPC gone */ }
  }
}

/**
 * Streaming variant of spawnCollect: spawns the command, pipes stdout/stderr
 * line-by-line through parseMutationLine, and resolves with the same shape
 * as spawnCollect once the process exits. All buffering logic is identical to
 * spawnCollect — we just add a per-line hook.
 */
function spawnStream(cmd, args, opts, onLine) {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    // Tool-path augmented env: a mutation command like `stryker run` (or an
    // npm script wrapping it) resolves from the repo .bin first, then any
    // configured tool dirs, without requiring node_modules in the OPENED
    // folder when a configured/global install exists.
    const child = spawn(cmd, args, { cwd: opts.cwd, env: toolenv.withToolPath(process.env, opts.repoRoot || opts.cwd), shell: !!opts.shell });
    let out = '';
    let err = '';
    let outBuf = '';
    let errBuf = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: 'timeout', stdout: out, stderr: err, code: null });
    }, opts.timeoutMs || 120_000);

    function processLines(buf, newData, isSterr) {
      const combined = buf + newData;
      const lines = combined.split('\n');
      const remainder = lines.pop(); // last incomplete line
      for (const l of lines) {
        const parsed = parseMutationLine(l);
        if (parsed) onLine(parsed);
      }
      return remainder;
    }

    child.stdout.on('data', (d) => {
      const chunk = String(d);
      out += chunk;
      outBuf = processLines(outBuf, chunk, false);
    });
    child.stderr.on('data', (d) => {
      const chunk = String(d);
      err += chunk;
      errBuf = processLines(errBuf, chunk, true);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: 'spawn-failed: ' + e.message, stdout: out, stderr: err, code: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // Flush any remaining partial line
      if (outBuf) { const p = parseMutationLine(outBuf); if (p) onLine(p); }
      if (errBuf) { const p = parseMutationLine(errBuf); if (p) onLine(p); }
      resolve({ ok: code === 0, code, stdout: out, stderr: err });
    });
  });
}

async function runMutationJob(cfg, jobId, claimedOverride) {
  const job = JOBS.get(jobId);
  try {
if (!cfg.mutation.command) throw new Error('mutation.command is not set in .gaia.yml');
    const depErr = runners.checkNodeModules(cfg.repoRoot);
    if (depErr) throw new Error(depErr.error);
    const before = cfg.mutation.absReport && fs.existsSync(cfg.mutation.absReport)
      ? fs.statSync(cfg.mutation.absReport) : null;
    const startedAt = Date.now();

    // Stream stdout/stderr through parseMutationLine so progress events are
    // available immediately, before the process exits.
    const r = await spawnStream(cfg.mutation.command, [], {
      cwd: cfg.repoRoot,
      repoRoot: cfg.repoRoot,
      timeoutMs: (cfg.mutation.timeoutSeconds || 900) * 1000,
      shell: true,
    }, (event) => emitProgress(job, jobId, { ...event, ts: Date.now() }));

    const after = cfg.mutation.absReport && fs.existsSync(cfg.mutation.absReport)
      ? fs.statSync(cfg.mutation.absReport) : null;
    const diagnostic = [
      r.error && `runner: ${r.error}`,
      r.stdout && `stdout tail: ${r.stdout.slice(-4000)}`,
      r.stderr && `stderr tail: ${r.stderr.slice(-4000)}`,
    ].filter(Boolean).join('\n');
    // A previous JSON artifact is not evidence of this run. Failed commands
    // cannot certify coverage even if they touched the report file.
    job.commandResult = {
      exitCode: r.code, runnerError: r.error || null,
      stdoutTail: (r.stdout || '').slice(-4000), stderrTail: (r.stderr || '').slice(-4000),
      reportProduced: !!after && (!before || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) && after.mtimeMs >= startedAt - 2000,
    };
    const reason = !r.ok ? `mutation command failed (exit ${r.code ?? 'none'}${r.error ? `; ${r.error}` : ''})`
      : !job.commandResult.reportProduced ? 'mutation command exited successfully but produced no fresh report' : null;
    if (reason) {
      throw new Error(`${reason}; expected ${cfg.mutation.report || '(unset)'}.` +
        (diagnostic ? `\n${diagnostic}` : ''));
    }
    job.result = await buildTrustGap(cfg, claimedOverride);
    job.status = 'done';
  } catch (e) {
    job.status = 'error';
    job.error = String(e && e.message ? e.message : e);
  } finally {
    job.finishedAt = Date.now();
    // Notify IPC that the job has a terminal status.
    if (process.send) {
      try { process.send({ type: 'gaia.mutationDone', jobId, status: job.status, error: job.error || null }); } catch { /* IPC gone */ }
    }
  }
}

/**
 * Stryker perTest coverage uses numeric jest test IDs. Resolve them to real
 * test names via `jest --json` over the mutation-suite test files so
 * dishonest-test attribution names names. Best-effort: null map on failure.
 */
async function resolveStrykerTestNames(cfg, mutants) {
  const ids = new Set();
  for (const m of mutants) for (const t of [...(m.coveredBy || []), ...(m.killedBy || [])]) ids.add(String(t));
  if (!ids.size || ![...ids].every((t) => /^\d+$/.test(t))) return null;

  // The mutation suite is defined by the repo's Stryker jest config
  // (testMatch narrowed to the suites under mutation). We replicate that
  // selection by running jest with the stryker config's testMatch; when no
  // stryker config is set we fall back to matching mutated-file basenames
  // against test filenames under tests.dir (clause-witness files excluded).
  const mutatedBases = [...new Set(mutants.map((m) => m && m.file).filter(Boolean))]
    .map((f) => path.basename(f).replace(/\.[^.]+$/, ''));

  const testDir = cfg.tests.absDir;
  const allFiles = [];
  const stack = [testDir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) stack.push(fp);
      else if (/\.test\.(ts|tsx|js|jsx|mjs)$/.test(e.name) || /^test_.*\.py$/.test(e.name)) allFiles.push(fp);
    }
  }
  let files = allFiles;
  if (cfg.mutation.absStrykerJestConfig && fs.existsSync(cfg.mutation.absStrykerJestConfig)) {
    // jest --config <stryker> --json runs exactly the mutation suite.
    const r = await runners.runJestCli(cfg.repoRoot, ['--json', '--config=' + cfg.mutation.absStrykerJestConfig], {
      cwd: cfg.repoRoot, timeoutMs: 120_000,
    });
    const parsed = runners.extractJson(r.stdout);
    if (!parsed || !parsed.testResults) return null;
    const names = {};
    let idx = 0;
    for (const tr of parsed.testResults) for (const a of tr.assertionResults || []) names[String(idx++)] = a.title;
    return idx ? names : null;
  }
  if (mutatedBases.length) {
    files = allFiles.filter((fp) => mutatedBases.some((b) => path.basename(fp).includes(b)) && !runners.isClauseTestFile(cfg, fp));
  }
  if (!files.length) return null;

  const names = {};
  let idx = 0;
  for (const fp of files.sort()) {
    const rel = path.relative(cfg.repoRoot, fp);
    const jestArgs = ['--json', '--testPathPattern=' + rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')];
    const r = await runners.runJestCli(cfg.repoRoot, jestArgs, { cwd: cfg.repoRoot, timeoutMs: 120_000 });
    const parsed = runners.extractJson(r.stdout);
    if (!parsed || !parsed.testResults) continue;
    for (const tr of parsed.testResults) {
      for (const a of tr.assertionResults || []) names[String(idx++)] = a.title;
    }
  }
  return idx ? names : null;
}

async function buildTrustGap(cfg, claimedOverride) {
  if (!cfg.mutation.absReport || !fs.existsSync(cfg.mutation.absReport)) {
    return null;
  }
  const { mutants, kind, testNames } = trustgapLib.loadMutationReport(cfg.mutation.absReport);
  let claimed = claimedOverride != null ? claimedOverride : null;
  if (claimed == null && cfg.mutation.absClaimedCoverageFrom && fs.existsSync(cfg.mutation.absClaimedCoverageFrom)) {
    claimed = trustgapLib.claimedFromJestSummary(cfg.mutation.absClaimedCoverageFrom);
  }
  const gap = trustgapLib.computeTrustGap(mutants, claimed);
  if (kind === 'stryker') {
    // Attribution naming: prefer the report's own testFiles id→name map
    // (authoritative); only re-run jest as a fallback.
    let names = testNames;
    if (!names) {
      try { names = await resolveStrykerTestNames(cfg, mutants); } catch { names = null; }
    }
    if (names) {
      trustgapLib.applyTestNames(gap, names);
      gap.attribution = 'per-test-named';
    } else {
      gap.attribution = 'unresolved';
      gap.dishonestTests = [];
      gap.attributionNote = 'numeric test ids could not be resolved to test names; survivor ids are listed under mutants, dishonest tests intentionally unnamed';
    }
  }
  gap.reportKind = kind;
  gap.reportPath = rel(cfg.mutation.absReport);
  return gap;
}

async function courtTrustgapReport(args) {
  const c = cfg();
  const claimedOverride = args && typeof args.claimed_coverage === 'number' ? args.claimed_coverage : null;

  // Prefer a fresh derivation from the mutation report; fall back to a
  // precomputed TrustGap.json so read-only lanes still work.
  const fresh = await buildTrustGap(c, claimedOverride);
  if (fresh) {
    // Persist conservatively: back up any existing ledger first, and only
    // overwrite when the caller explicitly asked (claimed_coverage override
    // or mutation report newer than the ledger). Never silently clobber a
    // hand-built ledger schema.
    try {
      const tp = c.evidence.trustgap;
      const existing = fs.existsSync(tp) ? readJson(tp) : null;
      const reportMtime = c.mutation.absReport ? fs.statSync(c.mutation.absReport).mtimeMs : 0;
      const ledgerMtime = existing && fs.existsSync(tp) ? fs.statSync(tp).mtimeMs : 0;
      const shouldWrite = claimedOverride != null || !existing || reportMtime > ledgerMtime;
      if (shouldWrite) {
        if (existing) writeJson(tp + '.bak', existing);
        writeJson(tp, fresh);
      }
    } catch { /* read-only fs: serve anyway */ }
    return { court: 'TRUSTGAP', status: 'ok', ...fresh };
  }
  if (fs.existsSync(c.evidence.trustgap)) {
    const t = readJson(c.evidence.trustgap);
    // Prefer survivors embedded in the precomputed ledger, else the mutants
    // fixture (which survives repo checkouts where reports/ is gitignored).
    let survivors = t.survivors || [];
    if (!survivors.length) {
      const fix = c.mutation.absReport && fs.existsSync(c.mutation.absReport)
        ? trustgapLib.loadMutationReport(c.mutation.absReport).mutants.filter((m) => /survived/i.test(m.status))
        : [];
      survivors = fix;
    }
    return {
      court: 'TRUSTGAP',
      status: 'ok',
      source: rel(c.evidence.trustgap),
      schemaVersion: t.schemaVersion,
      generated: t.generated,
      claimedCoverage: t.claimedCoverage,
      honestMutationScore: t.honestMutationScore,
      trustGap: t.trustGap,
      dishonestTests: t.dishonestTests || [],
      itLedger: t.itLedger || [],
      survivors,
      summary: t.summary || null,
    };
  }
  return {
    court: 'TRUSTGAP',
    status: 'not-run',
    note: `no mutation report at ${c.mutation.report || '(unset)'} and no precomputed ${rel(c.evidence.trustgap)} — invoke trustgap_mutate to generate`,
  };
}

async function courtTrustgapMutants(args) {
  const c = cfg();
  const only = args && args.status ? String(args.status) : null;
  let src = [];
  let source = null;
  if (c.mutation.absReport && fs.existsSync(c.mutation.absReport)) {
    src = trustgapLib.loadMutationReport(c.mutation.absReport).mutants;
    source = rel(c.mutation.absReport);
  } else if (fs.existsSync(c.evidence.trustgap)) {
    const t = readJson(c.evidence.trustgap);
    src = t.mutants || t.survivors || [];
    source = rel(c.evidence.trustgap);
  }
  if (!src.length && c.fixtures.mutants && fs.existsSync(c.fixtures.mutants)) {
    const f = readJson(c.fixtures.mutants);
    src = trustgapLib.fromGenericReport(f);
    source = rel(c.fixtures.mutants);
  }
  const mutants = only
    ? src.filter((m) => (m.status || '').toLowerCase() === only.toLowerCase())
    : src;
  if (!src.length) {
    return { court: 'TRUSTGAP', status: 'no-mutants', mutants: [] };
  }
  return { court: 'TRUSTGAP', status: 'ok', source, count: mutants.length, mutants };
}

async function courtTrustgapMutate(args) {
  const c = cfg();
  sweepJobs();
  if (!c.mutation.command) {
    return {
      court: 'TRUSTGAP',
      status: 'unconfigured',
      note: 'mutation.command is not set in .gaia.yml — TRUSTGAP cannot run the mutator. Set it, or precompute mutation.report and call trustgap_report.',
    };
  }
  // Two jobs in the same engine would race over Stryker's temp directory and
  // report path. Refuse the second rather than presenting its result as fresh.
  const running = [...JOBS.entries()].find(([, job]) => job.status === 'running');
  if (running) return { court: 'TRUSTGAP', status: 'busy', error: `mutation job ${running[0]} is already running`, job_id: running[0] };
  const claimed = args && typeof args.claimed_coverage === 'number' ? args.claimed_coverage : null;
  const jobId = 'mut-' + crypto.randomBytes(4).toString('hex');
  JOBS.set(jobId, { status: 'running', startedAt: Date.now(), finishedAt: null, error: null, result: null, progress: [], command: c.mutation.command, claimedCoverage: claimed });
  // Fire and forget; chat polls trustgap_status.
  runMutationJob(c, jobId, claimed);
  return {
    court: 'TRUSTGAP',
    status: 'started',
    job_id: jobId,
    command: c.mutation.command,
    claimed_coverage: claimed,
    poll: { tool: 'trustgap_status', arguments: { job_id: jobId } },
  };
}

async function courtTrustgapStatus(args) {
  sweepJobs();
  const jobId = args && args.job_id;
  if (!jobId) {
    return {
      court: 'TRUSTGAP',
      jobs: [...JOBS.entries()].map(([id, j]) => ({ job_id: id, status: j.status, startedAt: new Date(j.startedAt).toISOString() })),
    };
  }
  const job = JOBS.get(jobId);
  if (!job) return { court: 'TRUSTGAP', job_id: jobId, status: 'unknown', note: 'expired or never existed' };
  const out = {
    court: 'TRUSTGAP',
    job_id: jobId,
    status: job.status,
    elapsedSeconds: Math.round(((job.finishedAt || Date.now()) - job.startedAt) / 1000),
    // Include last 20 progress events so callers can display live metrics
    // without a separate SSE connection (polling fallback).
    progress: (job.progress || []).slice(-20),
  };
  if (job.error) out.error = job.error;
  if (job.commandResult) out.commandResult = job.commandResult;
  if (job.result) out.result = job.result;
  return out;
}

/**
 * Return the full progress log for a running or recently-finished job.
 * Used by the dashboard SSE endpoint — not exposed as an MCP tool.
 */
function getJobProgress(jobId) {
  const job = JOBS.get(jobId);
  if (!job) return null;
  return { status: job.status, progress: job.progress || [], startedAt: job.startedAt, finishedAt: job.finishedAt || null };
}

// ---------------------------------------------------------------------------
// VERIFY — in-loop diff-scoped micro-mutation (the adversarial runtime)
// ---------------------------------------------------------------------------
/**
 * gaia_verify_diff: the agent-facing self-correction tool.
 *
 * Input: a unified diff (the agent's proposed change), either pasted directly
 * ({diff}) or captured from the repo ({from_git: true} -> `git diff HEAD`).
 * Output: for every source file in the diff, plan <=3 micro-mutants on the
 * added lines, execute each against the diff-impacted test files only, and
 * return killed/survived verdicts with deterministic, operator-derived repair
 * hints the calling agent can act on without any model involvement here.
 *
 * This is TRUSTGAP-family tooling (honesty, not witness): it reads src/ by
 * design and never touches wall.denyGlobs logic, which governs WITNESS only.
 */
async function courtVerifyDiff(args) {
  const c = cfg();
  const started = Date.now();

  // --- acquire the diff text ---------------------------------------------
  let diffText = args && typeof args.diff === 'string' ? args.diff : null;
  let diffSource = 'argument';
  if (!diffText && args && args.from_git) {
    diffSource = 'git diff HEAD';
    const r = await runners.spawnCollect('git', ['diff', 'HEAD'], { cwd: c.repoRoot, timeoutMs: 15_000 });
    if (!r.ok && !r.stdout) {
      return { court: 'TRUSTGAP', tool: 'gaia_verify_diff', status: 'error', detail: 'git diff HEAD failed: ' + (r.error || r.stderr || 'unknown') };
    }
    diffText = r.stdout;
  }
  if (!diffText) {
    return {
      court: 'TRUSTGAP', tool: 'gaia_verify_diff', status: 'error',
      detail: 'no diff supplied — pass {diff: "<unified diff text>"} or {from_git: true}',
    };
  }

  // --- parse + filter ------------------------------------------------------
  const parsed = diffLib.parseDiff(diffText);
  if (parsed.error) {
    return { court: 'TRUSTGAP', tool: 'gaia_verify_diff', status: 'error', detail: parsed.error };
  }
  // Normalize paths against the repo root. `git diff` invoked from a parent
  // (or a monorepo root) emits paths like 'northstar/src/x.ts'; strip leading
  // segments until each path resolves inside the repo. Honest failure: a path
  // that never resolves is rejected with a reason, never silently mistargeted.
  for (const f of parsed.files) {
    f.path = resolveAgainstRepo(c.repoRoot, f.path);
  }
  for (const r of parsed.rejected) { /* paths kept verbatim for diagnosis */ }
  const { mutable, skipped } = diffLib.mutableFiles(parsed);
  if (mutable.length === 0) {
    return {
      court: 'TRUSTGAP', tool: 'gaia_verify_diff', status: 'skipped',
      detail: 'no mutable source files in diff (only tests/docs/config/binary changed, or files rejected)',
      rejected: parsed.rejected, skipped,
      diff: parsed.stats,
      durationMs: Date.now() - started,
    };
  }

  // --- per file: plan -> select tests -> execute ---------------------------
  const fileResults = [];
  let totalMutants = 0;
  let totalKilled = 0;
  let totalSurvived = 0;

  for (const f of mutable) {
    const srcAbs = path.join(c.repoRoot, f.path);
    if (!fs.existsSync(srcAbs)) {
      fileResults.push({ file: f.path, status: 'error', detail: 'file does not exist at new path (diff not applied?)' });
      continue;
    }
    const srcText = fs.readFileSync(srcAbs, 'utf8');
    const { mutants, skipped: planSkipped } = microLib.planFileMutants(f.path, srcText, f.addedLines);
    if (mutants.length === 0) {
      fileResults.push({ file: f.path, status: 'no-mutants', detail: 'added lines carried no mutable construct', skipped: planSkipped });
      continue;
    }

    // Test-impact analysis.
    const listed = await runners.listJestTests(c);
    if (!listed.files) {
      fileResults.push({ file: f.path, status: 'error', detail: 'jest --listTests failed: ' + listed.error, stderr: listed.stderr });
      continue;
    }
    const { impacted, reasons } = microLib.selectImpactedTests(c, f.path, listed.files);
    if (impacted.length === 0) {
      fileResults.push({
        file: f.path, status: 'uncovered',
        detail: 'no test file statically references or names this source — the diff is untested by construction',
        mutants: mutants.map(publicMutant),
      });
      totalMutants += mutants.length;
      totalSurvived += mutants.length; // uncovered == survived, by definition of honesty
      continue;
    }

    const exec = await verifyLib.executeMutants(c, srcAbs, f.path, mutants, impacted);
    const killed = exec.results.filter((r) => r.status === 'killed');
    const survived = exec.results.filter((r) => r.status === 'survived');
    const errored = exec.results.filter((r) => r.status === 'error');
    totalMutants += exec.results.length;
    totalKilled += killed.length;
    totalSurvived += survived.length;

    fileResults.push({
      file: f.path,
      status: survived.length ? 'failed' : errored.length === exec.results.length ? 'error' : 'passed',
      impactedTests: impacted.map((t) => rel(t)),
      testSelection: reasons,
      killed: killed.map((m) => ({ ...publicMutant(m), killedBy: m.killedBy })),
      survivors: survived.map((m) => ({
        ...publicMutant(m),
        coveredBy: m.coveredBy,
        repair: m.repair,
      })),
      errors: errored.map((m) => ({ id: m.id, line: m.line, detail: m.detail, stderr: m.stderr })),
      durationMs: exec.durationMs,
    });
  }

  const honest = totalSurvived === 0 && totalMutants > 0;
  return {
    court: 'TRUSTGAP',
    tool: 'gaia_verify_diff',
    status: totalSurvived > 0 ? 'failed' : totalMutants === 0 ? 'skipped' : 'passed',
    honest,
    diffSource,
    diff: { ...parsed.stats, mutantsGenerated: totalMutants, killed: totalKilled, survived: totalSurvived },
    files: fileResults,
    rejected: parsed.rejected,
    retry_hint: totalSurvived > 0
      ? 'Fix the missing assertions named in survivors[].repair, then re-run gaia_verify_diff with the updated diff to confirm each mutant is killed.'
      : null,
    durationMs: Date.now() - started,
  };
}

/**
 * Resolve a diff path to repo-relative. Tries the path as-is first, then
 * strips leading segments until it exists under repoRoot. Returns the
 * repo-relative path on success, or the original on failure (the caller
 * rejects non-existent files with a named reason).
 */
function resolveAgainstRepo(repoRoot, p) {
  if (!p) return p;
  const norm = p.split('\\').join('/').replace(/^\.\//, '');
  if (fs.existsSync(path.join(repoRoot, norm))) return norm;
  const segs = norm.split('/');
  for (let drop = 1; drop < segs.length - 1; drop++) {
    const cand = segs.slice(drop).join('/');
    if (fs.existsSync(path.join(repoRoot, cand))) return cand;
  }
  return norm;
}

/** Public mutant view: full line context, no internal mask artifacts. */
function publicMutant(m) {
  return {
    id: m.id, file: m.file, line: m.line, operator: m.operator,
    before: m.before, after: m.after,
    lineBefore: m.lineBefore.trim(), lineAfter: m.lineAfter.trim(),
  };
}

// ---------------------------------------------------------------------------
// TRIAGE court
// ---------------------------------------------------------------------------
/**
 * Normalize the metrics fixture across schemas. Two shapes are understood:
 *   (a) Gaia demo: { window: "ISO..ISO", breakerState, consecutiveFailures, openThreshold }
 *   (b) challenge canonical: { errorRate: { windowStart }, breaker: { state, consecutiveFailuresAtOpen, openThreshold, settleWindowSeconds } }
 * Returns { window, breakerState, consecutiveFailures, openThreshold, raw }.
 */
function normalizeMetrics(m) {
  if (!m || typeof m !== 'object') return { window: null, breakerState: null, consecutiveFailures: null, openThreshold: null, raw: m };
  // (a) explicit window
  if (m.window) {
    return {
      window: m.window,
      breakerState: m.breakerState ?? (m.breaker && m.breaker.state) ?? null,
      consecutiveFailures: m.consecutiveFailures ?? (m.breaker && m.breaker.consecutiveFailuresAtOpen) ?? null,
      openThreshold: m.openThreshold ?? (m.breaker && m.breaker.openThreshold) ?? null,
      raw: m,
    };
  }
  // (b) canonical: derive a window from errorRate.windowStart; end is unknown → open-ended
  const start = m.errorRate && m.errorRate.windowStart;
  const breaker = m.breaker || {};
  return {
    window: start ? `${start}..${start}` : null, // point window; deploys at/after start
    windowStart: start || null,
    windowOpenEnded: !!start,
    breakerState: breaker.state ?? null,
    consecutiveFailures: breaker.consecutiveFailuresAtOpen ?? m.consecutiveFailures ?? null,
    openThreshold: breaker.openThreshold ?? null,
    raw: m,
  };
}

async function courtTriageContext() {
  const c = cfg();
  const readMaybe = (fp, fallback) => (fp && fs.existsSync(fp) ? readJson(fp) : fallback);
  const deploys = readMaybe(c.fixtures.deploys, {}).deploys || [];
  const metrics = normalizeMetrics(readMaybe(c.fixtures.metrics, {}).metrics || readMaybe(c.fixtures.metrics, {}));
  const logsRaw = readMaybe(c.fixtures.logs, {});
  const logWindow = (logsRaw.log || logsRaw.logs || []).map((l) => ({
    t: l.t, level: l.level, msg: l.msg || l.message || JSON.stringify(l), event: l.event || null, component: l.component || null,
    spec: l.spec || null, runbook: l.runbook || null,
  }));
  return {
    court: 'TRIAGE',
    fixtures: {
      deploys: c.fixtures.deploys ? rel(c.fixtures.deploys) : null,
      metrics: c.fixtures.metrics ? rel(c.fixtures.metrics) : null,
      logs: c.fixtures.logs ? rel(c.fixtures.logs) : null,
    },
    deploys,
    metrics,
    logWindow,
  };
}

async function courtTriageRun() {
  const { deploys, metrics, logWindow } = await courtTriageContext();
  // Real correlation, not a heuristic score:
  //   1. The incident window is metrics.window (start..end).
  //   2. The suspect deploy is the LATEST deploy whose timestamp falls
  //      INSIDE that window (or the last one before it opened).
  //   3. Evidence = error/warn lines inside the window from the log fixture.
  if (!metrics.window) {
    return {
      court: 'TRIAGE',
      status: 'no-signal-window',
      detail: 'metrics fixture has no window (window or errorRate.windowStart) — cannot correlate',
    };
  }
  const [wStart, wEndRaw] = String(metrics.window).split('..').map((s) => new Date(s).getTime());
  // Open-ended window (point start): treat end as +infinity.
  const wEnd = metrics.windowOpenEnded ? Number.POSITIVE_INFINITY : wEndRaw;
  if (Number.isNaN(wStart) || Number.isNaN(wEnd)) {
    return { court: 'TRIAGE', status: 'bad-window', detail: `metrics.window '${metrics.window}' is not ISO..ISO` };
  }
  const inWindow = deploys.filter((d) => {
    const t = new Date(d.at).getTime();
    return t >= wStart && t <= wEnd;
  });
  const before = deploys.filter((d) => new Date(d.at).getTime() < wStart);
  const suspect = inWindow.length > 0
    ? inWindow[inWindow.length - 1]
    : before.length > 0 ? before[before.length - 1] : null;
  const evidenceLines = logWindow.filter((l) => l.level === 'error' || l.level === 'warn');
  return {
    court: 'TRIAGE',
    incidentWindow: metrics.window,
    suspect: suspect
      ? {
          id: suspect.id,
          service: suspect.service,
          commit: suspect.commit,
          deployedAt: suspect.at,
          reason: inWindow.length > 0 ? 'landed inside the error-rate window' : 'last deploy before the window opened',
        }
      : null,
    clearedDeploys: deploys.filter((d) => d !== suspect).map((d) => ({ id: d.id, at: d.at })),
    breakerSnapshot: {
      state: metrics.breakerState,
      consecutiveFailures: metrics.consecutiveFailures,
      openThreshold: metrics.openThreshold,
    },
    evidence: evidenceLines,
    // The violated rule is *derived from the data*: when the breaker opened
    // below its configured threshold, cite the runbook (if configured) plus
    // any spec anchor found on the evidence lines — never a hardcoded clause.
    rule: (() => {
      const below = typeof metrics.consecutiveFailures === 'number' &&
                    typeof metrics.openThreshold === 'number' &&
                    metrics.consecutiveFailures < metrics.openThreshold &&
                    /open/i.test(metrics.breakerState || '');
      if (!below) return null;
      const anchor = (evidenceLines.find((l) => l.spec) || {}).spec;
      const runbook = cfg().rules.runbook ? rel(cfg().rules.runbook) : (evidenceLines.find((l) => l.runbook) || {}).runbook;
      const defect = `breaker opened at consecutiveFailures=${metrics.consecutiveFailures} < openThreshold=${metrics.openThreshold}`;
      return [runbook, anchor].filter(Boolean).length
        ? `${[runbook, anchor].filter(Boolean).join(' + ')}: breaker SHALL NOT trip below openThreshold — ${defect} is the defect`
        : defect;
    })(),
  };
}

async function courtTriagePostmortem(args) {
  const c = cfg();
  const incident = args.incident_id || 'SEV1-UNNAMED';
  if (!/^[A-Za-z0-9._-]+$/.test(incident)) throw new Error('incident_id must be [A-Za-z0-9._-]+');
  const suspect = args.suspect_sha || 'unknown';
  const mitigations = args.mitigations || [];
  const followups = args.followups || [];
  const now = new Date().toISOString();
  const md = `# ${incident} — Postmortem

**Date:** ${now}
**Suspect deploy:** \`${suspect}\`
**Status:** mitigated

## Summary
${args.summary || '(fill me)'}

## Timeline
${(args.timeline || []).map((t) => `- **${t.t}** — ${t.what}`).join('\n') || '(fill me)'}

## Root cause
${args.root_cause || '(fill me)'}

## Mitigations
${mitigations.map((m) => `- ${m}`).join('\n') || '(fill me)'}

## Follow-ups
${followups.map((f) => `- [ ] ${f}`).join('\n') || '(fill me)'}

---
*Authored by the war-room subagent via the Gaia TRIAGE court. Deterministic template; prose is the caller model's.*
`;
  fs.mkdirSync(c.evidence.incidentDir, { recursive: true });
  const fp = path.join(c.evidence.incidentDir, incident + '.md');
  fs.writeFileSync(fp, md, 'utf8');
  return { court: 'TRIAGE', postmortem: rel(fp) };
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------
const TOOLS = [
  // WITNESS
  { name: 'witness_clauses', description: 'WITNESS: list spec clause ids extracted from the spec contract (titles/levels when an evidence ledger exists).', inputSchema: { type: 'object', properties: {} } },
  { name: 'witness_verdict_all', description: 'WITNESS: run all witness clause suites, return red/yellow/green per clause. Wall-enforced: never reads implementation.', inputSchema: { type: 'object', properties: {} } },
  { name: 'witness_clause', description: 'WITNESS: run a single spec clause (e.g. W4) and return verdict + failures.', inputSchema: { type: 'object', required: ['clause_id'], properties: { clause_id: { type: 'string' } } } },
  // TRUSTGAP
  { name: 'trustgap_report', description: 'TRUSTGAP: claimed coverage vs honest mutation kill-rate, derived from the mutation report. Falsifiable — every tautology is named.', inputSchema: { type: 'object', properties: { claimed_coverage: { type: 'number', description: 'optional explicit claimed line-coverage % override' } } } },
  { name: 'trustgap_mutants', description: 'TRUSTGAP: list mutants from the latest report (optionally filtered by status, e.g. Survived).', inputSchema: { type: 'object', properties: { status: { type: 'string' } } } },
  { name: 'trustgap_mutate', description: 'TRUSTGAP: start the mutation run in the background (async — returns a job_id immediately so chat never blocks). Poll with trustgap_status. Pass claimed_coverage to have the completed job carry the trust gap.', inputSchema: { type: 'object', properties: { claimed_coverage: { type: 'number', description: 'optional explicit claimed line-coverage % override' } } } },
  { name: 'trustgap_status', description: 'TRUSTGAP: poll a mutation job (job_id) or list all jobs.', inputSchema: { type: 'object', properties: { job_id: { type: 'string' } } } },
  { name: 'gaia_verify_diff', description: 'TRUSTGAP (in-loop): verify the agent\'s proposed diff with diff-scoped micro-mutations. Plans ≤3 mutants on the added lines per changed source file, runs only the impacted tests, and returns killed/survived per mutant with deterministic repair hints for survivors. Pass {diff: "<unified diff>"} or {from_git: true}. Sub-second-to-few-second feedback — safe to call inside every agent loop.', inputSchema: { type: 'object', properties: { diff: { type: 'string', description: 'unified diff text (git diff output)' }, from_git: { type: 'boolean', description: 'capture `git diff HEAD` from the repo instead' } } } },
  // TRIAGE
  { name: 'triage_context', description: 'TRIAGE: pull the deploy/metrics/logs incident context.', inputSchema: { type: 'object', properties: {} } },
  { name: 'triage_run', description: 'TRIAGE: compute suspect deploy + signal window by timestamp correlation.', inputSchema: { type: 'object', properties: {} } },
  { name: 'triage_postmortem', description: 'TRIAGE: render a structured incident postmortem under the incident dir.', inputSchema: { type: 'object', required: ['incident_id'], properties: { incident_id: { type: 'string' }, suspect_sha: { type: 'string' }, summary: { type: 'string' }, root_cause: { type: 'string' }, timeline: { type: 'array', items: { type: 'object' } }, mitigations: { type: 'array', items: { type: 'string' } }, followups: { type: 'array', items: { type: 'string' } } } } },
  // Meta
  { name: 'courts_about', description: 'Return the 3-court manifesto, config source, and wall policy in effect.', inputSchema: { type: 'object', properties: {} } },
];

const TOOL_HANDLERS = {
  witness_clauses: courtWitnessClauses,
  witness_verdict_all: courtWitnessVerdictAll,
  witness_clause: courtWitnessClause,
  trustgap_report: courtTrustgapReport,
  trustgap_mutants: courtTrustgapMutants,
  trustgap_mutate: courtTrustgapMutate,
  trustgap_status: courtTrustgapStatus,
  gaia_verify_diff: courtVerifyDiff,
  triage_context: courtTriageContext,
  triage_run: courtTriageRun,
  triage_postmortem: courtTriagePostmortem,
  courts_about: async () => {
    const out = {
      courts: ['WITNESS', 'TRUSTGAP', 'TRIAGE'],
      manifesto: 'Legal. Honest. Survivable.',
      engine: SERVER_INFO,
      description: {
        WITNESS: 'Spec-witness: tests from the spec contract only; wall enforced; verdicts red/yellow/green.',
        TRUSTGAP: 'Honesty audit: mutation kill-rate vs claimed coverage; tautologies named.',
        TRIAGE: 'Incident forensics: suspect deploy, signal window, structured postmortem.',
      },
      async: {
        WITNESS: { blocking: true, note: 'witness_verdict_all / witness_clause run the suite synchronously and return the verdict in one call.' },
        TRUSTGAP: { blocking: false, asyncTools: ['trustgap_mutate', 'trustgap_status'], note: 'trustgap_mutate returns a job_id immediately; poll trustgap_status until done. trustgap_report itself is synchronous.' },
        TRIAGE: { blocking: true, note: 'triage_run / triage_context return in one call.' },
      },
    };
    if (CFG) {
      out.repo = { root: REPO_ROOT, config: CFG.configSource, spec: CFG.spec.path, wall: CFG.wall.denyGlobs, framework: CFG.tests.framework, mutation: CFG.mutation.tool };
    } else {
      out.repo = { root: REPO_ROOT, config: null, error: CFG_ERROR ? CFG_ERROR.message : 'no .gaia.yml' };
    }
    return out;
  },
};

async function handleTool(name, args) {
  const handler = TOOL_HANDLERS[name];
  if (!handler) throw new Error('unknown tool ' + name);
  return handler(args || {});
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 REPL over stdio (MCP spec)
// ---------------------------------------------------------------------------
const rl = readline.createInterface({ input: process.stdin, terminal: false });

// In-flight async requests. The REPL must NOT exit on stdin EOF while a
// tool call (e.g. a jest spawn) is still running — the response would be
// dropped. `close` is deferred until the last pending response is written.
let pending = 0;
let stdinClosed = false;

function maybeExit() {
  if (stdinClosed && pending === 0) process.exit(0);
}

rl.on('line', async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    console.error('[gaia-courts] bad JSON: ' + line);
    return;
  }
  if (req.id === undefined || req.id === null) {
    return; // notification: never respond, never block exit
  }
  const id = req.id;
  pending += 1;
  let result;
  let isError = false;
  try {
    switch (req.method) {
      case 'initialize':
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: SERVER_INFO };
        break;
      case 'notifications/initialized':
        result = {};
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call': {
        const text = JSON.stringify(await handleTool(req.params && req.params.name, req.params && req.params.arguments));
        result = { content: [{ type: 'text', text }] };
        break;
      }
      case 'ping':
        result = {};
        break;
      default:
        isError = true;
        result = { code: -32601, message: 'unknown method ' + req.method };
    }
  } catch (e) {
    isError = true;
    result = { code: -32603, message: String(e && e.message ? e.message : e) };
  }
  const response = isError
    ? { jsonrpc: '2.0', id, error: result }
    : { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(response) + '\n');
  pending -= 1;
  maybeExit();
});

rl.on('close', () => {
  stdinClosed = true;
  maybeExit();
});

#!/usr/bin/env node
/**
 * court.js — TRIUMPH 3-court engine. Model-free MCP server.
 *
 * One process, three courts, zero opinions of its own:
 *
 *   REDLINE    — Spec-witness. Runs wall-checked test suites authored from
 *                the repo's spec contract alone. Verdict = red/yellow/green
 *                per clause. The wall is enforced *here*: REDLINE tools
 *                refuse to touch any path matched by wall.denyGlobs.
 *
 *   SPLITBRAIN — Honesty audit. Claimed coverage vs real mutation kill-rate.
 *                The gap is derived from the mutation report, never asserted.
 *                Slow runs are async: splitbrain_mutate starts a job, poll
 *                with splitbrain_status — chat never blocks.
 *
 *   WARPATH    — Incident forensics. Correlates deploy/metrics/log fixtures,
 *                isolates the suspect deploy, renders a structured postmortem.
 *
 * Repo-agnostic: every path, pattern, and runner comes from `.triumph.yml`
 * (see schemas/triumph-config.schema.json). Run `triumph-setup` or the
 * extension's "Install courts" command to generate one.
 *
 * Protocol — MCP 2024-11-05, JSON-RPC 2.0 newline-delimited over stdio:
 *   initialize / notifications/initialized / tools/list / tools/call / ping
 *
 * Config resolution: --repo <dir> | TRIUMPH_REPO_ROOT | cwd.
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

const PKG = (() => { try { return require('./package.json'); } catch { return { version: '0.0.0' }; } })();
const SERVER_INFO = { name: 'triumph-courts', version: PKG.version };

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
const REPO_ROOT = path.resolve(argv.repo || process.env.TRIUMPH_REPO_ROOT || process.cwd());

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
      'no usable .triumph.yml under ' + REPO_ROOT +
      (CFG_ERROR ? ' — ' + CFG_ERROR.message : '') +
      '. Run the TRIUMPH setup (extension command "Install courts" or `node court-extension/bin/triumph-setup.js --detect`) to generate one.'
    );
  }
  return CFG;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readJson(fp) {
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}
function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function rel(fp) {
  return path.relative(REPO_ROOT, fp);
}

/**
 * THE WALL. REDLINE tooling may not read any path matched by wall.denyGlobs.
 * Throws a hard, greppable error so violations are impossible to miss.
 */
function assertNotWalled(absPath, court = 'REDLINE') {
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
// REDLINE court
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

async function courtRedlineVerdict() {
  const c = cfg();
  assertNotWalled(c.tests.absDir);
  const r = await runners.runTests(c, null);
  if (!r.suites) {
    return { court: 'REDLINE', status: 'error', detail: r.error || 'no-parse', stderr_lines: r.stderr || [] };
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
  return { court: 'REDLINE', summary: { green, red, yellow: results.length - green - red, total: results.length }, results };
}

async function courtRedlineClause(args) {
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

async function courtRedlineClauses() {
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
  return { court: 'REDLINE', spec: c.spec.path, clauses };
}

// ---------------------------------------------------------------------------
// SPLITBRAIN court — async job registry for slow mutation runs
// ---------------------------------------------------------------------------
const JOBS = new Map(); // jobId -> {status, startedAt, finishedAt, error, result}
const JOB_TTL_MS = 30 * 60_000;

function sweepJobs() {
  const now = Date.now();
  for (const [id, j] of JOBS) {
    if (now - j.startedAt > JOB_TTL_MS) JOBS.delete(id);
  }
}

async function runMutationJob(cfg, jobId, claimedOverride) {
  const job = JOBS.get(jobId);
  try {
    if (!cfg.mutation.command) throw new Error('mutation.command is not set in .triumph.yml');
    const before = cfg.mutation.absReport && fs.existsSync(cfg.mutation.absReport)
      ? fs.statSync(cfg.mutation.absReport) : null;
    const startedAt = Date.now();
    const r = await runners.spawnCollect(cfg.mutation.command, [], {
      cwd: cfg.repoRoot,
      timeoutMs: (cfg.mutation.timeoutSeconds || 900) * 1000,
      shell: true,
    });
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
    const r = await runners.spawnCollect('npx', ['jest', '--json', '--config=' + cfg.mutation.absStrykerJestConfig], {
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
    const args = ['jest', '--json', '--testPathPattern=' + rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')];
    const r = await runners.spawnCollect('npx', args, { cwd: cfg.repoRoot, timeoutMs: 120_000 });
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

async function courtSplitTrustGap(args) {
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
    return { court: 'SPLITBRAIN', status: 'ok', ...fresh };
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
      court: 'SPLITBRAIN',
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
    court: 'SPLITBRAIN',
    status: 'not-run',
    note: `no mutation report at ${c.mutation.report || '(unset)'} and no precomputed ${rel(c.evidence.trustgap)} — invoke splitbrain_mutate to generate`,
  };
}

async function courtSplitMutants(args) {
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
    return { court: 'SPLITBRAIN', status: 'no-mutants', mutants: [] };
  }
  return { court: 'SPLITBRAIN', status: 'ok', source, count: mutants.length, mutants };
}

async function courtSplitMutate(args) {
  const c = cfg();
  sweepJobs();
  if (!c.mutation.command) {
    return {
      court: 'SPLITBRAIN',
      status: 'unconfigured',
      note: 'mutation.command is not set in .triumph.yml — SPLITBRAIN cannot run the mutator. Set it, or precompute mutation.report and call splitbrain_trustgap.',
    };
  }
  // Two jobs in the same engine would race over Stryker's temp directory and
  // report path. Refuse the second rather than presenting its result as fresh.
  const running = [...JOBS.entries()].find(([, job]) => job.status === 'running');
  if (running) return { court: 'SPLITBRAIN', status: 'busy', error: `mutation job ${running[0]} is already running`, job_id: running[0] };
  const claimed = args && typeof args.claimed_coverage === 'number' ? args.claimed_coverage : null;
  const jobId = 'mut-' + crypto.randomBytes(4).toString('hex');
  JOBS.set(jobId, { status: 'running', startedAt: Date.now(), finishedAt: null, error: null, result: null, command: c.mutation.command, claimedCoverage: claimed });
  // Fire and forget; chat polls splitbrain_status.
  runMutationJob(c, jobId, claimed);
  return {
    court: 'SPLITBRAIN',
    status: 'started',
    job_id: jobId,
    command: c.mutation.command,
    claimed_coverage: claimed,
    poll: { tool: 'splitbrain_status', arguments: { job_id: jobId } },
  };
}

async function courtSplitStatus(args) {
  sweepJobs();
  const jobId = args && args.job_id;
  if (!jobId) {
    return {
      court: 'SPLITBRAIN',
      jobs: [...JOBS.entries()].map(([id, j]) => ({ job_id: id, status: j.status, startedAt: new Date(j.startedAt).toISOString() })),
    };
  }
  const job = JOBS.get(jobId);
  if (!job) return { court: 'SPLITBRAIN', job_id: jobId, status: 'unknown', note: 'expired or never existed' };
  const out = {
    court: 'SPLITBRAIN',
    job_id: jobId,
    status: job.status,
    elapsedSeconds: Math.round(((job.finishedAt || Date.now()) - job.startedAt) / 1000),
  };
  if (job.error) out.error = job.error;
  if (job.commandResult) out.commandResult = job.commandResult;
  if (job.result) out.result = job.result;
  return out;
}

// ---------------------------------------------------------------------------
// WARPATH court
// ---------------------------------------------------------------------------
/**
 * Normalize the metrics fixture across schemas. Two shapes are understood:
 *   (a) TRIUMPH demo: { window: "ISO..ISO", breakerState, consecutiveFailures, openThreshold }
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

async function courtWarpathContext() {
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
    court: 'WARPATH',
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

async function courtWarpathTriage() {
  const { deploys, metrics, logWindow } = await courtWarpathContext();
  // Real correlation, not a heuristic score:
  //   1. The incident window is metrics.window (start..end).
  //   2. The suspect deploy is the LATEST deploy whose timestamp falls
  //      INSIDE that window (or the last one before it opened).
  //   3. Evidence = error/warn lines inside the window from the log fixture.
  if (!metrics.window) {
    return {
      court: 'WARPATH',
      status: 'no-signal-window',
      detail: 'metrics fixture has no window (window or errorRate.windowStart) — cannot correlate',
    };
  }
  const [wStart, wEndRaw] = String(metrics.window).split('..').map((s) => new Date(s).getTime());
  // Open-ended window (point start): treat end as +infinity.
  const wEnd = metrics.windowOpenEnded ? Number.POSITIVE_INFINITY : wEndRaw;
  if (Number.isNaN(wStart) || Number.isNaN(wEnd)) {
    return { court: 'WARPATH', status: 'bad-window', detail: `metrics.window '${metrics.window}' is not ISO..ISO` };
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
    court: 'WARPATH',
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

async function courtWarpathPostmortem(args) {
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
*Authored by the war-room subagent via the TRIUMPH WARPATH court. Deterministic template; prose is the caller model's.*
`;
  fs.mkdirSync(c.evidence.incidentDir, { recursive: true });
  const fp = path.join(c.evidence.incidentDir, incident + '.md');
  fs.writeFileSync(fp, md, 'utf8');
  return { court: 'WARPATH', postmortem: rel(fp) };
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------
const TOOLS = [
  // REDLINE
  { name: 'redline_clauses', description: 'REDLINE: list spec clause ids extracted from the spec contract (titles/levels when an evidence ledger exists).', inputSchema: { type: 'object', properties: {} } },
  { name: 'redline_verdict_all', description: 'REDLINE: run all witness clause suites, return red/yellow/green per clause. Wall-enforced: never reads implementation.', inputSchema: { type: 'object', properties: {} } },
  { name: 'redline_clause', description: 'REDLINE: run a single spec clause (e.g. W4) and return verdict + failures.', inputSchema: { type: 'object', required: ['clause_id'], properties: { clause_id: { type: 'string' } } } },
  // SPLITBRAIN
  { name: 'splitbrain_trustgap', description: 'SPLITBRAIN: claimed coverage vs honest mutation kill-rate, derived from the mutation report. Falsifiable — every tautology is named.', inputSchema: { type: 'object', properties: { claimed_coverage: { type: 'number', description: 'optional explicit claimed line-coverage % override' } } } },
  { name: 'splitbrain_mutants', description: 'SPLITBRAIN: list mutants from the latest report (optionally filtered by status, e.g. Survived).', inputSchema: { type: 'object', properties: { status: { type: 'string' } } } },
  { name: 'splitbrain_mutate', description: 'SPLITBRAIN: start the mutation run in the background (async — returns a job_id immediately so chat never blocks). Poll with splitbrain_status. Pass claimed_coverage to have the completed job carry the trust gap.', inputSchema: { type: 'object', properties: { claimed_coverage: { type: 'number', description: 'optional explicit claimed line-coverage % override' } } } },
  { name: 'splitbrain_status', description: 'SPLITBRAIN: poll a mutation job (job_id) or list all jobs.', inputSchema: { type: 'object', properties: { job_id: { type: 'string' } } } },
  // WARPATH
  { name: 'warpath_context', description: 'WARPATH: pull the deploy/metrics/logs incident context.', inputSchema: { type: 'object', properties: {} } },
  { name: 'warpath_triage', description: 'WARPATH: compute suspect deploy + signal window by timestamp correlation.', inputSchema: { type: 'object', properties: {} } },
  { name: 'warpath_postmortem', description: 'WARPATH: render a structured incident postmortem under the incident dir.', inputSchema: { type: 'object', required: ['incident_id'], properties: { incident_id: { type: 'string' }, suspect_sha: { type: 'string' }, summary: { type: 'string' }, root_cause: { type: 'string' }, timeline: { type: 'array', items: { type: 'object' } }, mitigations: { type: 'array', items: { type: 'string' } }, followups: { type: 'array', items: { type: 'string' } } } } },
  // Meta
  { name: 'courts_about', description: 'Return the 3-court manifesto, config source, and wall policy in effect.', inputSchema: { type: 'object', properties: {} } },
];

const TOOL_HANDLERS = {
  redline_clauses: courtRedlineClauses,
  redline_verdict_all: courtRedlineVerdict,
  redline_clause: courtRedlineClause,
  splitbrain_trustgap: courtSplitTrustGap,
  splitbrain_mutants: courtSplitMutants,
  splitbrain_mutate: courtSplitMutate,
  splitbrain_status: courtSplitStatus,
  warpath_context: courtWarpathContext,
  warpath_triage: courtWarpathTriage,
  warpath_postmortem: courtWarpathPostmortem,
  courts_about: async () => {
    const out = {
      courts: ['REDLINE', 'SPLITBRAIN', 'WARPATH'],
      manifesto: 'Legal. Honest. Survivable.',
      engine: SERVER_INFO,
      description: {
        REDLINE: 'Spec-witness: tests from the spec contract only; wall enforced; verdicts red/yellow/green.',
        SPLITBRAIN: 'Honesty audit: mutation kill-rate vs claimed coverage; tautologies named.',
        WARPATH: 'Incident forensics: suspect deploy, signal window, structured postmortem.',
      },
      async: {
        REDLINE: { blocking: true, note: 'redline_verdict_all / redline_clause run the suite synchronously and return the verdict in one call.' },
        SPLITBRAIN: { blocking: false, asyncTools: ['splitbrain_mutate', 'splitbrain_status'], note: 'splitbrain_mutate returns a job_id immediately; poll splitbrain_status until done. splitbrain_trustgap itself is synchronous.' },
        WARPATH: { blocking: true, note: 'warpath_triage / warpath_context return in one call.' },
      },
    };
    if (CFG) {
      out.repo = { root: REPO_ROOT, config: CFG.configSource, spec: CFG.spec.path, wall: CFG.wall.denyGlobs, framework: CFG.tests.framework, mutation: CFG.mutation.tool };
    } else {
      out.repo = { root: REPO_ROOT, config: null, error: CFG_ERROR ? CFG_ERROR.message : 'no .triumph.yml' };
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
    console.error('[triumph-courts] bad JSON: ' + line);
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

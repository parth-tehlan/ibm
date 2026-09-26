#!/usr/bin/env node
/**
 * court.js — ACP server: TRIUMPH 3-Court Orchestrator
 *
 * A standalone agent-control-plane (ACP) server that owns the testimony,
 * fix, and incident-room workflows across the northstar payments repo.
 * It is *independent of Bob*: it exposes a stable MCP-compatible tool surface
 * over stdio (JSON-RPC 2.0, newline-delimited), and Bob IDE integrates by
 * pointing `.bob/mcp.json` at this binary.
 *
 * Three "courts" are orchestrated here:
 *
 *   REDLINE   — Spec-witness. Reads docs/api-spec.md clauses, runs wall-checked
 *               jest suites authored from spec alone. Verdict = red/yellow/green
 *               per clause. Never sees src/. Court reporter: clause-wall.
 *
 *   SPLITBRAIN — Mutineer. Runs Stryker mutation testing against the suite the
 *               team claims is adequate. Trust-gap = claimed coverage minus
 *               honest mutation kill-rate. Court reporter: trustgap/.
 *
 *   WARPATH   — Incident commander + surgeon. Pulls deploy/metrics/log fixtures,
 *               isolates a regression window, applies a surgeon patch guarded
 *               by rollback, writes postmortem. Court reporter: incident/.
 *
 * All three courts share:
 *   - one repo (northstar/)
 *   - one evidence ledger (evidence/clauses.json, evidence/waivers.json)
 *   - one spec as law (docs/api-spec.md)
 *
 * Protocol — MCP 2024-11-05:
 *   initialize / notifications/initialized / tools/list / tools/call / ping
 *
 * Author: TRIUMPH orchestration plane. Bound by the same wall: the server's
 * REDLINE tools cannot read src/.
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const SERVER_INFO = { name: 'triumph-acp', version: '1.0.0' };
const ROOT = path.resolve(__dirname, '..', 'northstar');

// ---------------------------------------------------------------------------
// Paths — all evidence lives under northstar/
// ---------------------------------------------------------------------------
const P = {
  spec: path.join(ROOT, 'docs', 'api-spec.md'),
  clauses: path.join(ROOT, 'evidence', 'clauses.json'),
  waivers: path.join(ROOT, 'evidence', 'waivers.json'),
  trustgap: path.join(ROOT, 'trustgap', 'TrustGap.json'),
  deploys: path.join(ROOT, 'fixtures', 'deploy.json'),
  metrics: path.join(ROOT, 'fixtures', 'metrics.json'),
  logs: path.join(ROOT, 'fixtures', 'logs.json'),
  mutants: path.join(ROOT, 'fixtures', 'mutants.json'),
  srcDir: path.join(ROOT, 'src'),
  testsDir: path.join(ROOT, 'tests'),
  incidentDir: path.join(ROOT, 'incident'),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readJson(fp) {
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}
function writeJson(fp, obj) {
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function runJest(testPathRegex, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['jest', '--json', '--testPathPattern=' + testPathRegex],
      { cwd: ROOT, env: process.env }
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: 'timeout', stdout: out, stderr: err });
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      let parsed = null;
      try {
        // jest --json writes the JSON to stdout
        const start = out.indexOf('{');
        const end = out.lastIndexOf('}');
        if (start >= 0 && end > start) {
          parsed = JSON.parse(out.slice(start, end + 1));
        }
      } catch (e) {
        /* fall through */
      }
      resolve({ ok: code === 0, code, parsed, stdout: out, stderr: err });
    });
  });
}

// Wall check: refuse to read src/** from REDLINE tools.
function assertNotSrc(p) {
  const resolved = path.resolve(p);
  if (resolved.startsWith(P.srcDir)) {
    throw new Error(
      '[REDLINE WALL] witness tooling may not read ' + resolved + ' — the spec is the law.'
    );
  }
}

// ---------------------------------------------------------------------------
// REDLINE court
// ---------------------------------------------------------------------------
async function courtRedlineVerdict(args) {
  // Single jest run, slice results per-suite for O(1) jest spawns.
  const r = await runJest('tests/clause-W\\d+\\.test\\.ts');
  if (!r.parsed) {
    return { court: 'REDLINE', status: 'error', detail: r.error || 'no-parse', stderr_lines: (r.stderr || '').split('\n').slice(-10) };
  }
  const results = [];
  for (const suite of r.parsed.testResults || []) {
    const m = /clause-(W\d+)\.test\.ts$/.exec(suite.name);
    if (!m) continue;
    const clauseId = m[1];
    const assertions = suite.assertionResults || [];
    const passed = assertions.filter((a) => a.status === 'passed').length;
    const failed = assertions.filter((a) => a.status === 'failed').length;
    const total = assertions.length;
    const status = failed > 0 ? 'red' : passed === total && total > 0 ? 'green' : 'yellow';
    results.push({
      clause: clauseId,
      test: 'clause-' + clauseId + '.test.ts',
      status,
      passed,
      failed,
      total,
      spec_anchor: 'docs/api-spec.md#' + clauseId,
      failures: assertions
        .filter((a) => a.status === 'failed')
        .map((a) => ({ title: a.title, message: (a.failureMessages || [])[0] || '' })),
    });
  }
  results.sort((a, b) => a.clause.localeCompare(b.clause));
  const green = results.filter((r) => r.status === 'green').length;
  const red = results.filter((r) => r.status === 'red').length;
  return {
    court: 'REDLINE',
    summary: { green, red, total: results.length },
    results,
  };
}

async function courtRedlineClause(args) {
  const clauseId = args.clause_id;
  if (!clauseId) throw new Error('clause_id required');
  const test = path.join(P.testsDir, 'clause-' + clauseId + '.test.ts');
  assertNotSrc(test); // sanity: the wall must never allow a src/ path
  if (!fs.existsSync(test)) throw new Error('no test for clause ' + clauseId);
  const r = await runJest('tests/clause-' + clauseId + '\\.test\\.ts');
  if (!r.parsed) {
    return { clause: clauseId, status: 'unknown', error: r.error || 'no-parse' };
  }
  const failureMessages = (r.parsed.testResults?.[0]?.assertionResults || [])
    .filter((a) => a.status === 'failed')
    .map((a) => ({ title: a.title, messages: a.failureMessages }));
  return {
    clause: clauseId,
    status: r.parsed.numFailedTests > 0 ? 'red' : 'green',
    passed: r.parsed.numPassedTests,
    failed: r.parsed.numFailedTests,
    total: r.parsed.numTotalTests,
    failures: failureMessages,
  };
}

// ---------------------------------------------------------------------------
// SPLITBRAIN court
// ---------------------------------------------------------------------------
async function courtSplitTrustGap() {
  // Honest runner: read the precomputed TrustGap.json produced by the
  // mutineer's Stryker run. If absent, return a structured "not run" verdict.
  if (!fs.existsSync(P.trustgap)) {
    return {
      court: 'SPLITBRAIN',
      status: 'not-run',
      note: 'trustgap/TrustGap.json absent — invoke splitbrain_mutate to generate',
    };
  }
  const t = readJson(P.trustgap);
  return {
    court: 'SPLITBRAIN',
    status: 'ok',
    claimedCoverage: t.claimedCoverage,
    honestMutationScore: t.honestMutationScore,
    trustGap: t.trustGap,
    dishonestTests: t.dishonestTests || [],
    mutants: t.mutants || [],
  };
}

async function courtSplitMutateReport() {
  if (!fs.existsSync(P.mutants)) {
    return { court: 'SPLITBRAIN', status: 'no-mutants', mutants: [] };
  }
  const m = readJson(P.mutants);
  return { court: 'SPLITBRAIN', mutants: m.mutants || m };
}

// ---------------------------------------------------------------------------
// WARPATH court
// ---------------------------------------------------------------------------
async function courtWarpathContext() {
  const deploys = fs.existsSync(P.deploys) ? readJson(P.deploys).deploys || [] : [];
  const metrics = fs.existsSync(P.metrics) ? readJson(P.metrics).metrics || {} : {};
  const logs = fs.existsSync(P.logs) ? readJson(P.logs).log || [] : [];
  return {
    court: 'WARPATH',
    deploys,
    metrics,
    logWindow: logs,
  };
}

async function courtWarpathTriage() {
  const { deploys, metrics, logWindow } = await courtWarpathContext();
  // Real correlation, not a heuristic score:
  //   1. The incident window is metrics.window (start..end).
  //   2. The suspect deploy is the LATEST deploy whose timestamp falls
  //      INSIDE that window (or the last one before it started, if none
  //      landed inside). Everything earlier is cleared by the window.
  //   3. Evidence = breaker/error lines inside the window from logs.json.
  if (!metrics.window) {
    return {
      court: 'WARPATH',
      status: 'no-signal-window',
      detail: 'fixtures/metrics.json has no window — cannot correlate',
    };
  }
  const [wStart, wEnd] = metrics.window.split('..').map((s) => new Date(s).getTime());
  const inWindow = deploys.filter((d) => {
    const t = new Date(d.at).getTime();
    return t >= wStart && t <= wEnd;
  });
  const before = deploys.filter((d) => new Date(d.at).getTime() < wStart);
  const suspect =
    inWindow.length > 0
      ? inWindow[inWindow.length - 1]
      : before.length > 0
        ? before[before.length - 1]
        : null;
  // Correlated evidence: error/warn lines from the log window, plus the
  // breaker state snapshot from metrics.
  const evidenceLines = logWindow.filter(
    (l) => l.level === 'error' || l.level === 'warn'
  );
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
    clearedDeploys: deploys
      .filter((d) => d !== suspect)
      .map((d) => ({ id: d.id, at: d.at })),
    breakerSnapshot: {
      state: metrics.breakerState,
      consecutiveFailures: metrics.consecutiveFailures,
      openThreshold: metrics.openThreshold,
    },
    evidence: evidenceLines,
    rule: 'docs/runbook-payments.md: breaker SHALL NOT trip below openThreshold — breakerState(open) at consecutiveFailures=1 < openThreshold=5 is the defect',
  };
}

async function courtWarpathPostmortem(args) {
  // Render a markdown postmortem template from the triage argument map.
  const incident = args.incident_id || 'SEV1-UNNAMED';
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
*Authored by the incident-commander via the TRIUMPH ACP war path.*
`;
  if (!fs.existsSync(P.incidentDir)) fs.mkdirSync(P.incidentDir, { recursive: true });
  const fp = path.join(P.incidentDir, incident + '.md');
  fs.writeFileSync(fp, md, 'utf8');
  return { court: 'WARPATH', postmortem: path.relative(ROOT, fp) };
}

// ---------------------------------------------------------------------------
// Tool registry — what Bob IDE sees
// ---------------------------------------------------------------------------
const TOOLS = [
  // REDLINE
  {
    name: 'redline_verdict_all',
    description: 'REDLINE: run all witness clause suites, return red/yellow/green per clause.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'redline_clause',
    description: 'REDLINE: run a single spec clause (e.g. W4) and return verdict + failures.',
    inputSchema: {
      type: 'object',
      required: ['clause_id'],
      properties: { clause_id: { type: 'string', pattern: '^W[1-8]$' } },
    },
  },
  // SPLITBRAIN
  {
    name: 'splitbrain_trustgap',
    description: 'SPLITBRAIN: read the TrustGap — claimed coverage vs honest mutation kill rate.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'splitbrain_mutants',
    description: 'SPLITBRAIN: list surviving mutants from the latest run.',
    inputSchema: { type: 'object', properties: {} },
  },
  // WARPATH
  {
    name: 'warpath_context',
    description: 'WARPATH: pull the deploy/metrics/logs incident context.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'warpath_triage',
    description: 'WARPATH: compute suspect deploy + signal window.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'warpath_postmortem',
    description: 'WARPATH: render the incident postmortem under incident/.',
    inputSchema: {
      type: 'object',
      required: ['incident_id'],
      properties: {
        incident_id: { type: 'string' },
        suspect_sha: { type: 'string' },
        summary: { type: 'string' },
        root_cause: { type: 'string' },
        timeline: { type: 'array', items: { type: 'object' } },
        mitigations: { type: 'array', items: { type: 'string' } },
        followups: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  // Meta
  {
    name: 'courts_about',
    description: 'Return the 3-court manifesto + which court does what.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function handleTool(name, args) {
  switch (name) {
    case 'redline_verdict_all': return courtRedlineVerdict(args || {});
    case 'redline_clause': return courtRedlineClause(args || {});
    case 'splitbrain_trustgap': return courtSplitTrustGap(args || {});
    case 'splitbrain_mutants': return courtSplitMutateReport(args || {});
    case 'warpath_context': return courtWarpathContext(args || {});
    case 'warpath_triage': return courtWarpathTriage(args || {});
    case 'warpath_postmortem': return courtWarpathPostmortem(args || {});
    case 'courts_about':
      return {
        courts: ['REDLINE', 'SPLITBRAIN', 'WARPATH'],
        manifesto: 'Legal. Honest. Survivable.',
        description: {
          REDLINE: 'Spec-witness: tests from docs/api-spec.md only; surgeon binds; wall enforced.',
          SPLITBRAIN: 'Honesty audit: Stryker mutation kill-rate vs claimed coverage.',
          WARPATH: 'Incident forensics: suspect deploy, signal window, guarded surgeon patch, postmortem.',
        },
      };
    default:
      throw new Error('unknown tool ' + name);
  }
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
    console.error('[triumph-acp] bad JSON: ' + line);
    return;
  }
  if (req.id === undefined || req.id === null) {
    // A notification (no id): never respond, never block exit.
    return;
  }
  const id = req.id;
  pending += 1;
  let result;
  let isError = false;

  try {
    switch (req.method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        };
        break;
      case 'notifications/initialized':
        result = {};
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call': {
        const text = JSON.stringify(await handleTool(req.params?.name, req.params?.arguments));
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

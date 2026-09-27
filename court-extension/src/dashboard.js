'use strict';
/**
 * src/dashboard.js — VS Code dashboard integration.
 *
 * One DashboardServer child outlives individual runs so its URL stays
 * reachable, and multiple projects (multi-root windows) ride the same child
 * with separate credentials. One DashboardClient per project stays alive for
 * the extension session: it serves unsolicited runs (the dashboardRun
 * command) AND continuously polls for browser "Run again" requests, routing
 * each through the court workflow. Failures publish truthful error evidence
 * — never fabricated success. Git provenance is read from the repo (async,
 * null-safe). Heartbeats run inside the client at 10s, including during long
 * court collections. Cross-platform run ownership (Linux /proc, macOS/BSD
 * ps, Windows powershell) is enforced by the server's history layer.
 *
 * Compatibility surface: ensureSession/stopSession/isConnected alias the
 * multi-project startSession/stopAll so the extension host's status bar and
 * clean-shutdown paths keep working unchanged.
 *
 * Raw offline artifacts (triumph-input.json/html/md) are untouched — the
 * dashboard run is an additional, separate artifact.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { DashboardClient, DashboardServer } = require('../lib/dashboard');
const { projectId, toSnapshot } = require('../lib/convert');
const { loadConfig, findConfigFile } = require('../lib/config');
const { McpClient } = require('./mcp-client');

const PRODUCER = { name: 'triumph-courts', version: require('../package.json').version };
const ALL = ['redline', 'splitbrain', 'warpath'];

// --- shared child + per-project sessions -------------------------------------
let sharedServer = null; // one DashboardServer child serves every project
let closingServer = null; // in-flight stop of a replaced child
let stopping = false; // set while stopAll drains everything
const sessions = new Map(); // projectId -> Promise<session>

// --- connection-change notification (no polling; contract D) ----------------
const connectionListeners = new Set();

/** Register a listener called with isConnected()'s current value whenever
 *  the dashboard connection state may have changed. Never throws into
 *  dashboard control flow — each listener runs in its own try/catch. */
function onConnectionChange(fn) {
  connectionListeners.add(fn);
  return { dispose() { connectionListeners.delete(fn); } };
}

function notifyConnection() {
  let connected;
  try { connected = isConnected(); } catch { return; }
  for (const fn of connectionListeners) {
    try { fn(connected); } catch { /* listener errors must never propagate */ }
  }
}

/** Canonical workspace URI → stable project {id,name}.
 *  Uses the actual selected folder (realpath'd), never workspaceFolders[0]
 *  by accident in a multi-root window. */
function projectFor(_vscode, root) {
  const canonical = fs.realpathSync(root);
  return { id: projectId(require('url').pathToFileURL(canonical).href), name: path.basename(canonical) };
}

/** Read git provenance from the repo (null-safe; never throws).
 *  A clean tree is a real answer: workingTreeDirty=false, not null. */
function gitProvenance(root) {
  const run = (args) => new Promise((res) => {
    execFile('git', args, { cwd: root, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
      (e, out) => res(e ? null : String(out).trim()));
  });
  return (async () => {
    const [commit, branch, status] = await Promise.all([
      run(['rev-parse', 'HEAD']),
      run(['rev-parse', '--abbrev-ref', 'HEAD']),
      run(['status', '--porcelain']),
    ]);
    return {
      checkedOutCommit: commit || null,
      branch: !branch || branch === 'HEAD' ? null : branch, // detached or failed → null
      workingTreeDirty: status === null ? null : status.length > 0, // clean ('' ) → false
    };
  })();
}

/**
 * Preflight: decide which courts are *able* to run. A court is 'unavailable'
 * when a verified precondition is absent — never run it and call it a pass.
 * Returns { runnable, reasons, cfg }.
 */
function preflight(root) {
  const reasons = {};
  let cfg;
  try {
    if (!findConfigFile(root)) throw new Error('No TRIUMPH configuration found');
    cfg = loadConfig(root);
  } catch (e) {
    for (const court of ALL) reasons[court] = `Invalid TRIUMPH configuration: ${e.message}`;
    return { runnable: [], reasons };
  }
  if (!fs.existsSync(cfg.spec.absPath)) reasons.redline = 'spec.path missing';
  if (!fs.existsSync(cfg.tests.absDir)) reasons.redline = 'tests.dir missing';
  if (!(cfg.mutation.absReport && fs.existsSync(cfg.mutation.absReport)) &&
      !fs.existsSync(cfg.evidence.trustgap) && !cfg.mutation.command) {
    reasons.splitbrain = 'no mutation report, TrustGap ledger or mutation command';
  }
  if (!cfg.fixtures.metrics || !fs.existsSync(cfg.fixtures.metrics)) reasons.warpath = 'metrics fixture missing';
  else if (!cfg.fixtures.deploys || !fs.existsSync(cfg.fixtures.deploys)) reasons.warpath = 'deploy fixture missing';
  const runnable = ALL.filter((c) => !reasons[c]);
  return { runnable, reasons, cfg };
}

/** Classify a court's engine payload as complete/unavailable/error evidence. */
function outcome(court, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { kind: 'error', errors: ['Engine returned no object evidence'] };
  if (court === 'redline' && (payload.status === 'error' || !Array.isArray(payload.results))) {
    return { kind: 'error', errors: [String(payload.detail || 'REDLINE produced no verdicts')], payload };
  }
  if (court === 'splitbrain' && payload.status !== 'ok') return {
    kind: payload.status === 'not-run' || payload.status === 'unconfigured' ? 'unavailable' : 'error',
    errors: [String(payload.note || payload.error || `SPLITBRAIN status: ${payload.status || 'missing'}`)], payload,
  };
  if (court === 'warpath' && (payload.status || !payload.incidentWindow)) return {
    kind: payload.status === 'no-signal-window' ? 'unavailable' : 'error',
    errors: [String(payload.detail || `WARPATH status: ${payload.status || 'missing incident window'}`)], payload,
  };
  return { kind: 'complete', payload };
}

/** Collect the requested courts from the engine. Returns { court: outcome }.
 *  A configured mutation command makes a rerun fresh; without one, the
 *  precomputed report/ledger is shown as evidence (never pretend it reran). */
async function collectCourts(client, root, requested, reasons, cfg, signal) {
  const outcomes = {};
  for (const court of ALL) {
    if (!requested.includes(court)) { outcomes[court] = { kind: 'not_run' }; continue; }
    if (reasons[court]) { outcomes[court] = { kind: 'unavailable', errors: [reasons[court]] }; continue; }
    if (signal?.aborted) { outcomes[court] = { kind: 'error', errors: ['Extension stopped'] }; continue; }
    try {
      let payload;
      if (court === 'redline') payload = await client.call('redline_verdict_all');
      else if (court === 'warpath') payload = await client.call('warpath_triage');
      else {
        if (cfg.mutation.command) {
          const startedAt = Date.now();
          const started = await client.call('splitbrain_mutate');
          if (started.status !== 'started' || !started.job_id) { outcomes[court] = outcome(court, started); continue; }
          const deadline = Date.now() + (cfg.mutation.timeoutSeconds || 900) * 1000 + 10_000;
          let status;
          do {
            if (signal?.aborted) throw new Error('Extension stopped');
            if (Date.now() > deadline) throw new Error('Mutation job timed out');
            await new Promise((resolve) => setTimeout(resolve, 1000));
            status = await client.call('splitbrain_status', { job_id: started.job_id });
          } while (status.status === 'running');
          if (status.status !== 'done') { outcomes[court] = { kind: 'error', errors: [String(status.error || `Mutation status: ${status.status}`)], payload: status }; continue; }
          if (!cfg.mutation.absReport || !fs.existsSync(cfg.mutation.absReport) ||
              fs.statSync(cfg.mutation.absReport).mtimeMs < startedAt - 2000) {
            outcomes[court] = { kind: 'error', errors: ['Mutation finished without a fresh report'], payload: status }; continue;
          }
        }
        payload = await client.call('splitbrain_trustgap');
      }
      outcomes[court] = outcome(court, payload);
    } catch (e) { outcomes[court] = { kind: 'error', errors: [String(e.message || e)] }; }
  }
  return outcomes;
}

/** Run the requested courts and publish a complete snapshot via the session. */
async function execute(session, requested, existingRun, openExternal) {
  const { root, enginePath, dash, project, controller } = session;
  const { reasons, cfg } = preflight(root);
  const client = new McpClient(enginePath, root);
  let outcomes;
  try {
    // Preflight failures are evidence of unavailability, not a passing court.
    if (ALL.some((c) => requested.includes(c) && !reasons[c])) await client.start();
    outcomes = await collectCourts(client, root, requested, reasons, cfg, controller.signal);
  } catch (e) {
    outcomes = Object.fromEntries(ALL.map((c) => [c, requested.includes(c)
      ? { kind: 'error', errors: [String(e.message || e)] } : { kind: 'not_run' }]));
  } finally { client.dispose(); }
  if (controller.signal.aborted) throw new Error('Dashboard disconnected before the run could be published');
  const now = new Date().toISOString();
  const runId = existingRun?.runId || crypto.randomUUID();
  const snap = toSnapshot({ projectId: project.id, projectName: project.name, runId,
    createdAt: existingRun?.createdAt || now, revision: existingRun ? 1 : 0,
    state: 'complete', ...(await gitProvenance(root)), producer: PRODUCER }, outcomes, now);
  const stored = await dash.publish(snap);
  const url = dash.runUrl(stored.runId);
  if (openExternal) await openExternal(url);
  return { runId: stored.runId, url, outcomes };
}

/**
 * Ensure a session-scoped dashboard client is up for this workspace, with
 * continuous "Run again" polling. Reuses an existing session for the same
 * project; a new project joins the same shared child with its own
 * credentials. `ensureSession` is the compatibility alias.
 */
async function startSession(vscode, { root, enginePath, historyDir, onError, pollIntervalMs = 2000 }) {
  if (closingServer) await closingServer;
  if (stopping) throw new Error('Dashboard is stopping');
  const project = projectFor(vscode, root);
  if (sessions.has(project.id)) return sessions.get(project.id);
  if (!sharedServer) {
    const server = new DashboardServer({ historyDir });
    sharedServer = server;
    const gone = () => {
      if (sharedServer !== server) return;
      sharedServer = null;
      // A disconnected IPC pipe can leave the HTTP listener alive. Terminate
      // it before a replacement can recover the same history directory.
      const closing = server.stop();
      closingServer = closing;
      closing.finally(() => { if (closingServer === closing) closingServer = null; }).catch(() => {});
      for (const [id, pending] of sessions) {
        pending.then((s) => {
          clearInterval(s.timer);
          s.controller.abort();
          if (sessions.get(id) === pending) sessions.delete(id);
          if (!s.stopping && !stopping) s.onError?.(new Error('Dashboard server exited; run the command again to reconnect'));
        }, () => { if (sessions.get(id) === pending) sessions.delete(id); });
      }
      notifyConnection();
    };
    // A broken IPC channel is as fatal as a process exit for registration.
    server.start().then(() => {
      server.child.once('exit', gone);
      server.child.once('disconnect', gone);
      server.child.once('error', gone);
    }, () => { if (sharedServer === server) sharedServer = null; });
  }
  const session = { root, enginePath, project, onError, controller: new AbortController(), busy: false };
  // Reserve synchronously so concurrent commands never register duplicate children.
  const promise = (async () => {
    const dash = new DashboardClient({ project, server: sharedServer, onError });
    session.dash = dash;
    try {
      await dash.start();
      session.timer = setInterval(() => {
        if (session.busy || session.controller.signal.aborted) return;
        session.busy = true;
        (async () => {
          const request = await dash.poll();
          if (!request) return;
          if (request.projectId !== project.id || !Array.isArray(request.courts) ||
              !request.courts.length || request.courts.some((c) => !ALL.includes(c))) throw new Error('Invalid dashboard request');
          await dash.acknowledge(request.requestId);
          try { await execute(session, request.courts, request, null); }
          catch (e) {
            if (!session.controller.signal.aborted && dash.connected) {
              // Truthful failure: submit an errored run rather than fabricate success.
              const now = new Date().toISOString();
              const courts = Object.fromEntries(ALL.map((c) => [c, request.courts.includes(c)
                ? { kind: 'error', errors: [String(e.message || e)] } : { kind: 'not_run' }]));
              await dash.publish(toSnapshot({ projectId: project.id, projectName: project.name,
                runId: request.runId, createdAt: request.createdAt, revision: 1, state: 'complete',
                producer: PRODUCER }, courts, now));
              onError?.(e);
              return; // Error evidence is durable; preserve the connection.
            }
            throw e;
          }
        })().catch(async (e) => {
           onError?.(e);
           // A failed error publication must not strand an accepted request.
           if (!session.controller.signal.aborted) await dash.abandonRun();
         }).finally(() => { session.busy = false; });
      }, pollIntervalMs);
      notifyConnection();
      return session;
    } catch (e) { await dash.stop(); if (sessions.get(project.id) === promise) sessions.delete(project.id); throw e; }
  })();
  sessions.set(project.id, promise);
  return promise;
}
const ensureSession = startSession;

/** Stop every session and the shared child. Safe and idempotent with none. */
async function stopAll() {
  stopping = true;
  const server = sharedServer;
  sharedServer = null;
  const pending = [...sessions.values()];
  sessions.clear();
  try {
    await Promise.all(pending.map(async (p) => {
      const s = await p.catch(() => null);
      if (!s) return;
      s.stopping = true;
      s.controller.abort();
      clearInterval(s.timer);
      await s.dash.stop();
    }));
  } finally {
    try { await server?.stop(); await closingServer; } finally { stopping = false; }
  }
  notifyConnection();
}
const stopSession = stopAll;

/** True while a session is live on a connected child (status bar hint). */
function isConnected() {
  return !stopping && !!sharedServer?.child?.connected && sessions.size > 0;
}

/**
 * Command entry: run all courts (or a browser-driven subset) and publish.
 * Keeps the dashboard session alive afterward so browser "Run again" works.
 */
async function runAndPublish(vscode, opts) {
  const selected = opts.requested || ALL;
  if (!Array.isArray(selected) || !selected.length || selected.some((c) => !ALL.includes(c)) || new Set(selected).size !== selected.length) throw new Error('Invalid court selection');
  const session = await startSession(vscode, opts);
  if (session.busy) throw new Error('TRIUMPH run already in progress');
  session.busy = true;
  try { return await execute(session, selected, opts.existingRun, opts.openExternal); }
  finally { session.busy = false; }
}

module.exports = { runAndPublish, startSession, ensureSession, stopAll, stopSession,
  isConnected, onConnectionChange, preflight, projectFor, collectCourts, outcome, gitProvenance };

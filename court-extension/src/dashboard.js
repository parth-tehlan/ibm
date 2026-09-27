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
 * Raw offline artifacts (gaia-input.json/html/md) are untouched — the
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

const PRODUCER = { name: 'gaia-courts', version: require('../package.json').version };
const ALL = ['witness', 'trustgap', 'triage'];

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

// Execution, preflight and freshness are owned by the same coordinator as the
// sidebar and command adapters. These aliases preserve existing public tests.
const coordinator = require('./run-coordinator');
const { preflight, collectCourts, outcome, gitProvenance } = coordinator;

async function execute(session, requested, existingRun, openExternal) {
  const result = await coordinator.runCourt({root: session.root, enginePath: session.enginePath,
    vscode: session.vscode, historyDir: session.historyDir,
    onMutationProgress(jobId, event, signal, runId) {
      const runKey = `${session.project.id}:${runId}`;
      const child = sharedServer && sharedServer.child;
      try {
        if (child?.connected) child.send(signal === 'done'
          ? {type: 'gaia.mutationDone', runKey, status: 'done', error: null}
          : {type: 'gaia.mutationProgress', runKey, event});
        if (session.historyDir) {
          const dir = path.join(session.historyDir, 'mutation-events');
          fs.mkdirSync(dir, {recursive: true});
          fs.appendFileSync(path.join(dir, runKey.replace(/[^A-Za-z0-9-]/g, '_') + '.jsonl'), JSON.stringify({type: signal === 'done' ? 'done' : 'progress', event, ts: Date.now()}) + '\n');
        }
      } catch { /* progress transport must not affect evidence */ }
    }
  }, {courts: requested.map(c => c.toUpperCase()), trigger: existingRun ? 'dashboard' : 'command',
    runId: existingRun?.runId, requestId: existingRun?.requestId,
    publishToDashboard: true, session, existingRun});
  if (result.publicationError) throw new Error(result.publicationError);
  if (openExternal) await openExternal(result.dashboardUrl);
  return {runId: result.runId, url: result.dashboardUrl, outcomes: coordinator.legacyOutcomes(result.run), run: result.run, runRecord: result.run, report: result.report};
}

/** Transport-only API. It must NEVER call the MCP engine. Strict snapshot-v2
 * fields are produced exclusively through the existing converter. */
async function publishEvidence(vscode, opts) {
  const session = opts.session || await startSession(vscode, opts);
  const {run} = opts;
  if (session.controller.signal.aborted) throw new Error('Dashboard disconnected before publication');
  if (session.project.id !== run.workspaceId) throw new Error('Run belongs to another workspace');
  const now = new Date().toISOString();
  const snap = toSnapshot({projectId: session.project.id, projectName: session.project.name,
    runId: run.runId, createdAt: opts.existingRun?.createdAt || run.startedAt,
    revision: opts.existingRun ? 1 : 0, state: run.lifecycle === 'interrupted' ? 'interrupted' : 'complete',
    ...run.provenance, producer: PRODUCER}, coordinator.legacyOutcomes(run), now);
  // Preserve source collection times rather than turning retry time into freshness.
  for (const c of ALL) {
    const original = run.courts[c.toUpperCase()];
    snap[c].collectedAt = original.collectedAt;
    snap[c].sourceGeneratedAt = original.sourceGeneratedAt;
  }
  const stored = await session.dash.publish(snap);
  return {runId: stored.runId, url: session.dash.runUrl(stored.runId)};
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
  const session = { root: fs.realpathSync(root), enginePath, vscode, project, onError, controller: new AbortController(), busy: false, historyDir };
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
              !request.courts.length || new Set(request.courts).size !== request.courts.length || request.courts.some((c) => !ALL.includes(c))) throw new Error('Invalid dashboard request');
          await dash.acknowledge(request.requestId);
          try { await execute(session, request.courts, request, null); }
          catch (e) {
            if (!session.controller.signal.aborted && dash.connected) {
              // A saved run already contains the real (possibly partial) evidence.
              // Never overwrite it with a generic transport error snapshot.
              try { coordinator.readRun(root, request.runId); await dash.abandonRun(); onError?.(e); return; }
              catch (readError) { if (readError.code !== 'NOT_FOUND') throw readError; }
              // Rejected-before-execution requests still get durable error evidence.
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
  if (session.busy) throw new Error('Gaia run already in progress');
  session.busy = true;
  try { return await execute(session, selected, opts.existingRun, opts.openExternal); }
  finally { session.busy = false; }
}

module.exports = { publishEvidence, runAndPublish, startSession, ensureSession, stopAll, stopSession,
  isConnected, onConnectionChange, preflight, projectFor, collectCourts, outcome, gitProvenance };

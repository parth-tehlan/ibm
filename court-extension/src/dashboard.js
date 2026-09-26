'use strict';
// Persistent editor-owned dashboard session. The child must outlive individual runs
// so its URL remains reachable and browser rerun requests can be serviced.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { DashboardClient, DashboardServer } = require('../lib/dashboard');
let sharedServer = null;
let closingServer = null;
let stopping = false;
const { projectId, toSnapshot } = require('../lib/convert');
const { loadConfig, findConfigFile } = require('../lib/config');
const { McpClient } = require('./mcp-client');

const PRODUCER = { name: 'triumph-courts', version: require('../package.json').version };
const ALL = ['redline', 'splitbrain', 'warpath'];
const sessions = new Map();

function projectFor(_vscode, root) {
  // The actual selected folder, not workspaceFolders[0] in a multi-root window.
  const canonical = fs.realpathSync(root);
  return { id: projectId(require('url').pathToFileURL(canonical).href), name: path.basename(canonical) };
}

function preflight(root) {
  const reasons = {};
  let cfg;
  try {
    if (!findConfigFile(root)) throw new Error('No TRIUMPH configuration found');
    cfg = loadConfig(root);
  } catch (e) {
    for (const court of ALL) reasons[court] = `Invalid TRIUMPH configuration: ${e.message}`;
    return { reasons };
  }
  if (!fs.existsSync(cfg.tests.absDir)) reasons.redline = 'tests.dir missing';
  if (!(cfg.mutation.absReport && fs.existsSync(cfg.mutation.absReport)) &&
      !fs.existsSync(cfg.evidence.trustgap) && !cfg.mutation.command) {
    reasons.splitbrain = 'no mutation report, TrustGap ledger or mutation command';
  }
  if (!cfg.fixtures.metrics || !fs.existsSync(cfg.fixtures.metrics)) reasons.warpath = 'metrics fixture missing';
  else if (!cfg.fixtures.deploys || !fs.existsSync(cfg.fixtures.deploys)) reasons.warpath = 'deploy fixture missing';
  return { reasons, cfg };
}

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
        // A configured command makes a rerun fresh. Without one, show the
        // precomputed report/ledger as evidence (never pretend it was rerun).
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

function gitProvenance(root) {
  const git = (...args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  const commit = git('rev-parse', '--verify', 'HEAD');
  return { checkedOutCommit: commit, branch: commit ? git('symbolic-ref', '--quiet', '--short', 'HEAD') : null,
    workingTreeDirty: commit ? !!git('status', '--porcelain', '--untracked-files=normal') : null };
}

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
    state: 'complete', ...gitProvenance(root), producer: PRODUCER }, outcomes, now);
  const stored = await dash.publish(snap);
  const url = dash.runUrl(stored.runId);
  if (openExternal) await openExternal(url);
  return { runId: stored.runId, url, outcomes };
}

async function startSession(vscode, { root, enginePath, historyDir, onError, pollIntervalMs = 1000 }) {
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
      return session;
    } catch (e) { await dash.stop(); if (sessions.get(project.id) === promise) sessions.delete(project.id); throw e; }
  })();
  sessions.set(project.id, promise);
  return promise;
}

async function runAndPublish(vscode, opts) {
  const selected = opts.requested || ALL;
  if (!Array.isArray(selected) || !selected.length || selected.some((c) => !ALL.includes(c)) || new Set(selected).size !== selected.length) throw new Error('Invalid court selection');
  const session = await startSession(vscode, opts);
  if (session.busy) throw new Error('TRIUMPH run already in progress');
  session.busy = true;
  try { return await execute(session, selected, opts.existingRun, opts.openExternal); }
  finally { session.busy = false; }
}

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
}

function isConnected() {
  return sessions.size > 0 && !!(sharedServer && sharedServer.child && sharedServer.child.connected);
}

// Compatibility with the extension's public session lifecycle. stopAll safely
// closes every live project in a multi-root window.
const ensureSession = startSession;
const stopSession = stopAll;
module.exports = { runAndPublish, startSession, ensureSession, stopAll, stopSession, isConnected,
  preflight, projectFor, collectCourts, outcome, gitProvenance };

'use strict';
/**
 * src/dashboard.js — VS Code dashboard integration.
 *
 * One DashboardClient stays alive for the extension session (module-level
 * singleton). It serves unsolicited runs (the dashboardRun command) AND
 * continuously polls for browser "Run again" requests, routing each through
 * the court workflow. Git provenance is read from the repo. Heartbeats run
 * inside the client at 10s, including during long court collections.
 *
 * Raw offline artifacts (triumph-input.json/html/md) are untouched — the
 * dashboard run is an additional, separate artifact.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { DashboardClient } = require('../lib/dashboard');
const { projectId, toSnapshot } = require('../lib/convert');
const { McpClient } = require('./mcp-client');

const PRODUCER = { name: 'triumph-courts', version: require('../package.json').version };
const ALL = ['redline', 'splitbrain', 'warpath'];

// --- session singleton -------------------------------------------------------
let _session = null; // { dash, project, root, enginePath, polling, stopPolling }

/** Canonical workspace URI → stable project {id,name}. */
function projectFor(vscode, root) {
  const folders = vscode.workspace.workspaceFolders || [];
  const uri = (folders[0] && folders[0].uri && folders[0].uri.toString()) || `file://${root}`;
  return { id: projectId(uri), name: path.basename(root) };
}

/** Read git provenance from the repo (null-safe; never throws). */
function gitProvenance(root) {
  const run = (args) => new Promise((res) => {
    execFile('git', args, { cwd: root }, (e, out) => res(e ? null : String(out).trim() || null));
  });
  return (async () => {
    const [commit, branch, status] = await Promise.all([
      run(['rev-parse', 'HEAD']),
      run(['rev-parse', '--abbrev-ref', 'HEAD']),
      run(['status', '--porcelain']),
    ]);
    return {
      checkedOutCommit: commit,
      branch: branch === 'HEAD' ? null : branch, // detached → null branch
      workingTreeDirty: status === null ? null : status.length > 0,
    };
  })();
}

/** Preflight: which courts can run; a court is 'unavailable' when a verified precondition is absent. */
function preflight(root) {
  const cfg = readTriumphConfig(root);
  const reasons = {};
  const runnable = [];
  if (!cfg.specPath || !fs.existsSync(path.join(root, cfg.specPath))) reasons.redline = 'spec.path missing';
  else if (!cfg.testsDir || !fs.existsSync(path.join(root, cfg.testsDir))) reasons.redline = 'tests.dir missing';
  else runnable.push('redline');
  const hasReport = cfg.mutationReport && fs.existsSync(path.join(root, cfg.mutationReport));
  if (!cfg.mutationCommand && !hasReport) reasons.splitbrain = 'no mutation.command and no precomputed mutation.report';
  else runnable.push('splitbrain');
  const fx = ['fixtures/metrics.json', 'fixtures/deploy.json', 'fixtures/logs.json'].some((f) => fs.existsSync(path.join(root, f)));
  if (!fx) reasons.warpath = 'no incident fixtures (deploy/metrics/logs)';
  else runnable.push('warpath');
  return { runnable, reasons };
}

function readTriumphConfig(root) {
  const fp = path.join(root, '.triumph.yml');
  const out = { specPath: null, testsDir: null, mutationCommand: null, mutationReport: null };
  if (!fs.existsSync(fp)) return out;
  let y;
  try { y = fs.readFileSync(fp, 'utf8'); } catch { return out; }
  const grab = (re) => { const m = re.exec(y); return m ? m[1] : null; };
  out.specPath = grab(/path:\s*([^\s,}]+)/);
  out.testsDir = grab(/dir:\s*([^\s,}]+)/);
  out.mutationCommand = /command:\s*null/.test(y) ? null : grab(/command:\s*"?([^"\n]+?)"?\s*[,\n}]/);
  out.mutationReport = /report:\s*null/.test(y) ? null : grab(/report:\s*([^\s,}]+)/);
  return out;
}

/** Collect the requested courts from the engine. Returns { court: outcome }. */
async function collectCourts(client, root, requested, reasons) {
  const outcomes = {};
  for (const court of ALL) {
    if (!requested.includes(court)) { outcomes[court] = { kind: 'not_run' }; continue; }
    if (reasons[court]) { outcomes[court] = { kind: 'unavailable', errors: [reasons[court]] }; continue; }
    try {
      let payload;
      if (court === 'redline') payload = await client.call('redline_verdict_all');
      else if (court === 'splitbrain') payload = await client.call('splitbrain_trustgap');
      else payload = await client.call('warpath_triage');
      outcomes[court] = { kind: 'complete', payload };
    } catch (e) {
      outcomes[court] = { kind: 'error', errors: [String(e && e.message ? e.message : e)] };
    }
  }
  return outcomes;
}

/** Run the requested courts and publish a complete snapshot via the live session. */
async function runRequested(vscode, session, requested, existingRun) {
  const { root, enginePath } = session;
  const { reasons } = preflight(root);
  const client = new McpClient(enginePath, root);
  try {
    await client.start();
    const now = new Date().toISOString();
    const outcomes = await collectCourts(client, root, requested, reasons);
    const prov = await gitProvenance(root);
    const runId = existingRun ? existingRun.runId : crypto.randomUUID();
    const createdAt = existingRun ? existingRun.createdAt : now;
    const revision = existingRun ? existingRun.revision : 0;
    const snap = toSnapshot(
      { projectId: session.project.id, projectName: session.project.name, runId, createdAt, revision,
        state: 'complete', ...prov, producer: PRODUCER },
      outcomes, new Date().toISOString()
    );
    const stored = await session.dash.publish(snap);
    return { runId: stored.runId, url: session.dash.runUrl(stored.runId), outcomes };
  } finally {
    client.dispose();
  }
}

/** Poll once for a pending browser "Run again" and dispatch it through the court workflow. */
async function pollOnce(vscode, session) {
  let pending;
  try { pending = await session.dash.poll(); } catch { return; }
  if (!pending) return;
  try { await session.dash.acknowledge(pending.requestId); } catch { return; }
  // Browser saved a rev-0 placeholder at pending.createdAt; first extension update is rev 1.
  const existingRun = { runId: pending.runId, createdAt: pending.createdAt, revision: 1 };
  try {
    await runRequested(vscode, session, pending.courts, existingRun);
  } catch (e) {
    // Truthful failure: submit an errored run rather than fabricate success.
    try {
      const now = new Date().toISOString();
      const outcomes = {};
      for (const c of ALL) outcomes[c] = pending.courts.includes(c) ? { kind: 'error', errors: [String(e && e.message ? e.message : e)] } : { kind: 'not_run' };
      const snap = toSnapshot(
        { projectId: session.project.id, projectName: session.project.name, runId: pending.runId, createdAt: pending.createdAt,
          revision: 1, state: 'complete', checkedOutCommit: null, branch: null, workingTreeDirty: null, producer: PRODUCER },
        outcomes, now);
      await session.dash.publish(snap);
    } catch { /* disconnect will interrupt */ }
  }
}

/**
 * Ensure a session-scoped dashboard is up for this workspace, with continuous
 * "Run again" polling. Reuses an existing session for the same project.
 */
async function ensureSession(vscode, { root, enginePath, historyDir }) {
  const project = projectFor(vscode, root);
  if (_session && _session.project.id === project.id && _session.dash.connected) return _session;
  if (_session) await stopSession();
  const dash = new DashboardClient({ project, historyDir });
  await dash.start();
  _session = {
    dash, project, root, enginePath,
    _poll: setInterval(() => { pollOnce(vscode, _session).catch(() => {}); }, 2000),
  };
  if (_session._poll.unref) _session._poll.unref();
  return _session;
}

async function stopSession() {
  if (!_session) return;
  clearInterval(_session._poll);
  try { await _session.dash.stop(); } catch {}
  _session = null;
}

/** True while a session is live and connected (browser Run-again reachable). */
function isConnected() {
  return !!(_session && _session.dash && _session.dash.connected);
}

/**
 * Command entry: run all courts (or a browser-driven subset) and publish.
 * Keeps the dashboard session alive afterward so browser "Run again" works.
 */
async function runAndPublish(vscode, { root, enginePath, requested, existingRun, historyDir, openExternal }) {
  const session = await ensureSession(vscode, { root, enginePath, historyDir });
  return runRequested(vscode, session, requested || ALL, existingRun || null);
}

module.exports = { runAndPublish, preflight, projectFor, collectCourts, gitProvenance, ensureSession, stopSession, isConnected };

'use strict';
/**
 * src/dashboard.js — VS Code command module for the dashboard integration.
 *
 * Owns: project identity (per-workspace UUID in extension globalStorage), the
 * DashboardClient lifecycle, court collection against the engine, conversion to
 * the dashboard's v2 snapshot, publication, browser opening, and "Run again"
 * polling through the existing court workflow.
 *
 * The raw engine outputs (triumph-input.json, triumph-report.html/.md) are
 * untouched — the dashboard run is an additional, separate artifact.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DashboardClient } = require('../lib/dashboard');
const { projectId, toSnapshot } = require('../lib/convert');
const { McpClient } = require('./mcp-client');

const PRODUCER = { name: 'triumph-courts', version: '0.2.0' };
const ALL = ['redline', 'splitbrain', 'warpath'];

/** Canonical workspace URI → stable project {id,name}. */
function projectFor(vscode, root) {
  const folders = vscode.workspace.workspaceFolders || [];
  const uri = (folders[0] && folders[0].uri && folders[0].uri.toString()) || `file://${root}`;
  return { id: projectId(uri), name: path.basename(root) };
}

/**
 * Preflight: decide which courts are *able* to run. A court is 'unavailable'
 * when a verified precondition is absent — never run it and call it a pass.
 * Returns { runnable: string[], reasons: { court: reason } }.
 */
function preflight(root) {
  const cfg = readTriumphConfig(root);
  const reasons = {};
  const runnable = [];
  // REDLINE: needs a spec + a tests dir (or a clause test pattern).
  if (!cfg.specPath || !fs.existsSync(path.join(root, cfg.specPath))) reasons.redline = 'spec.path missing';
  else if (!cfg.testsDir || !fs.existsSync(path.join(root, cfg.testsDir))) reasons.redline = 'tests.dir missing';
  else runnable.push('redline');
  // SPLITBRAIN: needs a mutation command OR a precomputed report.
  const hasReport = cfg.mutationReport && fs.existsSync(path.join(root, cfg.mutationReport));
  if (!cfg.mutationCommand && !hasReport) reasons.splitbrain = 'no mutation.command and no precomputed mutation.report';
  else runnable.push('splitbrain');
  // WARPATH: needs at least one fixture.
  const fx = ['fixtures/metrics.json', 'fixtures/deploy.json', 'fixtures/logs.json'].some((f) => fs.existsSync(path.join(root, f)));
  if (!fx) reasons.warpath = 'no incident fixtures (deploy/metrics/logs)';
  else runnable.push('warpath');
  return { runnable, reasons };
}

/** Minimal .triumph.yml reader (we only need a few keys for preflight). */
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

/**
 * Run a TRIUMPH cycle and publish to the dashboard.
 *   requested: subset of ALL to actually run (browser "Run again" passes its courts).
 *   existingRun: { runId, createdAt, revision } for browser-requested runs (else null → unsolicited rev 0).
 * Returns { runId, url }.
 */
async function runAndPublish(vscode, { root, enginePath, requested, existingRun, historyDir, openExternal }) {
  const { runnable, reasons } = preflight(root);
  const project = projectFor(vscode, root);
  const dash = new DashboardClient({ project, historyDir });
  await dash.start();
  const client = new McpClient(enginePath, root);
  try {
    await client.start();
    const now = new Date().toISOString();
    const outcomes = await collectCourts(client, root, requested, reasons);
    const runId = existingRun ? existingRun.runId : crypto.randomUUID();
    const createdAt = existingRun ? existingRun.createdAt : now;
    const revision = existingRun ? existingRun.revision : 0;
    const snap = toSnapshot(
      { projectId: project.id, projectName: project.name, runId, createdAt, revision, state: 'complete',
        checkedOutCommit: null, branch: null, workingTreeDirty: null, producer: PRODUCER },
      outcomes, new Date().toISOString()
    );
    const stored = await dash.publish(snap);
    const url = dash.runUrl(stored.runId);
    if (openExternal) await openExternal(url);
    return { runId: stored.runId, url, outcomes };
  } finally {
    client.dispose();
    await dash.stop();
  }
}

module.exports = { runAndPublish, preflight, projectFor, collectCourts };

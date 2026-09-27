'use strict';
/**
 * src/actions.js — TRIUMPH action logic, extracted from the old
 * src/extension.js cmd* command handlers so the persistent panel (and the
 * thin command wrappers) can call the same code.
 *
 * NO vscode.window.* calls here (and no `require('vscode')` at all) — every
 * VS-Code-specific capability comes in through `ctx`:
 *   ctx = { root, enginePath, emit, globalStoragePath, openExternal, vscode }
 *     root:             workspace root (string) or null/undefined
 *     enginePath:       resolved path to court.js
 *     emit({level, text}): stream a log line ('info' | 'warn' | 'error')
 *     globalStoragePath: extension global storage dir (dashboardRun only)
 *     openExternal(url): open a URL in the user's browser (dashboardRun only)
 *     vscode:           the real `vscode` module, forwarded through to
 *                        dashboardCmd.runAndPublish (dashboardRun only) —
 *                        supplied by panel.js's _actionsCtx(); actions.js
 *                        itself never requires 'vscode'.
 * ctx.McpClient / ctx.dashboardCmd may be injected (tests) — default to the
 * real modules otherwise.
 *
 * Every action throws Error on failure, including Error('Open a workspace
 * folder first.') when ctx.root is falsy. Callers (panel.js's runJob) turn
 * that into an `error` message.
 */

const path = require('path');
const fs = require('fs');

const DefaultMcpClient = require('./mcp-client').McpClient;
const DefaultDashboardCmd = require('./dashboard');

const COURTS = ['REDLINE', 'SPLITBRAIN', 'WARPATH'];
const CONFIG_NAMES = ['.triumph.yml', '.triumph.yaml', '.triumph.json'];

function emit(ctx, level, text) {
  if (ctx && typeof ctx.emit === 'function') {
    try { ctx.emit({ level, text }); } catch { /* logging must never throw */ }
  }
}

function requireRoot(ctx) {
  const root = ctx && ctx.root;
  if (!root) throw new Error('Open a workspace folder first.');
  return root;
}

function findConfigPath(root) {
  for (const name of CONFIG_NAMES) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Lightweight existence check (no auto-detect) for state refresh. */
function configStatus(root) {
  if (!root) return { exists: false, path: null, notes: [] };
  const p = findConfigPath(root);
  return { exists: Boolean(p), path: p, notes: [] };
}

/** Same as old cmdDetectConfig, minus opening the file in an editor. */
async function detectConfig(ctx) {
  const root = requireRoot(ctx);
  const { detect, toYaml } = require('../lib/detect');
  const { config, notes } = detect(root);
  const dest = path.join(root, '.triumph.yml');
  const header = '# TRIUMPH 3-court repo adapter. See schemas/triumph-config.schema.json in the extension.\n';
  fs.writeFileSync(dest, header + toYaml(config) + '\n', 'utf8');
  emit(ctx, 'info', `.triumph.yml written. ${notes.join(' · ')}`);
  return { path: dest, notes };
}

/** Same as old cmdInstallCourts (minus the quickpick — host is given). */
async function installCourts(ctx, { host } = {}) {
  const root = requireRoot(ctx);
  const { HOSTS, installHost } = require('../lib/hosts');

  const hasConfig = Boolean(findConfigPath(root));
  if (!hasConfig) await detectConfig(ctx);

  const hosts = host === 'all' ? Object.keys(HOSTS) : [host];
  const written = [];
  const errors = [];
  for (const h of hosts) {
    try {
      const r = installHost(h, root);
      written.push(...r.files.map((f) => path.relative(root, f)));
      emit(ctx, 'info', `${h}: installed`);
    } catch (e) {
      errors.push({ host: h, message: e.message });
      emit(ctx, 'error', `TRIUMPH ${h}: ${e.message}`);
    }
  }
  const extVersion = require('../package.json').version;
  emit(ctx, 'info', `files written: ${written.join(', ') || '(none)'}`);
  emit(ctx, 'info',
    `TRIUMPH courts installed (${hosts.join(', ')}) — extension v${extVersion}. ${written.length} files written. ` +
    `If you expected skills/rules/modes and only see agents+mcp.json, reload the window (Developer: Reload Window) so the host picks up the current extension build.`);
  return { hosts, files: written, errors };
}

/** Same engine calls as old cmdRunCourt. No splitbrain_status polling. */
async function runCourt(ctx, { court } = {}) {
  const root = requireRoot(ctx);
  if (!COURTS.includes(court)) throw new Error(`Unknown court: ${court}`);
  const McpClientCtor = (ctx && ctx.McpClient) || DefaultMcpClient;
  const client = new McpClientCtor(ctx.enginePath, root);
  try {
    await client.start();
    let result;
    if (court === 'REDLINE') {
      emit(ctx, 'info', 'REDLINE running witness suites…');
      result = await client.call('redline_verdict_all');
      const s = result && result.summary;
      emit(ctx, 'info', s
        ? `REDLINE done: ${s.green} green / ${s.red} red / ${s.yellow} yellow of ${s.total}`
        : 'REDLINE done');
    } else if (court === 'SPLITBRAIN') {
      emit(ctx, 'info', 'SPLITBRAIN starting mutation testing…');
      const start = await client.call('splitbrain_mutate');
      if (start.status === 'started') {
        emit(ctx, 'info', `mutation job ${start.job_id} started`);
        result = start;
      } else {
        result = await client.call('splitbrain_trustgap');
        emit(ctx, 'info', 'SPLITBRAIN trustgap done');
      }
    } else {
      emit(ctx, 'info', 'WARPATH triage running…');
      result = await client.call('warpath_triage');
      emit(ctx, 'info', 'WARPATH done');
    }
    return result;
  } finally {
    client.dispose();
  }
}

/** Same as old cmdGenerateReport, minus the "Open HTML/MD" prompt. */
async function generateReport(ctx) {
  const root = requireRoot(ctx);
  const McpClientCtor = (ctx && ctx.McpClient) || DefaultMcpClient;
  const { writeReports } = require('../lib/render');
  const client = new McpClientCtor(ctx.enginePath, root);
  try {
    await client.start();
    const input = { repo: path.basename(root), repoRootAbs: root, generated: new Date().toISOString() };
    emit(ctx, 'info', 'REDLINE running…');
    input.redline = await client.call('redline_verdict_all');
    const rs = input.redline && input.redline.summary;
    emit(ctx, 'info', rs
      ? `REDLINE done: ${rs.green} green / ${rs.red} red / ${rs.yellow} yellow of ${rs.total}`
      : 'REDLINE done');
    emit(ctx, 'info', 'SPLITBRAIN running…');
    input.splitbrain = await client.call('splitbrain_trustgap');
    emit(ctx, 'info', input.splitbrain && input.splitbrain.trustGap != null
      ? `SPLITBRAIN done: trust gap ${input.splitbrain.trustGap}`
      : 'SPLITBRAIN done');
    emit(ctx, 'info', 'WARPATH running…');
    input.warpath = await client.call('warpath_triage');
    emit(ctx, 'info', input.warpath && input.warpath.incidentWindow
      ? `WARPATH done: incident window ${input.warpath.incidentWindow}`
      : 'WARPATH done');

    const outDir = path.join(root, 'reports', 'triumph');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'triumph-input.json'), JSON.stringify(input, null, 2) + '\n', 'utf8');
    const { mdPath, htmlPath } = writeReports(input, outDir);
    emit(ctx, 'info', `report written: ${htmlPath}, ${mdPath}`);
    return { htmlPath, mdPath, generatedAt: input.generated };
  } finally {
    client.dispose();
  }
}

/**
 * Stat reports/triumph/triumph-report.html (+.md) → summary/metadata, or
 * null if no report has ever been generated for this root.
 */
function findLastReport(root) {
  if (!root) return null;
  const outDir = path.join(root, 'reports', 'triumph');
  const htmlPath = path.join(outDir, 'triumph-report.html');
  if (!fs.existsSync(htmlPath)) return null;
  const stat = fs.statSync(htmlPath);
  const mdPath = path.join(outDir, 'triumph-report.md');
  let summary = null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(outDir, 'triumph-input.json'), 'utf8'));
    if (raw && raw.redline && raw.redline.summary) summary = raw.redline.summary;
  } catch { /* no triumph-input.json, or unparsable — summary stays null */ }
  return {
    htmlPath,
    mdPath: fs.existsSync(mdPath) ? mdPath : null,
    generatedAt: stat.mtime.toISOString(),
    summary,
  };
}

/** Same core as old cmdDashboardRun (progress notification lives in panel.js/extension.js). */
async function dashboardRun(ctx) {
  const root = requireRoot(ctx);
  const dashboardCmdMod = (ctx && ctx.dashboardCmd) || DefaultDashboardCmd;
  const historyDir = path.join(ctx.globalStoragePath, 'dashboard-history');
  fs.mkdirSync(historyDir, { recursive: true });
  emit(ctx, 'info', 'publishing…');
  const { url } = await dashboardCmdMod.runAndPublish(ctx.vscode, {
    root,
    enginePath: ctx.enginePath,
    requested: ['redline', 'splitbrain', 'warpath'],
    existingRun: null,
    historyDir,
    openExternal: ctx.openExternal,
    // The session (and its "Run again" polling loop) outlives this job, so
    // a browser-triggered failure after this call returns must still reach
    // the panel log — not just failures from this dashboardRun itself.
    onError: (e) => emit(ctx, 'error', 'dashboard: ' + (e && e.message ? e.message : String(e))),
  });
  emit(ctx, 'info', `published: ${url}`);
  return { url };
}

module.exports = {
  COURTS,
  configStatus,
  detectConfig,
  installCourts,
  runCourt,
  generateReport,
  findLastReport,
  dashboardRun,
};

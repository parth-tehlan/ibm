'use strict';
/** Thin public action adapters. All execution (including reports and dashboard
 * commands) goes through run-coordinator; publication never executes courts. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const coordinator = require('./run-coordinator');
const store = require('../lib/run-store');
const REPORT_FORMATS = ['html', 'md', 'json'];
const previews = new Map();
function fail(code, message) { return Object.assign(new Error(message), {code}); }
function rootFor(ctx, write = false) {
  if (write && (ctx.isTrusted === false || ctx.vscode?.workspace?.isTrusted === false)) throw fail('UNTRUSTED_WORKSPACE', 'Trust this workspace before writing files.');
  return store.canonicalRoot(ctx);
}
function revision(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe config target: ' + file);
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function configPath(root) { return require('../lib/config').findConfigFile(root); }
function configStatus(root) {
  if (!root) return {exists: false, path: null, notes: [], readiness: {}};
  try {
    const file = configPath(root);
    const {cfg, reasons, runnable} = coordinator.preflight(root);
    return {exists: !!file, path: file, valid: !!cfg, notes: [...new Set(Object.values(reasons))],
      revision: file ? revision(file) : null,
      timeoutSeconds: cfg?.mutation.timeoutSeconds || 900, timeoutSource: cfg ? 'configuration' : 'default',
      readiness: Object.fromEntries(coordinator.COURTS.map(c => [c, {ready: runnable.includes(c.toLowerCase()), reason: reasons[c.toLowerCase()] || null}]))};
  } catch (e) { return {exists: false, path: null, valid: false, notes: [e.message], readiness: {}}; }
}
function validateConfig(ctx) { return configStatus(rootFor(ctx)); }
function remember(preview) {
  previews.set(preview.previewId, preview);
  if (previews.size > 100) previews.delete(previews.keys().next().value);
  return JSON.parse(JSON.stringify(preview));
}
function previewConfig(ctx) {
  const root = rootFor(ctx);
  const {detect, toYaml} = require('../lib/detect');
  const {config, notes} = detect(root);
  const dest = configPath(root) || path.join(root, '.gaia.yml');
  if (path.dirname(dest) !== root) throw fail('INVALID_REQUEST', 'Configuration outside the workspace is read-only in Setup.');
  const expectedConfigRevision = revision(dest);
  const content = dest.endsWith('.json') ? JSON.stringify(config, null, 2) + '\n' : '# Gaia repo adapter. Review before applying.\n' + toYaml(config) + '\n';
  // The webview gates the apply step on expectedConfigRevision being a string
  // (media/panel.js renderPreview) and labels replacement from replacesExisting,
  // so surface both: missingConfig marks creation, where null is a valid
  // expected revision the UI could not otherwise distinguish from omission.
  return remember({kind: 'config', previewId: crypto.randomUUID(), root, path: dest, content, notes,
    expectedConfigRevision, missingConfig: expectedConfigRevision === null,
    replace: expectedConfigRevision !== null, replacesExisting: expectedConfigRevision !== null,
    files: [dest], createdAt: Date.now()});
}
function applyConfig(ctx, {previewId, expectedConfigRevision, confirmReplace = false} = {}) {
  const root = rootFor(ctx, true);
  const preview = previews.get(previewId);
  if (!preview || preview.kind !== 'config' || preview.root !== root || Date.now() - preview.createdAt > 15 * 60_000) throw fail('STALE_PREVIEW', 'Create a fresh configuration preview first.');
  if (expectedConfigRevision !== preview.expectedConfigRevision || revision(preview.path) !== preview.expectedConfigRevision || (configPath(root) || path.join(root, '.gaia.yml')) !== preview.path) throw fail('STALE_PREVIEW', 'Configuration changed since the preview; nothing was written.');
  if (preview.replace && !confirmReplace) throw fail('INVALID_REQUEST', 'Explicit replacement confirmation is required.');
  let backupPath = null;
  if (preview.replace) {
    backupPath = preview.path + '.' + crypto.randomUUID() + '.bak';
    fs.copyFileSync(preview.path, backupPath, fs.constants.COPYFILE_EXCL);
    store.atomic(preview.path, preview.content);
  } else fs.writeFileSync(preview.path, preview.content, {flag: 'wx', mode: 0o600});
  previews.delete(previewId);
  return {path: preview.path, notes: preview.notes, backupPath, validation: configStatus(root)};
}
/** Legacy create-config command remains explicit creation, never replacement. */
async function detectConfig(ctx) {
  const preview = previewConfig(ctx);
  if (preview.replace) throw fail('CONFIRM_REPLACE', 'Configuration already exists. Validate it or preview and explicitly confirm replacement.');
  return applyConfig(ctx, {previewId: preview.previewId, expectedConfigRevision: null});
}
function hostFiles(root, host) {
  const {AGENTS, EXT_DIR} = require('../lib/hosts');
  const base = host === 'claude' ? '.claude' : host === 'bob' ? '.bob' : host === 'codex' ? '.codex' : '.gaia';
  const files = host === 'vscode' ? AGENTS.map(n => path.join(root, '.github', 'chatmodes', `gaia-${n}.chatmode.md`)) : AGENTS.map(n => path.join(root, base, 'agents', n + '.md'));
  files.push(path.join(root, host === 'claude' ? '.mcp.json' : host === 'vscode' ? '.vscode/mcp.json' : base + (host === 'codex' ? '/config.json' : '/mcp.json')));
  if (host === 'bob') {
    const walk = (source, target) => { for (const item of fs.readdirSync(source, {withFileTypes: true})) {
      const src = path.join(source, item.name), dest = path.join(target, item.name);
      if (item.isDirectory()) walk(src, dest); else files.push(dest);
    }};
    walk(path.join(EXT_DIR, 'agents', 'skills'), path.join(root, '.bob', 'skills'));
    walk(path.join(EXT_DIR, 'agents', 'bob'), path.join(root, '.bob'));
  }
  return [...new Set(files)];
}
function previewInstall(ctx, {host} = {}) {
  const root = rootFor(ctx);
  const {HOSTS} = require('../lib/hosts');
  if (host !== 'all' && !Object.hasOwn(HOSTS, host)) throw fail('INVALID_REQUEST', 'Choose an integration host explicitly.');
  const hosts = host === 'all' ? Object.keys(HOSTS) : [host];
  const files = [...new Set(hosts.flatMap(h => hostFiles(root, h)))].map(file => ({path: file, revision: revision(file), action: fs.existsSync(file) ? 'merge-or-preserve' : 'create'}));
  return remember({kind: 'install', previewId: crypto.randomUUID(), root, hosts, host: hosts.length === 1 ? hosts[0] : 'all', files, createdAt: Date.now()});
}
async function installCourts(ctx, {host, previewId} = {}) {
  const root = rootFor(ctx, true);
  let preview;
  if (previewId) {
    preview = previews.get(previewId);
    if (!preview || preview.kind !== 'install' || preview.root !== root || Date.now() - preview.createdAt > 15 * 60_000 || preview.files.some(f => revision(f.path) !== f.revision)) throw fail('STALE_PREVIEW', 'Integration files changed; preview installation again.');
  } else preview = previewInstall(ctx, {host}); // compatibility for explicit command callers
  const {installHost} = require('../lib/hosts');
  const files = [], errors = [];
  for (const h of preview.hosts) {
    try { const installed = installHost(h, root); files.push(...installed.files.map(f => path.relative(root, f))); }
    catch (e) { errors.push({host: h, message: e.message}); }
  }
  previews.delete(preview.previewId);
  // Integration installation is optional and never creates/replaces config.
  return {hosts: preview.hosts, files, errors};
}
function runCourt(ctx, opts) { return coordinator.runCourt(ctx, opts); }
async function generateReport(ctx, {formats} = {}) {
  const result = await runCourt(ctx, {courts: coordinator.COURTS, formats, trigger: 'command'});
  return {...result.report, run: result.run, runRecord: result.run, errors: result.errors};
}
async function dashboardRun(ctx, opts = {}) {
  const result = await runCourt(ctx, {...opts, courts: opts.courts || coordinator.COURTS, publishToDashboard: true});
  return {...result, url: result.dashboardUrl};
}
function findLastReport(root) {
  if (!root) return null;
  const run = store.latestRun(root);
  if (!run) return legacyLastReport(root);
  const result = coordinator.resultFor(run);
  const payload = c => run.courts[c].payload;
  return {...result.report, runId: run.runId, run, runRecord: run, summary: payload('WITNESS')?.summary || null,
    witness: payload('WITNESS'), trustgap: payload('TRUSTGAP'), triage: payload('TRIAGE'),
    evidenceFreshness: 'run-owned'};
}
function legacyLastReport(root) {
  if (!root) return null;
  const outDir = path.join(root, 'reports', 'gaia');
  const htmlPath = path.join(outDir, 'gaia-report.html');
  const inputPath = path.join(outDir, 'gaia-input.json');
  const mdPath = path.join(outDir, 'gaia-report.md');
  const htmlExists = fs.existsSync(htmlPath);
  const inputExists = fs.existsSync(inputPath);
  if (!htmlExists && !inputExists) return null;
  // The JSON input is the freshest artifact when both exist (runCourt's
  // local target writes it last); the HTML mtime otherwise.
  const stat = fs.statSync(inputExists ? inputPath : htmlPath);
  let summary = null;
  let witness = null;
  let trustgap = null;
  let triage = null;
  try {
    const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    if (raw && typeof raw === 'object') {
      witness = raw.witness || null;
      trustgap = raw.trustgap || null;
      triage = raw.triage || null;
      if (witness && witness.summary) summary = witness.summary;
    }
  } catch { /* no gaia-input.json, or unparsable — per-court data stays null */ }
  return {
    htmlPath: htmlExists ? htmlPath : null,
    mdPath: fs.existsSync(mdPath) ? mdPath : null,
    generatedAt: null,
    modifiedAt: stat.mtime.toISOString(),
    evidenceFreshness: 'unknown',
    evidenceSource: 'imported',
    summary,
    witness,
    trustgap,
    triage,
  };
}


module.exports = {COURTS: coordinator.COURTS, REPORT_FORMATS, configStatus, validateConfig,
  previewConfig, applyConfig, previewInstall, detectConfig, installCourts, runCourt, generateReport, findLastReport, dashboardRun,
  listRuns: coordinator.listRuns, readRun: coordinator.readRun, selectRun: coordinator.selectRun,
  selectedRun: coordinator.selectedRun, publishRun: coordinator.publishRun, cancelRun: coordinator.cancelRun,
  onRunEvent: coordinator.onRunEvent, getActiveRun: coordinator.getActiveRun, capabilities: coordinator.capabilities};

#!/usr/bin/env node
/**
 * triumph-report — collect engine JSON (via MCP stdio) and render the two
 * deterministic artifacts: triumph-report.html + triumph-report.md.
 *
 *   node bin/triumph-report.js --repo <dir> [--out <dir>]
 *     [--skip redline|splitbrain|warpath ...]   (comma or repeat)
 *     [--claimed-coverage <pct>]
 *
 * The collector is a thin MCP client over the engine (court.js). Rendering is
 * lib/render.js — model-free, deterministic.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
const { writeReports } = require('../lib/render');
const { loadConfig } = require('../lib/config');

const ENGINE = path.resolve(__dirname, '..', 'court.js');

function parseArgs(argv) {
  const out = { repo: process.cwd(), out: null, skip: new Set(), claimed: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') out.repo = argv[++i];
    else if (a.startsWith('--repo=')) out.repo = a.slice(7);
    else if (a === '--out') out.out = argv[++i];
    else if (a.startsWith('--out=')) out.out = a.slice(6);
    else if (a === '--skip') argv[++i].split(',').forEach((s) => out.skip.add(s.trim()));
    else if (a.startsWith('--skip=')) a.slice(7).split(',').forEach((s) => out.skip.add(s.trim()));
    else if (a === '--claimed-coverage') out.claimed = Number(argv[++i]);
    else if (a === '--version' || a === '-v') {
      console.log(require('../package.json').version);
      process.exit(0);
    }
    else if (a === '--help' || a === '-h') {
      console.log('usage: triumph-report --repo <dir> [--out <dir>] [--skip redline,splitbrain,warpath] [--claimed-coverage <pct>]');
      process.exit(0);
    }
  }
  return out;
}

/** Minimal MCP stdio client. */
function mcpSession(repo) {
  const child = spawn('node', [ENGINE, '--repo', repo], { stdio: ['pipe', 'pipe', 'inherit'] });
  const rl = readline.createInterface({ input: child.stdout });
  let id = 0;
  const pending = new Map();
  rl.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const call = (name, args) => new Promise((resolve, reject) => {
    const rid = ++id;
    pending.set(rid, (msg) => {
      if (msg.error) return reject(new Error(msg.error.message));
      try { resolve(JSON.parse(msg.result.content[0].text)); } catch (e) { reject(e); }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method: 'tools/call', params: { name, arguments: args || {} } }) + '\n');
  });
  const close = () => { child.stdin.end(); };
  return { call, close };
}

async function main() {
  const args = parseArgs(process.argv);
  const repo = path.resolve(args.repo);
  const cfg = loadConfig(repo);
  const outDir = args.out ? path.resolve(args.out) : cfg.evidence.reportsDir;

  const { call, close } = mcpSession(repo);
  const input = {
    repo: cfg.repo.name || path.basename(repo),
    repoRootAbs: repo,
    generated: new Date().toISOString(),
  };
  try {
    if (!args.skip.has('redline')) {
      console.error('[report] REDLINE …');
      input.redline = await call('redline_verdict_all');
    }
    if (!args.skip.has('splitbrain')) {
      console.error('[report] SPLITBRAIN …');
      input.splitbrain = await call('splitbrain_trustgap', args.claimed != null ? { claimed_coverage: args.claimed } : {});
      const surv = await call('splitbrain_mutants', { status: 'Survived' });
      if (surv && surv.mutants && surv.mutants.length) input.splitbrain.survivors = surv.mutants;
    }
    if (!args.skip.has('warpath')) {
      console.error('[report] WARPATH …');
      input.warpath = await call('warpath_triage');
    }
  } finally {
    close();
  }

  // Persist the raw engine input alongside the reports for re-render + audit.
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'triumph-input.json'), JSON.stringify(input, null, 2) + '\n', 'utf8');
  const { mdPath, htmlPath } = writeReports(input, outDir);
  console.log('wrote:');
  console.log('  ' + mdPath);
  console.log('  ' + htmlPath);
}

main().catch((e) => { console.error('triumph-report: ' + (e && e.message ? e.message : e)); process.exit(1); });

#!/usr/bin/env node
/**
 * triumph-setup — "Install courts for this repo", from the command line.
 *
 *   node bin/triumph-setup.js --repo <dir> [--detect] [--host claude|bob|codex|vscode|generic|all]
 *
 *   --detect   auto-fill .triumph.yml from the workspace (skipped if one exists)
 *   --host     materialize court subagents + MCP wiring for that host
 *              (repeatable; 'all' installs every known host)
 *
 * With no flags: detects config if missing, then installs for every host.
 * The extension's command wraps exactly this logic.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { detect, toYaml } = require('../lib/detect');
const { installHost, HOSTS } = require('../lib/hosts');

function parseArgs(argv) {
  const out = { repo: process.cwd(), detect: false, hosts: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') out.repo = argv[++i];
    else if (a.startsWith('--repo=')) out.repo = a.slice(7);
    else if (a === '--detect') out.detect = true;
    else if (a === '--host') out.hosts.push(argv[++i]);
    else if (a.startsWith('--host=')) out.hosts.push(a.slice(7));
    else if (a === '--version' || a === '-v') {
      console.log(require('../package.json').version);
      process.exit(0);
    }
    else if (a === '--help' || a === '-h') {
      console.log('usage: triumph-setup --repo <dir> [--detect] [--host <id>|all] (hosts: ' + Object.keys(HOSTS).join(', ') + ')');
      process.exit(0);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const repo = path.resolve(args.repo);
  if (!fs.existsSync(repo)) {
    console.error('repo not found: ' + repo);
    process.exit(1);
  }

  // 1. Config
  const cfgPath = ['.triumph.yml', '.triumph.yaml', '.triumph.json']
    .map((n) => path.join(repo, n))
    .find((p) => fs.existsSync(p));
  if (!cfgPath || args.detect) {
    const { config, notes } = detect(repo);
    const dest = path.join(repo, '.triumph.yml');
    if (cfgPath && args.detect) {
      console.log('config exists at ' + path.basename(cfgPath) + ' — leaving it (delete to regenerate)');
    } else {
      fs.writeFileSync(dest, '# TRIUMPH 3-court repo adapter. See court-extension/schemas/triumph-config.schema.json\n' + toYaml(config) + '\n', 'utf8');
      console.log('wrote .triumph.yml');
    }
    for (const n of notes) console.log('  · ' + n);
  } else {
    console.log('config: found ' + path.basename(cfgPath));
  }

  // 2. Hosts
  let hosts = args.hosts;
  if (!hosts.length || hosts.includes('all')) hosts = Object.keys(HOSTS);
  for (const h of hosts) {
    try {
      const r = installHost(h, repo);
      console.log(`installed courts for ${r.hostName}:`);
      for (const f of r.files) console.log('  · ' + path.relative(repo, f));
    } catch (e) {
      console.error(`host ${h}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log('\nDone. The caller agent in each host now runs the court subagents with its own model; the engine (court.js) serves redline_*/splitbrain_*/warpath_* over MCP. Legal. Honest. Survivable.');
}

main();

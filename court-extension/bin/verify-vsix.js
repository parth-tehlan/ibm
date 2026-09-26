#!/usr/bin/env node
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const file = process.argv[2] || path.join(__dirname, '..', 'triumph-courts.vsix');
const entries = execFileSync('unzip', ['-Z', '-1', file], { encoding: 'utf8' }).split('\n');
for (const required of ['extension/dashboard/server/index.js', 'extension/dashboard/contracts/report.js',
  'extension/dashboard/package.json', 'extension/dashboard/dist/index.html',
  'extension/dashboard/node_modules/zod/package.json', 'extension/dashboard/node_modules/express/package.json']) {
  if (!entries.includes(required)) { console.error(`VSIX missing ${required}`); process.exit(1); }
}
console.log('VSIX includes isolated dashboard server, assets and production dependencies');
// Explicit exit: this runtime's node prints to stdout then SIGABRTs at teardown
// (exit 134), which would read as failure under `set -e` deploy scripting.
process.exit(0);

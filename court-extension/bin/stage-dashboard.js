#!/usr/bin/env node
'use strict';
// Copy the dashboard's isolated, built runtime, never its checkout or .data.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const source = path.resolve(root, '..', 'northstar-ui', '.runtime');
const target = path.join(root, 'dashboard');
const files = ['package.json', 'package-lock.json', 'server/index.js', 'server/app.js', 'server/bridge.js',
  'server/history.js', 'contracts/report.js', 'reports/export.js', 'dist/index.html'];
if (!files.every((f) => fs.existsSync(path.join(source, f))) || !fs.existsSync(path.join(source, 'node_modules', 'zod')) || !fs.existsSync(path.join(source, 'node_modules', 'express'))) {
  throw new Error('Missing northstar-ui/.runtime. Build it first: cd ../northstar-ui && npm ci && npm run package:runtime');
}
for (const f of files.filter((f) => f !== 'dist/index.html')) {
  fs.mkdirSync(path.dirname(path.join(target, f)), { recursive: true });
  fs.copyFileSync(path.join(source, f), path.join(target, f));
}
for (const dir of ['dist', 'node_modules']) {
  fs.rmSync(path.join(target, dir), { recursive: true, force: true });
  fs.cpSync(path.join(source, dir), path.join(target, dir), { recursive: true });
}
console.log('Staged self-contained dashboard runtime in court-extension/dashboard');

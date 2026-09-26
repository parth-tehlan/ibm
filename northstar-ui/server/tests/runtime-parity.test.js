import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

// Run with TRIUMPH_RUNTIME_DIR=... after npm run package:runtime. The ordinary
// source test suite does not silently use an old ignored staging directory.
test('opt-in packaged runtime has the same server, schema, lockfile and browser assets as source build', async (t) => {
  if (!process.env.TRIUMPH_RUNTIME_DIR) { t.skip('stage the runtime and set TRIUMPH_RUNTIME_DIR to verify parity'); return; }
  const staged = path.resolve(process.env.TRIUMPH_RUNTIME_DIR);
  const files = ['package.json', 'package-lock.json', 'server/index.js', 'server/app.js', 'server/bridge.js', 'server/history.js', 'contracts/report.js', 'reports/export.js', 'dist/index.html'];
  const assets = await readdir(path.join(root, 'dist/assets'));
  assert.ok(assets.some((asset) => asset.endsWith('.js')));
  files.push(...assets.map((asset) => `dist/assets/${asset}`));
  for (const file of files) {
    assert.deepEqual(await readFile(path.join(staged, file)), await readFile(path.join(root, file)), `staged ${file} is stale`);
  }
  const shipped = await readdir(path.join(staged, 'dist/assets'));
  assert.deepEqual(shipped.sort(), assets.sort(), 'no obsolete browser bundles');
  const { dependencies } = JSON.parse(await readFile(path.join(staged, 'package.json'), 'utf8'));
  for (const name of Object.keys(dependencies)) assert.ok((await readdir(path.join(staged, 'node_modules'))).includes(name), `missing production dependency ${name}`);
});

test('opt-in copied extension runtime matches staged browser and server artifacts', async (t) => {
  if (!process.env.TRIUMPH_RUNTIME_DIR || !process.env.TRIUMPH_COPIED_RUNTIME_DIR) {
    t.skip('set TRIUMPH_RUNTIME_DIR and TRIUMPH_COPIED_RUNTIME_DIR after extension re-staging'); return;
  }
  const source = path.resolve(process.env.TRIUMPH_RUNTIME_DIR);
  const target = path.resolve(process.env.TRIUMPH_COPIED_RUNTIME_DIR);
  const files = ['package.json', 'package-lock.json', 'server/index.js', 'server/app.js', 'server/history.js', 'server/bridge.js', 'contracts/report.js', 'reports/export.js', 'dist/index.html'];
  const assets = await readdir(path.join(source, 'dist/assets'));
  files.push(...assets.map((file) => `dist/assets/${file}`));
  assert.deepEqual((await readdir(path.join(target, 'dist/assets'))).sort(), assets.sort());
  for (const file of files) assert.deepEqual(await readFile(path.join(target, file)), await readFile(path.join(source, file)), `extension copy differs: ${file}`);
});

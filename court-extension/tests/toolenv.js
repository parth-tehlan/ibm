'use strict';
/**
 * tests/toolenv.js — the tool-resolution chain that removes the hard
 * requirement for node_modules in the OPENED workspace folder.
 *
 * Asserts:
 *   - repo node_modules wins over configured dirs (version fidelity)
 *   - GAIA_TOOL_PATH supplies a tool when the repo has none
 *   - .gaia/tool-path.json (repo) and ~/.gaia/tool-path.json (global)
 *     are honored, with repo config outranking global
 *   - withToolPath prepends repo .bin + configured bin dirs, keeps inherited
 *   - resolveExecutable finds bare command names across the chain
 *   - jest resolution: repo -> configured -> null (never guesses)
 *   - runJestCli error (win32 shape) names the searched locations
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const toolenv = require('../lib/toolenv');
const runners = require('../lib/runners');

let passed = 0, failed = 0;
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ok', name); })
    .catch((e) => { failed++; console.error('  FAIL', name, '—', e.message); });
}

/** Build a minimal fake package with a bin entry. Returns the pkg dir. */
function fakePkg(root, name, binName) {
  const pkgDir = path.join(root, 'node_modules', name);
  fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true });
  const bin = path.join(pkgDir, 'bin', (binName || name) + '.js');
  fs.writeFileSync(bin, '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
    name, version: '0.0.0', bin: { [binName || name]: 'bin/' + (binName || name) + '.js' },
  }));
  return { pkgDir, bin };
}

/** Fake executable in a .bin dir. */
function fakeExe(binDir, name) {
  fs.mkdirSync(binDir, { recursive: true });
  const fp = path.join(binDir, name);
  fs.writeFileSync(fp, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return fp;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-toolenv-'));
  const oldEnv = { GAIA_TOOL_PATH: process.env.GAIA_TOOL_PATH, HOME: process.env.HOME };
  const fakeHome = path.join(tmp, 'home');
  fs.mkdirSync(fakeHome, { recursive: true });
  process.env.HOME = fakeHome; // keep the real ~/.gaia out of the test
  try {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo, { recursive: true });

    await t('repo node_modules wins over configured dirs (version fidelity)', async () => {
      const r = path.join(tmp, 'repo-with-nm');
      fs.mkdirSync(r, { recursive: true });
      const local = fakePkg(r, 'jest');
      const shared = path.join(tmp, 'shared');
      fakePkg(shared, 'jest');
      process.env.GAIA_TOOL_PATH = shared;
      const hit = toolenv.resolvePackageBin('jest', 'jest', toolenv.nodeToolSearchDirs(r));
      assert.equal(hit.bin, local.bin);
      assert.equal(hit.source, r);
      delete process.env.GAIA_TOOL_PATH;
    });

    await t('GAIA_TOOL_PATH supplies jest when the repo has none', async () => {
      const bare = path.join(tmp, 'bare-a');
      fs.mkdirSync(bare, { recursive: true });
      const shared = path.join(tmp, 'shared2');
      const pkg = fakePkg(shared, 'jest');
      process.env.GAIA_TOOL_PATH = shared;
      const hit = toolenv.resolvePackageBin('jest', 'jest', toolenv.nodeToolSearchDirs(bare));
      assert.equal(hit.bin, pkg.bin);
      assert.equal(hit.source, shared);
      delete process.env.GAIA_TOOL_PATH;
    });

    await t('.gaia/tool-path.json (repo) honored; outranks global ~/.gaia file', async () => {
      const bare = path.join(tmp, 'bare-b');
      fs.mkdirSync(bare, { recursive: true });
      const repoShared = path.join(tmp, 'repo-shared');
      const repoPkg = fakePkg(repoShared, 'jest');
      const globalShared = path.join(tmp, 'global-shared');
      fakePkg(globalShared, 'jest');
      fs.mkdirSync(path.join(bare, '.gaia'), { recursive: true });
      fs.writeFileSync(path.join(bare, '.gaia', 'tool-path.json'), JSON.stringify({ toolPath: [repoShared] }));
      fs.mkdirSync(path.join(fakeHome, '.gaia'), { recursive: true });
      fs.writeFileSync(path.join(fakeHome, '.gaia', 'tool-path.json'), JSON.stringify({ toolPath: [globalShared] }));
      const hit = toolenv.resolvePackageBin('jest', 'jest', toolenv.nodeToolSearchDirs(bare));
      assert.equal(hit.bin, repoPkg.bin);
      fs.rmSync(path.join(bare, '.gaia'), { recursive: true, force: true });
    });

    await t('global ~/.gaia/tool-path.json used when repo has none', async () => {
      const bare = path.join(tmp, 'bare-c');
      fs.mkdirSync(bare, { recursive: true });
      const hit = toolenv.resolvePackageBin('jest', 'jest', toolenv.nodeToolSearchDirs(bare));
      assert.ok(hit && hit.bin.includes('global-shared'), 'expected global-shared jest, got ' + (hit && hit.bin));
      fs.rmSync(path.join(fakeHome, '.gaia'), { recursive: true, force: true });
    });

    await t('withToolPath prepends repo .bin then configured bins, keeps inherited PATH', async () => {
      const r = path.join(tmp, 'repo-path');
      fakeExe(path.join(r, 'node_modules', '.bin'), 'jest');
      process.env.GAIA_TOOL_PATH = path.join(tmp, 'shared3');
      fakeExe(path.join(tmp, 'shared3', 'node_modules', '.bin'), 'jest');
      const env = toolenv.withToolPath({ PATH: '/usr/bin' }, r);
      const dirs = env.PATH.split(path.delimiter);
      assert.equal(dirs[0], path.join(r, 'node_modules', '.bin'));
      assert.ok(dirs.includes(path.join(tmp, 'shared3', 'node_modules', '.bin')));
      assert.ok(dirs.includes('/usr/bin'), 'inherited PATH retained');
      delete process.env.GAIA_TOOL_PATH;
    });

    await t('withToolPath drops nonexistent dirs (no PATH litter)', async () => {
      const env = toolenv.withToolPath({ PATH: '/usr/bin' }, repo);
      for (const d of env.PATH.split(path.delimiter)) {
        assert.ok(fs.existsSync(d), d + ' should exist');
      }
    });

    await t('resolveExecutable: repo .bin beats configured beats PATH', async () => {
      const r = path.join(tmp, 'repo-exe');
      const repoBin = fakeExe(path.join(r, 'node_modules', '.bin'), 'stryker');
      const confDir = path.join(tmp, 'confbin');
      fakeExe(path.join(confDir, '.bin'), 'stryker');
      process.env.GAIA_TOOL_PATH = confDir;
      let hit = toolenv.resolveExecutable('stryker', r, { PATH: '/usr/bin' });
      assert.equal(hit.exe, repoBin);
      assert.equal(hit.source, 'repo');
      fs.rmSync(path.join(r, 'node_modules'), { recursive: true, force: true });
      hit = toolenv.resolveExecutable('stryker', r, { PATH: '/usr/bin' });
      assert.equal(hit.source, confDir);
      delete process.env.GAIA_TOOL_PATH;
      hit = toolenv.resolveExecutable('definitely-not-a-real-tool-xyz', r, { PATH: '/usr/bin' });
      assert.equal(hit, null);
    });

    await t('jest chain: repo -> configured -> null (never guesses)', async () => {
      // nothing anywhere
      assert.equal(runners.resolveJestCli(path.join(tmp, 'bare-repo')), null);
      // configured
      const shared = path.join(tmp, 'shared4');
      const pkg = fakePkg(shared, 'jest');
      process.env.GAIA_TOOL_PATH = shared;
      assert.equal(runners.resolveJestCli(path.join(tmp, 'bare-repo-2')), pkg.bin);
      delete process.env.GAIA_TOOL_PATH;
    });

    await t('runJestCli win32-shape error names the searched locations', async () => {
      const r = await runners.runJestCli(path.join(tmp, 'bare-repo-3'), ['--version'], { cwd: tmp, timeoutMs: 5000 });
      if (process.platform === 'win32') {
        assert.equal(r.ok, false);
        assert.match(r.error, /not resolvable/);
        assert.match(r.error, /node_modules/);
        assert.match(r.error, /PATH/);
        assert.match(r.error, /GAIA_TOOL_PATH|tool-path\.json/);
      } else {
        // POSIX: npx fallback path — spawn succeeds or fails honestly, never
        // silently the wrong binary. We only assert the attempt returns the
        // spawnCollect shape.
        assert.ok(typeof r.ok === 'boolean' && ('stdout' in r) && ('stderr' in r));
      }
    });

    await t('describeSearch lists repo, configured dirs, PATH', async () => {
      process.env.GAIA_TOOL_PATH = path.join(tmp, 'cfgd');
      const s = toolenv.describeSearch(repo);
      assert.ok(s.includes(path.join(repo, 'node_modules')));
      assert.ok(s.includes(path.join(tmp, 'cfgd')));
      assert.ok(s.includes('PATH'));
      delete process.env.GAIA_TOOL_PATH;
    });

    await t('junction: created only when repo lacks node_modules, removed cleanly, never overwrites', async () => {
      const toolRoot = path.join(tmp, 'toolroot');
      const nm = path.join(toolRoot, 'node_modules');
      fs.mkdirSync(nm, { recursive: true });
      const bare = path.join(tmp, 'junction-repo');
      fs.mkdirSync(bare, { recursive: true });

      // creates + reports
      const made = toolenv.ensureNodeModulesJunction(bare, nm);
      assert.equal(made.linked, true);
      assert.ok(fs.lstatSync(path.join(bare, 'node_modules')).isSymbolicLink());

      // refuses to overwrite an existing entry (even our own link)
      const again = toolenv.ensureNodeModulesJunction(bare, nm);
      assert.equal(again.linked, false);
      assert.match(again.reason, /already exists/);

      // removes only the link, not the target
      const removed = toolenv.removeNodeModulesJunction(bare, nm);
      assert.equal(removed, true);
      assert.ok(!fs.existsSync(path.join(bare, 'node_modules')));
      assert.ok(fs.statSync(nm).isDirectory(), 'target node_modules untouched');

      // never touches a REAL node_modules dir
      const realRepo = path.join(tmp, 'junction-repo2');
      fs.mkdirSync(path.join(realRepo, 'node_modules'), { recursive: true });
      const refuse = toolenv.ensureNodeModulesJunction(realRepo, nm);
      assert.equal(refuse.linked, false);
      const noRemove = toolenv.removeNodeModulesJunction(realRepo, nm);
      assert.equal(noRemove, false);
      assert.ok(fs.statSync(path.join(realRepo, 'node_modules')).isDirectory());
    });
  } finally {
    if (oldEnv.GAIA_TOOL_PATH === undefined) delete process.env.GAIA_TOOL_PATH;
    else process.env.GAIA_TOOL_PATH = oldEnv.GAIA_TOOL_PATH;
    process.env.HOME = oldEnv.HOME;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\ntoolenv: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();

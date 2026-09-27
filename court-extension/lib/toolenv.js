#!/usr/bin/env node
/**
 * lib/toolenv.js — external-tool resolution for the court engine.
 *
 * The courts drive the repo's own toolchain (jest for WITNESS / TRUSTGAP
 * verify, stryker-or-friends for TRUSTGAP mutation). Historically that
 * toolchain had to live in the OPENED folder's node_modules, because
 * resolution was `require.resolve(..., { paths: [repoRoot] })` or an
 * unmodified PATH — so a repo without `npm install` could not run any court.
 *
 * This module replaces repo-local-or-die with an explicit resolution chain:
 *
 *   1. the repo's own node_modules (preferred — version fidelity: ts-jest,
 *      babel transforms and stryker plugins are version-sensitive, and the
 *      repo pinned them);
 *   2. a user-configured tool path: GAIA_TOOL_PATH env (PATH-style list),
 *      then <repo>/.gaia/tool-path.json, then ~/.gaia/tool-path.json
 *      ({ "toolPath": [...] } — extra directories containing node_modules
 *      roots or .bin dirs);
 *   3. PATH (globally-installed tools).
 *
 * Every resolution result records WHERE the tool came from so errors and
 * court evidence can say exactly what was used (or what was searched, when
 * nothing was found). No silent guessing: a tool that cannot be resolved
 * produces an actionable error naming the searched locations.
 *
 * Zero deps; sync IO only at resolution time (cached per repoRoot).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const EXT_DIR = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Tool-path configuration
// ---------------------------------------------------------------------------
/**
 * Collect the user-configured tool search dirs for a repo, in priority
 * order. Sources (earlier wins):
 *   - GAIA_TOOL_PATH: PATH-style delimited list of directories
 *   - <repoRoot>/.gaia/tool-path.json: { "toolPath": ["dir", ...] }
 *   - ~/.gaia/tool-path.json: same shape, global default
 * Relative entries in the JSON files resolve against the file's own dir.
 */
function configuredToolDirs(repoRoot) {
  const dirs = [];
  const env = process.env.GAIA_TOOL_PATH;
  if (env) {
    for (const d of env.split(path.delimiter).filter(Boolean)) dirs.push(path.resolve(d));
  }
  const jsonFiles = [
    repoRoot ? path.join(repoRoot, '.gaia', 'tool-path.json') : null,
    path.join(os.homedir(), '.gaia', 'tool-path.json'),
  ].filter(Boolean);
  for (const fp of jsonFiles) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; }
    const list = parsed && Array.isArray(parsed.toolPath) ? parsed.toolPath : [];
    for (const d of list) {
      if (typeof d !== 'string' || !d) continue;
      dirs.push(path.resolve(path.dirname(fp), d));
    }
  }
  return dirs;
}

/**
 * Directories to search for a repo's node tools, in priority order:
 * repo root first, then configured dirs, then the extension's own dir
 * (last — a packaged extension carries no jest, but a dev checkout might).
 */
function nodeToolSearchDirs(repoRoot) {
  const dirs = [];
  if (repoRoot) dirs.push(repoRoot);
  dirs.push(...configuredToolDirs(repoRoot));
  dirs.push(EXT_DIR);
  return [...new Set(dirs)];
}

/** Extra PATH entries (bin dirs) for spawned tool processes, priority order. */
function toolPathEntries(repoRoot) {
  const entries = [];
  const seen = new Set();
  const add = (dir) => {
    if (!dir || seen.has(dir)) return;
    seen.add(dir);
    entries.push(dir);
  };
  if (repoRoot) add(path.join(repoRoot, 'node_modules', '.bin'));
  for (const d of configuredToolDirs(repoRoot)) {
    // Accept either a node_modules root, a .bin dir, or a plain bin dir.
    if (path.basename(d) === '.bin') add(d);
    else {
      add(path.join(d, 'node_modules', '.bin'));
      add(path.join(d, '.bin'));
      add(d);
    }
  }
  return entries.filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

/**
 * Child-process env with the tool path prepended to PATH. Repo .bin always
 * outranks configured dirs; both outrank the inherited PATH. Nothing is
 * removed — a tool the chain cannot provide still falls back to whatever
 * the user's shell would have found.
 *
 * NODE_PATH gets the corresponding node_modules roots so that when a
 * foreign jest CLI runs against the repo (rootDir = repo), named transforms
 * and plugins the repo's config references (ts-jest, babel presets) resolve
 * from the same install that provided jest. The repo's own node_modules is
 * always first — its versions win over any fallback's.
 */
function withToolPath(baseEnv, repoRoot) {
  const env = baseEnv || process.env;
  const extra = toolPathEntries(repoRoot);
  const nmRoots = nodeModulesRoots(repoRoot);
  let out = env;
  if (extra.length) {
    out = { ...out, PATH: [...extra, out.PATH || ''].filter(Boolean).join(path.delimiter) };
  }
  if (nmRoots.length) {
    out = { ...out, NODE_PATH: [...nmRoots, out.NODE_PATH || ''].filter(Boolean).join(path.delimiter) };
  }
  return out;
}

/** node_modules roots backing the tool chain, priority order (repo first). */
function nodeModulesRoots(repoRoot) {
  const roots = [];
  const seen = new Set();
  const add = (d) => {
    if (!d || seen.has(d)) return;
    seen.add(d);
    roots.push(d);
  };
  if (repoRoot) add(path.join(repoRoot, 'node_modules'));
  for (const d of configuredToolDirs(repoRoot)) {
    if (path.basename(d) === 'node_modules') add(d);
    else if (path.basename(d) === '.bin') add(path.dirname(d)); // <root>/node_modules/.bin -> node_modules
    else add(path.join(d, 'node_modules'));
  }
  return roots.filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

// ---------------------------------------------------------------------------
// Executable + package resolution
// ---------------------------------------------------------------------------
/** platform-aware executable file test (no symlink games — lstat'd real file). */
function isExecutableFile(fp) {
  try {
    const st = fs.statSync(fp);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') return true; // CreateProcess decides
    return (st.mode & 0o111) !== 0;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// node_modules junction (the last-resort fallback enabler)
// ---------------------------------------------------------------------------
/**
 * Jest resolves named config modules (transforms like ts-jest, presets,
 * plugins) against rootDir — the REPO — never against the jest CLI's own
 * install, and never via NODE_PATH. So a foreign jest cannot run a repo
 * whose config names such modules while the repo has no node_modules at
 * all. The honest escape hatch that keeps the engine zero-dep and zero-copy
 * is a filesystem junction: <repo>/node_modules -> the tool install's
 * node_modules. Zero bytes are copied, the repo's real sources are never
 * touched, and the link is reversible in one rmdir.
 *
 * We only ever create the junction when ALL of these hold:
 *   - the repo currently has NO node_modules entry at all (never overwrite
 *     a real install, a user's symlink, or even a broken one);
 *   - the tool that needs it was resolved from a configured tool dir, not
 *     from the repo itself (a repo-local tool needs no junction);
 *   - the caller passed autoJunction:true (explicit opt-in per court).
 *
 * Returns { linked: boolean, linkPath?, target?, reason }.
 */
function ensureNodeModulesJunction(repoRoot, targetNodeModules) {
  const linkPath = path.join(repoRoot, 'node_modules');
  const target = targetNodeModules;
  if (!repoRoot || !target) return { linked: false, reason: 'missing repoRoot or target' };
  let lst;
  try { lst = fs.lstatSync(linkPath); } catch { lst = null; }
  if (lst) return { linked: false, reason: 'node_modules already exists (never overwritten)' };
  let st;
  try { st = fs.statSync(target); } catch { return { linked: false, reason: 'target node_modules missing: ' + target }; }
  if (!st.isDirectory()) return { linked: false, reason: 'target is not a directory: ' + target };
  try {
    fs.symlinkSync(target, linkPath, 'junction'); // junction: no privilege needed on win32, fine on POSIX
    return { linked: true, linkPath, target };
  } catch (e) {
    return { linked: false, reason: 'symlink failed: ' + e.message };
  }
}

/** Remove a junction previously created by ensureNodeModulesJunction. Never
 *  removes a real directory or a link we did not make (we verify it is a
 *  symlink pointing at the expected target first). */
function removeNodeModulesJunction(repoRoot, expectedTarget) {
  const linkPath = path.join(repoRoot, 'node_modules');
  let lst;
  try { lst = fs.lstatSync(linkPath); } catch { return false; }
  if (!lst.isSymbolicLink()) return false; // a real dir — not ours, leave it
  try {
    const cur = fs.readlinkSync(linkPath);
    if (expectedTarget && path.resolve(cur) !== path.resolve(expectedTarget)) return false;
    fs.unlinkSync(linkPath); // unlink the symlink itself, never the target
    return true;
  } catch { return false; }
}

/**
 * Resolve a package's bin entry by walking the search dirs' node_modules.
 * Returns { bin, pkgDir, source } or null. `source` is the search dir that
 * provided the package (for diagnostics/evidence).
 */
function resolvePackageBin(packageName, binName, searchDirs) {
  for (const dir of searchDirs) {
    try {
      const pkgPath = require.resolve(`${packageName}/package.json`, { paths: [dir] });
      const pkgDir = path.dirname(pkgPath);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const binRel = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin && pkg.bin[binName || packageName]);
      if (!binRel) continue;
      const abs = path.resolve(pkgDir, binRel);
      if (fs.existsSync(abs)) return { bin: abs, pkgDir, source: dir };
    } catch { /* not under this dir — keep walking */ }
  }
  return null;
}

const WIN_EXTS = ['.cmd', '.exe', '.bat', '.ps1', ''];

/**
 * Find an executable on a PATH-style list of dirs. Returns the absolute
 * path or null. Never picks a directory; on POSIX requires +x.
 */
function whichIn(cmd, pathDirs) {
  for (const dir of pathDirs) {
    for (const ext of WIN_EXTS) {
      const fp = path.join(dir, cmd + (process.platform === 'win32' ? ext : ''));
      if (isExecutableFile(fp)) return fp;
    }
  }
  return null;
}

/**
 * Full executable resolution chain for a bare command name:
 * repo .bin → configured tool dirs → inherited PATH.
 * Returns { exe, source } or null (source: 'repo' | config dir | 'PATH').
 */
function resolveExecutable(cmd, repoRoot, env) {
  const repoBin = repoRoot ? path.join(repoRoot, 'node_modules', '.bin') : null;
  if (repoBin) {
    const hit = whichIn(cmd, [repoBin]);
    if (hit) return { exe: hit, source: 'repo' };
  }
  for (const d of configuredToolDirs(repoRoot)) {
    const bins = path.basename(d) === '.bin' ? [d] : [path.join(d, 'node_modules', '.bin'), path.join(d, '.bin'), d];
    const hit = whichIn(cmd, bins);
    if (hit) return { exe: hit, source: d };
  }
  const pathDirs = String((env || process.env).PATH || '').split(path.delimiter).filter(Boolean);
  const hit = whichIn(cmd, pathDirs);
  if (hit) return { exe: hit, source: 'PATH' };
  return null;
}

/** Human-readable account of where a tool search looked, for honest errors. */
function describeSearch(repoRoot) {
  const parts = [];
  if (repoRoot) parts.push(`${repoRoot}/node_modules`);
  const conf = configuredToolDirs(repoRoot);
  if (conf.length) parts.push(...conf);
  parts.push('PATH');
  return parts.join(' → ');
}

module.exports = {
  configuredToolDirs,
  nodeToolSearchDirs,
  toolPathEntries,
  nodeModulesRoots,
  withToolPath,
  resolvePackageBin,
  resolveExecutable,
  describeSearch,
  ensureNodeModulesJunction,
  removeNodeModulesJunction,
};

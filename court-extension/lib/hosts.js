#!/usr/bin/env node
/** Non-destructive, per-host court setup. No destination is written until the
 * whole host's config, source files and target paths have passed preflight. */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AGENTS = ['spec-witness', 'test-author', 'mutant-analyst', 'war-room'];
const ENGINE_TOOL_NAMES = [
  'redline_clauses', 'redline_verdict_all', 'redline_clause',
  'splitbrain_trustgap', 'splitbrain_mutants', 'splitbrain_mutate', 'splitbrain_status',
  'warpath_context', 'warpath_triage', 'warpath_postmortem', 'courts_about',
];
const EXT_DIR = path.resolve(__dirname, '..');
const ENGINE_ENTRY = path.join(EXT_DIR, 'court.js');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function safeStat(fp) {
  try { return fs.lstatSync(fp); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function validateDirectory(fp) {
  const parent = path.dirname(fp);
  if (parent !== fp) validateDirectory(parent);
  const stat = safeStat(fp);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
    throw new Error(`unsafe directory (not a real directory): ${fp}`);
  }
}

function validateTarget(fp) {
  validateDirectory(path.dirname(fp));
  const stat = safeStat(fp);
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) {
    throw new Error(`unsafe target (not a regular unlinked file): ${fp}`);
  }
  return stat;
}

function readJson(fp) {
  const stat = validateTarget(fp);
  if (!stat) return {};
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch (error) { throw new Error(`invalid JSON in ${fp}: ${error.message}`); }
  if (!isObject(parsed)) throw new Error(`expected JSON object in ${fp}`);
  return parsed;
}

function serverConfig(repoRoot, kind, old) {
  const base = isObject(old) ? old : {};
  const entry = { ...base, command: 'node', args: [ENGINE_ENTRY, '--repo', repoRoot] };
  if (kind === 'vscode') entry.type = 'stdio';
  if (kind === 'mcp' && !isObject(old)) {
    entry.alwaysAllow = ENGINE_TOOL_NAMES;
    entry.disabled = false;
  }
  return entry;
}

function mergeMcp(fp, repoRoot, kind) {
  const j = readJson(fp);
  const key = kind === 'codex' ? 'mcp_servers' : kind === 'vscode' ? 'servers' : 'mcpServers';
  if (j[key] !== undefined && !isObject(j[key])) throw new Error(`expected ${key} object in ${fp}`);
  const servers = j[key] || {};
  if (Object.prototype.hasOwnProperty.call(servers, 'triumph-courts') &&
      !isObject(servers['triumph-courts'])) {
    throw new Error(`expected triumph-courts object in ${fp}`);
  }
  // Only refresh the engine location. Preserve disabled, alwaysAllow and all
  // other user-supplied server settings, including those on our own entry.
  servers['triumph-courts'] = serverConfig(repoRoot, kind, servers['triumph-courts']);
  j[key] = servers;
  return JSON.stringify(j, null, 2) + '\n';
}

function loadYaml() {
  // Bundle the parser with the extension: Bob installs must work without an
  // unrelated global npm installation, while the court engine remains zero-dep.
  //
  // NOTE — two YAML implementations coexist deliberately. lib/config.js ships
  // a zero-dep YAML *subset* parser for `.triumph.yml` (author-controlled,
  // flat schema). This vendored full parser exists solely for merging the
  // user's pre-existing Bob `custom_modes.yaml` (arbitrary third-party YAML:
  // anchors, comments, key order), where a subset parser would corrupt the
  // document on round-trip. Do not "dedupe" one into the other.
  return require('../vendor/yaml');
}

function modeSlugs(modes, fp) {
  if (!isObject(modes) || !Array.isArray(modes.customModes)) {
    throw new Error(`expected customModes array in ${fp}`);
  }
  const seen = new Set();
  for (const mode of modes.customModes) {
    if (!isObject(mode) || typeof mode.slug !== 'string' || !mode.slug || seen.has(mode.slug)) {
      throw new Error(`invalid or duplicate custom mode slug in ${fp}`);
    }
    seen.add(mode.slug);
  }
  return seen;
}

function mergeModes(fp) {
  const source = path.join(EXT_DIR, 'agents', 'bob', 'custom_modes.yaml');
  const existing = validateTarget(fp) ? fs.readFileSync(fp, 'utf8') : null;
  const incoming = fs.readFileSync(source, 'utf8');
  const yaml = loadYaml();
  const parse = (text, name) => {
    const doc = yaml.parseDocument(text, { uniqueKeys: true });
    if (doc.errors.length) throw new Error(`invalid YAML in ${name}: ${doc.errors[0].message}`);
    modeSlugs(doc.toJS(), name);
    return doc;
  };
  const sourceDoc = parse(incoming, source);
  if (existing === null) return incoming;
  const doc = parse(existing, fp);
  const present = modeSlugs(doc.toJS(), fp);
  const targetSeq = doc.get('customModes', true);
  let added = false;
  for (const item of sourceDoc.get('customModes', true).items) {
    if (!present.has(item.get('slug'))) {
      targetSeq.add(item.clone());
      added = true;
    }
  }
  return added ? String(doc) : existing;
}

function collectTree(src, dest, add) {
  if (!safeStat(src)) return;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) collectTree(from, to, add);
    else if (entry.isFile()) add(to, fs.readFileSync(from), true);
    else throw new Error(`unsafe source entry: ${from}`);
  }
}

function createPlan(hostId, root) {
  const files = [];
  const changes = [];
  const seen = new Set();
  function add(fp, body, onlyIfMissing = false) {
    if (seen.has(fp)) throw new Error(`duplicate destination: ${fp}`);
    seen.add(fp);
    const stat = validateTarget(fp);
    files.push(fp);
    if (stat && onlyIfMissing) return; // Never replace a user's agent/skill/rule edits.
    const content = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const original = stat ? fs.readFileSync(fp) : null;
    if (original && original.equals(content)) return;
    changes.push({ fp, content, original, stat });
  }
  const agentsDir = path.join(root, hostId === 'claude' ? '.claude' :
    hostId === 'bob' ? '.bob' : hostId === 'codex' ? '.codex' : '.triumph', 'agents');
  if (hostId !== 'vscode') {
    for (const name of AGENTS) {
      add(path.join(agentsDir, name + '.md'),
        fs.readFileSync(path.join(EXT_DIR, 'agents', name + '.md')), true);
    }
  }
  if (hostId === 'bob') {
    const bob = path.join(root, '.bob');
    collectTree(path.join(EXT_DIR, 'agents', 'skills'), path.join(bob, 'skills'), add);
    collectTree(path.join(EXT_DIR, 'agents', 'bob'), bob, (fp, body, onlyIfMissing) => {
      if (path.basename(fp) === 'custom_modes.yaml' && fp === path.join(bob, 'custom_modes.yaml')) {
        add(fp, mergeModes(fp));
      } else add(fp, body, onlyIfMissing);
    });
  }
  const config = hostId === 'claude' ? path.join(root, '.mcp.json') :
    hostId === 'vscode' ? path.join(root, '.vscode', 'mcp.json') :
    path.join(root, hostId === 'bob' ? '.bob' : hostId === 'codex' ? '.codex' : '.triumph',
      hostId === 'codex' ? 'config.json' : 'mcp.json');
  add(config, mergeMcp(config, root, hostId === 'codex' ? 'codex' : hostId === 'vscode' ? 'vscode' : 'mcp'));
  if (hostId === 'vscode') {
    for (const name of AGENTS) {
      const body = fs.readFileSync(path.join(EXT_DIR, 'agents', name + '.md'), 'utf8')
        .replace(/^name:/m, 'description:');
      add(path.join(root, '.github', 'chatmodes', `triumph-${name}.chatmode.md`), body, true);
    }
  }
  return { files, changes };
}

function installChanges(changes) {
  const createdDirs = [];
  const applied = [];
  const scratch = [];
  const retainedBackups = new Set();
  const unique = (fp, kind = 'temp') => path.join(path.dirname(fp), `.${path.basename(fp)}.triumph-${kind}-${process.pid}-${crypto.randomBytes(12).toString('hex')}`);
  function mkdir(dir) {
    if (safeStat(dir)) { validateDirectory(dir); return; }
    mkdir(path.dirname(dir));
    fs.mkdirSync(dir);
    createdDirs.push(dir);
  }
  try {
    for (const change of changes) {
      const { fp, content, original, stat } = change;
      mkdir(path.dirname(fp));
      const current = validateTarget(fp);
      if (Boolean(current) !== Boolean(stat) ||
          (current && (current.ino !== stat.ino || current.dev !== stat.dev ||
            current.mode !== stat.mode || !fs.readFileSync(fp).equals(original)))) {
        throw new Error(`destination changed during setup: ${fp}`);
      }
      let backup;
      if (stat) {
        backup = unique(fp, 'backup');
        scratch.push(backup); // cleanup even if the copy partially creates it
        fs.copyFileSync(fp, backup, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(backup, stat.mode & 0o7777);
      }
      const temp = unique(fp);
      scratch.push(temp);
      fs.writeFileSync(temp, content, { flag: 'wx', mode: stat ? stat.mode & 0o7777 : 0o666 });
      if (stat) fs.chmodSync(temp, stat.mode & 0o7777);
      fs.renameSync(temp, fp); // atomic replacement on the same filesystem
      applied.push({ fp, backup });
    }
    // Retain backups after a successful install so the caller can explicitly
    // restore its previous configuration; keep original permissions (secrets).
    for (const { backup } of applied) if (backup) retainedBackups.add(backup);
  } catch (error) {
    const failures = [];
    for (const { fp, backup } of applied.reverse()) {
      try {
        if (backup) fs.renameSync(backup, fp);
        else fs.unlinkSync(fp);
      } catch (rollbackError) {
        if (backup) retainedBackups.add(backup);
        failures.push(`${fp}: ${rollbackError.message}${backup ? ` (backup: ${backup})` : ''}`);
      }
    }
    for (const dir of createdDirs.reverse()) {
      try { fs.rmdirSync(dir); }
      catch (rollbackError) { failures.push(`${dir}: ${rollbackError.message}`); }
    }
    if (failures.length) error.message += `; rollback incomplete: ${failures.join('; ')}`;
    throw error;
  } finally {
    for (const fp of scratch) {
      if (retainedBackups.has(fp)) continue;
      try { fs.unlinkSync(fp); }
      catch (error) { if (error.code !== 'ENOENT') console.error(`could not remove setup scratch file ${fp}: ${error.message}`); }
    }
  }
  return [...retainedBackups];
}

const HOSTS = Object.fromEntries([
  ['claude', 'Claude Code'], ['bob', 'IBM Bob'], ['codex', 'OpenAI Codex'],
  ['vscode', 'VS Code Chat'], ['generic', 'Generic MCP host'],
].map(([id, name]) => [id, { name, install(repoRoot) {
  const plan = createPlan(id, repoRoot);
  const backups = installChanges(plan.changes);
  return { files: plan.files, backups };
} }]));

function installHost(hostId, repoRoot) {
  const host = HOSTS[hostId];
  if (!host) throw new Error('unknown host ' + hostId + ' (known: ' + Object.keys(HOSTS).join(', ') + ')');
  const root = path.resolve(repoRoot);
  const stat = safeStat(root);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`unsafe repository directory: ${root}`);
  validateDirectory(root);
  return { host: hostId, hostName: host.name, ...host.install(root) };
}

module.exports = { HOSTS, installHost, AGENTS, ENGINE_TOOL_NAMES, ENGINE_ENTRY, EXT_DIR };

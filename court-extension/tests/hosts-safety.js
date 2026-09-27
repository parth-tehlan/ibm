#!/usr/bin/env node
'use strict';
// Run independently: node court-extension/tests/hosts-safety.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installHost, ENGINE_TOOL_NAMES } = require('../lib/hosts');

let count = 0;
function test(name, fn) {
  // realpathSync: os.tmpdir() on macOS is under /var, itself a symlink to
  // /private/var. installHost's validateDirectory walks up the full parent
  // chain rejecting any symlinked component - a real, intentional anti-
  // traversal check on real repo paths (never relaxed here, and still
  // exercised directly below by tests that create genuine symlinks under
  // this same canonicalized root). Canonicalize the test's own tmp root so
  // it matches an ordinary, non-symlinked repo path instead of tripping
  // that check on the OS's own plumbing.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-host-safety-')));
  try { fn(root); console.log(`ok ${++count} - ${name}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function put(root, relative, content, mode) {
  const fp = path.join(root, relative);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content);
  if (mode !== undefined) fs.chmodSync(fp, mode);
  return fp;
}
function snapshot(root) {
  const out = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, entry.name);
      const relative = path.relative(root, fp);
      if (entry.isDirectory()) walk(fp);
      else if (entry.isSymbolicLink()) out[relative] = ['symlink', fs.readlinkSync(fp)];
      else out[relative] = [fs.readFileSync(fp).toString('base64'), fs.statSync(fp).mode & 0o7777];
    }
  }
  walk(root);
  return out;
}

 test('Bob merges modes by slug and MCP by server without losing user edits', (root) => {
  const yaml = `# user comment\ncustomModes:\n  - slug: witness\n    name: My edited witness\n    groups: [read]\n  - slug: my-mode\n    name: Private mode\n    groups: [execute]\notherSetting: retained\n`;
  const modes = put(root, '.bob/custom_modes.yaml', yaml, 0o600);
  const config = put(root, '.bob/mcp.json', JSON.stringify({ mcpServers: {
    'gaia-courts': { disabled: true, alwaysAllow: ['my-tool'], env: { PRIVATE: 'kept' }, command: 'old' },
    personal: { command: 'personal' },
  }, extra: { untouched: true } }), 0o640);
  const agent = put(root, '.bob/agents/spec-witness.md', 'user-customized agent\n');
  const rule = put(root, '.bob/rules-witness/00-never-src.md', 'customized rule\n');
  const skill = put(root, '.bob/skills/witness-test/SKILL.md', 'customized skill\n');
  const { files, backups } = installHost('bob', root);
  assert.ok(files.includes(modes));
  assert.equal(backups.length, 2, 'preserve backups of both changed user configs');
  assert.equal(fs.readFileSync(backups.find((fp) => fp.includes('custom_modes.yaml')), 'utf8'), yaml);
  assert.deepEqual(JSON.parse(fs.readFileSync(backups.find((fp) => fp.includes('mcp.json')), 'utf8')).mcpServers.personal, { command: 'personal' });
  assert.ok(backups.every((fp) => fs.statSync(fp).mode & 0o400));
  const merged = fs.readFileSync(modes, 'utf8');
  assert.match(merged, /# user comment/);
  assert.match(merged, /My edited witness/);
  assert.match(merged, /Private mode/);
  assert.match(merged, /otherSetting: retained/);
  for (const slug of ['witness', 'isolate', 'surgeon', 'incident-commander', 'control-agent', 'my-mode']) {
    assert.match(merged, new RegExp(`slug: ${slug}\\b`));
  }
  assert.equal(fs.readFileSync(agent, 'utf8'), 'user-customized agent\n');
  assert.equal(fs.readFileSync(rule, 'utf8'), 'customized rule\n');
  assert.equal(fs.readFileSync(skill, 'utf8'), 'customized skill\n');
  const parsed = JSON.parse(fs.readFileSync(config));
  assert.equal(parsed.mcpServers['gaia-courts'].disabled, true);
  assert.deepEqual(parsed.mcpServers['gaia-courts'].alwaysAllow, ['my-tool']);
  assert.deepEqual(parsed.mcpServers['gaia-courts'].env, { PRIVATE: 'kept' });
  assert.deepEqual(parsed.mcpServers.personal, { command: 'personal' });
  assert.deepEqual(parsed.extra, { untouched: true });
  assert.deepEqual(parsed.mcpServers['gaia-courts'].args.slice(-2), ['--repo', root]);
  assert.equal(fs.statSync(modes).mode & 0o777, 0o600);
  assert.equal(fs.statSync(config).mode & 0o777, 0o640);
  const before = snapshot(root);
  installHost('bob', root);
  assert.deepEqual(snapshot(root), before, 'reinstall must be idempotent');
});

test('new Bob install creates valid defaults', (root) => {
  installHost('bob', root);
  const conf = JSON.parse(fs.readFileSync(path.join(root, '.bob/mcp.json')));
  assert.equal(conf.mcpServers['gaia-courts'].disabled, false);
  assert.deepEqual(conf.mcpServers['gaia-courts'].alwaysAllow, ENGINE_TOOL_NAMES);
  assert.match(fs.readFileSync(path.join(root, '.bob/custom_modes.yaml'), 'utf8'), /slug: witness/);
});

test('malformed JSON fails before any host writes, for every host', (root) => {
  const paths = { bob: '.bob/mcp.json', claude: '.mcp.json', codex: '.codex/config.json',
    vscode: '.vscode/mcp.json', generic: '.gaia/mcp.json' };
  for (const [host, relative] of Object.entries(paths)) {
    const dir = path.join(root, host);
    fs.mkdirSync(dir);
    put(dir, relative, '{ broken JSON', 0o600);
    const before = snapshot(dir);
    assert.throws(() => installHost(host, dir), /invalid JSON/);
    assert.deepEqual(snapshot(dir), before, `${host} modified files after parse failure`);
  }
});

test('malformed YAML and duplicate slugs fail before any Bob writes', (root) => {
  const fp = put(root, '.bob/custom_modes.yaml', 'customModes:\n  - slug: [unterminated\n');
  let before = snapshot(root);
  assert.throws(() => installHost('bob', root), /invalid YAML/);
  assert.deepEqual(snapshot(root), before);
  fs.writeFileSync(fp, 'customModes:\n  - slug: same\n  - slug: same\n');
  before = snapshot(root);
  assert.throws(() => installHost('bob', root), /duplicate custom mode slug/);
  assert.deepEqual(snapshot(root), before);
  fs.writeFileSync(fp, 'customModes: wrong-type\n');
  before = snapshot(root);
  assert.throws(() => installHost('bob', root), /expected customModes array/);
  assert.deepEqual(snapshot(root), before);
});

test('symlinks and suspicious targets are refused before writing', (root) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-outside-'));
  try {
    put(outside, 'canary', 'do not change');
    fs.symlinkSync(outside, path.join(root, '.bob'));
    assert.throws(() => installHost('bob', root), /unsafe directory/);
    assert.equal(fs.readFileSync(path.join(outside, 'canary'), 'utf8'), 'do not change');
    fs.unlinkSync(path.join(root, '.bob'));
    const target = put(outside, 'config', '{}');
    fs.mkdirSync(path.join(root, '.bob'));
    fs.symlinkSync(target, path.join(root, '.bob/mcp.json'));
    const before = snapshot(root);
    assert.throws(() => installHost('bob', root), /unsafe target/);
    assert.deepEqual(snapshot(root), before);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
});

test('rename failure rolls back overwritten configs and newly created files', (root) => {
  const config = put(root, '.bob/mcp.json', '{\n  "mcpServers": { "private": { "command": "keep" } }\n}\n', 0o600);
  put(root, '.bob/agents/spec-witness.md', 'leave user file alone');
  const before = snapshot(root);
  const original = fs.renameSync;
  let calls = 0;
  try {
    fs.renameSync = function (from, to) {
      if (++calls === 19) throw new Error('injected rename failure');
      return original(from, to);
    };
    assert.throws(() => installHost('bob', root), /injected rename failure/);
  } finally { fs.renameSync = original; }
  assert.ok(calls >= 19, 'failure must occur after writes began');
  assert.deepEqual(snapshot(root), before);
  assert.equal(fs.statSync(config).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.join(root, '.bob')).sort(), ['agents', 'mcp.json']);
});

test('late failure rolls back an already overwritten config', (root) => {
  const conf = put(root, '.vscode/mcp.json', '{ "servers": { "private": { "command": "stay" } } }', 0o640);
  const before = snapshot(root);
  const original = fs.renameSync;
  let calls = 0;
  try {
    fs.renameSync = function (from, to) {
      if (++calls === 2) throw new Error('injected second rename failure');
      return original(from, to);
    };
    assert.throws(() => installHost('vscode', root), /injected second rename failure/);
  } finally { fs.renameSync = original; }
  assert.deepEqual(snapshot(root), before);
  assert.equal(fs.statSync(conf).mode & 0o777, 0o640);
});

test('other hosts preserve unrelated servers, custom entry settings, and permissions', (root) => {
  const configs = { claude: ['.mcp.json', 'mcpServers'], codex: ['.codex/config.json', 'mcp_servers'],
    vscode: ['.vscode/mcp.json', 'servers'], generic: ['.gaia/mcp.json', 'mcpServers'] };
  for (const [host, [relative, key]] of Object.entries(configs)) {
    const repo = path.join(root, host);
    fs.mkdirSync(repo);
    const fp = put(repo, relative, JSON.stringify({ theme: 'keep', [key]: {
      personal: { command: 'custom' },
      'gaia-courts': { disabled: true, alwaysAllow: ['limited'], env: { HOME: 'user' } },
    } }), 0o600);
    installHost(host, repo);
    const config = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.equal(config.theme, 'keep');
    assert.deepEqual(config[key].personal, { command: 'custom' });
    assert.equal(config[key]['gaia-courts'].disabled, true);
    assert.deepEqual(config[key]['gaia-courts'].alwaysAllow, ['limited']);
    assert.deepEqual(config[key]['gaia-courts'].env, { HOME: 'user' });
    assert.equal(fs.statSync(fp).mode & 0o777, 0o600);
    const before = snapshot(repo);
    installHost(host, repo);
    assert.deepEqual(snapshot(repo), before);
  }
});

test('hardlinks and late destination conflicts fail in preflight', (root) => {
  const canary = put(root, 'canary', '{}');
  fs.mkdirSync(path.join(root, '.bob'));
  fs.linkSync(canary, path.join(root, '.bob/mcp.json'));
  let before = snapshot(root);
  assert.throws(() => installHost('bob', root), /unsafe target/);
  assert.deepEqual(snapshot(root), before);
  fs.unlinkSync(path.join(root, '.bob/mcp.json'));
  put(root, '.bob/rules-surgeon', 'blocking file');
  before = snapshot(root);
  assert.throws(() => installHost('bob', root), /unsafe directory/);
  assert.deepEqual(snapshot(root), before);
});

console.log(`${count} host safety tests passed`);

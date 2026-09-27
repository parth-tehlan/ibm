#!/usr/bin/env node
// Exercise only the bytes of a staged VSIX, never the checkout or a real Bob profile.
// Usage: node scripts/verify-packaged-bob.mjs court-extension/gaia-courts.vsix
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const archive = path.resolve(process.argv[2] || path.join(here, '../court-extension/gaia-courts.vsix'));
// realpathSync: os.tmpdir() on macOS is under /var, itself a symlink to
// /private/var. Node's own module resolution (require.resolve, __dirname)
// canonicalizes symlinks, so comparing an un-resolved sandbox path against
// resolved paths from inside the extension would spuriously fail on macOS.
// Canonicalize the sandbox root itself, once, rather than loosening any
// downstream identity check.
const sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), 'gaia-packaged-bob-')));
const extension = path.join(sandbox, 'extension');
const workspace = path.join(sandbox, 'disposable-workspace');
const mcpPath = path.join(workspace, '.bob', 'mcp.json');
const modesPath = path.join(workspace, '.bob', 'custom_modes.yaml');
const readMcp = () => JSON.parse(readFileSync(mcpPath, 'utf8'));
const readModes = () => readFileSync(modesPath, 'utf8');
const countSlug = (yaml, slug) => [...yaml.matchAll(/^\s*- slug: ([^\s]+)\s*$/gm)].filter((match) => match[1] === slug).length;

try {
  assert.ok(existsSync(archive), `VSIX missing: ${archive} (package first)`);
  execFileSync('unzip', ['-q', archive, '-d', sandbox]);
  const manifest = path.join(extension, 'package.json');
  const hostsFile = path.join(extension, 'lib', 'hosts.js');
  assert.ok(existsSync(manifest) && existsSync(hostsFile), 'VSIX missing Bob installer runtime');
  const require = createRequire(manifest);
  // The VSIX must ship its own YAML parser; never borrow one from the host.
  const resolvedYaml = require.resolve('./vendor/yaml');
  assert.ok(resolvedYaml.startsWith(extension + path.sep), `YAML parser not shipped in VSIX: ${resolvedYaml}`);
  const { installHost, ENGINE_ENTRY } = require('./lib/hosts.js');
  assert.equal(ENGINE_ENTRY, path.join(extension, 'court.js'), 'installer loaded outside the VSIX');
  assert.ok(existsSync(ENGINE_ENTRY), 'VSIX missing court.js');

  mkdirSync(path.dirname(mcpPath), { recursive: true });
  // A real user's unrelated MCP and mode must remain untouched. The disabled
  // mode belongs to the user, not to gaia; the second install also checks a
  // user-disabled gaia MCP and court mode survive upgrades.
  const userServer = { command: 'user-tool', args: ['--offline'], disabled: true };
  writeFileSync(mcpPath, JSON.stringify({ mcpServers: { 'my-server': userServer }, mySetting: 'keep' }, null, 2));
  const userMode = '  - slug: my-private-mode\n    name: My private mode\n    disabled: true\n    groups:\n      - read\n    customInstructions: user-owned\n';
  writeFileSync(modesPath, 'customModes:\n' + userMode);

  const first = installHost('bob', workspace);
  assert.equal(first.host, 'bob');
  assert.ok(first.files.length > 0);
  assert.ok(first.files.every((file) => file.startsWith(workspace + path.sep)), 'installer wrote outside disposable workspace');
  assert.deepEqual(readMcp().mcpServers['my-server'], userServer);
  assert.equal(readMcp().mySetting, 'keep');
  assert.equal(countSlug(readModes(), 'my-private-mode'), 1, 'first install erased/duplicated a user mode');
  assert.ok(readModes().includes(userMode), 'first install altered user mode settings');
  for (const slug of ['witness', 'isolate', 'surgeon', 'incident-commander', 'control-agent']) {
    assert.equal(countSlug(readModes(), slug), 1, `missing/duplicated bundled court mode ${slug}`);
  }
  const mcp = readMcp();
  assert.deepEqual(mcp.mcpServers['gaia-courts'].args, [ENGINE_ENTRY, '--repo', workspace]);
  assert.ok(existsSync(path.join(workspace, '.bob', 'agents', 'spec-witness.md')));
  assert.ok(existsSync(path.join(workspace, '.bob', 'rules-witness', '00-never-src.md')));

  // Simulate Bob user changes made after installation, before an upgrade.
  mcp.mcpServers['gaia-courts'].disabled = true;
  writeFileSync(mcpPath, JSON.stringify(mcp, null, 2));
  const firstModes = readModes();
  assert.match(firstModes, /^  - slug: witness\s*$/m);
  writeFileSync(modesPath, firstModes.replace(/^  - slug: witness\s*$/m, '  - slug: witness\n    disabled: true'));
  installHost('bob', workspace);
  const after = readMcp();
  assert.deepEqual(after.mcpServers['my-server'], userServer);
  assert.equal(after.mySetting, 'keep');
  assert.equal(after.mcpServers['gaia-courts'].disabled, true, 'reinstall re-enabled a user-disabled gaia MCP');
  assert.deepEqual(after.mcpServers['gaia-courts'].args, [ENGINE_ENTRY, '--repo', workspace]);
  const modes = readModes();
  assert.equal(countSlug(modes, 'my-private-mode'), 1);
  assert.ok(modes.includes(userMode), 'reinstall changed a user-owned mode');
  assert.match(modes, /^  - slug: witness\n    disabled: true\s*$/m, 'reinstall re-enabled a disabled court mode');
  for (const slug of ['witness', 'isolate', 'surgeon', 'incident-commander', 'control-agent']) {
    assert.equal(countSlug(modes, slug), 1, `reinstall duplicated court mode ${slug}`);
  }
  console.log('PASS: extracted VSIX Bob install/reinstall preserves user modes and disabled settings in disposable workspace');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
// Explicit exit: this runtime's node prints to stdout then SIGABRTs at
// teardown (exit 134), which would read as failure under `set -e` deploy
// scripting. The try/finally above completed when this line is reached.
process.exit(0);

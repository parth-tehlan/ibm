// Build an isolated dashboard runtime for the extension's VSIX packaging step.
// No repository-specific court engine, Northstar checkout, or Vite dev server is included.
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.argv[2] || path.join(root, '.runtime'));
const marker = path.join(output, '.triumph-runtime-staging');
if (output === root || root.startsWith(`${output}${path.sep}`)) throw new Error('Refusing to stage over the dashboard source tree');
try {
  await stat(output);
  const existing = await readFile(marker, 'utf8').catch(() => null);
  if (existing !== 'TRIUMPH dashboard runtime\n') throw new Error(`Refusing to replace unmarked directory: ${output}`);
  await rm(output, { recursive: true, force: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(output, { recursive: true });
await writeFile(marker, 'TRIUMPH dashboard runtime\n');
for (const entry of [
  'dist', 'server/index.js', 'server/app.js', 'server/history.js', 'server/bridge.js',
  'server/mutation-bus.js', 'contracts/report.js', 'reports/export.js', 'package.json', 'package-lock.json',
]) {
  const destination = path.join(output, entry);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(root, entry), destination, { recursive: true });
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: output, stdio: 'inherit', shell: process.platform === 'win32',
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Runtime dependency install failed (${result.status})`);
console.log(`Dashboard runtime staged at ${output}`);

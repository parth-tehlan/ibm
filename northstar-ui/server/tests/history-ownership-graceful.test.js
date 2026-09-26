import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../index.js', import.meta.url));
function wait(child, type, requestId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('IPC timeout')); }, 10000);
    const exit = () => { cleanup(); reject(new Error('child exited')); };
    const receive = (value) => { if (value?.type === type && (!requestId || requestId === value.requestId)) { cleanup(); resolve(value); } };
    function cleanup() { clearTimeout(timer); child.off('message', receive); child.off('exit', exit); }
    child.on('message', receive); child.once('exit', exit);
  });
}
async function spawn(data) {
  const child = fork(entry, [], { execArgv: [], env: { ...process.env, PORT: '0', XDG_DATA_HOME: data, TRIUMPH_HOST: '127.0.0.1', TRIUMPH_LEGACY_DIR: path.join(data, 'absent') }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  return { child, url: (await wait(child, 'triumph.ready')).url };
}
async function run(server) {
  const project = { id: randomUUID(), name: 'window' };
  const requestId = randomUUID();
  const registered = wait(server.child, 'triumph.registered', requestId);
  server.child.send({ type: 'triumph.register', requestId, project });
  assert.match((await registered).token, /^[0-9a-f]{64}$/);
  const response = await fetch(`${server.url}/api/projects/${project.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"courts":["warpath"]}' });
  assert.equal(response.status, 202);
  return { project, runId: (await response.json()).runId };
}
async function load(server, run) { return (await (await fetch(`${server.url}/api/projects/${run.project.id}/runs/${run.runId}`)).json()); }
async function stop(child) {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM'); await exited;
}
test('graceful stop interrupts only its own unfinished runs; sibling window keeps running', async (t) => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'triumph-graceful-'));
  const servers = [];
  t.after(async () => { await Promise.all(servers.map(({ child }) => stop(child))); await rm(data, { recursive: true, force: true }); });
  const first = await spawn(data); servers.push(first);
  const second = await spawn(data); servers.push(second);
  const a = await run(first), b = await run(second);
  await stop(first.child);
  assert.equal((await load(second, a)).state, 'interrupted');
  assert.equal((await load(second, a)).revision, 1);
  assert.equal((await load(second, b)).state, 'running');
  assert.equal((await load(second, b)).revision, 0);
});

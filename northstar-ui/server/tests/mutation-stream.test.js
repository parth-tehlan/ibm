import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { createHistory } from '../history.js';
import { createMutationBus } from '../mutation-bus.js';

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gaia-mutation-sse-'));
  const history = createHistory({ dir });
  const app = createApp({ history });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  return { app, history, base: `http://127.0.0.1:${server.address().port}` };
}

test('mutation bus: replay-first subscribe, terminal frame, sweep of finished runs', () => {
  const bus = createMutationBus();
  const key = `${randomUUID()}:${randomUUID()}`;
  bus.push(key, { tested: 1, total: 4, line: '1/4 Mutants' });
  bus.push(key, { verdict: 'Killed: 1' });
  bus.done(key, 'done', null);

  const frames = [];
  const off = bus.subscribe(key, (frame) => frames.push(frame));
  assert.equal(frames.length, 3, 'late subscriber replays buffered events + done frame');
  assert.equal(frames[0].type, 'progress');
  assert.equal(frames[2].type, 'done');
  assert.equal(typeof off, 'function');

  // Terminal runs are immutable.
  bus.push(key, { tested: 99 });
  assert.equal(bus.replay(key).events.length, 2);

  // Corrupt input never throws.
  bus.push('no-colon', { tested: 1 });
  bus.push(key, null);
  bus.done('also-no-colon');

  // Sweep drops finished runs with no listeners.
  const entry = bus.replay(key);
  assert.ok(entry && entry.done);
  bus.sweep(0); // default now() — entry is fresh, kept
  assert.ok(bus.replay(key), 'fresh finished run survives a sweep');
});

test('SSE endpoint streams pushed events and the terminal frame', async (t) => {
  const { app, base } = await setup(t);
  const projectId = randomUUID();
  const runId = randomUUID();
  const runKey = `${projectId}:${runId}`;

  const controller = new AbortController();
  const res = await fetch(`${base}/api/projects/${projectId}/runs/${runId}/mutation-stream`, { signal: controller.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const frames = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const readNext = () => reader.read().then(({ value }) => {
    buf += decoder.decode(value || new Uint8Array(), { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
      if (dataLine) frames.push(JSON.parse(dataLine.slice(6)));
    }
  });

  // Push after the stream is open.
  app.locals.mutationBus.push(runKey, { tested: 2, total: 5, killed: 1, killRate: 50, line: '2/5 Mutants' });
  app.locals.mutationBus.push(runKey, { verdict: 'Survived: 1' });
  app.locals.mutationBus.done(runKey, 'done', null);

  for (let i = 0; i < 3; i++) await readNext();
  assert.equal(frames.length, 3);
  assert.equal(frames[0].event.tested, 2);
  assert.equal(frames[0].event.killRate, 50);
  assert.equal(frames[2].type, 'done');
  controller.abort();
});

test('mutation-stream rejects malformed ids; replay returns 404 without a log', async (t) => {
  const { base } = await setup(t);
  const projectId = randomUUID();
  const runId = randomUUID();
  assert.equal((await fetch(`${base}/api/projects/not-an-id/runs/${runId}/mutation-stream`)).status, 404);
  assert.equal((await fetch(`${base}/api/projects/${projectId}/runs/not-an-id/mutation-stream/replay`)).status, 404);
  assert.equal((await fetch(`${base}/api/projects/${projectId}/runs/${runId}/mutation-stream/replay`)).status, 404);
});

test('warm-cache replay: JSONL written by the extension is served after a restart', async (t) => {
  // Seed a history dir with an extension-style event log.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gaia-mutation-cache-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projectId = randomUUID();
  const runId = randomUUID();
  const { mkdir, writeFile } = await import('node:fs/promises');
  const logDir = path.join(dir, 'mutation-events');
  await mkdir(logDir, { recursive: true });
  const safe = `${projectId}:${runId}`.replace(/[^A-Za-z0-9-]/g, '_');
  const lines = [
    JSON.stringify({ type: 'progress', event: { tested: 1, total: 3, line: '1/3 Mutants' }, ts: 1 }),
    JSON.stringify({ type: 'progress', event: { tested: 2, total: 3, killed: 2, killRate: 100, line: '2/3 Mutants' }, ts: 2 }),
    JSON.stringify({ type: 'done', status: 'done', error: null, ts: 3 }),
    '{"type":"progress"', // corrupt trailing line from an interrupted write — skipped
  ];
  await writeFile(path.join(logDir, `${safe}.jsonl`), lines.join('\n') + '\n', 'utf8');

  // A fresh history on the same dir simulates a server restart.
  const history = createHistory({ dir });
  const app = createApp({ history });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/projects/${projectId}/runs/${runId}/mutation-stream/replay`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, 'cache');
  assert.equal(body.events.length, 2);
  assert.equal(body.events[1].killRate, 100);
  assert.equal(body.done.status, 'done');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp } from '../../server/app.js';
import { createHistory } from '../../server/history.js';

const envelope = () => ({ state: 'not_run', collectedAt: null, sourceGeneratedAt: null, payload: null, errors: [] });
const tick = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 40)); }); };
async function until(check) {
  for (let i = 0; i < 75; i++) { if (check()) return; await tick(); }
  assert.fail('Timed out waiting for browser state');
}

// Render the actual TSX browser client against an isolated HTTP server. Never
// read the developer's default history or depend on an installed browser binary.
test('browser contract: two projects, detached imports, generic untrusted evidence and navigation', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'triumph-browser-'));
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  const { default: App } = await vite.ssrLoadModule('/client/App.tsx');
  const history = createHistory({ dir, legacyDir: path.join(dir, 'no-legacy') });
  const app = createApp({ history });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dom = new JSDOM('<div id="root"></div>', { url: `${base}/`, pretendToBeVisual: true });
  const previous = Object.fromEntries(['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'].map((key) => [key, globalThis[key]]));
  // navigator/window are getter-only globals on Node >=21 — Object.assign throws.
  // defineProperty with configurable:true so the teardown can restore them.
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, fetch: (url, options) => previous.fetch(new URL(url, base), options) })) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); }
    dom.window.close(); await vite.close(); await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const a = { id: randomUUID(), name: 'Alpha <img src=x onerror=alert(1)>' };
  const b = { id: randomUUID(), name: 'Beta repository' };
  const tokenA = app.locals.bridge.registerProject({ project: a }).token;
  const tokenB = app.locals.bridge.registerProject({ project: b }).token;
  const click = async (button) => { assert.ok(button, 'expected button'); await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); await tick(); };
  const button = (name) => [...dom.window.document.querySelectorAll('button')].find((el) => el.textContent.includes(name));
  await act(async () => root.render(React.createElement(App)));
  await until(() => dom.window.document.querySelectorAll('.project-item').length === 2);
  assert.equal(dom.window.document.querySelectorAll('.project-item').length, 2);
  assert.equal(dom.window.document.querySelector('img'), null, 'project name is text, not markup');
  await click(button('Alpha <img'));
  await click(button('Run REDLINE'));
  await until(() => dom.window.location.pathname.startsWith(`/projects/${a.id}/runs/`));
  assert.match(dom.window.location.pathname, new RegExp(`^/projects/${a.id}/runs/`));
  const runA = dom.window.location.pathname.split('/').at(-1);
  const requestA = (await (await globalThis.fetch(`/api/extension/${a.id}/requests`, { headers: { Authorization: `Bearer ${tokenA}` } })).json()).request;
  assert.deepEqual(requestA.courts, ['redline']);
  assert.equal(requestA.runId, runA);
  await click(button('Beta repository'));
  await click(button('Run WARPATH'));
  await until(() => dom.window.location.pathname.startsWith(`/projects/${b.id}/runs/`));
  const runB = dom.window.location.pathname.split('/').at(-1);
  assert.notEqual(runA, runB);
  assert.equal((await (await globalThis.fetch(`/api/projects/${a.id}/runs`)).json()).length, 1);
  assert.equal((await (await globalThis.fetch(`/api/projects/${b.id}/runs`)).json()).length, 1);
  const initialB = await (await globalThis.fetch(`/api/projects/${b.id}/runs/${runB}`)).json();
  const generic = { ...initialB, revision: 1, state: 'complete', updatedAt: new Date().toISOString(), warpath: { ...envelope(), state: 'complete', payload: { novel: '<img src=x onerror=alert(1)>' } } };
  assert.equal((await globalThis.fetch(`/api/extension/${b.id}/runs`, { method: 'POST', headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' }, body: JSON.stringify(generic) })).status, 201);
  await click(button('Beta repository'));
  await click([...dom.window.document.querySelectorAll('.run-item')].find((el) => el.textContent.includes(runB.slice(0, 8))));
  await until(() => dom.window.document.querySelector('.run-identity').textContent.includes(runB));
  await click(button('WARPATH'));
  assert.match(dom.window.document.body.textContent, /Unrecognized court payload/);
  assert.equal(dom.window.document.querySelector('img'), null, 'generic evidence is escaped');
  // A disconnected project cannot run, even though its history remains visible.
  assert.equal((await globalThis.fetch(`/api/extension/${b.id}/disconnect`, { method: 'POST', headers: { Authorization: `Bearer ${tokenB}` } })).status, 204);
  // Navigating to A must not show B's snapshot while the new run is loading.
  await click(button('Alpha <img'));
  assert.equal(dom.window.document.querySelector('.run-identity').textContent.includes(runB), false);
  const input = dom.window.document.querySelector('#snapshot-upload');
  const json = JSON.stringify(generic);
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size: Buffer.byteLength(json), text: async () => json }] });
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
  await until(() => dom.window.document.body.textContent.includes('Detached evidence view'));
  assert.equal(dom.window.document.querySelector('.all-button').disabled, true, 'an import cannot execute despite matching a live project');
  await click(button('Save to server'));
  await until(() => dom.window.location.pathname.startsWith('/imports/'));
  await until(() => dom.window.document.body.textContent.includes('Saved imported evidence'));
  assert.equal(dom.window.document.querySelector('.all-button').disabled, true);
  assert.equal((await (await globalThis.fetch(`/api/projects/${b.id}/runs`)).json()).length, 1, 'saving detached evidence cannot alter connected history');
});

test('branded real-like opaque court evidence renders without invented scores or verdicts', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'triumph-generic-'));
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  const { default: App } = await vite.ssrLoadModule('/client/App.tsx');
  const project = { id: randomUUID(), name: 'Generic' };
  const report = { schemaVersion: 2, project, runId: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 0, state: 'complete', checkedOutCommit: null, branch: null, workingTreeDirty: null, producer: { name: 'test', version: '1' }, redline: { ...envelope(), state: 'complete', payload: { testimony: '<script>alert(1)</script>' } }, splitbrain: { ...envelope(), state: 'complete', payload: { court: 'SPLITBRAIN', status: 'ok', schemaVersion: 1, claimedCoverage: null, honestMutationScore: 89.47, trustGap: null, dishonestTests: [{ testId: 'tests/weak.test.js', survivedMutants: ['m-2'] }], itLedger: [], survivors: [{ id: 'm-2' }] } }, warpath: { ...envelope(), state: 'complete', payload: { court: 'WARPATH', status: 'triaged', suspect: { id: 'deploy-1' }, evidence: [{ message: 'latency increased' }] } } };
  const history = createHistory({ dir, legacyDir: path.join(dir, 'no-legacy') });
  await history.save(report);
  const app = createApp({ history }); const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dom = new JSDOM('<div id="root"></div>', { url: `${base}/projects/${project.id}/runs/${report.runId}` });
  const previous = Object.fromEntries(['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'].map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true, fetch: (url, options) => previous.fetch(new URL(url, base), options) });
  const root = createRoot(dom.window.document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } dom.window.close(); await vite.close(); await new Promise((r) => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  await act(async () => root.render(React.createElement(App)));
  await until(() => dom.window.document.body.textContent.includes('Evidence available · unrecognized format'));
  assert.match(dom.window.document.body.textContent, /Evidence available · unrecognized format/);
  await act(async () => dom.window.document.querySelector('.court-card').click());
  assert.match(dom.window.document.body.textContent, /Unrecognized court payload/);
  assert.equal(dom.window.document.querySelector('script'), null);
  const nav = (court) => [...dom.window.document.querySelectorAll('.nav-item')].find((el) => el.textContent.includes(court));
  await act(async () => nav('Overview').click());
  assert.equal(dom.window.document.querySelectorAll('.court-card .card-foot').length, 3);
  assert.equal([...dom.window.document.querySelectorAll('.court-card .card-foot')].filter((el) => el.textContent.includes('unrecognized format')).length, 2);
  await act(async () => nav('SPLITBRAIN').click());
  const split = dom.window.document.querySelector('.page-section');
  assert.match(split.textContent, /Engine mutation ledger/);
  assert.match(split.textContent, /89\.47%/);
  assert.match(split.textContent, /Not recorded/);
  assert.match(split.textContent, /tests\/weak\.test\.js/);
  assert.doesNotMatch(split.textContent, /8947\.0%|GREEN CLAUSES/i);
  assert.match(split.querySelector('details pre').textContent, /"honestMutationScore": 89\.47/);
  await act(async () => nav('WARPATH').click());
  const war = dom.window.document.querySelector('.page-section');
  assert.match(war.textContent, /Unrecognized evidence/, 'incomplete triage without incident window stays opaque');
  assert.match(war.querySelector('pre').textContent, /latency increased/);
  assert.equal(war.querySelector('.metrics'), null, 'incomplete engine triage is not a verdict');
});

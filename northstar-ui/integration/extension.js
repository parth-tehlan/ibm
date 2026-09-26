import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { createHistory } from '../server/history.js';
import { createBridge } from '../server/bridge.js';

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

/** Trusted, process-local editor integration. No credential is returned to the browser. */
export async function startExtension({
  project, dir, history = createHistory(dir === undefined ? {} : { dir }), bridge,
  port = 0, onRun, onError, openBrowser, mapUrl,
  pollIntervalMs = 1_000,
} = {}) {
  if (!project || typeof project !== 'object') throw new TypeError('project is required');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid port');
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) throw new TypeError('Invalid poll interval');
  for (const [name, fn] of Object.entries({ onRun, onError, openBrowser, mapUrl })) {
    if (fn !== undefined && typeof fn !== 'function') throw new TypeError(`${name} must be a function`);
  }
  if (typeof history.recoverInterrupted !== 'function') throw new TypeError('History must support recovery');
  bridge ??= createBridge({ history });
  // Recovery MUST precede registration/listening: no old process's tokens survive.
  await history.recoverInterrupted();
  const server = createServer(createApp({ history, bridge }));
  let registered;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    registered = bridge.registerProject({ project });
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;
    const browserUrl = mapUrl === undefined ? url : await mapUrl(url);
    if (typeof browserUrl !== 'string' || !/^https?:\/\//.test(browserUrl)) throw new TypeError('mapUrl must return an HTTP(S) URL');
    if (openBrowser) await openBrowser(browserUrl);

    const { token, project: identity } = registered;
    const auth = { projectId: identity.id, token };
    const controller = new AbortController();
    let stopping = false;
    let stopPromise;
    let tickPromise;
    let timer;
    const submissions = new Set();
    const reportError = (error) => {
      if (onError) Promise.resolve().then(() => onError(error)).catch(() => {});
      else console.error('Dashboard extension integration:', error);
    };
    function publish(snapshot) {
      if (stopping) return Promise.reject(new Error('Extension stopped'));
      const operation = bridge.submit({ ...auth, snapshot });
      submissions.add(operation);
      operation.finally(() => submissions.delete(operation)).catch(() => {});
      return operation;
    }
    function tick() {
      if (stopping) return Promise.resolve();
      if (tickPromise) return tickPromise;
      tickPromise = (async () => {
        bridge.heartbeat(auth);
        await bridge.sweep();
        if (!onRun || stopping) return;
        const request = bridge.poll(auth);
        if (!request || stopping) return;
        bridge.acknowledge({ ...auth, requestId: request.requestId });
        // Do not block polling/heartbeats on long-running court collection.
        Promise.resolve().then(async () => {
          if (stopping) return;
          const submit = (snapshot) => {
            if (snapshot?.runId !== request.runId) throw new TypeError('Snapshot runId must match request');
            return publish(snapshot);
          };
          const result = await onRun(request, { submit, signal: controller.signal });
          if (result !== undefined && !stopping) await submit(result);
        }).catch(reportError);
      })().finally(() => { tickPromise = undefined; });
      return tickPromise;
    }
    function schedule() {
      if (stopping) return;
      timer = setTimeout(async () => {
        try { await tick(); } catch (error) { if (!stopping) reportError(error); }
        schedule();
      }, pollIntervalMs);
    }
    schedule();
    async function stop() {
      if (stopPromise) return stopPromise;
      stopping = true;
      controller.abort();
      clearTimeout(timer);
      stopPromise = (async () => {
        try {
          if (tickPromise) await tickPromise.catch(() => {});
          await Promise.allSettled([...submissions]);
          await bridge.disconnect(auth);
        } finally {
          await close(server);
        }
      })();
      return stopPromise;
    }
    return { url, browserUrl, project: identity, history, bridge, publish, pollNow: tick, stop };
  } catch (error) {
    if (registered) {
      try { await bridge.disconnect({ projectId: registered.project.id, token: registered.token }); }
      catch (cleanupError) { error.cause ??= cleanupError; }
    }
    if (server.listening) {
      try { await close(server); } catch (cleanupError) { error.cause ??= cleanupError; }
    }
    throw error;
  }
}

export const createExtension = startExtension;

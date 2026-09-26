# In-process editor extension SDK

This module is **trusted editor-host code**, not a browser endpoint or a court runner. It starts a local dashboard, registers one project through the process-local bridge, and publishes only reports supplied by the caller. It does not inspect a repository or invent evidence/pass results. Node ESM; from `ibm/northstar-ui`, install dependencies with `npm ci`.

```js
import { startExtension } from './integration/extension.js';

const extension = await startExtension({
  project: { id: 'a-valid-rfc4122-uuid', name: 'Workspace' },
  dir: '/private/dashboard-history', // optional; default is createHistory() data root
  port: 0,                     // optional, ephemeral by default
  pollIntervalMs: 1000,        // optional, positive integer milliseconds
  mapUrl: (localUrl) => localUrl, // optional: editor's remote-port-forwarding URL
  openBrowser: (url) => editor.openExternal(url), // optional; receives mapped URL
  onRun: async (request, { submit, signal }) => {
    // Collect real evidence for request.courts; respect signal on stop.
    // await submit(actualV2Snapshot); // can submit running revisions then final revision
    // Or return a snapshot to submit it once. Never return fabricated success.
  },
  onError: (error) => console.error(error), // optional; callback/polling errors
});
// await extension.publish(actualV2Snapshot); // unsolicited, authenticated report
// await extension.stop();
```

## Exact API

- `startExtension(options)` (also exported as `createExtension`) returns `Promise<handle>`. Required: `project: {id: UUID, name: nonempty string}`. Optional: `dir` for `createHistory({dir})`, or provide `history` with `recoverInterrupted()` and standard history methods; `bridge` defaults to `createBridge({history})` (a supplied bridge must implement the standard bridge methods). `port` is an integer `0..65535` (default `0`). `pollIntervalMs` is a positive safe integer (default `1000`). `onRun`, `onError`, `mapUrl`, `openBrowser` are optional functions. A custom history and bridge must belong together. Do not reuse one bridge to register the same connected project twice.
- Before listening, calls `history.recoverInterrupted()`, preserving prior evidence and marking orphaned running reports interrupted; then creates `createApp({history,bridge})`, binds the HTTP server **only to `127.0.0.1`**, and calls `bridge.registerProject({project})` in-process. Registration credentials remain private inside the handle's methods; no token is returned or exposed over HTTP. `handle.bridge` is provided for trusted host coordination only: **never expose it or its methods to browser/untrusted code**.
- `mapUrl(localUrl)` may be sync/async and must return an HTTP(S) URL string; `openBrowser(browserUrl)` may be sync/async and is called after mapping. Neither is called unless provided. A failure during mapping/opening rolls back registration and closes the listener. No browser is launched by default. Remote forwarding is the editor's responsibility; the HTTP server remains loopback-only.
- The handle contains `{url, browserUrl, project, history, bridge, publish, pollNow, stop}`. `url` is the actual local `http://127.0.0.1:<port>` address; `browserUrl` is the mapped URL (or `url`). `project` is the registered canonical identity. `publish(snapshot)` returns `Promise<storedSnapshot>` from `bridge.submit`; supplies credentials internally. Snapshot must be a valid v2 report (v1 normalization is supported by the bridge), match the registered project, and use valid revision/history semantics. Invalid identities, revisions, and credentials fail rather than silently changing evidence. **Only the caller supplies states, payloads, and producer metadata.**
- The SDK heartbeats, sweeps expired connections and polls/acknowledges pending requests on a serial timer. `pollNow()` returns a promise for one immediate heartbeat/poll/ack pass, useful in tests or when notified of a request. The browser can request a run via `POST /api/projects/:id/run` with `{"courts":["redline"]}` (any distinct nonempty subset of `redline`, `splitbrain`, `warpath`); the callback receives the bridge request `{requestId,runId,projectId,courts,createdAt,status}`. `onRun(request, {submit,signal})` receives a per-request `submit(snapshot)` which rejects a mismatched `runId`, and an AbortSignal aborted at stop. The browser route persists a `running` revision `0` placeholder with `createdAt: request.createdAt`, so the first callback snapshot for that run must keep that `createdAt` and use revision `1` (then increase revisions monotonically). It may submit real running revisions then the real final revision, **or** return one snapshot for automatic submission. Returning `undefined` submits nothing. Callbacks execute asynchronously without blocking heartbeats. The pending request is acknowledged before invocation, so an exception is reported via `onError(error)` (or `console.error`) but never retried or converted into a made-up success/error court result. If no callback is configured, no requests are acknowledged. Host code should report actual failures through truthful snapshots where available, or stop/disconnect to interrupt unfinished runs.
- `stop()` is idempotent and returns a promise. It prevents new submissions/callbacks, aborts the signal, cancels polling, waits for already-started submissions, disconnects the bridge (interrupting tracked running reports), and closes the server. It does **not** wait indefinitely for a hung `onRun`. Submission after stop rejects. Call stop during editor shutdown. A crashed process is handled by recovery on the next startup; history is retained.

Run isolated SDK tests with `node --test integration/tests/extension.test.js` from `ibm/northstar-ui`. `npm test` also includes these tests.

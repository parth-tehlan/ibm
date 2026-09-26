# Separate-process VS Code handoff (draft for extension owner)

The dashboard owns `server/index.js`, `contracts/report.js`, and browser history. The extension owns court execution and conversion of **real** engine evidence. Do not post `triumph-input.json` directly: it is not a version-2 snapshot. Do not replace the raw JSON/HTML/Markdown files; retain them as offline/audit artifacts.

## Starting and registering

For an extension that does not embed `integration/extension.js` in its own Node process, fork `server/index.js` with a Node IPC channel (e.g. `child_process.fork`, `stdio: ['ignore','pipe','pipe','ipc']`). Set `PORT=0` for an available loopback port; set `XDG_DATA_HOME` if the default per-user history directory is unsuitable. After history recovery/listening the child sends `{type:'triumph.ready',url:'http://127.0.0.1:<port>'}`. From the **trusted editor process only**, send `{type:'triumph.register',requestId:<UUID>,project:{id:<stable UUID>,name:<name>}}`. The child replies `{type:'triumph.registered',requestId,project,token}` or `{type:'triumph.registrationError',requestId,error}`. Store the 64-character hexadecimal token in extension memory only; **never** send it to the browser or log it. Registration is not exposed over HTTP. Reusing a project ID in the same child requires disconnecting first; on restart, re-register with the same project ID.

The existing in-process alternative is `integration/extension.js`; choose **one** startup method with the extension owner. The child-process route is useful if importing our ESM SDK into the existing CommonJS VS Code host is inconvenient. The agreed local packaging path is a self-contained runtime inside the VSIX, not a sibling dashboard checkout: from `northstar-ui/` run `npm ci && npm run package:runtime`. The ignored `.runtime/` folder contains built browser assets, only the server/contract/export files it imports, package metadata, and installed production dependencies. Ship that folder intact, including its ESM `package.json` and transitive `node_modules`; do not ship the source checkout or `.data/` history. Validate it in isolation with `TRIUMPH_RUNTIME_DIR="$PWD/.runtime" node --test server/tests/ipc.test.js`. Fork the packaged absolute `server/index.js` with `PORT=0` and explicitly set `TRIUMPH_HOST=127.0.0.1` in the child environment, even if the editor inherited a public development host. Keep history outside the VSIX; `XDG_DATA_HOME` can point to the editor's private storage directory. The child-process method currently assumes a local VS Code host; remote workspaces/forwarded URLs need a separate host/origin and security review.

## Publishing

Authenticated HTTP calls to the ready URL use `Authorization: Bearer <token>`:

- `POST /api/extension/:projectId/heartbeat` frequently (timeout: 30 seconds).
- `POST /api/extension/:projectId/runs` with a validated version-2 snapshot. Returns `{projectId,runId,revision}`. Unsolicited extension runs can start at revision `0` and use a new run UUID; later updates increase revision without changing project name/ID or `createdAt`.
- `GET /api/extension/:projectId/requests` returns `{request:null}` or `{request:{requestId,runId,projectId,courts,createdAt,status:'pending'}}`.
- `POST /api/extension/:projectId/requests/:requestId/ack` acknowledges the pending browser rerun. Run only the requested courts. The browser has already saved a `running` revision `0` placeholder. Keep its runId and createdAt; first extension update must have revision `1` or greater, then increase monotonically. Finish with a truthful `complete` snapshot or explicitly report court errors/unavailability; on disconnect unfinished runs become interrupted. Keep heartbeats going while the court runs.
- `POST /api/extension/:projectId/disconnect` when shutting down. Never substitute unauthenticated `/api/import` for connected publication; imports are detached from project history.

After successful publication open `<url>/projects/<projectId>/runs/<runId>` in the external browser. Do not open the extension's standalone HTML file as a substitute: that cannot show project history. This dashboard is local-only; never expose its bearer token in a URL.

## Evidence contract to agree with the developer

Use `contracts/report.js` as the authoritative version-2 schema. A run has `schemaVersion:2`, stable `project:{id,name}`, fresh `runId`, `createdAt`, `updatedAt`, increasing `revision`, `state:running|complete|interrupted`, nullable Git provenance, and `producer:{name,version}`. Every `redline`, `splitbrain`, `warpath` court has exactly `{state,collectedAt,sourceGeneratedAt,payload,errors}`; `payload` is an object or null. Court states are `not_run`, `running`, `complete`, `error`, `unavailable`. Preserve the raw court evidence as an opaque object; **never** manufacture green clauses or silently treat missing fixtures as passing. Agree on which raw fields contain each court's source timestamp, whether an absent source is `not_run` versus `unavailable` versus `error`, and stable project UUID generation/storage before implementing the converter. Browser and server validate the same schema.

The process handoff and tests are present on the dashboard side. The extension does not call them yet; this is **not** an end-to-end integration until the extension owner wires the runner, report converter, polling, browser opening, and packaging.

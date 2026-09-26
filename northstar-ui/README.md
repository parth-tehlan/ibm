# TRIUMPH Dashboard

The local browser results interface for the TRIUMPH extension. Browse any registered project's past court runs, request a new run from a connected extension, inspect independent REDLINE/SPLITBRAIN/WARPATH evidence, and export offline HTML, Markdown, or JSON. **Northstar is only a legacy example.** This dashboard does not run court tools or agent models.

## Run locally

Node.js 22 LTS and npm:

```sh
npm ci
npm test && npm run typecheck && npm run build
npm start              # http://127.0.0.1:4317
# For UI development instead: npm run dev (Vite at http://127.0.0.1:5173)
```

A standalone `npm start` lets you browse saved runs and import reports; it does **not** connect an editor. Run buttons only work while an extension connects a trusted project. For a local editor host, the extension can embed the server with `integration/extension.js` (see `integration/README.md`), or launch it as a child process with the private IPC handshake in `integration/PROCESS-HANDOFF.md`. The Vite dev server and API bind to `0.0.0.0`; set `TRIUMPH_ALLOWED_HOSTS` to a comma-separated list of exact IP hostnames used to access it (for example `TRIUMPH_ALLOWED_HOSTS=192.168.1.25 npm run dev`). Only use this on a trusted network: there is no user authentication, and anyone who can reach the service can view local reports/import reports and may request runs from a connected extension. Binding does not open cloud firewalls or create a public URL. We have not wired the other developer's VS Code extension yet.

## Report contract and history

The shared version-2 report schema lives in `contracts/report.js`. Each report has a stable project UUID/name, run UUID, timestamps, monotonic revision, independent court evidence envelopes, producer and Git provenance. Court payloads are deliberately opaque to the server; requirement IDs are not tied to Northstar's W1–W8. A missing or failed court is **never** a passing verdict. Browser renderers display recognized court payload shapes and generic exports retain all evidence. No composite release score is calculated.

History is private to this computer under `$XDG_DATA_HOME/triumph-dashboard` (or `~/.local/share/triumph-dashboard`). It keeps immutable revisions and survives restarts. On startup the server non-destructively migrates the old ignored `northstar-ui/.data/` reports; originals remain untouched. Standalone JSON imports are detached, cannot start runs, and are saved only by explicit choice. HTML/Markdown exports are self-contained and escape untrusted evidence. Avoid sharing private log or payment data in exported reports.

## Browser-to-extension flow

1. Trusted editor-host integration calls `app.locals.bridge.registerProject({ project: { id, name } })` **in process**, never over a browser route. Keep the returned token private; do not include it in HTML, browser storage, imports, logs, or the run URL.
2. Browser `POST /api/projects/:id/run` with `{ "courts": ["redline"] }` creates a persisted running run and queued request. It rejects projects without a live extension. `GET /api/projects`, `GET /api/projects/:id/runs`, `GET /api/projects/:id/runs/:runId` expose local history.
3. The extension polls `GET /api/extension/:id/requests`, acknowledges `POST /api/extension/:id/requests/:requestId/ack`, runs the requested courts with its existing agent/engine workflow, then posts version-2 snapshots to `POST /api/extension/:id/runs` with `Authorization: Bearer <project token>`. Its first update after the browser placeholder uses revision >= 1; revisions must increase. Extension-initiated runs may be submitted without a browser request.
4. The extension opens `/projects/:id/runs/:runId` in the user's browser, using editor port forwarding in remote workspaces. On disconnect or restart, unfinished runs become interrupted, never completed successfully by guesswork.

Other routes: `POST /api/import`, `GET /api/imports`, `GET /api/imports/:id`, `GET /api/runs/:id/export?format=html|md|json&projectId=:id` (or `&importId=:id`). The API binds to `0.0.0.0`, enforces browser Origin/Host checks and per-project bearer tokens for extension endpoints. Browser-facing history/import routes do not require user authentication. It is a local desktop interface, **not** a multi-user authenticated service. Do not publish/forward it to untrusted users.

## Ownership

`court-extension/` owns execution, agents, repository adapters and editor integration. This directory owns the dashboard, history, shared report contract and exports. Integrate the handshake and schema with that developer before calling the end-to-end extension flow done. Northstar's intentionally failing clauses and the extension owner's engine code remain unchanged.

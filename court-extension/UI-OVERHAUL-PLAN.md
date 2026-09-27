# TRIUMPH extension — UI and workflow overhaul

## Decision

Make the sidebar a compact place to configure a run, watch its progress, and inspect its outcome. Use the existing dashboard for detailed investigation. One run produces one evidence record, local reports, and optionally a dashboard publication. Publishing must never execute courts again.

Keep the current stack. This is a workflow and presentation overhaul with a targeted orchestration refactor, not a platform rewrite.

Status: implementation in working tree; tests and packaging are not a live editor acceptance run. The two-tab Run / Evidence presentation remains the decision; the workflow issues below are additional acceptance criteria.

## Presentation follow-up and six workflow acceptance criteria

Keep the single-run coordinator, persisted run records, report provenance, preview-before-write setup, and optional **publish saved evidence** semantics. Retain the two labeled horizontal Run / Evidence tabs, with Setup and Dashboard as secondary actions; keep explicit court checkboxes, a prominent silver/muted live step timeline with state icons and timestamps, and a collapsed bounded raw-console drawer on Run. This is **run activity** (deterministic engine work), not a claim that an AI agent is thinking. Use the host's real step events; never manufacture wall verification, test counts, or passing verdicts. Retain full evidence and recent runs in Evidence. Local evidence must always be persisted; publishing is an additive choice, not an alternative run mode. Do not bring back export-format checkboxes that could make results disappear. Timeout editing appears only if the host supports applying it.

| Failure mode to prevent | Acceptance check |
|---|---|
| Verdict disappears after running without selected export formats, raw JSON unexpectedly opens | Running one court produces a persisted canonical record; Evidence immediately shows the selected court's verdict, with others explicitly not run; no automatic JSON editor open. HTML/Markdown actions reflect actual artifacts. |
| Ready/enabled on cold start without config | No config or invalid config marks courts not ready, disables Run, and offers safe configuration preview. Host preflight independently rejects unavailable inputs for both local and dashboard publication. |
| Dashboard option secretly runs all courts | Exactly the selected subset executes once; publishing reuses its run ID; unselected courts stay not run. |
| Run a court / Install courts palette commands only reveal a tab | Palette entry points perform an explicit next step (court picker → shared run path, or host picker → read-only installation preview). Installation still needs user confirmation; trust and single-flight guards remain on the host. |
| Long mutation run cannot be stopped | Show Stop only when verified process-tree cancellation is available; preserve interrupted partial evidence and label it as such. Never fake cancellation by merely stopping UI polling. |
| Cryptic status bar / inert Dashboard tab | Status bar has a short plain-language summary and a tooltip with units and provenance; Dashboard shows connection, URL, Open, Refresh, and a recovery action if disconnected. Do not imply connection by showing a stale URL. |

The two-tab rationale below remains the current presentation decision. Theme tokens, narrow widths, focus management, reduced motion, keyboard tabs, bounded append-only feed (200 entries), auto-scroll only when pinned, and logs with a live count are acceptance criteria.

## Review and two-tab layout

### 1. Findings from the screenshots and source

| Current issue | Source / consequence | Decision |
|---|---|---|
| Four icon tabs divide a single workflow | `media/panel.js`: Run / Report / Dashboard / Setup; the inner rail consumes scarce width | Two labeled horizontal tabs: Run / Evidence. A labeled Setup action opens a secondary screen. |
| Court selection and previous verdict share the same tile | Selection is a tint/edge; historical badges resemble current readiness | Explicit checkboxes, capability descriptions, and readiness. Put previous verdicts in a distinct latest-run section. |
| Options displace the run action | Output destination, timeout, and export formats compete with the court selection | One visible dashboard toggle; advanced execution settings collapsed; report exports move to Evidence. |
| Dashboard selection does more than it says | `src/actions.js:284–350` executes selected courts, then `runAndPublish` requests all three | Execute the exact selection once; publish that same record. Unselected courts remain `not_run`. |
| Dashboard runs do not share the local report path | Local artifacts are written only in the local branch of `runCourt` | Always persist local evidence; dashboard publication is additive. |
| Execution errors and findings are conflated | Returned `{kind:'error'}` outcomes do not necessarily enter the aggregate `errors` list | Aggregate from structured outcomes, not thrown exceptions or activity text. |
| Trust-gap presentation disagrees | Tile shows raw gap; report multiplies by 100 and clamps; `lib/trustgap.js` produces percentage-point differences | Display e.g. `Trust gap 2.19 pp`; scores are already 0–100 percentages. Remove misleading gauge. |
| Missing evidence can look positive | REDLINE tile checks only `red > 0`; WARPATH absence of incident window becomes `clear` | Explicit incomplete/unavailable/error states; pass/clear requires affirmative evidence. |
| Report freshness is inferred from shared artifacts | `findLastReport` uses file mtime and may combine files from different runs | Immutable run identity, per-court provenance, artifact ownership. |
| Setup labels understate writes | `detectConfig` writes `.triumph.yml`; its button says auto-detect | Read-only validation; explicit create/re-detect preview before replacing config. |
| Long URLs, paths, timestamps and nested logs dominate | Visible in screenshots | Friendly link labels, relative paths, compact timestamps; full values in accessible details/copy actions. |
| Current UI tests lock in old layout | `tests/panel-ui.js` asserts exact icons, rail CSS and copy | Replace obsolete assertions with interaction/state tests and visual checks. |

This review is source-based, not a completed runtime audit or a claim that existing tests were run.

### 2. Product and visual decisions

### Information architecture

- **Run:** workspace readiness, exact court selection, dashboard option, run progress, latest outcome.
- **Evidence:** selected run summary, per-court findings, drill-down actions, export menu, recent runs.
- **Setup:** secondary screen reached through a labeled header action, with Back navigation. Not a third main tab.
- **Dashboard:** header/footer action and publication status within each run, not a standalone tab of connection metadata.
- Keep existing command IDs and command-palette entry points as compatibility adapters.

### Sidebar layout — ready state

Illustrative wireframe, not actual collected evidence:

```text
TRIUMPH                         Setup
northstar ▾               Config ready

[ Run ]  [ Evidence ]

Choose courts
[x] REDLINE
    Verify spec requirements
[x] SPLITBRAIN
    Test assertion strength · slower
[ ] WARPATH
    Investigate incident evidence

[ ] Also publish to local dashboard
Reports are always saved locally.

▸ Advanced

[ Run 2 courts                     ]

LATEST RUN                 4 min ago
Completed · findings need attention
REDLINE       8 failed · 2 incomplete
SPLITBRAIN         Trust gap 2.19 pp
[ View evidence ]    Open dashboard ↗
```

- First use: select available REDLINE; do not silently default to an expensive mutation run. If REDLINE is unavailable, select nothing and show the readiness reasons. Persist explicit selections per workspace afterward.
- WARPATH is opt-in; incident investigation is not a mandatory routine check.
- Use checkboxes, not ambiguous selectable cards. Entire label row is clickable; controls have visible focus states.
- Show unavailable courts with a reason and `Configure` action. Do not quietly drop a selected court if prerequisites later disappear; require review before execution.
- Dashboard toggle defaults off; persist a user's explicit choice. Label it as local so “publish” does not imply public hosting.
- Advanced contains the effective mutation timeout, its source, and a per-run override. Do not use only a placeholder such as “from .triumph”.
- Default local outputs: canonical run JSON plus existing HTML and Markdown. Remove export-format checkboxes from the run form; choosing how to read results should not change what evidence is preserved.
- Preserve existing explicit format options for programmatic callers while always keeping internal canonical evidence.

### During execution

```text
Running 2 courts                 1m 42s
✓ REDLINE       8 clause failures
◌ SPLITBRAIN    Testing mutations
  37 / 120 tested · 24 killed

[ Stop run ]                View logs

▸ Activity (6 updates)
```

- Freeze the submitted selection and settings; a visible run must not change identity when draft controls change.
- Sequential court execution remains the default. Show queued/running/settled separately, not every selected court as running.
- Progress percentages only when the runner supplies a reliable denominator. Otherwise show phase, elapsed time, and counts; no invented ETA.
- `Stop run` is part of the completed overhaul, but ships only with verified child-process cancellation. Aborting polling alone is not cancellation.
- Preserve completed and partial evidence on stop/error. Do not discard it or mark it passed.
- Rename **Agent activity** to **Run activity**: these deterministic engine calls are not necessarily agent actions.
- Keep a short structured activity summary in the sidebar. Put full stdout/stderr in the existing or a dedicated VS Code Output channel. Avoid multiple always-visible scrolling panels.

### Completion and investigation

- Stay on Run when the job settles; update the same run card rather than forcing navigation or opening a browser.
- Primary next action: **View evidence**. Secondary: **Open dashboard**, when that run is published.
- Distinguish `Completed — findings need attention`, `Completed — incomplete evidence`, `Finished with execution errors`, `Stopped — partial evidence`, and `Completed — no issues found`.
- Dashboard transport failure says `Evidence saved · dashboard publish failed` with **Retry publish**. Retrying publication never reruns tests.
- Evidence rows show the finding, its basis, freshness, and an action—not only a colored badge.
- REDLINE: failed/incomplete clause list and actual test counts; open a local source/test location when the engine supplies a valid workspace path.
- SPLITBRAIN: claimed coverage, mutation score, trust gap in pp, survivor count, fresh versus imported evidence. Use the existing dashboard for mutant-level exploration.
- WARPATH: distinguish detected incident, insufficient signal, unavailable inputs, and engine error; do not invent an incident count or assert “clear” from missing fields.
- Exports menu: HTML report, Markdown, JSON, and reveal report folder. Disable unavailable artifacts with explanations.
- Recent runs: latest 10 summaries, load more on demand; never load all mutation payloads into the sidebar. Full comparisons remain in the dashboard.

### Setup and empty states

1. No workspace: **Open folder**; no enabled run/install actions.
2. Untrusted workspace: explain why commands/config writes are disabled and link to native workspace trust controls. Never auto-grant trust.
3. No config: **Create configuration** → preview detected values and files → create → validate.
4. Existing config: **Validate configuration**, **Open config**, and secondary **Re-detect…** → diff/preview → explicit replacement confirmation. Keep a recoverable backup on replacement.
5. Show per-court readiness; a found config is not necessarily valid.
6. Separate optional **Install agent integration** from **Run courts**. Explain that installation writes host prompts/MCP configuration and does not supply or call a model.
7. Honor an explicitly configured host preference. For first-time selection, suggest the current host only when reliably detected; otherwise require a choice. `All hosts` remains available but is not the silent fallback.
8. Preview host files to be written and report partial installation failures truthfully.

### Visual specification

- Native IDE density; inherit VS Code font family and font size. Small headings at roughly 1.1× body size, not oversized app typography.
- Theme colors from `--vscode-*` tokens; no fixed dark palette. Validate light, dark and high-contrast themes.
- Spacing scale: 4 / 8 / 12 / 16 px. Main inset 12 px; modest 4–6 px radii; borders only to separate meaningful groups.
- Remove the duplicate vertical rail, emoji navigation, oversized cards and repeated full-width secondary buttons. Use local SVG icons with text labels for important actions.
- Minimum 28–32 px control height for mouse/keyboard IDE use, with larger primary run button; do not sacrifice zoom readability for density.
- One main vertical scroll region. Primary run/stop action may be sticky but must reserve space and never cover content. At short heights or high zoom, allow normal document flow.
- Layout acceptance widths: 240, 280, 320, 400 and 600 CSS px; check 200% zoom. No horizontal page scrolling, chopped controls or hidden tab labels.
- At 320×700 CSS px with default font and Advanced closed, court selection and primary action are visible without scrolling.
- Long names/paths may truncate visually but must offer keyboard-accessible full details and Copy. URLs are labeled links, not multi-line UUID blocks. Timestamps are relative with a full localized timestamp/timezone in details.
- Keyboard tab navigation, arrow-key tab switching, proper label relationships, text+icon status, focus preservation, polite/throttled live announcements and reduced-motion support.

## 3. Architecture & tech decisions

| Layer | Keep | Targeted change |
|---|---|---|
| Extension host | CommonJS JavaScript, VS Code APIs | A shared run coordinator used by sidebar, commands and dashboard-triggered runs |
| Sidebar | `WebviewViewProvider`, plain JS DOM rendering, CSS, `postMessage` | Split shell, Run, Evidence, Setup and rendering helpers into small local modules; no new sidebar build framework |
| Engine | Current court/MCP tools and sequential execution | Propagate run context, structured progress, effective timeout and cancellation; keep model-free execution |
| Dashboard | Existing React 18 / TypeScript / Vite client, Express / Zod server | Reuse for deep evidence; correct run identity/publication integration and semantic parity |
| Storage | Local filesystem and existing extension storage | Small run manifests, immutable run evidence, artifact index and latest pointer; no database |
| Validation | Existing schemas/validators and Node tests | Versioned sidebar message/run contracts; validate in host, not only browser controls |
| UI testing | Existing Node test approach | DOM behavior tests using dev-only jsdom; dev-only Playwright for screenshots/layout checks |

No Next.js, Tailwind migration, UI component suite, Redux, new database, hosted backend, model provider or wholesale TypeScript conversion.

### Execution pipeline

```text
Sidebar / command / dashboard request
                 ↓
Shared run coordinator (workspace identity + run lock)
                 ↓
Read-only preflight + immutable execution plan
                 ↓
Execute exact selection once, sequentially
                 ↓
Normalize outcomes + persist canonical evidence
                 ↓
Render local artifacts → optionally publish the same evidence
                 ↓
Sidebar / status bar / dashboard read the same run identity
```

- Factor the stronger preflight, freshness checks and collectors out of `src/dashboard.js`; reconcile them with `src/actions.js` rather than adding a third executor.
- One mutation owner per canonical workspace in this extension host across every entry point. Preserve existing lower-level process/ownership guards; do not claim that an in-memory lock excludes unrelated external Stryker processes.
- `src/dashboard.js` owns dashboard server/session/transport, not an independent court execution path.
- Browser reruns enter the same coordinator with the selected courts and request identity; retain acknowledgements, abandonment and durable error publication.
- Publication uses the existing dashboard snapshot-v2 adapter. Do not add fields to its strict schema without a deliberate coordinated version change.
- Status bar derives from the same host summaries; it cannot retain a contradictory cached verdict.
- Dashboard connectivity is workspace-specific and separate from publication status. A live server does not mean the selected run was published.
- Internal JSON is always saved, including all-error and interrupted runs. Compatibility HTML/MD and legacy latest-file paths remain available; update latest pointers only after writes settle. Track artifact generation failures separately from court errors.
- Store sidebar preferences in webview state with a version migration; durable run state belongs in host/storage, never only in webview memory.
- Preserve CSP nonce/local-resource restrictions. Validate message types/arguments, resolve file IDs in the host, restrict file opening to authorized workspace/artifact paths, and validate dashboard URLs. No arbitrary shell command or arbitrary URI received from the webview.

## 4. Schemas & data models

Use JSON Schema for persisted and message contracts, plus JSDoc for authoring. SQL/Prisma/Pydantic would add irrelevant infrastructure to this JavaScript/file-based project. The following are exact field/type blueprints, not executable application logic.

### RunRecord — new internal schema version 1

| Field | Type / constraint |
|---|---|
| schemaVersion | literal `1` |
| runId | UUID; stable across local evidence and publication |
| workspaceId | canonical project/workspace identifier |
| requestedCourts | nonempty unique array of `REDLINE`, `SPLITBRAIN`, `WARPATH` |
| trigger | `sidebar`, `command`, `dashboard` |
| startedAt / finishedAt | ISO timestamps; finishedAt nullable |
| phase | `preflight`, `executing`, `saving`, `publishing`, `settled` |
| lifecycle | `running`, `completed`, `interrupted`; not a verdict |
| settings | effective timeout, timeout source, publishToDashboard; immutable once accepted |
| provenance | commit, branch, dirty-state and config fingerprint; unknown values explicitly null |
| courts | all three keys, each a CourtOutcome |
| artifacts | entries containing artifact ID, runId, kind, path, generation status and error |
| publication | state `not_requested`, `pending`, `publishing`, `published`, `failed`; URL/error nullable |

### CourtOutcome

| Field | Type / constraint |
|---|---|
| execution | `not_run`, `queued`, `running`, `complete`, `unavailable`, `error`, `cancelled` |
| verdict | `pass`, `findings`, `inconclusive`, `unknown`; separate from execution |
| collectedAt / sourceGeneratedAt | timestamp or null; collection is not source freshness |
| evidenceSource | `executed`, `precomputed`, `imported`, `none` |
| evidenceFreshness | `fresh`, `stale`, `unknown` |
| payload | original opaque engine object or null; never mutate source evidence |
| errors | structured code, message and diagnostic reference entries |
| metrics | typed names, numeric value or null, explicit unit (`count`, `percent`, `percentage_points`) |
| progress | phase, tested/total/killed counts or null; only runner-reported values |

Adapter rule: cancelled court → existing v2 `error` envelope with cancellation reason; interrupted run → existing v2 `interrupted`; unselected court → `not_run`. Preserve partial payloads. Keep richer internal workflow metadata separate rather than violating the strict dashboard contract.

### Evidence rules — hard requirements

- REDLINE with zero executed tests is inconclusive/yellow, never a pass. Yellow is not universally “skipped”: preserve the engine's actual reason. Duplicate discovery under tests and `.stryker-tmp` does not prove assertions ran successfully.
- SPLITBRAIN mutation command failure/no fresh report is an execution error. Preserve stdout, stderr, exit code and report provenance where the runner exposes them; extend runner diagnostics where necessary. An old report may be opened separately but not relabeled as this run's success.
- Engine mutation score and claimed coverage are percentages already; trust gap is their difference in percentage points. No multiplication by 100, no clamping into a percentage meter, no value-based unit guessing. Preserve negative gaps; explain them rather than classifying them by an invented threshold.
- Use authoritative configured/domain thresholds where they exist. If no verified verdict policy exists, show metrics and findings without manufacturing pass/fail thresholds.
- WARPATH without sufficient input/signal is unavailable or inconclusive, never an automatic all-clear.
- `complete` means the collector finished; it does not mean the evidence passed. Aggregate outcome comes from all requested court outcomes and artifact/publication status.
- Missing, stale, imported and not-run are distinct. Legacy files without run provenance receive unknown freshness, never a fabricated current timestamp.

## 5. API contracts

The sidebar uses the existing host bridge, not HTTP. Existing dashboard HTTP endpoints/authentication remain behind `lib/dashboard` and the current snapshot converter. No new public REST API is needed.

### Proposed webview → host messages

All carry `protocolVersion: 2`, `requestId`, `type` and `payload`; unknown fields/types are rejected. Host derives trusted root/paths and verifies workspace context.

| Type | Payload | Result |
|---|---|---|
| `ready` | supported protocol version | full current snapshot and capabilities |
| `run.start` | workspaceId, courts, publishToDashboard, optional timeoutSeconds | accepted runId or explicit validation/busy/readiness error |
| `run.cancel` | runId | cancellation requested; terminal state only after actual shutdown |
| `run.publish` | runId | publish persisted evidence; never collect courts |
| `run.select` | runId | evidence summary for that run |
| `artifact.open` | runId, artifactId | open host-resolved artifact |
| `diagnostics.open` | runId, optional court | reveal run diagnostics |
| `dashboard.open` | runId | validated published URL or actionable unavailable response |
| `config.validate` | workspaceId | read-only readiness results |
| `config.preview` | workspaceId | detected config preview with revision token; no writes |
| `config.apply` | previewId, expectedConfigRevision | confirmed apply, rejecting stale previews |
| `integration.preview` / `integration.install` | host selection / confirmed preview ID | write preview / verified installation outcome |

Existing messages and command IDs translate to these operations during migration; preserve existing semantics where callers explicitly request execution, including Generate report. New export UI never executes tests.

### Host → webview

- `state`: full versioned snapshot with workspace, readiness, draft defaults, active run, selected run, recent summaries, dashboard status and capabilities.
- `run.event`: runId, monotonic sequence, event kind and structured payload. Ignore duplicate/outdated events; request/replay a snapshot after reconnect. Cap in-memory activity buffers.
- `response`: requestId, status `accepted`, `ok`, `rejected`, plus runId/data/error as applicable. These are bridge statuses, not HTTP status codes.
- Error codes: `INVALID_REQUEST`, `NO_WORKSPACE`, `UNTRUSTED_WORKSPACE`, `BUSY`, `NOT_READY`, `STALE_PREVIEW`, `NOT_FOUND`, `PUBLISH_FAILED`, `INTERNAL_ERROR`.
- Draft UI preferences may be optimistic; run execution and publication state are always host-authoritative. Repeated requestId must not start a duplicate run.

## 6. Implementation tasks for $codex

Implement in this order. Each task includes its verification gate.

1. **Capture baseline and lock semantics.** Add fixtures for zero-test REDLINE, actual clause failures, failed mutation/no fresh report, precomputed mutation data, missing WARPATH signal, selected-subset runs, publication failure and stale artifacts. Document the current percentage units. Gate: regression tests fail against the misleading behavior they target.
2. **Introduce shared normalization and run contract.** Add `schemas/run-record.schema.json`, a message schema and host-side `lib/run-summary.js`; reuse existing converters where appropriate. Gate: sidebar, status bar and dashboard adapters agree on outcome, units and source freshness for every fixture.
3. **Unify execution ownership.** Add `src/run-coordinator.js`; reconcile collectors from `actions.js` and `dashboard.js`; route sidebar, command and browser requests through it. Thread effective timeout into the actual runner, not just the polling deadline. Gate: each selected court executes exactly once, unselected courts never execute, and competing mutation requests cannot overlap through extension entry points.
4. **Persist once, publish without rerunning.** Add run storage/index and artifact manifests; always retain canonical evidence including errors. Keep legacy latest report paths as compatibility outputs. Route publish/retry through snapshot conversion and existing transport. Gate: transport failure retains local evidence; retry has zero engine invocations; reload restores the correct run/artifacts.
5. **Complete cancellation and progress plumbing.** Add structured phases/court progress and owned-process cancellation down through MCP/runner boundaries. Gate: no orphan mutation process after stop, no false cancelled state while execution continues, partial evidence persists, and the next run can start safely. Until this passes, omit Stop and advertise no cancellation capability.
6. **Replace the sidebar shell.** Refactor `media/panel.js` into small local UI modules and rewrite CSS around the two-tab layout. Update `src/panel.js` local resources/CSP as needed. Add preference migration (`report` → Evidence, `dashboard` → Evidence with publication focus, `setup` → Setup). Gate: keyboard navigation, rehydration, viewport checks and old command focus routes work.
7. **Build Run and Evidence views.** Implement explicit selection/readiness, dashboard toggle, Advanced settings, active-run summary, structured findings, recent runs and exports. Add Output-channel diagnostics. Gate: no automatic browser opening/tab switching; correct partial/error/inconclusive states; full evidence reachable in at most two actions from completion.
8. **Rework Setup safely.** Add validation, preview/apply, explicit overwrite confirmation, optional host installation and trust gating. Gate: read-only checks never change files; stale preview cannot overwrite newer config; partial host installation reports the failures; first-run path reaches a real run without mandatory agent installation.
9. **Align the dashboard and status bar.** Limit dashboard changes to run identity, matching selections, semantic formatting, provenance and publish/rerun integration. Do not redesign the entire dashboard in this scope. Gate: both surfaces refer to the same evidence and report compatible verdicts; browser reruns update sidebar state and obey the shared lock.
10. **Behavior, visual and packaged acceptance.** Replace layout-string tests with DOM behavior assertions; add browser screenshot/layout checks for idle/running/findings/incomplete/error/empty states and theme/width/zoom matrix. Run extension tests, dashboard tests/typecheck when affected, and packaged verification. Install the resulting VSIX in the actual Bob/VS Code host for final smoke testing.

Suggested delivery slices: correctness/orchestration (1–5), sidebar/Setup (6–8), integration/release (9–10). Do not ship the redesigned dashboard toggle on top of the old duplicate-execution path.

## 7. Release and packaging

- Source paths in this checkout are `court-extension/` and `northstar-ui/` (not an `ibm/` subdirectory).
- If dashboard source changes, first run `npm run package:runtime` in `northstar-ui`, then `npm run stage:dashboard` in `court-extension`. Staging alone can copy stale runtime assets.
- Package using the repository's documented VSIX process; inspect extracted `media/` and dashboard assets, not only source or a passing dependency/file-presence verifier.
- Verify shipped asset content/hash against the new build; run available packaged VSIX/Bob checks and a real installed-extension smoke test.
- Do not run mutation jobs concurrently during verification. Prefer deterministic fixture tests for UI coverage; reserve live mutation for one controlled end-to-end check.

## 8. Definition of done

- Ready workspace: a returning user can run their remembered selection in one action.
- Selection, publish intent and run action are unambiguous in a narrow sidebar.
- One request executes only its selected courts once; publishing or exporting does not execute them again.
- Every court outcome has honest execution/verdict/freshness semantics and consistent units everywhere.
- A failed/stopped run retains diagnostics and usable partial evidence; no generic green completion hides it.
- Sidebar hide/show, reload, workspace changes, dashboard exit and browser reruns do not mix run state or leave stale success indicators.
- Existing commands, local report consumers and dashboard snapshot-v2 compatibility remain functional.
- No framework rewrite, database, cloud service or model dependency was introduced.

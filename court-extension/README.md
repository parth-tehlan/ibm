# Gaia 3-Court Dev Tool — VS Code Extension

Build tests, review coverage honestly, and debug incidents using the
**3-court method** — for *any* repository and *any* model the user wants,
including IBM Bob's chat.

- **Path 1 — caller executes the subagents we ship.** We install court
  subagents into the agent hosts the user already has; each host's **own model**
  runs them. We never call a model ourselves.
- **Three roles in one extension:** setup orchestrator, tool/engine server,
  and report generator.
- **Model-agnostic by construction:** engine + reports are deterministic; the
  brain is always the caller's model (Claude, GPT, DeepSeek, IBM
  watsonx/Granite, Bob's chat).

See **`BUILD-PROMPT.md`** for the full build spec and **`GAIA-DESIGN.md`**
for the locked architecture.

## The three courts

| Court | What it does | Tool prefix |
|-------|--------------|-------------|
| **WITNESS** | Spec-witness: verdicts from test suites authored from the spec contract alone; wall-enforced (never reads implementation). | `witness_*` |
| **TRUSTGAP** | Honesty audit: claimed coverage vs real mutation kill-rate; names tautologies. Slow runs are async (`trustgap_mutate` → `trustgap_status`). | `trustgap_*` |
| **TRIAGE** | Incident forensics: correlates deploy/metrics/log fixtures, isolates the suspect deploy, renders the postmortem. | `triage_*` |

Manifesto: **Legal. Honest. Survivable.**

## Layout

```
court.js                 ← the model-free MCP engine (Role 2), repo-agnostic
lib/
  config.js              ← .gaia.yml loader (zero-dep YAML subset + validation)
  detect.js              ← workspace auto-detector (fills .gaia.yml)
  runners.js             ← jest / pytest / custom test runners → normalized verdicts
  trustgap.js            ← TRUSTGAP honesty math (gap derived, never asserted)
  hosts.js               ← Role 1: per-host subagent + MCP writers
  render.js              ← Role 3: engine JSON → interactive HTML + agent MD
agents/                  ← the subagent prompt pack (write-once, per-host)
  spec-witness.md  test-author.md  mutant-analyst.md  war-room.md
schemas/gaia-config.schema.json
bin/
  gaia-setup.js          ← "Install courts for this repo" (CLI form of Role 1)
  gaia-report.js         ← collect engine JSON over MCP, render both reports
src/extension.js         ← VS Code extension host (activation, MCP provider, status bar)
src/panel.js             ← Gaia panel: WebviewViewProvider for the "3-Court"
                           Activity Bar view (gaia.panel) — Config / Run /
                           Last report / Dashboard / Install courts sections
src/actions.js           ← action handlers the panel (and the commands) dispatch
                           into — detect config, run a court, generate report,
                           open report, install courts, dashboard run
media/                   ← panel webview assets (panel.js, styles, icon)
tests/run.js             ← zero-dep smoke tests
tests/panel.js           ← panel provider + message-routing tests
```

## VS Code: the Gaia panel

The primary interface is the **Gaia** view in the Activity Bar (webview
view `gaia.panel`, labeled "3-Court"). It has five sections:

- **Config** — auto-detect `.gaia.yml`, or open it.
- **Run** — pick a court (WITNESS / TRUSTGAP / TRIAGE) and run it, or
  generate the full report; a live log and job indicator show progress (one
  job runs at a time).
- **Last report** — summary of the most recent run, with buttons to open the
  HTML report (reused webview tab) or the Markdown report.
- **Dashboard** — connection badge, run courts straight to the dashboard,
  open the dashboard, refresh.
- **Install courts** — pick a host and install.

Progress streams into the panel's log instead of notification toasts.

## Commands (back-compat entry points)

The six commands below still work, but they now just reveal the panel and
either run the action directly or focus the relevant section for you to
finish there:

- `gaia.detectConfig`, `gaia.generateReport`, `gaia.openReport`,
  `gaia.dashboardRun` — reveal the panel and run the action immediately.
- `gaia.installCourts`, `gaia.runCourt` — reveal the panel at the
  Install courts / Run section, with the host preselected from
  `gaia.defaultHost` where applicable; no quickpick — pick in the panel.

## Quick start (CLI, host-agnostic)

```bash
# In any repo:
node court-extension/bin/gaia-setup.js --repo .          # detect + install all hosts
node court-extension/bin/gaia-setup.js --repo . --host claude --host bob

# Run the courts + render the report:
node court-extension/bin/gaia-report.js --repo .
#   → reports/gaia/gaia-report.html  (interactive: R/Y/G clauses,
#     mutation gutter, evidence timeline, click-to-jump vscode:// links)
#   → reports/gaia/gaia-report.md    (agent-friendly, re-runnable)
#   → reports/gaia/gaia-input.json   (raw engine output for audit)
```

## Quick start (VS Code)

1. Open a repo. Click the **Gaia** icon in the Activity Bar to open the
   3-Court panel.
2. **Config** section: auto-detect `.gaia.yml`.
3. **Install courts** section: pick a host and install — this writes the
   court subagents + MCP wiring into your host (`.claude/`, `.bob/`,
   `.codex/`, `.vscode/mcp.json` + `.github/chatmodes/`, or generic
   `.gaia/`).
4. The extension also registers the engine as an MCP server with VS Code, so
   agent-mode chat can call `witness_*` / `trustgap_*` / `triage_*` with
   VS Code's own model. The caller is the director.
5. **Run** section: pick WITNESS/TRUSTGAP/TRIAGE and run it, or generate
   the full report — progress streams into the panel's log, and **Last
   report** opens the resulting HTML/Markdown.

The six `gaia.*` commands (Command Palette) remain as shortcuts into the
same panel — see "Commands (back-compat entry points)" above.

## The engine standalone (any MCP host)

```bash
node court-extension/court.js --repo /path/to/repo

# JSON-RPC 2.0 over stdio (MCP 2024-11-05):
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"witness_verdict_all","arguments":{}}}
```

## .gaia.yml (the repo adapter)

One per repo; auto-detected on install. Repo-agnostic: every path, pattern,
and runner is config — never assumption. See
`schemas/gaia-config.schema.json`. Minimal jest+Stryker example:

```yaml
version: 1
spec: { path: docs/api-spec.md, clausePattern: '^## (W\d+)', clauseIdPattern: '^W\d+$' }
tests: { framework: jest, dir: tests, clauseTestPattern: 'clause-{{clause}}.test.ts' }
mutation: { tool: stryker, report: reports/mutation/mutation.json, command: npm run mutation }
wall: { denyGlobs: ['src/**'] }
```

## Tool resolution (no node_modules in the opened folder?)

The courts drive the repo's own toolchain (jest for REDLINE + SPLITBRAIN
verify, stryker-or-friends for SPLITBRAIN mutation). The opened VS Code
folder no longer **has** to carry `node_modules`. Resolution order:

1. **The repo's own `node_modules`** — always preferred (version fidelity:
   `ts-jest`/babel transforms are version-sensitive and the repo pinned them).
2. **A configured tool path** — `TRIUMPH_TOOL_PATH` (PATH-style list), then
   `<repo>/.triumph/tool-path.json`, then `~/.triumph/tool-path.json`, each
   `{ "toolPath": ["dir", ...] }` where a dir contains a `node_modules`.
3. **`PATH`** — globally-installed tools (`stryker`, jest).

For spawned shell commands (`mutation.command`), the engine prepends the
repo's `node_modules/.bin` and any configured tool `.bin` dirs to `PATH`,
so a plain `stryker run` works without `npx` (and without npx's
install-prompt). When jest is resolved from *outside* the repo and the repo
has no `node_modules`, the engine creates a **zero-copy junction**
(`<repo>/node_modules` → the tool install's `node_modules`) so jest can
resolve the config's named transforms (e.g. `ts-jest`) against `rootDir`;
the junction is removed as soon as the run settles and is recorded on the
run result for audit. Nothing is ever copied into the repo's sources, and a
real pre-existing `node_modules` is never touched.

If no jest is found anywhere, the error names exactly what was searched.

## Mandatory properties (from BUILD-PROMPT)

- **Path-1 caller execution** — the extension ships files only; each host's
  model runs the subagents. No code path in this repo calls a model.
- **Model-agnostic / any host** — swapping Claude/GPT/DeepSeek/watsonx/Bob is
  a `--host` flag. Engine and reports unchanged.
- **Easy setup** — one command per repo; auto-detection for jest+Stryker,
  pytest, mutmut, and a custom escape hatch.
- **Wall-enforcing** — `assertNotWalled` in `court.js`; the engine itself
  refuses WITNESS reads under `wall.denyGlobs`.
- **Falsifiable** — the trust gap is *derived* from the mutation report;
  dishonest tests are named from per-test `coveredBy` attribution (or
  explicitly `unresolved` — never guessed).
- **Repo-agnostic** — validated on `northstar/` (TS+jest+Stryker) and a
  second scratch repo (JS+jest) in this workspace.
- **Incremental for chat** — `trustgap_mutate` returns a `job_id`
  immediately; `trustgap_status` polls. A chat conversation never blocks.

## Tests

```bash
node court-extension/tests/run.js
```

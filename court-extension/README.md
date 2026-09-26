# TRIUMPH 3-Court Dev Tool — VS Code Extension

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

See **`BUILD-PROMPT.md`** for the full build spec and **`TRIUMPH-DESIGN.md`**
for the locked architecture.

## The three courts

| Court | What it does | Tool prefix |
|-------|--------------|-------------|
| **REDLINE** | Spec-witness: verdicts from test suites authored from the spec contract alone; wall-enforced (never reads implementation). | `redline_*` |
| **SPLITBRAIN** | Honesty audit: claimed coverage vs real mutation kill-rate; names tautologies. Slow runs are async (`splitbrain_mutate` → `splitbrain_status`). | `splitbrain_*` |
| **WARPATH** | Incident forensics: correlates deploy/metrics/log fixtures, isolates the suspect deploy, renders the postmortem. | `warpath_*` |

Manifesto: **Legal. Honest. Survivable.**

## Layout

```
court.js                 ← the model-free MCP engine (Role 2), repo-agnostic
lib/
  config.js              ← .triumph.yml loader (zero-dep YAML subset + validation)
  detect.js              ← workspace auto-detector (fills .triumph.yml)
  runners.js             ← jest / pytest / custom test runners → normalized verdicts
  trustgap.js            ← SPLITBRAIN honesty math (gap derived, never asserted)
  hosts.js               ← Role 1: per-host subagent + MCP writers
  render.js              ← Role 3: engine JSON → interactive HTML + agent MD
agents/                  ← the subagent prompt pack (write-once, per-host)
  spec-witness.md  test-author.md  mutant-analyst.md  war-room.md
schemas/triumph-config.schema.json
bin/
  triumph-setup.js       ← "Install courts for this repo" (CLI form of Role 1)
  triumph-report.js      ← collect engine JSON over MCP, render both reports
src/extension.js         ← VS Code extension host (commands + MCP provider)
tests/run.js             ← zero-dep smoke tests
```

## Quick start (CLI, host-agnostic)

```bash
# In any repo:
node court-extension/bin/triumph-setup.js --repo .          # detect + install all hosts
node court-extension/bin/triumph-setup.js --repo . --host claude --host bob

# Run the courts + render the report:
node court-extension/bin/triumph-report.js --repo .
#   → reports/triumph/triumph-report.html  (interactive: R/Y/G clauses,
#     mutation gutter, evidence timeline, click-to-jump vscode:// links)
#   → reports/triumph/triumph-report.md    (agent-friendly, re-runnable)
#   → reports/triumph/triumph-input.json   (raw engine output for audit)
```

## Quick start (VS Code)

1. Open a repo. Run **TRIUMPH: Install courts for this repo**.
2. The extension auto-detects `.triumph.yml`, then writes the court subagents
   + MCP wiring into your host (`.claude/`, `.bob/`, `.codex/`,
   `.vscode/mcp.json` + `.github/chatmodes/`, or generic `.triumph/`).
3. The extension also registers the engine as an MCP server with VS Code, so
   agent-mode chat can call `redline_*` / `splitbrain_*` / `warpath_*` with
   VS Code's own model. The caller is the director.
4. **TRIUMPH: Generate 3-court report** runs all courts and opens the
   interactive HTML report.

## The engine standalone (any MCP host)

```bash
node court-extension/court.js --repo /path/to/repo

# JSON-RPC 2.0 over stdio (MCP 2024-11-05):
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"redline_verdict_all","arguments":{}}}
```

## .triumph.yml (the repo adapter)

One per repo; auto-detected on install. Repo-agnostic: every path, pattern,
and runner is config — never assumption. See
`schemas/triumph-config.schema.json`. Minimal jest+Stryker example:

```yaml
version: 1
spec: { path: docs/api-spec.md, clausePattern: '^## (W\d+)', clauseIdPattern: '^W\d+$' }
tests: { framework: jest, dir: tests, clauseTestPattern: 'clause-{{clause}}.test.ts' }
mutation: { tool: stryker, report: reports/mutation/mutation.json, command: npm run mutation }
wall: { denyGlobs: ['src/**'] }
```

## Mandatory properties (from BUILD-PROMPT)

- **Path-1 caller execution** — the extension ships files only; each host's
  model runs the subagents. No code path in this repo calls a model.
- **Model-agnostic / any host** — swapping Claude/GPT/DeepSeek/watsonx/Bob is
  a `--host` flag. Engine and reports unchanged.
- **Easy setup** — one command per repo; auto-detection for jest+Stryker,
  pytest, mutmut, and a custom escape hatch.
- **Wall-enforcing** — `assertNotWalled` in `court.js`; the engine itself
  refuses REDLINE reads under `wall.denyGlobs`.
- **Falsifiable** — the trust gap is *derived* from the mutation report;
  dishonest tests are named from per-test `coveredBy` attribution (or
  explicitly `unresolved` — never guessed).
- **Repo-agnostic** — validated on `northstar/` (TS+jest+Stryker) and a
  second scratch repo (JS+jest) in this workspace.
- **Incremental for chat** — `splitbrain_mutate` returns a `job_id`
  immediately; `splitbrain_status` polls. A chat conversation never blocks.

## Tests

```bash
node court-extension/tests/run.js
```

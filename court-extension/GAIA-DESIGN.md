# Gaia — 3-Court Dev Tool: Final Architecture

## Decision (locked)
- **Path 1 — Caller executes subagents we ship.** The caller's model runs the
  court subagents with its own brain. The extension never calls a model itself.
- The extension has **three roles**: setup orchestrator, tool/engine server,
  and report generator.

## The three roles

### Role 1 — Setup orchestrator (materialize subagents into every agent host)
The extension writes/syncs the court subagent prompts + MCP wiring into each
target agent's recognized location, so the *caller* can run them with its own
model:

| Agent / host | Config the extension writes | Who runs the subagent |
|--------------|-----------------------------|------------------------|
| VS Code Chat | native chat participants + MCP | VS Code's model |
| Claude Code | `.claude/agents/*.md` + `.mcp.json` | Claude |
| OpenAI Codex | agent defs + MCP | Codex model |
| IBM Bob | `.bob/` config + `.bob/mcp.json` | Bob's model |
| Other MCP/agent hosts | their recognized format | that host's model |

One user command — e.g. "Install courts for this repo" — drops in the
subagents and wires the engine over MCP. The caller is the director.

### Role 2 — Tool + engine server (model-free MCP server)
The extension runs the 3-court engine as an MCP server it registers with the
above agents, exposing:
- `witness_*`  — spec-witness verdicts per clause.
- `trustgap_*` — claimed coverage vs real mutation kill-rate.
- `triage_*` — incident/postmortem tooling.
- `courts_about` — meta.

Model-free by construction: ships zero keys, calls no LLM, runs no subagents.
Its deterministic JSON output is the source of truth for the reports.

### Role 3 — Report generator (two artifacts, one engine output)
After any caller's subagents run the courts, the extension ingests the engine's
JSON and renders:
- **Interactive HTML report** — R/Y/G per clause, mutation gutters, postmortem
  timeline, click-to-jump edit links.
- **Agent-friendly Markdown report** — clean, parseable summary the subagents
  / user can consume and re-run exactly.

Same engine output → both reports. Model-agnostic because the reports are
rendered from deterministic tool results, not model prose.

## Why this satisfies "any model, any host"
- **Caller executes subagents** (Path 1) → the brain is always the caller's
  model: Claude, GPT, DeepSeek, IBM watsonx/Granite, whatever. We don't care.
- **Extension never reasons** → no locked-in model, no keys.
- **Setup is one command** → the extension materializes subagents + MCP config
  into whichever agent the user is in, including IBM Bob's chat/agent.

## Data flow
```
User opens repo in VS Code
  └─ Extension: "Install courts" → writes .claude/, .bob/, codex, vscode config
        └─ Caller agent (Bob/Claude/Codex) runs court subagents with ITS model
              └─ subagents call engine MCP tools (witness/trustgap/triage)
                    └─ engine returns deterministic JSON
                          └─ Extension renders HTML report + MD report
```

## Manifesto (unchanged)
**Legal. Honest. Survivable.**

## Build order
1. **Engine** (model-free): refactor `court.js` — WITNESS/TRUSTGAP/TRIAGE
   tools over MCP, deterministic JSON out.
2. **Repo adapter**: `.gaia.yml` + auto-detect (spec/test/mutation/fixtures).
3. **Subagent prompt pack**: spec-witness, test-author, mutant-analyst,
   war-room — written once, materialized per-host.
4. **Setup orchestrator**: write config into .claude/.bob/codex/vscode.
5. **Report generator**: HTML + MD from engine JSON.
6. **Validate** on the demo repo + a second real repo, standalone + with each agent.

Ignite a **30-minute timer** each cycle; iterate until perfect.
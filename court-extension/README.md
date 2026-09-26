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

See **`BUILD-PROMPT.md`** for the full build spec, and **`TRIUMPH-DESIGN.md`**
for the architecture.

## The three courts

| Court | What it does | Tool prefix |
|-------|--------------|-------------|
| **REDLINE** | Spec-witness: test suites authored from the repo's spec contract alone; never reads implementation. | `redline_*` |
| **SPLITBRAIN** | Honesty audit: claimed coverage vs real mutation kill-rate (Stryker); catches tautologies. | `splitbrain_*` |
| **WARPATH** | Incident forensics: pulls deploy/metrics/log fixtures, isolates suspect deploy, writes postmortem. | `warpath_*` |

Manifesto: **Legal. Honest. Survivable.**

## The extension's three roles

1. **Setup orchestrator** — writes/syncs the court subagent prompts + MCP wiring
   into each agent host's location (VS Code Chat, Claude Code `.claude/agents`,
   OpenAI Codex, IBM Bob `.bob/`). One command installs the courts for the
   current host.
2. **Tool + engine server** — runs the 3-court engine as an **MCP server**
   (`redline_*`, `splitbrain_*`, `warpath_*`, `courts_about`). Model-free:
   zero keys, zero LLM calls.
3. **Report generator** — renders the engine's deterministic JSON into an
   **interactive HTML report** and an **agent-friendly Markdown report**.

## Core engine (model-free)

The engine (`court.js`) runs standalone as a JSON-RPC 2.0 / MCP server over
stdio:

```bash
# Run standalone
node court-extension/court.js

# Speak JSON-RPC 2.0 over stdin/stdout (MCP 2024-11-05):
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"redline_clause","arguments":{"clause_id":"W4"}}}
```

Its deterministic output is the single source of truth for the reports.
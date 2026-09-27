# TRIUMPH 3-Court Dev Tool — Build Prompt

## Opportunity
Build a **VS Code extension** that bakes our **3-court method** (REDLINE /
SPLITBRAIN / WARPATH) into everyday development — writing tests, reviewing
coverage honestly, and debugging incidents — for **any repository** and for
**whatever model the user wants**, including IBM Bob's chat. It works by
installing our court *subagents* into the agent hosts the user already has, and
letting each host's **own model** execute them (Path 1 — caller executes the
subagents we ship).

## The three courts (the method)
1. **REDLINE** — *Spec-witness.* Test suites authored from the repo's spec
   contract alone (never reading implementation). Where reality diverges from
   the documented contract → fail.
2. **SPLITBRAIN** — *Honesty audit.* Claimed coverage vs real mutation
   kill-rate (Stryker). Tests that pass but catch nothing → tautology.
3. **WARPATH** — *Incident forensics.* Pull deploy/metrics/log fixtures,
   isolate the suspect deploy, write a structured postmortem.

Manifesto: **Legal. Honest. Survivable.**

## The extension has three roles — never reasons itself, never holds a model.

### 1. Setup orchestrator
Materialize the court subagent prompts + MCP wiring into every agent host's
recognized location, so the caller runs them with its own model:
- **VS Code Chat** → chat participants + MCP
- **Claude Code** → `.claude/agents/*.md` + `.mcp.json`
- **OpenAI Codex** → agent defs + MCP
- **IBM Bob** → `.bob/` config + `.bob/mcp.json`
- **Other MCP/agent hosts** → their format (behind a per-host adapter)

The primary interface is the TRIUMPH Activity Bar panel (webview view
"3-Court"), with an "Install courts" section (host dropdown + Install) that
does the drop-in for whichever host the user picks. The six `triumph.*`
commands (e.g. "Install courts for this repo") remain as back-compat entry
points that reveal the panel at that section. The caller — not us — is the
director.

### 2. Tool + engine server (model-free MCP server)
Runs the 3-court engine as an MCP server wired into the above agents:
`redline_*`, `splitbrain_*`, `warpath_*`, plus `courts_about` meta. Deterministic
JSON out. **Zero API keys, zero LLM calls, zero subagent orchestration.** The
engine is the source of truth for every report.

### 3. Report generator (two artifacts, one deterministic output)
Ingest the engine's JSON (from any caller) and render:
- **Interactive HTML report** — R/Y/G per clause, mutation gutters, postmortem
  timeline, click-to-jump edit links.
- **Agent-friendly Markdown report** — clean, parseable, re-runnable.

Same engine output → both reports. Model-free because reports are rendered
from deterministic tool results, not model prose.

## Mandatory properties
- **Path-1 caller execution** — we ship subagents; the caller's model runs
  them. We never call a model.
- **Model-agnostic / any host** — swaps to Claude, GPT, DeepSeek, IBM
  watsonx/Granite, or IBM Bob's chat are config-only. No engine or report
  changes.
- **Easy setup** — one-per-repo `.triumph.yml` adapter + auto-detection for
  common stacks (jest+Stryker, pytest+mutation). The extension also auto-fills
  it from the open workspace.
- **Wall-enforcing** — REDLINE refuses to read implementation; verdicts come
  from the spec contract only.
- **Falsifiable** — SPLITBRAIN catches every tautology; no fake-pass survives.
- **Repo-agnostic** — spec/test/mutation/fixture locations are config, not
  assumptions.
- **Incremental for chat** — fast courts run synchronously; slow mutation runs
  expose async status so a chat conversation never blocks.

## Deliverables / build order
1. **Engine** (model-free): REDLINE/SPLITBRAIN/WARPATH tools over MCP,
   deterministic JSON out (refactor existing `court.js`).
2. **Repo adapter**: `.triumph.yml` schema + auto-detector.
3. **Subagent prompt pack**: spec-witness, test-author, mutant-analyst,
   war-room — written once, materialized per-host.
4. **Setup orchestrator**: per-host writer (vscode/.claude/.bob/codex) behind an
   adapter interface.
5. **Report generator**: HTML + MD from engine JSON.
6. **Validate**: demo repo + a second real repo, standalone, through each agent,
   through IBM Bob's chat.

Work without stopping until production-grade. On each cycle, ignite a
**30-minute timer** that prompts you to keep perfecting the project.
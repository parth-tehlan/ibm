# Hackathon Workspace — TRIUMPH Project

This is the living workspace for the IBM Bob 2.0 Hackathon submission **TRIUMPH**.
The official guide is in `../challenge/` (numbered 00–10). Bob session screenshots go
in `../bob_sessions/`.

---

## 🌱 If you're new or just need the story

- **`triumph-plain-english.md`** — every idea, term, and screenshot explained in simple words, no jargon. Start here.
- **`triumph-combined-master-plan.md`** — the full "what we're building" (scope, three gates, demo, build plan).

## ⚙️ For the automation loop / build agent (READ THESE)

- **`BUILD_ORDERS.md`** — standing invariants (non-negotiable rules every run must obey). Read every run.
- **`WORK_STATE.md`** — the single source of truth for progress: NEXT UP + timestamped LOG + BLOCKED. Read and append every run.
- **`option-c-prompt.md`** — the exact scheduled-loop prompt text.

## 🛠️ Implementation reference (how to build it)

- **`triumph-implementation-report.md`** — scraped live from bob.ibm.com; exact config schema for custom modes, hooks, MCP, skills, `.bobignore`, rollback, @-mentions. Includes the critical design correction: the **isolation wall is mode `fileRegex` + PreToolUse hook (exit 2), NOT `.bobignore`** (it is workspace-global and `@` bypasses it). Has §14 build-ready drafts and §15 QA checklist.
- **`mcp-ide-docs-facts.md`** — dedicated MCP server-transports + custom-modes facts (STDIO/SSE/HTTP, `mcp` tool group, `alwaysAllow`).

---

## Working set (what the agent may read)

| File | Purpose |
|---|---|
| `BUILD_ORDERS.md` | Invariants (do not modify) |
| `WORK_STATE.md` | Progress log (modify: append + set NEXT UP) |
| `option-c-prompt.md` | Loop prompt (reference) |
| `triumph-implementation-report.md` | HOW to build |
| `triumph-combined-master-plan.md` | WHAT we're building |
| `triumph-plain-english.md` | Plain-language overview |
| `mcp-ide-docs-facts.md` | MCP schema |
| `README.md` | This index |

## 🗄️ Archived (DO NOT read — superseded)

`_archive/` holds old, superseded documents (individual lane plans, early ideation,
superseded strategy/research). Kept for historical reference only. **The build agent
is instructed to never read anything in `_archive/`.**

---

## How to win (one-liner)

Bob IDE must be **core and on camera** doing parallel subagents + `@`-ing a real PDF; a mode that physically cannot cheat is the product; a `PreToolUse exit 2` hook is the guarantee; MCP serves **local fixtures**, not the internet; author `.bob/` outside Bob to protect the Bobcoins; capture `bob_sessions/` PNGs per task.
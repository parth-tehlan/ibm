# TRIUMPH — BUILD ORDERS (standing invariants)

**Read this IN FULL every run. These are non-negotiable. DO NOT modify this file.**
This is the "memory" for the Option-C 30-min automation loop. It exists so each
fresh-chat run obeys the same rules without re-deriving them and burning Bobcoins.

---

## 1. What we are building (one paragraph)
TRIUMPH — a reusable IBM Bob IDE "skill pack" + a sample repo (`northstar/`) that
runs one payments codebase through **three gates**: REDLINE (spec-legal: PDF spec
→ clause wall), SPLITBRAIN (test-honest: Stryker → trust gap), WARPATH (incident-safe:
war room → MTTR). The unifying trick: the checking agent is **physically forbidden
from reading `src/`** ("isolation-as-correctness"). The judges want **Bob IDE doing the
work, on camera**. We do NOT ship a webapp/VS Code extension/ACP client.

## 2. Source of truth (read these, in order, only when scope is unclear)
- `challenge/workspace/triumph-implementation-report.md` — HOW to build (confirmed Bob IDE schemas, §11 layout, §14 build-ready drafts, §15 QA checklist)
- `challenge/workspace/triumph-combined-master-plan.md` — WHAT we're building (scope)
- `challenge/workspace/triumph-plain-english.md` — plain-language overview
- `challenge/workspace/mcp-ide-docs-facts.md` — MCP server schema

## 3. HARD CONSTRAINT 1 — The isolation wall is NOT .bobignore alone
`.bobignore` is **workspace-global** (not per-mode) and **`@`-mentions bypass it**;
`insert_content`/`search_and_replace` can bypass it on save. The REAL wall =
**custom-mode `fileRegex` (write scope) + a `PreToolUse` hook that exits 2** on any
`src/` access, plus rules/skills forbidding `@src`. Keep `.bobignore` only as
defense-in-depth (read tool + listing).

## 4. HARD CONSTRAINT 2 — @-mention syntax
File `@`-mentions are **root-relative with a leading slash**: `@/docs/api-spec.pdf`
(NOT `@docs/api-spec.pdf`). This applies to every prompt we write.

## 5. HARD CONSTRAINT 3 — Skills
Each skill lives at `.bob/skills/<name>/SKILL.md` with **both `name` AND `description`
in YAML frontmatter** (no description = skill is ignored). Invoked via `use_skill` or
auto-activation by description — there is NO `@skill`. A custom mode must include the
**`skill` tool group** to load skills at all.

## 6. HARD CONSTRAINT 4 — MCP is local-only
Use project-level `.bob/mcp.json` with a **STDIO** server (`command`/`args`/`cwd`,
JSON-RPC 2.0 over stdio). **No internet in the demo.** `mcp` is a tool group in
custom modes; add it to any mode that calls the server.

## 7. HARD CONSTRAINT 5 — Bobcoin discipline
- Author and test all project/config files **locally/cheaply** — NOT on the live
  provisioned account.
- **Reserve one dedicated near-zero-spend account for the final recorded gold
  session only.** Never trial-and-error against it.

## 8. HARD CONSTRAINT 6 — Scope guardrails
- **Core workflow first and rehearsed.** Do NOT build the optional ACP/web-wrapper.
- Do NOT create new top-level plan documents; only build files + `WORK_STATE.md`.
- Keep metrics as PLACEHOLDERS until the pipeline produces them. Never quote made-up
  numbers on camera as measured results.

## 8b. HARD CONSTRAINT 7 — No placeholders/TODOs; no API mock data
- **No PLACEHOLDER/TODO markers in shipped code.** Scan every `src/`, `tests/`, and
  `.bob/` file you create or change (exclude `.bob/scratch/` and `node_modules/`)
  for: `placeholder`, `TODO`, `FIXME`, `STUB`, `"not implemented"`, `"replace after"`.
  Remove or implement each. Never leave one in a source or test file.
- **Exceptions (the only two allowed):** (1) the PLANTED bugs in `src/` (W1–W8,
  stacking) — they are the deliberate REDLINE/SPLITBRAIN demo subject, not TODOs;
  (2) PLACEHOLDER metrics in state or evidence files the plan declares will be
  measured in the gold session (`incident/metrics.json` mttrSeconds,
  `trustgap` claimedCoverage). Those never excuse a marker in real source/test code.
- **No API returns hard-coded demo or mock data.** Any function a real caller treats
  as an API or data source must read real state (`src/` logic, `fixtures/`,
  `evidence/`) — never canned constants, empty STUB objects, or STUB notes. This
  includes `.bob/mcp/gauntlet.js` and every MCP tool. The planted-bug constants in
  `src/` are exempt (spec-violating values under test, not mock responses).

## 9. When a decision is unsafe
Never guess your way past an unsafe decision. Record it under `BLOCKED / NEEDS
DECISION` in `WORK_STATE.md` and STOP the run.
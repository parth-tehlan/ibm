# TRIUMPH — Bob IDE Implementation Report
**How we turn the plan into actual Bob IDE configuration, based on the official docs.**

*Source: scraped live from bob.ibm.com/docs/ide/* (modes, custom modes, subagents, lifecycle hooks, MCP, `.bobignore`, rollback, custom rules, context mentions, skills, security guidance, audit-code tutorial). This is the authoritative implementation reference for the TRIUMPH plan.*

---

## 0. TL;DR — what the docs actually let us do

| Planned feature | Does Bob support it? | Which mechanism is the real "teeth" |
|---|---|---|
| Custom modes (org chart / personas) | ✅ Yes — `.bob/custom_modes.yaml`, tool groups, `fileRegex` | **Mode `fileRegex`** = hard per-mode write block |
| Witness isolation (forbid seeing `src/`) | ⚠️ Partial — `.bobignore` is **global**, not per-mode; `@` mentions **bypass** it | Belt-and-suspenders: **`fileRegex` (mode) + PreToolUse hook (exit 2) + rules (behavioral)** |
| Parallel subagents | ✅ Yes — `explore` and `general` types, parallel panel | Subagents + roles via mode `allowedSubagents` |
| MCP fixture server (local, no internet) | ✅ Yes — STDIO transport, `.bob/mcp.json` | STDIO `command/args/cwd` |
| SKILL.md workflows | ✅ Yes — `.bob/skills/<name>/SKILL.md` with YAML frontmatter | `name` + `description`; `use_skill` / `/skill` / auto-activate (see §5) |
| Hooks (block destructive actions) | ✅ Yes — `settings.json` `hooks` key | **`PreToolUse` + exit code 2** = blocking |
| Rollback (undo bad fixes) | ✅ Yes — task-scoped snapshots | Chat "Changed files" + rollback button |
| `@spec.pdf` document understanding | ✅ Yes — file/DOCX/PDF mentions | `@/docs/api-spec.pdf` (text extraction) |
| Capture `bob_sessions` PNGs | ✅ Yes — Tasks list → header → summary | Tomoduchio per submission guide |

**Single most important finding:** the docs confirm our "isolation-as-correctness" mechanic is *implementable*, but **not with `.bobignore` alone**. The real guarantee must come from **custom-mode `fileRegex` + a `PreToolUse` hook that exits 2**. This is a design correction we need to accept and encode.

---

## 1. Custom modes — the org chart (confirmed, deployable)

**File:** project `.bob/custom_modes.yaml` (or `.bob/custom_modes.yaml`). YAML required.

**Schema confirmed:**
```yaml
customModes:
  - slug: witness            # letters, numbers, hyphens only; must be unique
    name: 🕵️ Witness
    description: Isolated test/evidence author (never reads src/).
    roleDefinition: You are a witness who writes tests from the spec alone.
    whenToUse: Write clause/policy tests without seeing the implementation.
    customInstructions: Never open the src/ directory.
    groups:
      - read
      - - edit
        - fileRegex: "^tests/.*"     # only writes into tests/
        - description: tests only
      - skill
      - subagent
    allowedSubagents:            # optional: restrict subagent types
      - explore
```

**Key rules the docs give us (all matter for TRIUMPH):**
- Tool groups available: `read`, `edit`, `execute`, `mcp`, `skill`, `workflow`, `todo`, `subtask`, `subagent`, `mode`.
- **`fileRegex` restricts the `edit` group** — this is our per-mode write fence (e.g. `surgeon` = `^src.*|^tests/.*`).
- Omit `groups` → mode gets *no* tools.
- `allowedSubagents` restricts which subagent presets the mode can spawn.
- Per-mode extra instructions: `.bob/rules-{mode-slug}/` directory (loaded alphabetically, combined with `customInstructions`).
- You can override built-in modes (agent/ask/plan) by using the same slug.

**Design implication for our 9 modes:** assign each a tight `fileRegex`:
| Mode | edit `fileRegex` allowed to write | Notes |
|---|---|---|
| `witness` | `tests/clause-*` , `tests/policy-*` only | plus **NO `@src` and no read of src via rules/hook** |
| `mutineer` | scratch copy only (e.g. `.bob/scratch/**`) | runs Stryker |
| `isolate` | `TrustGap.json`, `*.json` in evidence dir | reads tests only |
| `surgeon` | `^src/.*` , `^tests/.*` | cannot touch docs/fixtures/evidence |
| `compliance-officer` | `evidence/**`, `clause-wall/**` | director, no code |
| `incident-commander` | `incident/**/*.md` | director of war room |
| `forensic-explorer` | (none — read-only) | |
| `comms-officer` | `incident/.*`, `CHANGELOG.md` | postmortem |
| `control-agent` | **no restriction on src** (deliberate opposite) | the comparison baseline |

---

## 2. The isolation wall — the CRITICAL finding

**What the docs say (this changes our approach):**
1. **`.bobignore` is global to the workspace**, not per-mode. One file, applies to everyone. So we **cannot** make "witness can't see src, but surgeon can" purely with `.bobignore`.
2. **`@mentions bypass `.bobignore`** entirely. A witness could type `@/src/pay/create-intent.ts` and read code that `.bobignore` lists. The ignore wall is *not* a hard sandbox.

**Therefore the real isolation is three independent layers (defense in depth):**
- **Layer 1 — mode `fileRegex`:** the `witness` mode is configured so its `edit` group can only target `tests/*`. This blocks *writes* to src.
- **Layer 2 — `PreToolUse` hook (`exit 2`):** the real guarantee. A hook matches the `read_file` / `list_files` / `execute_command` / `write_file` tools and exits 2 if the active mode is `witness` AND the path is under `src/`. This is fully supported (`PreToolUse` + exit 2 = block).
- **Layer 3 — rules + skill instruction:** the `witness` skill/rules explicitly say "never reference `@/src/**`; if you need the implementation, you must not open it."

**We must also test the bypass in rehearsal** — deliberately prompt the witness to `@` a src file and confirm the hook blocks it. This is now a **named rehearsal checklist item**.

**Enforcement recap for each role:**
| Who must not touch | Enforced by |
|---|---|
| witness must not read src | hook (read_file / list_files on `src/`) + rules |
| witness must not write src | mode `fileRegex` (edit → tests only) + hook |
| surgeon must not write docs/fixtures/evidence | mode `fileRegex` (edit → src+tests only) |
| commander/officer must not write src | mode `fileRegex` |
| control-agent CAN read src | no restriction (the deliberate exception) |

---

## 3. Subagents — the parallel panels (confirmed)

**Types:** `explore` (read-only, lighter model) and `general` (full tools, default model).

**Confirmed behaviors:**
- Subagent runs in its **own isolated context window**; does NOT see parent history unless `fork_context: true`.
- Bob spawns subagents **sparingly** — only when the task is self-contained and would pollute context. *This matters:* we must **make the sub-tasks self-contained** (clear prompts) or Bob may do them inline.
- **Approval:** you are prompted to approve each subagent spawn (unless auto-approved).
- **Parallel panel:** multiple subagents running at once are grouped into a **single collapsible panel** with aggregate stats (completed/total, tools used, cost, elapsed, failed calls). This is exactly our "money shot" screenshot.
- **Mode restriction:** a mode's `allowedSubagents` controls which types it can spawn.
- Subagents ≠ subtasks (subtasks are visible, interactive threads).

**Design:**
- Use `explore` subagents for the read-only forensics/test-authoring roles (witness lanes, WARPATH forensics).
- Use `general` subagents for the `surgeon`/`mutineer` roles that must write/execute.
- Set `allowedSubagents` per mode so each court spawns only the right kind.
- **Deliberately prompt for parallel:** "In parallel, spawn ClauseMiner, BehaviorWriter, CrossExaminer." The parallel panel only appears when multiple run *at once* — see §6 gold-script notes.

---

## 4. Hooks — the teeth (confirmed, with exact schema)

**File:** `.bob/settings.json` `hooks` key (project-scope); global in `~/.bob/settings/settings.json`.

**Schema:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(read_file|list_files|write_file|execute_command)$",
        "hooks": [{ "type": "command", "command": "sh .bob/hooks/block-witness-src.sh", "timeout": 5 }]
      }
    ]
  }
}
```

**Confirmed hook behavior (critical):**
- **`PreToolUse`** = runs *before* a matched tool; **exit code `2` = block the tool**. Bob reports it blocked, session continues. ← our enforcement path.
- **`UserPromptSubmit`** = runs before prompt sent; exit 2 blocks the whole prompt.
- **`SessionStart`** = once per session; **stdout injected into context**; cannot block. ← we use this to inject branch/SHA/date (evidence stamp).
- **`Stop`** = at session end; stdout ignored; cannot block. ← we use this to emit MTTR elapsed time.
- **`PostToolUse`** = after tool runs; cannot block; stdout ignored.
- Hook runs via `sh -c`; default timeout 10s; receives JSON on stdin (`{event, session_id, tool, input}`).
- **Working dir** = the task working directory.

**Our hooks (exact):**
1. `inject-evidence.sh` on **`SessionStart`** → output `Project/branch/SHA/date` to inject context + stamp `evidence/manifest.json`.
2. `block-witness-src.sh` on **`PreToolUse`** → read stdin JSON, if `tool` is read/list/write and path starts with `src/` and mode is witness → `exit 2`. (Need to confirm whether hook stdin exposes the active mode — if not, we key off the tool + path and keep the mode restriction via fileRegex + rules.)
3. `block-out-of-scope-writes.sh` on **`PreToolUse`** → mirror surgeon/commander write fences.
4. `stop-write-metrics.sh` on **`Stop`** → write elapsed to `incident/metrics.json` (MTTR).

**Known limitation to plan around:** features like `input rewriting` are NOT supported (hooks can't modify tool input). Our blocker hooks only *block*, which is exactly what we need.

---

## 5. Skills (confirmed, detailed)

**File:** `.bob/skills/<name>/SKILL.md` (project) or `~/.bob/skills/` (global). Project wins on name clash.

**SKILL.md format (confirmed):**
```markdown
---
name: redline-extract
description: Parse an RFC-2119 spec PDF into machine clauses (MUST clauses) and write evidence/clauses.json.
user-invocable: true
---
Everything below the --- is the instructions Bob gets when the skill runs.
```

**Confirmed rules:**
- Required fields: `name`, `description` (skills **without descriptions are ignored** — Bob uses the description to decide when to auto-activate).
- `user-invocable: true` was used in the official audit tutorial (invoked via `/redline-extract`).
- Supporting files alongside `SKILL.md` (checklists, templates, scripts in subfolders) are readable when the skill is active. → keep SKILL.md concise, put details in helper files.
- Skills load once per conversation — refresh a chat to see edits.

**Invocation — ⚠️ the docs give two mechanisms, verify in rehearsal** (the two scrapes returned slightly different facts):
1. **`use_skill` tool** (programmatic / agent-initiated): Plan mode's official instructions literally call `use_skill(skill_name: "create-plan")` to load a skill at startup. This is the invocation a mode/agent uses.
2. **Slash command** (`/redline-extract`) when `user-invocable: true` — as seen in the official audit-code tutorial.
3. **Auto-activation**: Bob matches your request to the `description` and proposes/activates the skill (needs the "Allow Bob to use this skill" toggle on + skills auto-approve, otherwise it pauses on an approval prompt).
- **There is NO `@skill` mention syntax** — `@` covers files/folders/problems/terminal/git/url, not skills. Don't use `@skill` in prompts.
- **Confirmed:** to load skills at all, a custom mode must include the **`skill` tool group** in its `groups:`.

> For our gold session we will use the **`use_skill(skill_name: ...)`** form inside skill instructions (so a mode auto-runs the right workflow) and rely on auto-activation by description; we'll confirm `/skill` still works in rehearsal and pick whichever is most reliable on camera.

**Mapping (plan → actual skills):** 10 skills → `redline-extract`, `redline-test`, `redline-audit`, `splitbrain-witness`, `splitbrain-mutineer`, `splitbrain-isolate`, `warpath-intake`, `warpath-forensics`, `warpath-patch`, `warpath-postmortem`. Each in `.bob/skills/<name>/SKILL.md` with a crisp `description` and a `<Steps>`-style action list.

---

## 6. MCP fixture server (confirmed, STDIO)

**File:** project `.bob/mcp.json` (JSON, `mcpServers` map). Project-level takes precedence over global `~/.bob/settings/mcp.json`.

```json
{
  "mcpServers": {
    "gauntlet-signals": {
      "command": "node",
      "args": [".bob/mcp/gauntlet.js"],
      "cwd": "/path/to/northstar",
      "env": {},
      "alwaysAllow": [],
      "disabled": false
    }
  }
}
```

**Confirmed:**
- Transports: `STDIO` (local, `command`/`args`/`cwd`/`env`), `Streamable HTTP` (remote, `url`/`headers`), and **SSE (legacy)** documented on the server-transports page. Use **STDIO** for local fixtures — **no network needed** (offline/air-gapped safe), child process, JSON-RPC 2.0 over stdin/stdout, newline-delimited. **STDIO servers need no `type` field.**
- Tools exposed via `use_mcp_tool` / `access_mcp_resource`; per-tool enable/disable in MCP settings; `alwaysAllow` (config array) for per-tool auto-approve (global MCP auto-approve toggle must be on).
- **`mcp` is a valid custom-mode tool group** — a mode whose `groups:` includes `mcp` can call the tools. (This comes from the custom-modes page.)
- **No pre-installed servers** — we build our own (Node/TS via MCP SDK). We write these fixture tools ourselves (local, no internet) — matches the plan.
- Our tool surface: `list_clauses`, `get_test_status`, `submit_waiver`, `run_stryker`, `run_suite`, `get_trust_gap`, `get_stack_trace`, `get_logs`, `get_metrics`, `get_recent_deploys`.

**Security note (docs):** local MCP runs with Bob's permissions and can read the filesystem. Keep fixture paths scoped to the repo; never hardcode secrets in `mcp.json`; add to `.gitignore` if secret-bearing; synthetic/no-PI data throughout.

> See also `mcp-ide-docs-facts.md` (the dedicated, more detailed MCP scrape).

---

## 7. Rollback (confirmed — great for the demo)

- Task-scoped **snapshots auto-created before file modifications**. Available in the chat history "Changed files" view + rollback buttons.
- **Demo:** hover a user message → rollback button restores files to that point. This is how we show "we undid the bad breaker fix."
- Respects `.gitignore` (excluded files aren't snapshotted). Built-in exclusions for `node_modules`, `dist`, `.env`, binaries.
- **Note:** rollback only captures changes made *during active Bob tasks* — our pre-snapshot before surgeon runs is a *supplement*, but Bob's own rollback is the primary *on-camera* undo.

---

## 8. Context mentions & document understanding (confirmed)

- File mention: `@/path/to/file.ts` (absolute from workspace root); **works with PDFs and DOCX (text extraction)** → `@/docs/api-spec.pdf` ✓.
- Line range: `@/src/app.js:10-20`. Folder mention non-recursive. Also `@problems`, `@terminal`, `@git-changes`, `@commit-hash`, `@url`.
- **CRITICAL:** `@` mentions **bypass `.bobignore`** (and `.gitignore`). This is why our isolation must rely on hooks + mode fileRegex, and why rehearsal must test the `@src` bypass. The SKILL/rules must forbid witnesses from `@`-mentioning source paths.
- Attach PDF/DOCX/XLSX directly as context (does text extraction) — great for specs/runbooks.
- Context window is **270,000 tokens** — confirms our "separate chats / write findings to file then fresh task" strategy.

---

## 9. Custom rules (behavioral, not enforcement)

- Global `~/.bob/rules/` and workspace `.bob/rules/`; **per-mode dirs `.bob/rules-{mode-slug}/`** (loaded alphabetically).
- Rules are **behavioral guidance, not hard blocks.** Use them to reinforce "never open src" / "never weaken a test," but the actual guarantee is hooks + fileRegex.
- `AGENTS.md` optional; loads after mode rules, before workspace rules.

---

## 10. Permissions & auto-approve (per-task toggles)

- Per-task capability toggles: Read / Edit / Execute / Skill / MCP checkboxes (used throughout the audit tutorial for least-privilege).
- Auto-approve is per-category; higher risk with broad settings. For demo smoothness, we auto-approve the *safe* groups in the gold task but keep Edit/Execute gated where we want an on-camera "blocked" moment (so the hook visibly fires).

---

## 11. Consolidated implementation checklist → file layout

```
northstar/
├── .bob/
│   ├── custom_modes.yaml          # 9 modes + control-agent (role × fileRegex × groups × allowedSubagents)
│   ├── settings.json              # hooks: SessionStart(inject), PreToolUse(block x2), Stop(mt metrics)
│   ├── mcp.json                   # gauntlet-signals (STDIO, local fixtures)
│   ├── skills/                    # 10 skills, one folder each with SKILL.md + helpers
│   ├── rules/                     # workspace rules (bobignore-critical: never @src)
│   ├── rules-witness/             # per-mode: never @src, never open src
│   ├── rules-surgeon/             # never weaken tests; rollback if red
│   ├── hooks/                     # inject-evidence.sh, block-witness-src.sh, block-out-of-scope.sh, stop-metrics.sh
│   └── scratch/                   # Stryker mutant playground (surgeon/control only)
```

---

## 12. Open questions / risks raised by the docs

1. **Does `PreToolUse` stdin expose the active mode?** The docs show `{event, session_id, tool, input}` — no explicit `mode` field shown. If the active mode isn't in stdin, our "block only when mode=witness" hook must instead key off **path + tool** (block src reads/writes when the skill/rule says so) or we rely on `fileRegex` for mode-specific write blocking and the hook as a universal src-guard. **Verify in rehearsal.**
2. **`.bobignore` write-bypass:** `insert_content` / `search_and_replace` "might bypass" `.bobignore` on final save. Our PreToolUse hook can also matcher-match those tool names — add them to the block matcher.
3. **`@` bypass:** covered above — must be disciplined by rules + reminded in every witness prompt; test in rehearsal.
4. **Subagent auto-approval:** for the parallel panel to run smoothly on camera, pre-approve subagent spawns or the demo pauses on prompts.

---

## 13. Nothing blocks the plan — with this one correction

Every planned feature (custom modes, isolation, parallel subagents, MCP fixtures, skills, hooks, rollback, document understanding) **is confirmed supported** by the docs. The single design correction the docs force on us:

> **The isolation wall is implemented as a *three-layer defense*** (mode `fileRegex` for writes + `PreToolUse` exit-2 hook for reads/writes + rules/skills forbidding `@src`), **not** as per-mode `.bobignore` (which is workspace-global and bypassed by `@`).

Everything else in the plan carries over to actual Bob IDE configuration.

---

## 14. Build-ready drafts of the safety-critical pieces

These are literal, copy-ready drafts for the parts that back the "cannot cheat" guarantee. Author the rest (skills, MCP server code, fixtures) after confirming these in rehearsal.

### 14.1 `custom_modes.yaml` — the two modes that define the wall

```yaml
customModes:
  # The honest checker: MUST NOT see src/ .
  # Wall = edit fileRegex (writes) + PreToolUse hook exit-2 (reads) + rules (no @src).
  - slug: witness
    name: 🕵️ Witness
    description: Writes clause/policy tests from the spec, never from the source.
    roleDefinition: >-
      You are a witness. You write tests that assert what the DOCUMENT says the
      software must do. You have NEVER seen the implementation and you must not.
    whenToUse: Writing clause tests or policy tests from a spec PDF.
    customInstructions: >-
      NEVER open or reference the src/ directory, and never use @ mentions to
      source files. If you don't know the implementation, that is correct and intended.
    groups:
      - read
      - edit:
          - fileRegex: "^(tests/clause-|tests/policy-|evidence/).*"
            description: tests/evidence only
      - skill
      - subagent
    allowedSubagents: [explore]

  # The comparison baseline: deliberately has NO wall (control group).
  - slug: control-agent
    name: 🐇 Control Agent
    description: Same task as witness but allowed to read src (the unwalled baseline).
    roleDefinition: >-
      You are the control. You may read the implementation. You write tests and
      may use the source to guide you.
    whenToUse: Demonstrating that an unwalled agent blesses planted bugs.
    customInstructions: >-
      You MAY open src/. There is no isolation on you.
    groups:
      - read
      - edit
      - skill
      - subagent
    allowedSubagents: [explore, general]
```

### 14.2 `block-witness-src.sh` — the PreToolUse hook (rehearsal-verify the stdin fields)

```bash
#!/usr/bin/env bash
# Reads JSON on stdin: {event, session_id, tool, input, ...}
# Block ANY read or write of src/ when the active mode is witness.
set -euo pipefail

read -r payload

# Parse the active mode (field may be `mode` or nested; see open question §12.1).
mode=$(printf '%s' "$payload" | jq -r '.mode // empty')
tool=$(printf '%s' "$payload" | jq -r '.tool // empty')
path=$(printf '%s' "$payload" | jq -r '.input // empty' | jq -r '.file_path // empty')

if [ "$mode" = "witness" ]; then
  case "$tool" in
    read_file|list_files|write_file|apply_diff|insert_content|search_and_replace|execute_command)
      # Normalize: block if the path (or an execute command arg) mentions src/
      if printf '%s' "$path" | grep -qE '(^|/)src/'; then
        echo "BLOCKED: witness must not access src/"
        exit 2          # <-- exit 2 = block
      fi
      ;;
  esac
fi

exit 0
```

> **Note:** `jq` may not be preinstalled in the Bob task environment — the hook should shell-parse stdin (e.g. with a small `sed`/`awk` helper or a tiny node script) rather than assume `jq`. Verify the exact stdin schema in rehearsal (§12.1) and update the parser. The matcher list must include `insert_content`/`search_and_replace` because they can bypass `.bobignore` on save (§12.2).

### 14.3 `.bob/rules-witness/00-never-src.md` — the behavioral layer (belt-and-suspenders)

```markdown
# Witness rules
- You are a WITNESS. You write tests from the document ONLY.
- You have NEVER seen the implementation. That is the point.
- NEVER open, list, grep, or @-mention anything under `src/`.
- NEVER run the test suite against `src/` code you were not given.
- If you are tempted to read the code, stop and write the test from the spec instead.
```

---

## 15. Rehearsal checklist — verify the wall before trusting it

Run each of these **before** the gold session (they cost coins; do them on a scratch copy):
- [ ] `witness` cannot `read_file` a `src/` file → hook exits 2 (blocked message shows).
- [ ] `witness` cannot `@/src/pay/create-intent.ts` and get content → **@ bypass is blocked**.
- [ ] `witness` cannot `write_file` into `src/` → edit `fileRegex` blocks.
- [ ] `insert_content` / `search_and_replace` on `src/` by witness → hook blocks (not just `.bobignore`).
- [ ] `control-agent` CAN read `src/` → no false block on the baseline.
- [ ] `surgeon` can edit `src/`+`tests/` but NOT `evidence/`/`docs/`/`fixtures/`.
- [ ] `execute_command` `cat src/...` by witness → hook blocks (custom command path).
- [ ] Rollback: complete a surgeon fix, hover the message, roll back → files restore.
- [ ] Skills load: switch to `witness` with the `skill` group, confirm `use_skill`/`/` works.
- [ ] Stryker runs on the scratch copy and produces a `TrustGap.json` from real mutants.
- [ ] `@/docs/api-spec.pdf` (leading slash) attaches the PDF correctly.
# BOB.md — how this repo is structured for IBM Bob 2.0

Read this before touching `.bob/`. It's the ground truth on Bob's actual config schema, scraped
from `bob.ibm.com/docs` on 2026-09-26. Two things here **overturn assumptions in the original
TRIUMPH plan** — read §5 before building any hook or per-mode `.bobignore`.

---

## 1. Directory layout

```
<repo-root>/
├── BOB.md                      # this file
├── .bobignore                  # ONE file, workspace-root scoped — see §5
└── .bob/
    ├── custom_modes.yaml        # all custom modes, one file
    ├── mcp.json                 # MCP server registrations (project-level)
    ├── rules/                   # rules that apply to ALL modes
    │   └── *.md
    ├── rules-<mode-slug>/       # rules that apply ONLY to that custom mode
    │   └── *.md
    └── skills/
        └── <skill-name>/
            └── SKILL.md
```

Global (cross-project) equivalents live under `~/.bob/settings/` and `~/.bob/skills/` — we don't
use those for TRIUMPH; everything is project-scoped so it ships in the repo.

`AGENTS.md` at repo root is auto-loaded by Bob by default, separately from `.bob/rules/`. If we
want something loaded unconditionally with zero setup, it goes there instead.

---

## 2. Custom modes — `.bob/custom_modes.yaml`

```yaml
customModes:
  - slug: witness
    name: 🔍 Witness
    description: Isolated spec-only test author. Never opens src/.
    roleDefinition: >
      You are a test author who works ONLY from specification and policy documents.
      You never open, read, or reference files under src/. Your tests describe what
      the spec promises, not what the code does.
    whenToUse: Use to author characterization or policy tests before any src/ fix.
    groups:
      - read
      - - edit
        - fileRegex: "^tests/(clause|policy)-.*\\.test\\.ts$"
          description: Only new clause/policy test files
      - skill
```

Required fields: `slug`, `name`, `roleDefinition`.
Optional: `description`, `whenToUse`, `customInstructions`, `allowedSubagents`.

**Tool groups**: `read`, `edit`, `execute`, `mcp`, `skill`, `workflow`, `todo`, `subtask`,
`subagent`, `mode`. Only `edit` supports the nested `fileRegex` restriction (confirmed in docs —
whether `read` can be similarly scoped is **unconfirmed**, see §5.2).

**File-restriction syntax** — `edit` becomes a two-element list, not a flat string:
```yaml
groups:
  - - edit
    - fileRegex: "pattern"
      description: "human-readable note"
```

---

## 3. MCP servers — `.bob/mcp.json`

```json
{
  "mcpServers": {
    "gauntlet-signals": {
      "command": "node",
      "args": ["mcp/gauntlet-signals/index.js"],
      "cwd": ".",
      "env": {},
      "alwaysAllow": [],
      "disabled": false
    }
  }
}
```
Project `.bob/mcp.json` overrides global `~/.bob/settings/mcp.json` if both define the same server.

---

## 4. Skills — `.bob/skills/<name>/SKILL.md`

```markdown
---
name: redline-extract
description: Extract every RFC-2119 MUST/SHALL clause from a spec document into evidence/clauses.json.
---

Steps the skill performs when Bob activates it...
```

Only `name` and `description` are required frontmatter. **`description` is load-bearing** — Bob
decides whether to auto-activate a skill based on it, so write it like a trigger condition, not a
title. Project-level skill wins over a global one of the same name.

Rules live separately from skills: `.bob/rules/*.md` (all modes) or `.bob/rules-<slug>/*.md`
(one mode only), loaded alphabetically.

---

## 5. Where the original plan was wrong — read this before building the wall

### 5.1 There is no hook system

Bob has **no `PreToolUse`/`Stop`/`SessionStart` hooks, no `settings.json` hook config, no
exit-code-based blocking**. This was confirmed absent from both the security-guidance and
auto-approve docs, and `.../configuration/hooks` 404s outright.

Consequence: **cut these files entirely** — `block-witness-src.sh`, `block-out-of-scope-writes.sh`,
`inject-evidence.sh`, `stop-write-metrics.sh`. There is nothing in Bob for them to attach to.

The wall is enforced two ways instead:
- **`.bobignore`** — blocks `read_file`/`write_file`/`apply_diff` on matched paths, repo-wide.
- **`fileRegex` on a mode's `edit` group** — scopes what that mode can *write*, mode by mode.

This is arguably a stronger pitch, not a weaker one: *"the isolation is declarative Bob
configuration, not a bolt-on script watching for violations."* Say it that way in the README.

### 5.2 `.bobignore` is one file for the whole workspace — not per-mode

There is no per-custom-mode `.bobignore` scoping documented. One `.bobignore`, repo-root scoped,
applies regardless of active mode.

This breaks the plan as literally written: `witness` needs `src/` blocked while `surgeon` (same
repo, same session) needs `src/` open. A single global ignore file can't hold both states at once.

**What to actually build:** don't rely on `.bobignore` for the witness/surgeon split at all. Use it
only for things that should *never* be touched by any mode (e.g. `fixtures/mutants.json`,
`.env`). For the witness wall specifically:
- `witness` mode gets `groups: [read, skill]` — no `edit` group, so it cannot write to `src/` or
  anywhere else. It also is not asked to open `src/` — `whenToUse`/`roleDefinition`/rules in
  `.bob/rules-witness/` explicitly instruct it never to.
- **Unconfirmed and worth 20 minutes before the gold session:** whether `read` supports a
  `fileRegex` the same way `edit` does. If yes, `witness` can be hard-blocked from *reading*
  `src/`, matching the original "physically cannot see it" claim exactly. If no, the honest framing
  becomes *"structurally unable to act on src/, and instructed never to open it"* — still a real
  isolation guarantee, just not an OS-level read block. Test this directly in Bob IDE (try
  `@src/something.ts` from `witness` mode) before writing that line into the pitch.

### 5.3 Subagents are not user-authored personas

The plan names subagents like `ClauseMiner`, `BehaviorWriter`, `Mutineer`, `Blame`, `LogWindow` —
implying each is a defined, nameable role. What Bob actually has is **two subagent types**:
`explore` (read-only, lighter model) and `general` (full tool access, default model), spawned
automatically by Bob when a task looks self-contained, and gated by which types the *active custom
mode* permits (`allowedSubagents`).

Consequence: those named roles aren't separate configured entities — they're **task framings**
you give Bob within a session (e.g. "as three parallel `explore` subagents, do X, Y, Z"), not
YAML you write once. Drop any plan to define per-subagent config files. Keep the names in the
README and demo narration — they're fine as descriptive labels for what a given subagent call is
doing — just don't expect a `subagents.yaml` to exist.

### 5.4 No orchestrator mode

There's no built-in "orchestrator" concept. Bob moves between modes on its own when appropriate.
`compliance-officer` / `incident-commander` are just custom modes like any other — nothing special
elevates them to "orchestrator" beyond `whenToUse` guidance and which subagent types they permit.

---

## 6. What every teammate needs to know before writing anything

1. **One `.bobignore`** at repo root — treat it as a blocklist for things nobody should ever touch
   (secrets, precomputed fixtures), not as the witness/surgeon wall.
2. **The wall is mode `groups` + `fileRegex`**, defined once in `.bob/custom_modes.yaml`. Don't
   duplicate mode logic elsewhere.
3. **No hooks.** If you're tempted to write a shell script to "enforce" something, stop — put the
   restriction in the mode definition or a rules file instead.
4. **Subagents are spawned in-session by prompt, not pre-configured.** Don't build subagent YAML.
5. **Rules can be mode-scoped** (`.bob/rules-<slug>/`) even though `.bobignore` can't be — use this
   for anything mode-specific that isn't a file-access restriction (e.g. "never weaken a test").
6. Before recording the gold session: **verify §5.2's open question** (read-scoping) live in Bob
   IDE. It determines the exact wording of our core claim.

---

*Sourced from bob.ibm.com/docs on 2026-09-26. If Bob ships a docs update before we build, re-check
`configuration/custom-modes`, `configuration/bobignore`, `features/subagents`, and
`configuration/mcp/mcp-in-bob` — this file should be treated as a snapshot, not a live reference.*

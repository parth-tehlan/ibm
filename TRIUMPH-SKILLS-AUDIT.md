# TRIUMPH — Skills & Tooling Audit

Audit of what's installed in Claude Code on this machine, mapped against the TRIUMPH build
(REDLINE ⟗ SPLITBRAIN ⟗ WARPATH), plus the gaps that need filling before the build starts.

Claude Code is the **build tool**; IBM Bob is the **product**. Everything here is about making
the `.bob/` pack, the `northstar` repo, and the measurement harness faster to produce — none of
it ships in the submission.

Audited: 2026-09-26 · Marketplace: `claude-plugins-official`, `addy-agent-skills`

---

## 1. Currently installed
Install if not available on the machine. 
| Plugin | Version | What it gives you |
|---|---|---|
| `agent-skills@addy-agent-skills` | 0.6.9 | 25 SDLC skills (spec, TDD, planning, review, hooks-adjacent) |
| `skill-creator@claude-plugins-official` | — | Authoring + evaluating SKILL.md files |
| `typescript-lsp@claude-plugins-official` | 1.0.0 | Real TS diagnostics on `northstar` |
| `context7@claude-plugins-official` | — | Current docs for Stryker / Express / Jest / MCP SDK |
| `playwright@claude-plugins-official` | — | Headless browser — dashboard screenshots, demo capture |

Plus built-ins already available: `pdf`, `dataviz`, `artifact-design`, `artifact-diagramming`,
`docx`, `pptx`, `xlsx`, `code-review`, `security-review`, `init`.

---

## 2. Coverage map — build task → skill you already have

| Build task | Owner | Use this |
|---|---|---|
| Author `api-spec.md` with RFC-2119 MUSTs | P1 | `agent-skills:spec-driven-development` |
| `openapi.yaml` + endpoint contracts | P1 | `agent-skills:api-and-interface-design` |
| `api-spec.pdf` / `runbook.pdf` generation | P1 | `pdf` (built-in) |
| Scaffold `northstar` src + tests | P1 | `agent-skills:incremental-implementation` |
| Make planted auth/webhook bugs realistic (W2, W5) | P1 | `agent-skills:security-and-hardening` |
| Design the WARPATH incident so it's actually debuggable | P4 | `agent-skills:debugging-and-error-recovery` |
| Realistic `logs.json` / `metrics.json` fixtures | P4 | `agent-skills:observability-and-instrumentation` |
| Honest policy tests (the SPLITBRAIN control) | P3 | `agent-skills:test-driven-development` |
| Write the 10 Bob `SKILL.md` files | P5 | `skill-creator` |
| Clause wall / Trust Gap / incident HTML | P2, P3, P4 | `agent-skills:frontend-ui-engineering` + `dataviz` |
| Trust Gap charts specifically | P3 | `dataviz` — read before writing chart code |
| Architecture diagram for README | P1 | `artifact-diagramming` |
| 5-person work split + dependency order | P1 | `agent-skills:planning-and-task-breakdown` |
| Branch strategy, merge discipline, the final PR | P5 | `agent-skills:git-workflow-and-versioning` |
| Stryker wired into a repeatable command | P3 | `agent-skills:ci-cd-and-automation` |
| README, walkthrough, postmortem template | P1 | `agent-skills:documentation-and-adrs` |
| Review your own planted code before it ships | all | `agent-skills:code-review-and-quality` |
| Adversarial pass on the demo before rehearsal #3 | all | `agent-skills:doubt-driven-development` |
| Pre-gold-session checklist | all | `agent-skills:shipping-and-launch` |
| Deterministic dashboard screenshots | P5 | `playwright` |

**Note the overlap worth knowing about:** `agent-skills:constraint-driven-development` watches a
diff for a *weakened quality bar* — deleted tests, stripped assertions, added `@ts-ignore`. That is
SPLITBRAIN's thesis applied to a diff instead of a suite. Read it before you finalize the pitch so
you can articulate what TRIUMPH does that it doesn't (mutation-verified, spec-isolated authoring,
not diff-watching). If a judge knows this space, they'll ask.

---

## 3. Install before hour 0 — three plugins, blocks P5

```
/plugin install plugin-dev@claude-plugins-official
/plugin install mcp-server-dev@claude-plugins-official
/plugin install hookify@claude-plugins-official
```

| Plugin | Skills | Why TRIUMPH needs it |
|---|---|---|
| `plugin-dev` | `hook-development`, `agent-development`, `mcp-integration`, `command-development`, `plugin-settings` | You are writing 4 hooks with `exit 2` blocking semantics (`block-witness-src.sh`, `block-out-of-scope-writes.sh`, `inject-evidence.sh`, `stop-write-metrics.sh`). Bob's `PreToolUse`/`Stop` hook contract mirrors Claude Code's closely enough that this skill's payload transfers. **This is the single highest-value install.** |
| `mcp-server-dev` | `build-mcp-server`, `build-mcp-app`, `build-mcpb` | `gauntlet-signals` is a local STDIO MCP server with 3 namespaces and ~10 tools. Don't hand-roll the transport. |
| `hookify` | `writing-rules` | Turns a natural-language rule ("a witness must never read src/") into a hook. Good for generating the second-wall variants fast. Lower priority than the other two — skip if you're moving fast. |

**Optional, low priority** — install only if the need actually shows up:
`session-report` (packaging `bob_sessions/` evidence), `project-artifact` (deliverable bundling),
`agent-sdk-dev` (only if you end up wrapping anything programmatically).

**Skip** — already covered by `agent-skills`: `code-review`, `pr-review-toolkit`, `code-simplifier`,
`frontend-design`, `security-guidance`, `claude-security`, `feature-dev`, `code-modernization`.

---

## 4. Real gaps — nothing installed covers these, you must author them

These are custom SKILL.md files to write with `skill-creator`. Listed in build order.

### 4.1 `bob-schema` — **write this first, hour 0, blocks everything**

**Problem:** Claude has no knowledge of IBM Bob's config formats. Every `custom_modes.yaml`,
`.bobignore`, `mcp.json`, and Bob `SKILL.md` frontmatter we generate is currently a *guess* shaped
like Claude Code's equivalents. If Bob's schema differs in any field name, P5's entire output is
subtly wrong and nobody finds out until integration at hour 21.

**Contents:** scraped and pinned from `bob.ibm.com/docs` —
- `custom_modes.yaml` exact schema: mode name, `roleDefinition`, groups, `fileRegex` syntax, `whenToUse`
- `.bobignore` semantics — is it per-mode or global? glob syntax? does it block reads, writes, or both?
- Bob `SKILL.md` frontmatter fields and how skills are invoked
- Bob hook events (`SessionStart`, `PreToolUse`, `Stop`), the JSON payload shape, and **what exit
  code actually blocks a tool call**
- `mcp.json` STDIO server registration format
- Subagent invocation syntax and how parallel fan-out is triggered

**How:** Firecrawl/WebFetch over the Bob docs URLs already in the hackathon guide, distilled into
one reference skill. Two hours of work that de-risks twenty.

> Until this exists, treat every `.bob/` file as a draft. Do not let P2/P3/P4 build against
> unverified mode syntax.

### 4.2 `mutation-harness` — SPLITBRAIN's measurement, blocks P3

No skill on this machine knows mutation testing. You need:
- Stryker config for TS + Jest (`stryker.conf.json`, `mutate` globs, `testRunner`, timeouts)
- Which mutators to enable so the run finishes in demo-viable time
- How to scope the run to `src/discounts.ts` etc. rather than the whole repo
- Reading the output: mutation score vs. coverage, survived vs. killed vs. timeout, and how to
  export `TrustGap.json` from Stryker's JSON reporter
- The honest framing of what a mutation score does and does not prove

### 4.3 `two-arm-experiment` — the credibility layer, blocks P3

The walled-vs-unwalled comparison is the submission's central claim and there is no skill for
running an experiment cleanly. Needs to encode:
- **Arm A (control):** unwalled Bob session, default test generation off `src/`
- **Arm B (treatment):** witness mode, `.bobignore src/`, tests from spec only
- Both arms face the **identical** Stryker mutant set
- Fixed protocol: same prompts modulo the wall, same model, same repo SHA, arms run in the same
  session-length budget, results appended not overwritten
- Output schema for `TrustGap.json` so the dashboard reads one stable contract
- Rule: **placeholder numbers are marked `null` until a real run fills them.** No hand-typed scores.

### 4.4 `demo-capture` — optional, saves P1 time at the end

Shot-list discipline, Playwright screenshot automation for the three artifacts at fixed viewport,
`bob_sessions/` naming convention (`teamname_taskNN_desc.png`), and a rehearsal QA checklist.
Nice-to-have. Only build it if you're ahead of schedule at hour 24.

---

## 5. Priority summary

| When | Action | Blocks |
|---|---|---|
| Hour 0 | Install `plugin-dev`, `mcp-server-dev` | P5 (hooks + MCP) |
| Hour 0–2 | Author `bob-schema` skill from Bob docs | **everyone** |
| Hour 2–4 | Author `mutation-harness` skill | P3 |
| Hour 4–6 | Author `two-arm-experiment` skill | P3, and the whole credibility story |
| As needed | `hookify`, `session-report`, `demo-capture` | nothing |

Three plugin installs and three custom skills. Everything else the build needs is already on this
machine.

---

## 6. Open item carried from planning

The filmed lane still needs a decision by hour 8: **real public spec, or self-authored spec.**
A real one kills the "you found the bugs you hid" objection outright. `bob-schema` and
`agent-skills:spec-driven-development` both assume this is settled — don't start P1's doc work
until it is.

# WARPATH — Master Plan
**"Paste a stack trace. Bob stands up a war room."**

*Ready-to-build blueprint for the IBM Bob 2.0 Hackathon.*

> **Status:** TERTIARY CONCEPT (remember these: RECON, OKHANDOFF are under-exploited; this is the cinematic-commercial play) · Est. build: ~14h focused · Est. Bobcoins: ~14–20  
> **Judging fit:** Application of Technology (🔴) · Originality (🟡—careful: OpsPilot/Incident Commander clones last year) · Business Value (🟡 high) · Presentation (🔴—the parallel panel screenshot is gold)

---

## 1. Product concept & pitch

**Name:** WARPATH
**One-liner:** Paste a production stack trace; WARPATH spins up an incident war room — parallel forensics, an RCA citing the runbook, a minimal fix under rollback, and a filed postmortem.
**Tagline:** *Paste a stack trace. Bob stands up a war room.*
**Judge-repeatable line (30s):** *"They pasted a crash log and Bob spawned four forensic subagents in parallel — git-blame, log window, runbook, tests — found null userId from yesterday's billing commit, patched it with rollback armed, and filed the postmortem. 47 minutes to 82 seconds. It looks like the NTSB."*

**The core novelty (don't lose it):** This is not "AI explains your stack trace," and it's not a SaaS incident dashboard. It is a **live incident *organization*** whose structure = Bob's custom modes (org chart) + parallel subagents (the work shifts) + MCP fixtures (the alerting hands) + hooks (the walls) + rollback (the safety net). The **runbook PDF is consumed *during* the incident** via document understanding — not precompiled into a skill. If it reads as "OpsPilot clone" you lose; you win only if the mode-walls + parallel panel + runbook-on-camera are all visible.

**Workflow bracket:** Debugging / on-call / MTTR.

---

## 2. Sample repository

**Name:** `northstar-pay` (same payments API as REDLINE? → use a *separate* replica so both demos are self-contained). Name it `northstar-checkout` to avoid confusion.

```
northstar-checkout/
├── src/
│   ├── webhooks/
│   │   └── stripe.ts          # BUG: on missing customer.id it 500s (throws), not 409
│   ├── billing/
│   │   └── async.ts           # the "feat: async billing" commit from yesterday
│   ├── retry.ts               # reads LOCAL_RETRY; no backoff; nested 3x3
│   └── circuit.ts             # shared CircuitBreaker (do NOT touch)
├── docs/
│   └── runbook-payments.pdf   # "on 409 retry with backoff; keep CircuitBreaker open until drained"
│   └── runbook-payments.md    # markdown twin (fallback)
├── fixtures/
│   ├── logs.json              # 60s of logs around the 500 window
│   ├── deploy.json            # "yesterday 14:07 async billing rolled to prod"
│   └── metrics.json           # p95 spike
├── tests/
│   ├── webhooks.stripe.test.ts
│   └── retry.test.ts
├── package.json
└── .env.example
```

### The planted incident (painstakingly deterministic)

The webhook `GET/POST /webhooks/stripe` 500s. Root causes, layered:
1. Yesterday's `feat: async billing` (from agent) removed the `customer.id` null-guard → NPE.
2. `retry.ts` reads `LOCAL_RETRY` with **no backoff** and nests calls 3×3 = 9×, amplifying the retry storm.
3. `circuit.ts`'s `CircuitBreaker` is **SHARED with the auth service** — a tempting "fix" is to trip it, which would take auth down entirely.

The **safe** knob: `LOCAL_RETRY=0`. The **unsafe** knob: `CircuitBreaker`. The runbook PDF explicitly says: "on 409 retry with backoff; do NOT touch shared circuit breaker until the payment queue drains." A naive agent would "fix" by tripping the breaker → disaster. WARPATH must steer to retry-limit + null-guard.

Why this repo wins: it forces the *correct* (safe) RCA, proves the "safe vs unsafe" distinction, and gives the demo a genuine "we almost made it worse" beat.

---

## 3. Full `.bob/` architecture

```
northstar-checkout/.bob/
├── custom_modes.yaml
├── skills/
│   ├── warpath-intake/SKILL.md
│   ├── warpath-forensics/SKILL.md
│   ├── warpath-patch/SKILL.md
│   └── warpath-postmortem/SKILL.md
├── rules/
│   └── incident-protocol.md
├── mcp.json                  # warpath-signals (local STDIO)
├── settings.json             # hooks
└── hooks/
    ├── inject-git-sha.sh
    └── block-out-of-scope-writes.sh
```

### Custom modes (the org chart + the walls)

| Mode | Role | Constraints |
|---|---|---|
| `incident-commander` | Orchestrator; the only mode you drive | read, skill, subagent, todo, mcp, mode. `edit` locked to `incident/**/*.md` via `fileRegex`. **Cannot touch `src/`.** |
| `forensic-explorer` | Read-only forensics | read/skill/subagent(explore). No mutating execute. |
| `patch-surgeon` | The only code-writer | `edit`/`execute` with `fileRegex` = `^(src/|tests/).*`. Skills: patch + tests. **Cannot touch `fixtures/` or `docs/`.** |
| `comms-officer` | Postmortem + comms | Markdown only (`incident/.*`, `CHANGELOG.md`), no code. |

### Parallel forensics (the screenshot — four panels fill live)

| Subagent | Host | Job | Reads |
|---|---|---|---|
| **Blame** | forensic-explorer | `git blame` + walk recent commits touching the stack frames; tag `feat: async billing` | git log + src |
| **LogWindow** | forensic-explorer | Correlate the log window at the 500 timestamp → NPE on missing `customer.id` | fixtures/logs.json |
| **Callers/Tests** | forensic-explorer | Find callers of `stripe` handler + existing tests; which are missing | src + tests |
| **RunbookDoc** | forensic-explorer | Document-understanding of `runbook-payments.pdf` → extract the 409/backoff + breaker rule | runbook.pdf (no src) |

RCA synthesis: "null `customer.id` in webhook, introduced yesterday in `feat: async billing`; runbook says 409+retry-backoff but we 500; no test for missing customer; `LOCAL_RETRY` is safe to zero; CircuitBreaker is shared with auth — do not trip."

### Skills

- **warpath-intake/SKILL.md** — parse the stack trace/alert → spawn the four forensics in parallel → start the RCA template.
- **warpath-forensics/SKILL.md** — per-forensic protocol: how to blame frames, read the log window, read the runbook PDF, find missing tests. Includes "safe vs unsafe knobs" checklist (runbook-derived).
- **warpath-patch/SKILL.md** — minimal fix + regression test; stop if tests fail → recommend rollback; *never* weaken a test; never touch shared infra without a cited runbook rule.
- **warpath-postmortem/SKILL.md** — SEV1 template: timeline, impact, blast radius, root cause, fix, preventions, owner.

### MCP `warpath-signals` (local STDIO, fixtures only)
- `get_stack_trace()` → the planted stack
- `get_logs(window)` → `fixtures/logs.json`
- `get_metrics()` → `fixtures/metrics.json`
- `get_recent_deploys()` → `fixtures/deploy.json`
Same interface maps to real backends later (demo never touches the internet).

### Hooks
- `inject-git-sha.sh` on `SessionStart` — stamps branch/SHA/tag into `incident/manifest.json`.
- `block-out-of-scope-writes.sh` on `PreToolUse` — second wall beyond `fileRegex`: block any write outside the active mode's scope (e.g., surgeon can't write `docs/`). *This is the teeth.*
- `Stop` hook writes `incident/metrics.json` (elapsed seconds → MTTR).

### Rollback
Snapshot `src/` + `tests/` before `patch-surgeon` runs. Demo the "undo a wrong first fix" — e.g., the surgeon initially trips the breaker, we roll it back, then apply the correct fix.

---

## 4. Bob session script (phases)

**Phase 0 — Prep.** Author `.bob/` + repo + fixtures + runbook PDF outside Bob.

**Phase 1 — Intake.**
> `Switch to incident-commander. @docs/runbook-payments.pdf — stand up the war room for this Sev-1.`

**Phase 2 — Parallel forensics (the shot).**
> `In parallel: Blame, LogWindow, Callers/Tests, RunbookDoc. Show me the RCA.`

**Phase 3 — The bad idea (optional beat).** Ask the surgeon to "fix" it by tripping the breaker → hook blocks / rollback shown → pivot.

**Phase 4 — Patch.**
> `Switch to patch-surgeon. Fix the NPE + add a test for missing customer.id. Set LOCAL_RETRY=0. Do not touch CircuitBreaker.`

**Phase 5 — Verify.** Tests green.

**Phase 6 — Postmortem.**
> `Switch to comms-officer. Write incident/SEV1-2026-02-14.md from warpath-postmortem.`

Incident metrics written by the Stop hook: **MTTR 47 min → 82 sec.**

---

## 5. Judge screenshot artifact — the war room / incident report

Two artifacts, in order of impact:

1. **The parallel forensics panel** (alive in Bob IDE) — four explorers filling as you watch. *This* is the "screenshot that wins." Make sure names are visible: **Blame · LogWindow · Callers/Tests · RunbookDoc**, each with a colored status.
2. **Incident report** `incident/SEV1-2026-02-14.html` (static) — a one-page NTSB-style report: **probable cause**, **contributing factors**, **timeline**, **blast radius**, **the two-line fix**, **the test that would have caught it**, and a red **SAFE vs UNSAFE knob** callout (LOCAL_RETRY vs CircuitBreaker).

Paused-caption: "Probable cause: null `customer.id` introduced yesterday in `feat: async billing`. Fix: `src/webhooks/stripe.ts:41` + regression test. SAFE knob: `LOCAL_RETRY=0`. UNSAFE: CircuitBreaker (shared with auth)."

---

## 6. Two-minute demo shot list

| Time | Shot | VO |
|---|---|---|
| 0:00–0:08 | Red terminal, stack trace | "418 of these today." |
| 0:08–0:22 | northstar-checkout repo, "MTTR 47 min" card | "A senior hunts logs, git blame, runbook, and tests while Slack burns." |
| 0:22–0:55 | **Bob IDE, do not cut.** `@runbook.pdf`, 4 forensic subagents fill | "Bob reads the runbook and spawned four explorers in parallel." |
| 0:55–1:18 | RCA + the WRONG fix (trip breaker) → rollback → right fix | "It almost tripped the shared circuit breaker. Rollback caught it. The safe knob is `LOCAL_RETRY=0`." |
| 1:18–1:38 | Tests green + incident report file | "NPE fixed, test added, postmortem filed." |
| 1:38–1:52 | `.bob/modes/`, `bob_sessions/` PNGs | "One incident pack." |
| 1:52–2:00 | MTTR overlay: 47 min → 82 sec | "War room, closed." |

**bob_sessions names:** `team_warpath_task01_intake.png`, `task02_parallel_forensics.png`, `task03_rca_runbook.png`, `task04_patch_rollback.png`, `task05_postmortem.png`.

---

## 7. Build plan (~14h focused)

| Hr | Task |
|---|---|
| 1–2 | northstar-checkout: src + planted bug (NPE, async commit), runbook PDF+md, fixtures (logs/deploy/metrics), tests. |
| 3 | Author 4 SKILL.md + custom_modes.yaml + hook source. |
| 4 | MCP `warpath-signals` (Node STDIO, fixtures). |
| 5 | Incident report HTML generator + postmortem template. |
| 6–7 | Rehearsal #1: confirm the four forensics spawn; confirm runbook doc-understanding yields "409/backoff + do-not-trip-breaker". |
| 8–10 | Rehearsal #2 = demo path incl. wrong-fix→rollback beat; capture the parallel panel + report. |
| 11–12 | Rehearsal #3 timed; bake any flaky step (markdown runbook twin as fallback). Make bob_sessions PNGs. |
| 13–14 | Narration + record + submission README. |

**Coins (~14–20):** explore(cheap) + plan + implement + verify in separate chats. Author `.bob/` outside. Rehearse on scratch.

---

## 8. Measurable impact + business value

- MTTR: **47 min → 82 s** (hook-emitted). Time-to-RCA, time-to-green, artifact count.
- Wrong-fix prevention: the shared **CircuitBreaker false-fix is caught by the runbook rule** — a concrete "saved an outage" beat.
- Business value: on-call fatigue + change-caused incidents are IBM's enterprise story; the `bob_sessions` PNGs double as an incident-record system.
- Optional watsonx: Granite classifies severity (SEV1); Orchestrate pages a human. Not required to win.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Looks like OpsPilot / Incident Commander clone | Emphasize the **mode-walls + parallel panel + runbook doc-understanding during the incident**, not an agent swarm. |
| Demo feels random if cause hidden | Deterministic fixtures + a pre-written RCA. Never demo a real heisenbug. |
| "Wrong fix → rollback" beat can flake | Pre-script exactly what happens; rollback restore is instant. |
| Runbook PDF parsing fails | Ship `runbook-payments.md` twin; demo against whichever parses. |
| Bobcoin budget | scratch rehearsal; separate chats; author `.bob/` outside. |

---

## 10. Standalone README (verbatim-worthy)

> **WARPATH** — Paste a stack trace. Bob stands up a war room.
>
> WARPATH turns an incident into an orchestrated organization: custom modes are the org chart (an Incident Commander who can't touch `src/`, read-only Forensic Explorers, a Patch Surgeon who can only edit code+tests, a Comms Officer for the postmortem), parallel subagents investigate in lockstep, and the runbook PDF is read *during* the incident via document understanding. Rollback protects every patch.
>
> **Why Bob:** the mode sandbox + hook walls + parallel subtask fan-out ARE the war room. It cannot run on a prompt.
>
> **Reproduce:** `git clone … && cat incident/*.md` · see `docs/WARPATH-WALKTHROUGH.md`.
> **Evidence:** `bob_sessions/`.

---

## 11. Escalation / more available

I can generate on request:
- `custom_modes.yaml`, 4 `SKILL.md`, hooks, MCP source, runbook PDF+md, fixtures, planted-bug diffs, report HTML, exact prompt strings.
- A **rehearsal QA checklist** (verify per-phase).
- A **"safe vs unsafe knob"** mapping so the demo never slips into tripping the breaker.

---

## 12. Cross-idea portfolio note

| If you build… | Time | Fits the room |
|---|---|---|
| **REDLINE** | ~16h | Governance / commercial / "who's lying" |
| **SPLITBRAIN** | ~10h | Testing skepticism / can fold Witness into REDLINE |
| **WARPATH** | ~14h | Cinematic / on-call drama / the parallel panel |
| **ZOMBIE** (subagent running) | ~10h | Infra-secret lifecycle — least-saturated, extra-time |

**Recommendation:** Ship **REDLINE** as the primary (highest originality + business + presentation). If you want a logo-stage or the visceral demo, swap in **WARPATH**. Keep **SPLITBRAIN's** Witness logic folded in. Build **ZOMBIE** only if coins/time remain.

If you say the word, I'll generate the actual scaffold files for any one of these — starting with the one you choose to build.
# TRIUMPH — Combined Master Plan
**REDLINE ⟗ SPLITBRAIN ⟗ WARPATH — one pipeline, one repo, one gold session.**

*Ready-to-build blueprint for the IBM Bob 2.0 Hackathon.*

> **Status:** PRIMARY (unified) · Est. build: ~26h focused across the three gates (+3 gold-session rehearsals) · Est. Bobcoins: ~25–40  
> **Judging fit:** Application of Technology (🔴 — three Bob-native lanes in one) · Originality (🔴 — no one ships spec-evidence + test-honesty + incident response as one system) · Business Value (🔴 — a full delivery lifecycle) · Presentation (🔴 — three screenshot artifacts)

---

## 0. Why combine, and how (the thesis)

Each of the three plans is a *different courtroom* for the same lie — **"the code is fine"**:

- **REDLINE** — *Is the code legal?* The **spec is the law.** Witnesses who can't see `src/` extract every MUST and cross-examine the implementation. *Who is lying: the code, against the contract.*
- **SPLITBRAIN** — *Are the tests telling the truth?* The same **Witness isolation** mechanic, turned on the *test suite*: a Witness who can't see `src/` writes honest tests; a Mutineer proves "94% coverage" is a photocopy. *Who is lying: the tests.*
- **WARPATH** — *When it breaks in prod, do we resolve it?* Incident Commander + forensics + rollback + postmortem, runbook PDF consumed *during* the incident. *Who is lying: the runtime.*

**The unified product:** *Before you ship, run the Gauntlet — legal, honest, and then safe when it burns.* One sample payments app; one `.bob/` pack; the same custom-mode wall philosophy across three gates. It's a full **delivery lifecycle** in one skill set, which is the strongest "Application of Technology" story possible: Bob isn't one tool, it's the *whole pipeline*.

**Why bits are shared (not pasted):**
- **One `witness` mode**, used by both REDLINE (spec clauses) and SPLITBRAIN (policy tests) — same isolation wall (mode `fileRegex` + a `PreToolUse` hook that exit-2 blocks `src/`).
- **One `surgeon` mode** (code+tests only), used by both gates for fixes — same `fileRegex: ^(src/|tests/).*`.
- **One sample repo** (`northstar`, a payments app) carrying the planted clauses, the dishonest tests, AND the planted incident — so all three demos run on one believable codebase and one gold session.
- **One hook family** (`block-<role>-writes.sh`), one MCP server (`gauntlet-signals`) exposing fixtures for all three lanes.
- **The judge sees continuum:** legal (REDLINE wall) → honest (SPLITBRAIN gap) → resilient (WARPATH war room). Three artifacts, one narrative arc: *ship it lawfully, ship it honestly, survive it.*

---

## 1. Product concept & pitch

**Name:** TRIUMPH
**One-liner:** Before a PR ships, three air-gapped courts — the Spec Court, the Honesty Court, and the War Room — cross-examine it with subagents that can never read the source. Then Bob opens the PR.

**Tagline:** *Legal. Honest. Survivable. Ship it.*

> **Companion implementation reference:** `triumph-implementation-report.md` is the authoritative, docs-sourced guide for *how* to build (custom modes, hooks, isolation wall, skills, MCP, rollback, @-mentions). Also see `mcp-ide-docs-facts.md` for the detailed MCP schema. This plan states *what*; those documents state *how*.

**Judge-repeatable line (30s):**
> *"They put one payments repo through three Bob courts — spec clauses from a PDF the witnesses never opened the source for, and they ran it against a real public spec nobody on the team wrote. A '94% coverage' suite a mutation tool proved was a photocopy. Then a real incident where Bob's war room found the NPE, didn't trip the shared circuit breaker, patched it under rollback, and filed the postmortem. Legal → honest → survivable. One skill pack."*

**The core novelty (don't lose it):** EVERY gate uses the exact same **isolation-as-correctness** mechanic — a subagent that physically cannot read `src/`, *proven by running the same agent without the wall as a control group and watching it bless the bugs.* Round 1 teams ship *one* of these; we ship all three as one lifecycle with one witness wall, and we prove the wall works. It's the difference between "a tool" and "a methodology."

**Workflow bracket:** Testing + review + release + debugging (the entire SDLC delivery loop). Not a clone of any single appendix example — it *is* the pipeline those bullets describe.

---

## 2. Sample repository — `northstar`

A single believable payments API (Express + TypeScript + Jest + OpenAPI) that carries all three gates' evidence. **One repo, three self-contained demo paths.**

```
northstar/
├── src/
│   ├── pay/
│   │   ├── create-intent.ts      # W1: missing idempotency check (duplicate inserts)
│   │   └── confirm.ts            # ok
│   ├── webhooks/
│   │   └── stripe.ts             # W2: bad-sig returns 200;  W8/INCIDENT: NPE on missing customer.id
│   ├── refunds/
│   │   └── cancel.ts             # W3: allows refund > captured amount
│   ├── ledger/
│   │   ├── balance.ts            # W4: reads only `available`, never `pending`
│   │   └── journal.ts            # ok
│   ├── auth/
│   │   ├── token.ts              # W5: accepts JWT + API key interchangeably
│   │   └── key.ts
│   ├── discounts.ts              # SPLITBRAIN: stacks vs single-best (violates PRICING_POLICY)
│   ├── billing/
│   │   └── async.ts              # the "feat: async billing" commit that caused the NPE
│   ├── retry.ts                  # reads LOCAL_RETRY; no backoff; nested 3x3
│   ├── circuit.ts                # shared CircuitBreaker — do NOT touch (safe-vs-unsafe)
│   └── money.ts                  # integer-cents helper (W7 float coercion)
├── docs/
│   ├── api-spec.pdf + api-spec.md    # REDLINE: RFC-2119 MUSTs (fallback twin)
│   ├── runbook-payments.pdf + .md    # WARPATH: 409/backoff + do-not-trip-breaker
│   └── PRICING_POLICY.md             # SPLITBRAIN: single-best, tax cap 8%, min order 5.00
├── openapi.yaml
├── fixtures/
│   ├── logs.json                   # 60s log window around the 500
│   ├── deploy.json                 # "yesterday 14:07 async billing → prod"
│   ├── metrics.json                # p95 spike
│   └── mutants.json                # the 8 planted SPLITBRAIN mutants
├── tests/
│   ├── pay.intent.test.ts          # (dishonest / shaped)
│   ├── webhooks.stripe.test.ts     # (dishonest — blesses the bug)
│   ├── discounts.test.ts           # (SPLITBRAIN dishonest: toEqual(fn(x)) tautology)
│   ├── tax.test.ts
│   └── ...
├── package.json
└── .env.example
```

### Planted evidence — across all three lanes

> **Two-demo stance (decided):** we run **both** our own authored spec/lane **AND** a real public specification. Our authored lane stays deterministic (guaranteed to work on camera); a real public spec lane is the **credibility lane** (a spec nobody on this team wrote → no "you staged the bugs" objection). See §4A for the lane decisions gated by hour 8.

**REDLINE (8 authored clauses)** — W1 idempotency, W2 bad-sig→200, W3 over-refund, W4 available-vs-pending, W5 JWT/API-key interchange, W6 plain-text errors (RFC 7807), W7 float money (integer minor units), W8 no rate-limit/429.

**REDLINE (live lane)** — a **real public spec** (e.g., a published API/RFC/payments spec) run through the same pipeline to find real violations. This lane's numbers are **whatever the pipeline actually produces** — not pre-canned 8/8.

**SPLITBRAIN (2 authored lie types)** — (a) tautology `expect(fn(discount)).toEqual(fn(discount))`; (b) policy violation the suite blesses: `applyDiscount(100,'STACK')` returns 70 (stacking) while `PRICING_POLICY.md` says single-best → honest test expects 15. **Mutants are generated by Stryker** (the standard JS mutation-testing tool) into a scratch copy — the honesty score comes from **real tool output**, not a hand-planted list. (The two hand-planted *dishonest tests* remain, because they're the *subject being analyzed*, not the mutants.)

**WARPATH (1 authored incident, layered)** — webhook 500 on missing `customer.id` (NPE) introduced by yesterday's `feat: async billing`; `retry.ts` local-retry storm; `circuit.ts` shared breaker is the **false-fix trap** (SAFE knob `LOCAL_RETRY=0`, UNSAFE knob `CircuitBreaker`).

The authored lane is *more* planted than any single plan — but it's all *deterministic fixtures* and markdown/PDF twins, so nothing can flake on stage. The live lane deliberately gives up determinism in exchange for proof the result is real.

---

## 3. Full `.bob/` architecture (unified)

```
northstar/.bob/
├── custom_modes.yaml
├── skills/
│   ├── redline-extract/SKILL.md
│   ├── redline-test/SKILL.md
│   ├── redline-audit/SKILL.md
│   ├── splitbrain-witness/SKILL.md
│   ├── splitbrain-mutineer/SKILL.md
│   ├── splitbrain-isolate/SKILL.md
│   ├── warpath-intake/SKILL.md
│   ├── warpath-forensics/SKILL.md
│   ├── warpath-patch/SKILL.md
│   └── warpath-postmortem/SKILL.md
├── rules/
│   ├── redline-protocol.md
│   ├── splitbrain-protocol.md
│   └── incident-protocol.md
├── mcp.json                 # gauntlet-signals (local STDIO, fixtures only)
├── settings.json            # hooks
├── hooks/
│   ├── inject-evidence.sh
│   ├── block-witness-src.sh     # the shared isolation guarantee (both testify lanes)
│   ├── block-out-of-scope-writes.sh  # per-mode second wall (surgeon/docs/fixtures)
│   └── stop-write-metrics.sh    # WARPATH elapsed → MTTR
└── .bobignore                # defense-in-depth (global read/listing block); the REAL wall = mode fileRegex + hooks
```

### Shared custom modes (the org chart + the walls)

| Mode | Role | Constraints | Used by |
|---|---|---|---|
| **`witness`** | Isolated test/evidence author | `read`, `skill`, `write` of `tests/` or `evidence/` via `fileRegex` (**no `src/` regex scope**) + a **PreToolUse hook that exit-2's any read/write touching `src/`**. Cannot run the suite against `src`. | REDLINE + SPLITBRAIN |
| **`mutineer`** | The adversary | Reads `src/`, edits a **scratch copy**, runs jest on scratch, injects one mutant at a time. | SPLITBRAIN |
| **`isolate`** | Suite-honesty analyst | Reads `tests/` only (never `src/`); emits `TrustGap.json`. | SPLITBRAIN |
| **`surgeon`** | The only code-writer | `edit`/`execute`, `fileRegex: ^(src/|tests/).*`. Cannot touch `docs/`, `fixtures/`, `evidence/`. | REDLINE + SPLITBRAIN + WARPATH |
| **`compliance-officer`** | REDLINE orchestrator | read/skill/subagent/todo/mcp/mode. `edit` locked to `evidence/**` + `clause-wall/**`. Cannot touch `src/`. | REDLINE |
| **`incident-commander`** | WARPATH orchestrator | read/skill/subagent/todo/mcp/mode. `edit` locked to `incident/**/*.md`. Cannot touch `src/`. | WARPATH |
| **`forensic-explorer`** | Read-only forensics | read/skill/subagent(explore); no mutating execute. | WARPATH |
| **`comms-officer`** | Postmortem writer | Markdown only (`incident/.*`, `CHANGELOG.md`). | WARPATH |
| **`control-agent`** | The **unwalled** comparison (same task, but CAN read `src/`) | read/skill/write tests. **No hook, no regex restriction on `src/`** — deliberately the opposite of `witness`. Runs side-by-side for the honest-vs-claimed comparison. | Control group (§3) |

> One **`witness`** and one **`surgeon`** serve all three lanes — that's the *unification*. We're not re-architecting Bob three times; we're reusing the same two isolation walls across three courts. The **`control-agent`** mode exists *specifically to prove the walls matter* — it's the same agent with the wall removed, and it blesses the bugs.

### Parallel subagents (run in parallel — the screenshots)

**REDLINE / SPLITBRAIN testify lane:**
| Subagent | Host | Job | Reads |
|---|---|---|---|
| **ClauseMiner** | witness | Extract every MUST from `@/docs/api-spec.pdf` (leading-slash root-relative) | spec.pdf only |
| **BehaviorWriter** | witness | Characterization tests from the doc | spec.pdf only |
| **CrossExaminer** | witness | Compare clause behavior via tests (no src) | tests + spec, no src |
| **HonestAuthor** | witness | Fresh policy tests from `PRICING_POLICY.md` | policy only |
| **Mutineer** | mutineer | Drive **Stryker** on a scratch copy to generate mutants; report what the suite misses | src + scratch |
| **TautologyScanner** | isolate | List self-referential assertions | tests only |
| **BiasReport** | isolate | Rank shaped vs honest tests | tests + policy |

**WARPATH incident lane:**
| Subagent | Host | Job | Reads |
|---|---|---|---|
| **Blame** | forensic-explorer | `git blame` + recent commits on stack frames | git log + src |
| **LogWindow** | forensic-explorer | Correlate log window at the 500 → NPE | fixtures/logs.json |
| **Callers/Tests** | forensic-explorer | Callers of `stripe` handler + gaps | src + tests |
| **RunbookDoc** | forensic-explorer | Document-understanding of runbook.pdf → 409/backoff + do-not-trip rule | runbook.pdf only |

The demo shows the testify-lane panel *and* the incident-lane panel — two parallel-fan-out money shots.

### Skills (10 SKILL.md, concise — each a focused playbook)
Covered exhaustively in the three source plans. Key unification points:
- `redline-test` & `splitbrain-witness` both say **"Never open `src/`."** — the shared creed.
- `redline-surgeon` & `warpath-patch` & `splitbrain-surgeon` all share the **"never weaken the test; rollback if red"** rule.
- `warpath-patch` adds the **"safe vs unsafe knob" checklist** derived from the runbook (never trip the shared breaker).

**Authoring spec (from the docs):** each skill lives at `.bob/skills/<name>/SKILL.md` with **both `name` and `description` in YAML front matter** (no description = the skill is ignored). Skills are invoked via the **`use_skill` tool** (e.g. `use_skill(skill_name: "redline-extract")`) or auto-activated by matching the user request to the `description` — there is **no `@skill` or slash-command**. **A custom mode must explicitly include the `skill` tool group** in its `groups:` to be able to load skills at all.** The `witness`, `surgeon`, `compliance-officer`, `incident-commander`, `mutineer`, and `isolate` modes all need `skill` in their groups. Skills load once per conversation (refresh a chat to see edits).

### Control group — the unwalled agent (the honest baseline)

To **prove isolation actually does something**, the demo compares the walled Witness against an **unwalled control agent** (same model, same task, but allowed to read `src/`). Expectation we demo:

- **Unwalled agent** writes tests that bless the planted bugs → **high claimed coverage, low honesty**.
- **Walled Witness** (never sees `src/`) writes tests from the doc alone → catches the violations.

This is a *real, reproducible comparison* — and it's a **stronger and more honest story than a human-baseline claim** ("faster than a human" assumes a human baseline we can't measure). Two panels run side by side. **All "impact" numbers in §8 that referenced human baselines are now placeholders** pending the pipeline's actual output.

### MCP `gauntlet-signals` (local STDIO, fixtures only, no internet)
- REDLINE: `list_clauses()` → `evidence/clauses.json`, `get_test_status(clause_id)`, `submit_waiver(clause_id, reason)`
- SPLITBRAIN: `run_stryker()` (generates mutants on scratch), `run_suite()`, `get_trust_gap()` → `TrustGap.json`
- WARPATH: `get_stack_trace()`, `get_logs(window)`, `get_metrics()`, `get_recent_deploys()`

One server, three namespaces. Same "fixtures, never the internet" rule.

> **MCP confirmed workable (from the docs):** project-level `.bob/mcp.json` with a **STDIO** server (`command`, `args`, `cwd`, `env`, `alwaysAllow`, `disabled`) — Bob spawns it as a child process, JSON-RPC 2.0 newline-delimited over stdio, **no network needed**. Exposed to Bob via the built-in `use_mcp_tool`. `mcp` is a **tool group** in custom modes — any mode that calls the server must include `mcp` in its `groups:`. Auto-approve per-tool via `alwaysAllow`. Set `cwd` to the repo root so fixture paths resolve. Full facts + schema: `challenge/workspace/mcp-ide-docs-facts.md`.

### Hooks (the teeth — all three lanes get a hard guarantee)

> **Isolation-wall reality (from the docs):** `.bobignore` is **workspace-global, not per-mode**, and `insert_content`/`search_and_replace` can **bypass it on save**; `@`-mentions bypass it entirely; `execute_command` protection only covers a predefined read-command list. So the Witness wall is **NOT `.bobignore` alone** — it is **custom-mode `fileRegex` (edit scope) + a `PreToolUse` hook that `exit 2` on any `src/` access**. `.bobignore` on `src/` is kept as a *defense-in-depth* layer (read tool + listing), but it is not the guarantee. `@src/...` must additionally be discouraged in the skill instructions since @-mentions ignore `.bobignore`.

- `inject-evidence.sh` (SessionStart) — stamp branch/SHA/date into `evidence/manifest.json`.
- `block-witness-src.sh` (PreToolUse) — if mode is `witness` and the tool reads or writes under `src/`, `exit 2`. **The shared guarantee across both testify courts.** (Covers read, write, `execute`, and @-mention fetch paths that `.bobignore` alone cannot.)
- `block-out-of-scope-writes.sh` (PreToolUse) — second wall: surgeon can't write `docs/`/`fixtures/`; commander/officer can't write `src/`.
- `stop-write-metrics.sh` (Stop) — WARPATH writes `incident/metrics.json` (elapsed → MTTR).

### Rollback
Snapshot `src/` + `tests/` before any surgeon run. Demonstrated twice: (1) undoing a wrong REDLINE/SPLITBRAIN fix; (2) the WARPATH **false-fix trap** — surgeon initially trips the breaker, we roll it back, then apply the safe fix.

---

## 4. Bob session script — the single gold path

> Keep explore → plan → implement → verify in **separate chats** (Bobcoin discipline). Author `.bob/` + repo + PDFs + fixtures **outside Bob**.

**ACT I — Spec Court (REDLINE).**
- Phase 0 (lane decision): the authored `northstar` lane OR the **real public spec** lane (locked at the §4A hour-8 gate). Both parse through the same pipeline.
- Phase 1 (ingest): switch `compliance-officer`. `@/docs/api-spec.pdf — run skill redline-extract. Mind every MUST.` *(note: @-mention must be root-relative with a leading slash `@/docs/...`)*
- Phase 2 (extract + write): `In parallel: ClauseMiner, BehaviorWriter, CrossExaminer against @/docs/api-spec.md. Never open src/.` *(plus the `control-agent` run for the honest baseline)*
- Phase 4 (surgeon): `Switch to surgeon. For W1, W2, W3 make the minimal change so clause tests pass. Never weaken. Run suite.`
- Phase 5 (audit): `Switch back to compliance-officer. Run skill redline-audit -> evidence/VERDICT.md.`
- Phase 6: waive stragglers with citation → the "8 of 10 fixed, 2 waived" beat.

**ACT II — Honesty Court (SPLITBRAIN).**
- `@/PRICING_POLICY.md — switch to witness. Run skill splitbrain-witness. Do not open src/. Write policy-*.test.ts.`
- **Control group (the honest comparison):** run the same task in `control-agent` (CAN read `src/`) beside the `witness` — watch the unwalled agent bless the bugs while the walled one catches them. Two panels, side by side.
- `Switch to mutineer. Run skill splitbrain-mutineer — Stryker mutates a scratch copy. Show what the current suite misses.`
- `Switch to isolate. Run skill splitbrain-isolate -> TrustGap.json.` → the 94% → 11% reveal. *(Stryker-produced numbers.)*
- Human picks the truth (stacking is forbidden). `Switch to surgeon. Fix discounts.ts + make tests honest.`

**ACT III — War Room (WARPATH).**
- `Switch to incident-commander. @/docs/runbook-payments.pdf — stand up the war room for this Sev-1.`
- `In parallel: Blame, LogWindow, Callers/Tests, RunbookDoc. Show me the RCA.`
- (optional wrong-fix beat) ask surgeon to trip the breaker → hook/rollback → pivot.
- `Switch to patch-surgeon. Fix the NPE + add a test. Set LOCAL_RETRY=0. Do not touch CircuitBreaker.`
- `Switch to comms-officer. Write incident/SEV1-2026-02-14.md.`

**ACT IV — Ship.** Open the PR. Point at the three artifacts.

---

## 4A. Dual-spec decision gate (Claude review, point 6)

**Decision made:** we build **both** lanes — **our authored spec** (deterministic, guaranteed) **and a real public spec** (credibility lane). The *filmed* lane choice is gated and must be **decided by hour 8**, not left to hour 25.

> **Why this is the sharpest review point:** if we author both the spec *and* the bugs, then "REDLINE found 8/8" is trivially true because we hid 8 clues for it to find. A real public spec (a spec nobody in this room wrote) **kills the "you staged it" objection outright.** We adopt both: the authored lane is our safe-on-camera demo; the real-spec lane is our "this is real, run it against anything" proof.

**By hour 8, decide:**
1. **Which lane is filmed end-to-end** (authored `northstar` or a real public spec) — balances determinism vs credibility.
2. **If a real public spec is used, which one**, and it must:
   - Be a domain we can actually implement (payments/API preferred).
   - Have extractable MUST/SHALL clauses.
   - Be capturable as a PDF for the `@/…spec.pdf` doc-understanding shot (leading-slash root-relative).
3. **String it explicitly:** the live lane's findings are **whatever the pipeline produces** — no pre-canned 8/8. The demo narrative is built around the *real result*.

**Tradeoff to accept:** the real-spec lane gives up guaranteed perfection on camera. That is the *correct* trade — the whole product is about verifiability, and a real, non-staged result is on-brand. If a good real spec isn't found by hour 8, we commit to the authored lane and lean on the **unwalled-vs-walled control group (§3)** to restore credibility.

**Open decision (deferred, not dropped):** one-lane-democlosed vs 3-act demo (Claude point 5). Noting this review point for a later call — see §12 "Decisions & deferred review notes."

## 5. Judge screenshot artifacts — three, one narrative arc

1. **The Clause Wall** (`clause-wall/index.html`) — *Legal.* Every MUST red/yellow/green with `file:line` + the spec sentence. (REDLINE)
2. **The Trust Gap dashboard** (`trustgap/index.html`) — *Honest.* Claimed coverage 94% vs honest 11%, mutation table, tautology list, post-fix 81%. (SPLITBRAIN)
3. **The Incident Report** (`incident/SEV1-2026-02-14.html`) — *Survivable.* NTSB-style probable cause, SAFE vs UNSAFE knob callout, two-line fix + regression test. (WARPATH)

Plus two **live parallel-panel screenshots** from the IDE (testify lane + incident lane).

**The one paused-frame a judge would tweet:** a triptych — clause wall (legal) · trust-gap 94→11 (honest) · incident report (survivable) — captioned *"Legal. Honest. Survivable. One repo, three Bob courts."*

---

## 6. Two-minute demo shot list

| Time | Shot | VO |
|---|---|---|
| 0:00–0:08 | Triptych: wall · trust-gap · incident | "Legal. Honest. Survivable." |
| 0:08–0:22 | northstar repo + "2-day audit" + "94% coverage" + "MTTR 47min" cards | "The same agent wrote the code, the tests, and the spec-vs-code gap. Three courts for one lie." |
| 0:22–0:40 | **Bob IDE, do not cut.** `@/docs/api-spec.pdf`, parallel witness panel | "Bob reads the spec. The witnesses have never seen `src/`." |
| 0:40–0:58 | Clause wall fills; click W1 red → fix → green | "One red clause, one minimal fix, a test proves it." |
| 0:58–1:12 | **Swivel to Honesty court.** flip `>=`→`>`; suite stays green; policy test goes red; Trust Gap 94→11 | "CI says green. The honest test says wrong. Coverage was a photocopy." |
| 1:12–1:26 | Surgeon fixes; **swivel to War Room.** NPE RCA, near-miss breaker, rollback, safe flag | "Legal and honest — then the webhook 500s. Bob's war room found it, didn't touch the shared breaker, patched under rollback." |
| 1:26–1:40 | Three artifacts on screen; PR opens | "Legal → honest → survivable. One PR." |
| 1:40–1:52 | README, `.bob/skills/`, custom modes, `bob_sessions/` PNGs | "One skill pack. Clone it Monday." |
| 1:52–2:00 | Triptych again | "Legal. Honest. Survivable. Ship it." |

**bob_sessions PNG names:** `task01_spec_ingest.png`, `task02_witness_subagents.png`, `task03_clause_wall_surgeon.png`, `task04_trust_gap_mutineer.png`, `task05_war_room_forensics.png`, `task06_patch_rollback.png`, `task07_postmortem.png` (prefix with team name).

---

## 7. Hour-by-hour build plan (~26h focused; 48h comfortable)

| Phase | Hours | Tasks |
|---|---|---|
| **Prep** | 1–4 | Scaffold `northstar` (all src + tests + dishonesty + planted incident). `api-spec.md/pdf`, `runbook.pdf/md`, `PRICING_POLICY.md`. Fixtures (logs/deploy/metrics). |
| **Decision gate** | **by hour 8** | **Lock the filmed lane & the real public spec (see §4A).** Also lock: one person owns `custom_modes.yaml` + `mcp.json` (no parallel edits to those two files). |
| **Prep (live lane)** | 5–8 | Acquire + verify a real public spec (MUST clauses extractable, PDF-capturable). |
| **Redline** | 5–10 | 3 REDLINE skills + compliance-officer/witness/surgeon modes + **witness wall (`fileRegex` + PreToolUse hook)** + `.bobignore` (defense-in-depth) + **unwalled control-agent mode**. MCP redline namespace. Clause wall HTML + evidence gen. Rehearsal #1. |
| **Splitbrain** | 11–15 | 4 SPLITBRAIN skills + mutineer/isolate modes. **Stryker wiring** (mutants auto-generated on scratch). MCP splitbrain namespace. Trust Gap dashboard + `TrustGap.json`. Rehearsal #2. |
| **Warpath** | 16–20 | 4 WARPATH skills + incident-commander/forensic/comms modes + WRONG-fix trap + rollback. MCP warpath namespace. Incident report HTML. Rehearsal #3. |
| **Integrate** | 21–24 | One gold path across all three acts; unify the witness/surgeon reuse; smoke-test that a witness is blocked from src in BOTH courts; capture both parallel panels. |
| **Polish** | 25–28 | Rehearse narration, record, iterate the three artifacts' colors/labels, benchmark timer. |
| **Submit** | 29+ | README, public repo, video edit, `bob_sessions` PNGs, submission fields. |

**Bobcoin budget (~25–40):** author `.bob/` outside Bob (0 coins). Explore/plan (cheap) + implement + verify in *separate chats* per act. Rehearse on a **scratch** account; the **gold session runs in a dedicated, near-zero-spend account** — the account you film with has a pristine context, not a long history of trial-and-error. **One account is reserved for the gold session from the start.** If coins run tight, cut SPLITBRAIN to phase-2/probe-only (drop the surgeon fix) and keep REDLINE + WARPATH full — the triptych still prints.

---

## 8. Measurable impact + business value

> **All numbers below are PLACEHOLDERS until the pipeline produces them.** Anything shown on camera as a "measured result" comes from the actual run (hook-emitted metrics, Stryker output, real-spec findings), not a scripted figure. Human-baseline numbers (e.g., "2 days → 4 min", "47 min → 82 s") are labeled **illustrative context**, not measured claims.

- **Effective baseline (headline):** **walled Witness vs unwalled control agent** on the same task — the real, reproducible comparison the demo leads with. *[numbers from actual run]*
- **Time-to-audit (illustrative):** human 2-day audit → ~4 min clause wall. *[placeholder]*
- **Test truth:** claimed **94%** → honest **11%** → post-fix **81%** mutation kill; 2 blessed violations caught. *(Stryker-generated honesty score; placeholders until Stryker runs.)*
- **Incident MTTR (illustrative):** **47 min → 82 s** (hook-emitted). *[placeholder]* One false-fix (breaker trip) prevented by the runbook rule.
- **Find rate (authored lane):** planned 8/8 clauses found, 6–8 fixed; 2/2 test lies exposed; 1/1 incident resolved safely. *(Authored-lane demo targets — live-lane numbers are real output.)*
- **Business story:** a *delivery lifecycle* — legal verification the regulator trusts, test honesty that stops AI-shaped CI from shipping, and incident tooling that cuts on-call fatigue. It maps to the entire appendix theme: onboarding → review → test → release → maintain, as one coherent Bob methodology.
- **watsonx tie-ins:** Granite as the neutral model for the Honesty court; Orchestrate routes a red clause (REDLINE) or a low-Trust-Gap module (SPLITBRAIN) or a Sev-1 (WARPATH) to human/CAB action.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Too much to demo in 2 min / scope creep** | The three acts are each ~15 s; the shot list is fixed. If time dies, **cut a lane** (SPLITBRAIN first) — the triptych still says "lifecycle." |
| **Cost/Bobcoin exhaustion running 3 lanes** | Author `.bob/` outside; separate chats per act; rehearse scratch; boil acts to one gold pass. |
| **"Three tools stapled together" reads incoherent** | The unified pitch is *one lifecycle* with one shared Witness isolation wall — the narrative arc (legal→honest→survivable) is the product. Emphasize shared `witness`/`surgeon` reuse. |
| **Redline + Warpath both use `northstar`** | Single `northstar` repo, deliberately — same codebase across acts reinforces the story. |
| **PDF→clause mapping flakes** | `api-spec.md` + `runbook-payments.md` twins; demo against whichever parses; artifacts are the star. |
| **A Witness accidentally "knows" the code** | Wall = mode `fileRegex` + `block-witness-src.sh` PreToolUse exit-2 (covers read/write/execute/@-fetch). `.bobignore` is only defense-in-depth (global, @ can bypass). Rehearse that a peek is blocked in BOTH courts. |
| **Mutation / audit math feels improvised** | Let **Stryker** generate the mutants and numbers; `TrustGap.json` comes from the tool, not a hand-planned score. |
| **"8/8 found reads as staged" (authored lane)** | Run the **real public spec** lane too; if we author both spec+bugs, the *unwalled-vs-walled control group* restores credibility. |
| **A real spec flakes or is unpredictable on camera** | Decide the filmed lane by hour 8; if a good real spec isn't found, commit to the authored lane + control-group comparison for credibility. |
| **Reported numbers are invented** | All on-camera results are **placeholders until the pipeline produces them**; human baselines are labeled illustrative only. |
| **Wrong-fix (breaker) demo flaky** | Pre-script; rollback restore is instant; runbook doc-understanding must yield the do-not-trip rule (keep md twin). |
| **Looks like a wrapper / "we used Bob"** | Never say "we used Bob to build." The mode walls + hook blocks + parallel panels ARE the product. Harness test passes: swap Bob for Cursor, all walls vanish. |

---

## 10. Standalone submission README (verbatim-worthy)

> **TRIUMPH** — Legal. Honest. Survivable. Ship it.
>
> TRIUMPH runs one payments repo through three air-gapped courts on the same IBM Bob isolation mechanic:
> **REDLINE** (the spec is the law) — witnesses that have never seen `src/` extract every MUST from an RFC-2119 spec PDF into a live red/yellow/green **clause wall**; a source-only **surgeon** fixes violations; an auditor emits a citation-backed verdict.
> **SPLITBRAIN** (never let the same model grade its own homework) — an isolated Witness writes policy tests from the spec alone; a Mutineer injects defects to prove "94% coverage" is a photocopy; a Trust Gap dashboard shows claimed vs honest coverage.
> **WARPATH** (paste a stack trace, Bob stands up a war room) — custom modes are the org chart, parallel forensics investigate in lockstep, the runbook PDF is read *during* the incident, rollback protects every patch, and a postmortem is filed.
>
> **Why Bob:** the Witness isolation (custom-mode `fileRegex` + a `PreToolUse` hook that hard-blocks `src/`), the parallel subagent fan-out, the `@/spec.pdf` / `@/runbook.pdf` document-understanding, and the hook-blocked walls are the product — not a wrapper. The identical isolation wall is what unifies all three courts.
>
> **Reproduce:** `git clone … && open clause-wall/index.html && open trustgap/index.html && cat incident/*.md` · see `docs/TRIUMPH-WALKTHROUGH.md`.
> **Evidence:** `bob_sessions/` contains the required task-session summaries for every act.

---

## 11. Escalation / more available

If you confirm scope, I can generate the actual buildable files:
- `custom_modes.yaml` (9 modes incl. `control-agent`), all **10 `SKILL.md`**, hook scripts, MCP `gauntlet-signals` source, `.bobignore` (as defense-in-depth).
- Full `northstar` sample repo (src + tests + planted dishonesty + planted incident + PDFs + md twins + fixtures).
- The 8 REDLINE clause diffs, the 8 SPLITBRAIN mutants, the WARPATH safe/unsafe knob map.
- Static artifacts: `clause-wall/index.html`, `trustgap/index.html`, `incident report HTML`, `TrustGap.json`.
- PDF-generation script (markdown→PDF, deterministic).
- Exact copy-paste prompt strings for each phase + a **rehearsal QA checklist** + a **gold-session timer card**.

---

## 12. Bottom line

**Ship TRIUMPH as one lifecycle** — REDLINE ⟗ SPLITBRAIN ⟗ WARPATH — on a single repo with a single Witness-isolation wall reused across all three courts. The three screenshots (clause wall · trust gap · incident report) plus two live parallel panels give you the strongest Application-of-Technology and Originality story in the room: not three tools, but **one methodology that owns the whole delivery loop.** If coin/time pressure hits, drop SPLITBRAIN's fix phase and keep its probe — the triptych still prints and the story holds.

### Decisions & deferred review notes (from the Claude round-2 review)

**Incorporated (applied to this plan):**
- **(1) Numbers are placeholders** until the pipeline produces them; the effective baseline is a **walled Witness vs unwalled control agent** (a real, showable comparison), not an invented human baseline.
- **(2) Stryker generates the mutants** (real tool output), not a hand-planted list. Hand-planted *dishonest tests* stay as the subject under analysis.
- **(4) A dedicated, near-zero-spend account is reserved for the gold session** from the start.
- **(6) Dual-spec stance adopted:** we run **both** our authored demo lane **and a real public spec** (credibility lane). Filmed-lane + real-spec choice is a **decision gate at hour 8** (§4A).

**Deferred (noted, decide later):**
- **(5) Demo format:** one-lane-end-to-end + 20s montage vs the full three-act demo. Noted as the strongest strategic review point; currently we plan the three-act triptych, but this is the top candidate to change. **Decision due before recording.**
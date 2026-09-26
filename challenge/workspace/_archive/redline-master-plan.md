# REDLINE — Master Plan
**"The spec is the law. The repo is the defendant."**

*Ready-to-build blueprint for the IBM Bob 2.0 Hackathon.*

> **Status:** PRIMARY CONCEPT · Est. build: ~16h focused (+3 gold-session rehearsals) · Est. Bobcoins: ~15–25  
> **Judging fit:** Application of Technology (🔴 high) · Originality (🔴 high) · Business Value (🟡 high) · Presentation (🔴 high)

---

## 1. Product concept & pitch

**Name:** REDLINE
**One-liner:** Drop an 80-page spec/RFC/policy PDF on a repo; REDLINE turns every MUST clause into a red/yellow/green behavior wall with `file:line`, then cross-examines the implementation with subagents that have never seen the code.
**Tagline:** *The spec is the law. The repo is the defendant.*
**Judge-repeatable line (30s):** *"They dropped an 80-page spec on a payments repo and every MUST went red or green with a file and line. Then three subagents — who were forbidden from reading the source — fixed two reds while we watched. A two-day audit in four minutes."*

**The core novelty:** The exact thing that makes it win is that the **Witnesses cannot see `src/`**. Isolation isn't context-hygiene — it's a *correctness property*. If a Witness can read the code, the product is broken. This is the inverse of every "AI code review" and every "unit test generator," and it directly uses **document understanding** — the Bob 2.0 feature the brief names and almost nobody will actually demo with a real PDF.

**Workflow bracket:** Testing + review + release (permission to ship). Not a clone of appendix #1–4.

---

## 2. Sample repository

**Name:** `northstar-pay` — a small but real-feeling payments API (Express + TypeScript + Jest + OpenAPI).

### Repo layout (deliver as part of scaffold)

```
northstar-pay/
├── src/
│   ├── pay/
│   │   ├── create-intent.ts        # W1: missing idempotency check
│   │   └── confirm.ts              # ok
│   ├── webhooks/
│   │   └── stripe.ts               # W2: rejects signature but swallows error → 200 on bad sig
│   ├── refunds/
│   │   └── cancel.ts               # W3: allows refund > original amount
│   ├── ledger/
│   │   ├── balance.ts              # W4: reads only `available`, never `pending`
│   │   └── journal.ts              # ok
│   ├── auth/
│   │   └── token.ts                # W5: accepts both JWT and raw API keys interchangeably
│   └── money.ts                    # integer-cents helper
├── docs/
│   ├── api-spec.pdf                # THE spec (also api-spec.md fallback)
│   ├── api-spec.md                 # markdown twin — usable if PDF mapping flakes
│   └── runbook.pdf
├── openapi.yaml
├── .env.example
├── package.json
└── tests/
    ├── pay.intent.test.ts
    ├── webhooks.stripe.test.ts
    └── ...
```

### Planted violations (8–12 total; pick strongest 8)

| # | Clause in spec (MUST) | Code reality | Category |
|---|---|---|---|
| W1 | "Idempotency MUST be enforced on create-intent" | create-intent inserts duplicates | Duplicate-submit bug |
| W2 | "Webhook signature MUST be validated; invalid MUST 401" | bad-sig returns 200 | Auth/security |
| W3 | "Refunds MUST NOT exceed the captured amount" | over-refund allowed | Money-safe |
| W4 | "Balance MUST reflect available + pending funds" | ledger uses only `available` | Money-safe |
| W5 | "Auth MUST differentiate JWT from API-key scopes" | both accepted interchangeably | Auth/security |
| W6 | "Errors MUST use RFC 7807 problem+json" | errors are plain text | Contract |
| W7 | "Amounts MUST be integer minor units" | a helper coerces floats | Money-safe/type |
| W8 | "Rate-limit MUST return 429 with Retry-After" | no rate-limit at all | Reliability |

Each is *deterministic*: the spec says one thing, code says another, and a test written from the spec alone fails on the planted bug.

### Why this repo wins
It's believable ("payments = high stakes"), the spec is short enough to @ as a PDF (2–4 pages), and every violation is a *behavioral* clause a Witness can test from the document alone — no code access needed.

---

## 3. Full `.bob/` architecture

```
northstar-pay/.bob/
├── custom_modes.yaml
├── skills/
│   ├── redline-extract/SKILL.md
│   ├── redline-test/SKILL.md
│   ├── redline-surgeon/SKILL.md
│   └── redline-audit/SKILL.md
├── rules/
│   └── redline-protocol.md
├── mcp.json                  # redline-signals (local STDIO, fixtures)
├── settings.json             # hooks
├── hooks/
│   ├── inject-evidence.sh
│   └── block-src-writes-by-witness.sh
└── .bobignore               # applied per-mode
```

### Custom modes (the org chart / the walls)

**Mode `compliance-officer`** (orchestrator) — the only mode you drive in the demo.
- Tools: `read`, `skill`, `subagent`, `todo`, `mcp`, `mode`.
- `edit`/`execute` **locked to `evidence/**` and `clause-wall/**`** via `fileRegex`. **Cannot touch `src/` or `tests/`.** It *directs*, never writes code.

**Mode `witness`** — the isolation wall. Receives the spec + policy ONLY.
- `read` + `skill(redline-extract|redline-test)`.
- `.bobignore` **excludes `src/` and all `src/**`** for this mode, so it literally cannot peek. If a witness "knows" the code, it's a bug.
- Emits clause→test mapping to `evidence/clauses.json` + draft tests.

**Mode `surgeon`** — the only code-writer.
- `edit`/`execute` with `fileRegex`: `^(src/|tests/).*`. **Cannot touch `evidence/` or `docs/`.** Even a fix must live in code/test land.

**Mode `auditor`** (read-only, used at the end) — re-runs the full suite against the spec one final time and stamps `evidence/VERDICT.md`.

### Subagents (run in parallel — the screen shot)

| Subagent | Mode host | Job | Only reads |
|---|---|---|---|
| **ClauseMiner** | witness | Extract every *MUST / SHALL / REQUIRED* from `@api-spec.pdf` into a structured list | spec.pdf only |
| **BehaviorWriter** | witness | Turn each clause into a characterization test (from the document, NOT the code) | spec.pdf only |
| **CrossExaminer** | witness | Compare each clause's required behavior vs actual behavior — but reports via the *tests* only | tests + spec (no src) |
| **PerjurerHunt** | compliance-officer | After surgeon fixes, re-run tests to confirm no code was faked | tests + src (allowed) |

Parallelism = the four run simultaneously; the panel populates live.

### Skills (SKILL.md structure)

- **redline-extract/SKILL.md** — "How to parse an RFC-2119 spec PDF into machine clauses (MUST/SHALL/MAY). Output `evidence/clauses.json`: {id, clause, category, requirement}" + a numbered extraction checklist.
- **redline-test/SKILL.md** — "For each MUST, write a Jest characterization test that asserts the *documented* behavior. Filename `clause-<id>.test.ts`. Do NOT open `src/`. If code is required, write the test expecting the spec behavior regardless of current code."
- **redline-surgeon/SKILL.md** — "Given clause-id + failing test, make the minimal `src/` change so the test passes. Never weaken the test. Confirm the whole suite still runs."
- **redline-audit/SKILL.md** — "Produce `evidence/VERDICT.md`: table of clause-id → PASS/FAIL/WAIVED → file:line → test name. Recommend waiver only with a cited reason."

### MCP `redline-signals` (local STDIO, fixtures only, no internet)

- `list_clauses()` → reads `evidence/clauses.json`
- `get_test_status(clause_id)` → reads a static status fixture (so demo is deterministic)
- `submit_waiver(clause_id, reason)` → writes to `evidence/waivers.json` (for the "2 remaining, both waived" moment)

### Hooks (the guarantee)

- **`inject-evidence.sh`** on `SessionStart` — stamps branch/SHA/date into `evidence/manifest.json`.
- **`block-src-writes-by-witness.sh`** on `PreToolUse` — if the active mode is `witness` and the tool touches `src/`, `exit 2` (hard block). *This is the product's teeth.*

### Rollback

Before the surgeon runs, `compliance-officer` snapshots `src/` + `tests/`. Surgeon changes are rolled back cleanly if a fix is wrong — demoable as "we undid the bad fix."

---

## 4. Bob session script (the exact prompts, phase by phase)

> Run explore → plan → implement → verify in **separate chats** to keep the context window cheap (Bobcoin discipline).

**Phase 0 — Prep (author `.bob/` and repo OUTSIDE Bob).** Generation of skills/modes/hooks and the sample repo happen in your own editor; Bob only does the demoable work.

**Phase 1 — Ingest.** Switch to `compliance-officer`.
> `@docs/api-spec.pdf — run skill redline-extract. Mind every MUST.`

**Phase 2 — Extract + write.** Spawn the parallel subagents.
> `In parallel: ClauseMiner, BehaviorWriter, and CrossExaminer against docs/api-spec.md. Do not open src/. Write clause tests into tests/clause-*.test.ts.`

**Phase 3 — Cross-examine.** Watch the panel; the 4 subagents populate.

**Phase 4 — Surgeon.**
> `Switch to surgeon. For clauses W1, W2, W3: make the minimal change so clause tests pass. Never weaken a test. Run the suite.`

**Phase 5 — Audit.**
> `Switch back to compliance-officer. Run skill redline-audit -> evidence/VERDICT.md.`

**Phase 6 — Waive the stragglers (the "8 of 10 fixed, 2 waived with evidence" beat).**

That's the whole gold path.

---

## 5. Judge screenshot artifact — the Clause Wall

`clause-wall/index.html` — a static, self-contained page (no server, opens by double-click; judges can pause it).

**Layout:**
- Title bar: *REDLINE — northstar-pay · 22 clauses, 3 PASS, 2 FAIL, 1 WAIVED, 2 IN-PROGRESS*.
- A grid/list of every clause. Each row:
  - **Clause id** (W1…) + **the spec sentence** (the MUST verbatim).
  - **Status chip** — 🔴 FAIL (red `#d92d20`), 🟡 WAIVED (amber `#f79009`), 🟢 PASS (green `#12b76a`).
  - **file:line** of the violating/owning code.
  - **Test name** that proves it.
- A footer band: *evidence/VERDICT.md · 2-day audit → 4 min*.

**The one paused-frame caption a judge would tweet:** a FAIL chip with `src/pay/create-intent.ts:41` next to the spec sentence *"Idempotency MUST be enforced."*

Colors must be readable paused; no 5% gray-on-white text.

---

## 6. Two-minute demo shot list

| Time | Shot | VO (≤ one line) |
|---|---|---|
| 0:00–0:08 | Clause wall, full screen | "The spec is the law." |
| 0:08–0:22 | northstar-pay repo + a human "2-day audit" card | "Two days, a spec nobody re-reads, and AI wrote the code and the tests together." |
| 0:22–0:55 | **Bob IDE, do not cut.** `@docs/api-spec.pdf`, skill redline-extract, **parallel subagent panel fills with 4 witnesses** | "Bob reads the spec. The witnesses have never seen `src/`." |
| 0:55–1:18 | Click W1 (red) → file:line + failing clause test. Surgeon mode. Test goes green. | "One red clause, one minimal fix, test proves it." |
| 1:18–1:38 | Clause wall now 22 clauses; split-screen before | "2 days → 4 minutes. 8 of 10 passed, 2 waived with cited evidence." |
| 1:38–1:52 | README, `.bob/skills/`, custom mode dropdown, `bob_sessions/` PNGs | "The whole thing is a skill pack + a repo. Clone it Monday." |
| 1:52–2:00 | End on the clause wall | "The spec is the law." |

**bob_sessions PNG naming** (for `bob_sessions/`):
`team_redline_task01_spec_ingest.png`, `task02_witness_subagents.png`, `task03_surgeon_fix_W1.png`, `task04_verdict_wall.png` (team name TBD).

---

## 7. Hour-by-hour build plan (48h for REDLINE as primary; ~16h focused)

| Hour | Task |
|---|---|
| 1–2 | Scaffold `northstar-pay` (7 source files + tests) with 8 planted violations. Build `api-spec.md` (RFC-2119 MUSTs) + generate `api-spec.pdf` (markdown→PDF) + `api-spec.md` twin. |
| 3–4 | Author `.bob/skills/` (4 SKILL.md) + `.bob/custom_modes.yaml` + `.bob/modes/*`. Write the hook scripts. |
| 5 | Author MCP `redline-signals` (Node STDIO, fixtures). |
| 6 | Build `clause-wall/index.html` (static) + `evidence/` generation script. |
| 7–8 | **Bob rehearsal #1**: run the gold script outside-the-demo. Fix skill prompts; confirm Witness never reads `src/`; confirm surgeon cannot touch `docs/`. Log what Bob got wrong. |
| 9–12 | **Bob rehearsal #2** to a clean state. Capture the parallel-subagent panel + @PDF screenshot. |
| 13–16 | **Rehearsal #3** = the demo path end-to-end, timed. Bake any flaky step (keep the markdown twin as PDF fallback). Screenshot bob_sessions PNGs per task. |
| 17–20 | Record/rehearse narration; iterate the clause wall colors/labels. |
| 21+ | Buffer: polish README, submission files, GitHub public repo, video edit. |

**Bobcoin budget (~15–25):** #1/#2 explore (cheap), plan, implement; #3 verify. Separate chats = smaller context = fewer coins. Rehearse with a *scratch* copy first, only the gold path in the account you submit.

---

## 8. Measurable impact + business value

- Time-to-audit: **2 person-days → ~4 minutes** (from spec to verdict wall).
- Clauses cross-examined from the *document* only — removing the bias that the code-writer also wrote the tests.
- Find rate on planted bugs: **8/8** found; **6–8/8** auto-fixed by surgeon; stragglers waived with citation.
- Business story for IBM: spec-driven verification is the mechanism regulators and internal audit actually trust; it pairs with watsonx Orchestrate (red clause → CAB ticket) and Granite (residual-risk paragraph). The `bob_sessions` PNGs *are* the audit evidence.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| PDF→clause mapping flakes | Ship `api-spec.md` twin; demo against whichever parses; the clause wall is the star, not the PDF parser. |
| Witness "knows" the code | Lock it with mode `.bobignore` on `src/`; rehearse that a peek is blocked. |
| Bob refuses to run N subagents | Fall back to 2 subagents (Miner + CrossExaminer) — parallel panel still fills. |
| Surgeon weakens a test | Skill says "never weaken the test"; CrossExaminer re-runs full suite after. |
| Bobcoin exhaustion | Author `.bob/` outside Bob; rehearse on scratch; separate chats per phase. |
| Looks like a test generator | The isolation + document-understanding + verdict wall are the differentiators; the pitch never says "we generated tests." |

---

## 10. Standalone submission README (verbatim-worthy)

> **REDLINE** — The spec is the law. The repo is the defendant.
>
> REDLINE turns any RFC-2119 spec/RFC/policy PDF into a live red/yellow/green **clause wall** over a codebase. Witness subagents that have **never seen the source** extract every MUST and write characterization tests from the document alone; a surgeon (code-only permissions) fixes the violations; an auditor emits a citation-backed verdict. Built so the entire capability ships as a reusable Bob skill pack + a sample payments repo.
>
> **Why Bob:** the isolation of the Witnesses (forbidden from `src/`), the parallel subagent fan-out, and the `@spec.pdf` document-understanding are the product — not a wrapper.
>
> **Reproduce:** `git clone … && open clause-wall/index.html` · or follow `docs/REDLINE-WALKTHROUGH.md`.
> **Evidence:** `bob_sessions/` contains the required task-session summaries.

---

## 11. How to escalate / ask for more

If you need it, I can additionally produce, on request:
- **The actual generated files** (`custom_modes.yaml`, `SKILL.md`×4, hook script source, MCP tool source, `api-spec.md`, the 8 planted-`ts` diffs, `clause-wall/index.html`).
- **The exact prompt strings** copy/paste-safe for the Bob chat (each phase).
- **A PDF-generation script** (pandoc/md→pdf) so the spec is reproducible and deterministic.
- **A rehearsal QA checklist** (what to verify in each of the 3 rehearsals).
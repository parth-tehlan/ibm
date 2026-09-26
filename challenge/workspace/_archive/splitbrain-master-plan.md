# SPLITBRAIN — Master Plan
**"Never let the same model grade its own homework."**

*Ready-to-build blueprint for the IBM Bob 2.0 Hackathon.*

> **Status:** SECONDARY CONCEPT (INDEPENDENT; or fold its Witness into REDLINE) · Est. build: ~10h focused · Est. Bobcoins: ~10–16  
> **Judging fit:** Application of Technology (🔴) · Originality (🔴) · Business Value (🟡) · Presentation (🟡)

**Relationship to REDLINE:** SPLITBRAIN or REDLINE can be submitted standalone, or you can ship REDLINE and *add* SPLITBRAIN's mutation as an extra "honesty meter" clause. The two share the identical **Witness isolation** mechanic — but REDLINE proves *spec compliance*, SPLITBRAIN proves *that the tests actually test anything*. They're complementary, not redundant.

---

## 1. Product concept & pitch

**Name:** SPLITBRAIN
**One-liner:** A Witness subagent that has never seen the implementation writes the tests; a Mutineer injects defects; if the "94% coverage" suite stays green, the tests are a photocopy — and SPLITBRAIN says so.
**Tagline:** *Never let the same model grade its own homework.*
**Judge-repeatable line (30s):** *"We broke the code and CI stayed green — because the tests were written by the same agent that writes the code. SPLITBRAIN walls off the Witness from the source, so its tests are honest. We flipped a comparator, mutation 'coverage' dropped from 94% to 11%, then a Surgeon fixed the real gaps."*

**The core novelty:** The industry's test generators *are* the failure mode (Autonoma 2026 *coverage-shaped tests*). Conventional mutation testing MTurk's your whole suite and spews a score. SPLITBRAIN uses Bob's **isolation** as a correctness boundary: the test-author literally cannot read `src/`. It's the only idea on this roster where "the mode can't cheat" is the *entire* product.

**Workflow bracket:** Testing.

---

## 2. Sample repository

**Name:** `pricing` — a small, believable discount engine (Node/TS + Jest).

```
pricing/
├── src/
│   ├── discounts.ts     # applyDiscount(order, code): stacks vs single-best
│   ├── tax.ts           # computes tax; budget thresholds
│   └── money.ts         # rounds to cents
├── PRICING_POLICY.md    # "single best discount, never stack"; "tax cap 8%";
│                        # "min order 5.00 for promo"
├── openapi.yaml (tiny)
├── .env.example
├── package.json
└── tests/
    ├── discounts.test.ts      # written by the "senior" AI — passes but is shaped
    └── tax.test.ts
```

### Built-in "shaped" tests (the dishonest ones)

- In `discounts.test.ts`, a test asserts `fn(discount).toEqual(fn(discount))` — a tautology that never changes.
- Another asserts the *current* return value, not the *policy* value: e.g., `expect(applyDiscount(100,'STACK')).toBe(70)` even though the policy says stacking is forbidden → the code stacks and the test *blesses the bug*.
- `tax.test.ts` asserts nothing about the 8% cap; it just echoes the function.

### Why this repo wins
Two planted lie-types, both *specific* and instantly demoable: (a) a comparator/keyword flip the suite won't catch, (b) a policy violation the suite blesses. The `PRICING_POLICY.md` is the "spec" the honest Witness reads — without seeing the code.

---

## 3. Full `.bob/` architecture

```
pricing/.bob/
├── custom_modes.yaml
├── skills/
│   ├── splitbrain-witness/SKILL.md
│   ├── splitbrain-mutineer/SKILL.md
│   ├── splitbrain-isolate/SKILL.md   # outputs TrustGap.json
│   └── splitbrain-surgeon/SKILL.md
├── rules/
│   └── splitbrain-protocol.md
├── mcp.json
└── hooks/
    └── block-witness-src.sh
```

### Custom modes

**Mode `witness`** — writes tests from `PRICING_POLICY.md` ONLY.
- `read`, `skill(splitbrain-witness)`, `write` of `tests/clause-*.test.ts`.
- `.bobignore` **excludes `src/`** for this mode — hard wall. If a witness has seen the code, the product is broken.
- Tool restriction: cannot run the suite against `src` until handed off.

**Mode `mutineer`** — the adversary.
- Reads `src/`, injects a *single* defect (mutant) at a time into a scratch copy.
- Tools: `edit` on scratch, `execute` (jest on scratch), `read src/`.
- Purpose: prove the suite can't tell good from broken.

**Mode `isolate`** — analyses the suite.
- Reads `tests/` only (never `src/`); computes a **Tautology metric** (grep for `toEqual(fn(x))`-style self-assignments, assertions mirroring the current return value).
- Emits `TrustGap.json`: `{ coverage, honestCoverage, mutationScore, tautologicalTests: [...] , blessedViolations: [...] }`.
- **The Trust Gap** = coverage percentage that is *not* just reconfirming current behavior.

**Mode `surgeon`** — rewrites tests to be honest (code + tests allowed) after a human picks the truth.
- `edit`/`execute` on `src/` + `tests/`.

### Parallel subagents (the screen shot)

| Subagent | Host mode | Job | Reads |
|---|---|---|---|
| **HonestAuthor** | witness | Writes fresh tests from `PRICING_POLICY.md`, zero `src/` context | policy only |
| **Mutineer** | mutineer | Injects 8–11 specific mutants; reports which the suite fails to catch | src + scratch |
| **TautologyScanner** | isolate | Lists tests that assert current behavior rather than spec behavior | tests only |
| **BiasReport** | isolate | Ranks which tests are "shaped" vs "honest" | tests + policy |

### Skills

- **splitbrain-witness/SKILL.md** — "Read `PRICING_POLICY.md`. Write Jest tests asserting the *policy* (e.g., single-best-never-stack → `expect(applyDiscount(100,'STACK')).toBe(15)` and saving the policy's own values). Never open `src/`. Name them `policy-*.test.ts`."
- **splitbrain-mutineer/SKILL.md** — "From `src/`, create a scratch copy. Inject ONE plausible mutant (flip `>`, change a constant, drop a guard). Run the suite. Record pass/fail. Repeat for each defined mutant. Output `mutation-report.json`."
- **splitbrain-isolate/SKILL.md** — "Score the suite's honesty: tally tautological assertions, count tests asserting current (possibly wrong) behavior, produce `TrustGap.json` and a `Mutation score` = mutants killed / mutants injected."
- **splitbrain-surgeon/SKILL.md** — "After human confirms which behavior is true, make tests honest and (optionally) fix the code only if the policy mandates it. Keep the suite green on the true behavior."

### MCP `splitbrain-signals`
- `inject_mutant(def)` → writes a scratch mutant, returns status.
- `run_suite()` → runs jest, returns static fixture result (deterministic demo).
- `get_trust_gap()` → reads `TrustGap.json`.

### Hooks
- `block-witness-src.sh` on `PreToolUse` — if mode is `witness` and target path is under `src/`, `exit 2`. The guarantee.
- Rollback: snapshot `tests/` before surgeon rewrites; undo a bad test rewrite visibly.

---

## 4. Bob session script (phases)

**Phase 0 — Prep.** Author `.bob/` + repo outside Bob.

**Phase 1 — Ingest.**
> `@PRICING_POLICY.md — switch to witness. Run skill splitbrain-witness. Do not open src/. Write policy-*.test.ts into tests/.`

**Phase 2 — Probe the lie.**
> `Switch to mutineer. Run skill splitbrain-mutineer against src/. Show me what the current suite catches.`

**Phase 3 — Score.**
> `Switch to isolate. Run skill splitbrain-isolate -> TrustGap.json.`

**Phase 4 — The reveal.** The deposit of "mutation 'coverage' 94% → 11%; W3 tautology listed."

**Phase 5 — Fix (surgeon).** Human agrees: stacking is forbidden. Surgeon fixes code + makes tests honest. Suite green with honest tests.

**Phase 6 — Re-score.** `TrustGap.json` now shows honest coverage and a real mutation kill rate.

---

## 5. Judge screenshot artifact — Trust Gap dashboard

`trustgap/index.html` — static.

**Layout:**
- Headline: **SPLITBRAIN — pricing · Suite honesty audit**.
- Two big numbers side by side: **Claimed coverage 94%** (gray) vs **Honest coverage 11%** (red) with a `Trust Gap = 83%`.
- A **Mutation table**: each mutant (e.g., *flip `>=` to `>` in discounts.ts:14*) with the suite's verdict — red "KILLED 0/8", listed as "suite stayed green".
- A **Tautology list**: the `expect(fn(x)).toEqual(fn(x))` line highlighted.
- After-fix footer: *11% → 81% mutation kill; W3 now asserts the single-best policy.*

**Paused-caption a judge would tweet:** the two 94%/11% numbers with a red trust-gap wedge. Colors: gray `#434343`, red `#d92d20`, green `#12b76a`.

---

## 6. Two-minute demo shot list

| Time | Shot | VO |
|---|---|---|
| 0:00–0:08 | Trust Gap dashboard | "The gold standard — 94% coverage." |
| 0:08–0:22 | Show the shaped test (tautology) + a bug the suite blesses | "Same agent wrote the code and the tests. Coverage is a photocopy." |
| 0:22–0:55 | **Bob IDE, do not cut.** `@PRICING_POLICY.md`. Witness writes honest tests *without seeing src*. Mutineer panel injects mutants. | "SPLITBRAIN walls off the test-writer from the implementation, then plays devil's advocate." |
| 0:55–1:18 | Flip `>=`→`>`. Suite stays green. Then honest policy test goes RED. | "CI said green. The honest test says the code is wrong." |
| 1:18–1:38 | Trust Gap re-scores: 11% → 81% mutation kill. | "We didn't add tests — we deleted the bias." |
| 1:38–1:52 | `.bob/modes/witness`, `.bobignore src/`, `bob_sessions/` PNGs | "One skill pack. Clone it." |
| 1:52–2:00 | Dashboard again | "Never let the same model grade its own homework." |

**bob_sessions names:** `team_splitbrain_task01_witness_isolated.png`, `task02_mutineer_probe.png`, `task03_trustgap_dashboard.png`, `task04_surgeon_honest_tests.png`.

---

## 7. Build plan (~10–12h focused)

| Hr | Task |
|---|---|
| 1–2 | `pricing` repo: discounts.ts/tax.ts/money.ts + the dishonest tests + `PRICING_POLICY.md`. Plant the tautology + blessed-violation. |
| 3 | Author 4 SKILL.md + custom_modes.yaml + witness `.bobignore` + hook. |
| 4 | MCP `splitbrain-signals` (Node STDIO, fixtures). |
| 5 | `trustgap/index.html` static dashboard + TrustGap.json generator. |
| 6–7 | Bob rehearsal #1: confirm Witness truly can't read `src/`; confirm Mutineer mutants are the planted set. |
| 8–9 | Rehearsal #2 = demo path, capture parallel panel + dashboard screenshot. |
| 10 | Narration rehearsal + record; make bob_sessions PNGs. |
| + | Buffer/polish + submit README. |

**Coins (~10–16):** explore(cheap) + plan + implement + verify in separate chats. Author `.bob/` outside Bob. Rehearse on scratch.

---

## 8. Measurable impact + business value

- Trust Gap quantified: **claimed 94% → honest 11%** → post-fix **81% mutation kill**.
- Count of blessed violations caught: **2 (stacking + tax cap)**.
- Time to a true test-quality signal: **~1 hour of dev hand-off → ~3 minutes**.
- Business value: fake "green" CI is the #1 reason broken AI code ships. SPLITBRAIN is the cheapest honesty meter a team can run *before* trusting its own coverage number. IBM angle: pairs with watsonx.ai Granite for a neutral model, and with watsonx Orchestrate to route low-Trust-Gap modules to mandatory review.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| "Looks like a mutation tester" (well-trodden) | Mutation libs score the WHOLE suite; SPLITBRAIN's claim is the **isolation** + **Trust Gap** + tautology report. Pitch = bias removal, not "a coverage tool." |
| Honest Witness needs the policy to be robust | Make `PRICING_POLICY.md` explicit (single-best, cap%, min-order) so its tests are unambiguous. |
| Mutation demo feels random | Pre-select 8 mutants listed in a fixture; the Mutineer only "replays" them. Deterministic. |
| Trust Gap math is improv | Precompute final numbers; dashboard reads a static JSON. |
| Bobcoin budget | author `.bob/` outside; scratch rehearse; separate chats. |

---

## 10. Standalone README (verbatim-worthy)

> **SPLITBRAIN** — Never let the same model grade its own homework.
>
> SPLITBRAIN detects *coverage-shaped* tests: suites whose assertions just echo whatever the code currently returns, so they stay green even when the code is wrong. A Witness mode that is **physically forbidden from reading the implementation** writes fresh tests from the policy alone; a Mutineer injects planted defects; an analyzer reports a **Trust Gap** (claimed coverage vs honest coverage) and a mutation kill-rate.
>
> **Why Bob:** the isolation of the Witness (`.bobignore src/`) is the enforcement mechanism — not a convention. You literally cannot run it without Bob's mode sandbox.
>
> **Reproduce:** `git clone … && open trustgap/index.html` · see `docs/SPLITBRAIN-WALKTHROUGH.md`.
> **Evidence:** `bob_sessions/`.

---

## 11. Escalation / more available

I can generate on request:
- `custom_modes.yaml`, all 4 `SKILL.md`, the hook source, `MCP` source, `PRICING_POLICY.md`, the dishonest test source, `TrustGap.json` fixture + `trustgap/index.html`.
- Exact prompt strings per phase.
- The list of 8 planted mutants + which the dishonest suite misses.
- A rehearsal QA checklist.
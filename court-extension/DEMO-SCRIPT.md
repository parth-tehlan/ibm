# Gaia 3-Court — 2:00 Demo Script (IBM Bob 2.0 Hackathon)

Runtime target: **1:55–2:00**. One speaker. No music under the Bob IDE shots.
The judge-repeatable sentence we want them saying in the room afterward:

> "They dropped a spec on a real payments repo and every clause went red or green with file and line — then their trust-gap court named the tests that were lying. And the whole thing ran *inside Bob*, with no model in the engine at all."

---

## 0:00–0:08 — HOOK (artifact full-screen, before we say a word)

**[SCREEN: black → hard cut to the Gaia HTML report, full screen. The clause wall: 8 rows, all RED, each with `file:line`. Pause one beat.]**

**VO:**
> "Every MUST in your API spec, rendered red or green with the exact line that breaks it — and not a single LLM call deciding which."

**[Lower third: `Gaia 3-Court — Legal. Honest. Survivable.`]**

---

## 0:08–0:22 — PAIN (one concrete failure, timer on screen)

**[SCREEN: northstar repo open in file tree — real files: `src/pay/create-intent.ts`, `src/webhooks/stripe.ts`, `src/refunds/cancel.ts`. A wall-clock timer starts.]**

**VO:**
> "This is a payments service with eight spec violations already in it — duplicate charges, unverified webhooks, over-refunds. Today, finding them means an engineer reading an 80-page spec against the code by hand. That's a two-day audit, and humans get tired before clause eight."

---

## 0:22–0:55 — BOB DOES THE HARD THING (the eligibility shot — do NOT cut away)

**[SCREEN: full-screen **IBM Bob IDE**, Agent mode, on the northstar repo. Slow down. Judges must be able to read the UI.]**

**VO:**
> "So we open the repo in IBM Bob. I `@`-mention the spec —" *(document understanding — say it)* "—and Bob's agent mode runs the three courts we shipped as subagents."

**[DO, on camera, in order:]**
1. Type `@docs/api-spec.md` in Bob chat → document understanding visibly ingests it.
2. Show the installed court subagents in the tree (`.bob/`, `agents/spec-witness.md`, `war-room.md`) — the skill files Bob did **not** have yesterday.
3. Bob spawns **parallel subagents** — keep the collapsible panel on screen: spec-witness, test-author, mutant-analyst. Tool counts + elapsed time visible.
4. The deterministic sensors fire: `jest` runs red — not the LLM grading itself.

**VO (over the panel):**
> "Bob is the director. Our engine is just files — MCP tools and prompts. Bob's own model writes the witness tests from the spec *alone*, behind a wall that refuses to let it read the implementation."

---

## 0:55–1:18 — THE ARTIFACT (readable paused)

**[SCREEN: cut to `reports/gaia/gaia-report.html`. Three courts, side by side.]**

**VO:**
> "Three verdicts. **WITNESS**: eight clauses, all red — each one names the file and line. Click W2—" *(click it)* "—and it jumps to the webhook that never checks its signature."

**[CLICK a red clause → `vscode://` jump into `src/webhooks/stripe.ts`.]**

**VO:**
> "**TRUSTGAP** is the honesty audit. This repo claims 91% coverage. Mutation testing says 89 — and it *names* the test that's a tautology." *(hover the named dishonest test — the `x == x` assertion.)*
> "**TRIAGE** correlates the deploy, the metrics, and the logs, and isolates the exact deploy that tripped the circuit breaker."

---

## 1:18–1:38 — BEFORE / AFTER (split screen, three numbers max)

**[SCREEN: split — left "manual audit," right "Gaia in Bob." Big type. No invented percentages.]**

**VO:**
> "Spec-to-evidence audit: two days, to one Bob session. Eight of eight planted violations caught — by tests that never saw the code. And the trust gap is *derived* from the mutation report, not asserted — kill a survivor and the gap closes. It's falsifiable."

**[On-screen text, three lines:]**
```
Audit:        2 days      →  1 Bob session
Caught:       8 / 8 spec violations, blind
Honesty:      gap derived, liars named — never guessed
```

---

## 1:38–1:52 — LOOKS COMPLETE (fast cuts, ~1s each)

**[SCREEN: quick cuts —]**
- README with a 3-step install.
- `node court-extension/bin/gaia-setup.js --repo .` running on a **second, different repo** (proves repo-agnostic).
- The same engine serving **Claude / GPT / watsonx-Granite** — one `--host` flag (proves model-agnostic: no model in our code path, zero runtime deps).
- `bob_sessions/` PNGs (the submission deliverable — show they're in the repo).

**VO:**
> "One command installs it on any repo — jest, pytest, anything. Swapping the brain from Bob to watsonx's Granite is one flag, because the engine never calls a model. And every Bob session that built this is in the repo as evidence."

---

## 1:52–2:00 — CLOSE (repeat the hook, stop talking, end on the artifact)

**[SCREEN: back to the clause wall — this time W1 flips from RED to GREEN as a Bob subagent's patch lands and the test re-runs.]**

**VO:**
> "Gaia 3-Court. Your spec, your tests, and your incidents — put on trial, inside IBM Bob. Legal. Honest. Survivable."

**[Hold on the wall for two full seconds. Cut to black. Stop talking.]**

---

## Pre-flight checklist (the stuff that kills demos)

- [ ] The 8-clause wall is readable **paused** — if a judge tweets one frame, does it explain the product?
- [ ] The click-to-`file:line` jump is rehearsed (W2 → `stripe.ts` is the money click).
- [ ] Bob IDE is on screen for the entire 0:22–0:55 block. If Bob is off-screen there, we're a wrapper.
- [ ] The named-tautology hover (TrustGap) is queued — that's the "lie detector" moment judges repeat.
- [ ] Second-repo `--host` swap is a **recording fallback** if live is flaky — do not ad-lib it.
- [ ] One speaker. Burn the first 20 seconds of every take. No "um."
- [ ] `bob_sessions/` PNGs named per the submission spec before filming the 1:38 cut.

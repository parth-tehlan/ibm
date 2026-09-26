# Round 2 — Exploring More Options

**Date:** 2026-09-25 · IBM Bob 2.0 Hackathon · 48h · ~$12k  
**Judging:** Application of Technology · Originality · Business Value · Presentation

Round 1 converged on one recommendation: **REDLINE** (spec-is-law clause wall with isolation Witnesses). The user asked to *explore more options*. Five sub-agents attacked five orthogonal territories to avoid tunnel-vision. This memo ranks the strongest alternates across every family, notes how each differs from REDLINE, and gives an honest "build this instead / pair with / fold in" verdict per idea.

All threads survived the same filters: a screenshotable named artifact, Bob IDE on camera doing parallel subagents + `@`-ing a real non-source doc, a mode that physically cannot cheat, 48h buildable, and NOT a round-1/last-year clone.

---

## The contrast frame (when to use what)

| If judges respond to… | Build | Family |
|---|---|---|
| Governance / audit / "who's lying" | **REDLINE** (round 1) | Spec-governance |
| **Physics / unreproducible bugs** | **RECON** | Hardware/embedded |
| **Human emotion / a flinch** | **TRIP-THE-SCREEN** or **OKHANDOFF** | A11y / team |
| **A zoo of secrets / env blame** | **ZOMBIE** | Infra secrets |
| **A judge steering the AI live** | **DECISION DENDRITE** | Visual reasoning |
| **A live license-plate moment** | **TRIP-THE-SCREEN** | Education |

---

## The 5 round-2 threads (ranked by my overall judgement)

### Thread A — UNDERGROUND: physics & hardware (RECON)
**RECON** · *Hardware concurrency hunt. A race you can't reproduce.* Bob reads a firmware repo + a logic-analyzer **scope CSV** + a datasheet PDF; parallel subagents bisect a nondeterministic race; a `trace-witness` mode (`.bobignore` on src) infers the wiring contract from the datasheet alone; a `harness-surgeon` replays the captured interleaving 5000×. Artifact: a **race-timeline canvas**.

- **Why it's distinct from REDLINE:** a physics problem + a *binary* document. Only CircuitSense even touched EDA last year.
- **Verdict:** strongest *pure-originality* escape hatch. Light **RECON**, medium **DERIVE**, high **DARKSIDE** (planted-backdoor honeypot — fiddly demo).
- **Risk:** sourcing a believable scope dump / datasheet set; a race demo can look random if under-prepped.

### Thread B — Visual-Reasoning: a judge steers the AI (DECISION DENDRITE / BOARDROOM)
**DECISION DENDRITE** · *A PR's failure tree you click to reweight; Bob re-reasons live.* Parallel Failure-Auditor subagents trace one if-this-then-break path each; a render step draws an interactive tree; a slider reweights a branch and the tree re-balances. Screenshot = **the highlighted branch mid-reweight, tree moving.**

- Runner-up in that thread: **BOARDROOM** — four persona-mode subagents (3 Advocates + Devil's Advocate) argue in parallel, a Verdict synthesizes; artifact = a one-page board deck. Lowest build risk, most legible to non-engineers.
- **Why it differs from REDLINE:** REDLINE verifies; this *shows the chain of reasoning and lets you steer it*. The "judge changes the system's mind on screen" is the money shot.
- **Risk:** purely model-quality-dependent. Mitigation: plant a richly-documented synthetic PR; rehearse the exact click→re-balance.
- **Verdict:** great presentation play; higher demo risk than RECON/ZOMBIE.

### Thread C — Human/team: the emotional artifact (OKHANDOFF / SHRUGSHIELD)
**OKHANDOFF** · *A leaving dev gets a living, git-backed Guarantee of what the next dev can trust.* Parallel Encore/Confession/Orphan subagents turn outgoing claims into TRUSTED / BELIEVED / NO-MAN'S-LAND, cross-examined against proof. Artifact: a **Trust Passport** with a red NO-MAN'S-LAND zone.

- **SHRUGSHIELD** (runner-up): flips PR-review into *per-recipient* empathy — tell each reviewer only the blast radius they own.
- **Why it differs from REDLINE:** REDLINE is process truth; OKHANDOFF is *ownership & trust*. Distinct from the onboarding graveyard because it's about "who is safe to hand this to," not "where things live."
- **Verdict:** safest *big win*, sticky emotional artifact, provably not a clone. Strong secondary pick.

### Thread D — Infra secret lifecycle (ZOMBIE) — the least-saturated pain
**ZOMBIE** · *Trace every env var / secret as READ / WRITTEN / DYING across the monorepo; retire zombies safely.* GitGuardian reality: **64% of 2022 secrets are still valid in 2026**, +34% YoY leaks from AI commits. Hook refuses to delete any key with a live reader. Artifact: a **Zombie Graveyard + Rotation-Risk map**.

- **DRIFTLINE** (fallback): parallel subagents per resource family audit Terraform/Helm/CloudFront declared-vs-deployed drift → a **Drift Wall**. Literally "parallel subagents per resource family," as the brief suggests.
- **Why it differs:** secret *scanners* only detect; nobody owns the env-var *lifecycle* and safe retirement — exactly GitGuardian's "limiting factor." Fast, visceral, memorable 2-min demo.
- **Verdict:** highest-pure-EV pain that AI worsens, on no road map, great demo. **Best "different-world" pick if RECON is too fiddly.**

### Thread E — Education / a11y: TRIP-THE-SCREEN (the visceral flinch)
**TRIP-THE-SCREEN** · *Every UI control gets a screen-reader tripwire; Bob narrates your app as a blind user and fuzzes it.* Parallel subagents inject an a11y assertion on every control and throw 50 adversarial inputs; Bob *plays the screen-reader itself*. Artifact: **a wire-tripped narratlog** + focus-heatmap.

- **Why it differs from REDLINE:** REDLINE governs what the spec says; this checks what *nobody* thought to check, and it's a **live flinch** ("Bob reads your app to you, blind"). Emotional, unforgettable, fully Bob-native (browser mode + tool-use + doc-understanding).
- **Verdict:** the single most *memorable/live-demo* idea of round 2 — the one a judge repeats at lunch. Deterministically plantable a11y bugs = can't-fail demo.

---

## My round-2 synthesis / recommendation ladder

To **win**: pick **one** of two paths depending on appetite:

**Path 1 (commercial-judge favorite):** **REDLINE** (round 1) with the **ZOMBIE** secret-lifecycle mechanic folded in as its second "gate." Both are gates the agent can't bypass; shared CSS/hook DNA; two screenshots for one build. Emphasizes Business Value + App of Tech.

**Path 2 (memorability play, higher swing):** **TRIP-THE-SCREEN** — the visceral live-narration demo. If the room rewards shock + education over governance, this is the flinch winner. It out-memorizes REDLINE and is 100% Bob-native.

**Best different-world alternates:** **RECON** (physics/race) and **OKHANDOFF** (trust/ownership) — file these as the two most likely to be under-served by other teams.

**When to pivot:** if REDLINE's PDF→clause mapping dies on day 1 → **DRIFTLINE** (same wall DNA, different data source, least rework). If you want the live demo → **BOARDROOM** (near-zero risk). If you want the flinch → **TRIP-THE-SCREEN**.

---

## Files written this round

- `escape-governance-territories.md` — RECON / DERIVE / DARKSIDE / RECANON / RELIVE / CONSENSUS
- `visual-reasoning-pitches.md` — DECISION DENDRITE / CONFESSION / BOARDROOM / TIME MACHINE / MATCHMAKER / TEACH-THE-TEACHER
- `round2-human-team-ideas.md` — OKHANDOFF / SHRUGSHIELD / RECEIPT / GAUNTLET / FRICTION
- `underpass-strategy.md` — ZOMBIE / DRIFTLINE / REVERSE / FLAKEBUST / CROSSWIRES
- `genius-ideas.md` (updated) — round-1 synthesis + this ladder

## One-line decisions

- **Build REDLINE** or **build TRIP-THE-SCREEN** — do not build both.
- Fold **ZOMBIE** into REDLINE if you go commercial.
- **RECON** or **OKHANDOFF** are your sharpest "nobody else will" stories.
- **DRIFTLINE** is your day-1 fallback (same DNA as REDLINE).
# Round 2 — The Human/Team/Org Axis
## Beyond REDLINE (spec-governance). Ideas where the PRODUCT is team cognition, not spec vs code.

**Why this axis, and how it's complementary (not clones):**
Round 1 (REDLINE) won on *document-against-repo* truth. It answers "**who is lying**" between an authority (spec) and the code.

Round 2 should answer a different 2026 question nobody productized: **"who is safe to hand this to, who actually feels good doing this work, and who is one pager away from quitting."** REDLINE is about *compliance of artifacts*. These are about *cognition and care of humans* — but each is still a **named, git-backed artifact** produced by Bob doing code-aware, multi-agent (subagent/parallel/document-understanding/MCP/rollback) work. That last part is the trap: the moment an idea reduces to "a prompt in a chat," Bob is replaceable and it dies the wrapper-death.

**Hard anti-patterns kept in mind (from round 1 research):**
- Onboarding dashboards / "explain the repo" = the appendix #1 graveyard. Avoid unless the artifact is physical and the workflow is *post-onboarding*.
- PR risk scores / "smart review" = saturated. Avoid unless it's *per-persona*, not per-diff.
- Must keep the round-1 thesis true: coding isn't the bottleneck; *believing/owning/caring* is.

**Fresh supporting evidence for the human axis (all real, 2025–26):**
| Signal | What it means for us |
|---|---|
| LinearB / DORA: AI PRs rejected 67% vs 15% for humans | The human review step is now the *grief*, not the code. Reviewer bandwidth is the bottleneck → empathy tools. |
| "AI authorship → nobody owns the code" (2026 on-call debt) | Handoff/ownership is the pain, not understanding. → successor handoff, context freeze. |
| Compaction/context-rot ("50 First Dates") | Memory is disposable today. → durable, git-backed memory products. |
| METR: experienced devs 19% *slower* while believing faster | Per-recipient calibration is needed, not generic "better tools." → reviewer-brain, toil index. |
| Juniors inheriting agent-authored diffs without a WHY | The WHY is now a person-shaped gap, and it's teachable. → training-as-artifact. |

---

# Ranked — by win probability (the big one first)

---

## RANK 1 — OKHANDOFF (successor handoff, not onboarding)
**12-word pitch:** A leaving dev gets a living, git-backed Guarantee of what the next dev can trust and not.

**Human pain (not code pain):** The worst day in a team's quarter is turnover: the person who *remembers the invariants*, the workarounds, the "this file is sacred, that file is dead" leaves — and the other 8 people on the team each reconstruct a partial, contradictory picture. Onboarding products show *where the code is*. Handoff is about **what the code is allowed to pretend to be** — the difference is ownership and safety, and it's why juniors freeze for a month. Empirically real: DORA +154% PR size means the "the whole team must understand everything" just got worse.

**Bob architecture proving Bob is core (not prompt-replaceable):**
```
.bob/
  modes/
    seneschal/         # the inheritor persona: read + skills, CANNOT edit src/
    exorcist/          # read only; licks every claim
  skills/ok-handoff/
  mcp.json             # own-the-repo fixture tools (git log, ownership map, test-flakiness)
  settings.json        # hook: every handoff write is its own git commit (git-backed living artifact)
```
1. **Deterministic prep (0 tokens):** MCP reads git log + CODEOWNERS/blame → builds an ownership map of "who actually last touched, tested, or owned each module."
2. **Parallel subagents** (the org chart):
   - **Encore** — reads commits + old PRs + comments, extracts the *claims* the outgoing dev believes ("this rate-limiter is production-hardened"; "this module is only for legacy batch").
   - **Confession** — cross-examines each claim against proof: is there a test? a recent green run? a second owner? It separates **Trusted** (verified) from **Believed** (asserted, unproven) from **Contested** (two devs disagree).
   - **Orphan** — finds modules with zero owners, zero tests, zero recent edits: the true liability.
3. **Seneschal mode** writes `HANDOFF.md` — a **living Guarantee** with three sections: *(A) Guarantees* — "you may rely on X; here's the proof"; *(B) Suspended beliefs* — "the previous owner believed Y; do not spend a week on it until it's proven"; *(C) No-man's-land* — "these files are unsupported; the previous owner would tell you to rewrite, not patch."
4. **Hook** commits every handoff revision as its own git commit (`#handoff`) so the Guarantee *itself* has blame — a "who changed the story of the code" ledger. Rollback lets a new owner revert a wrong handoff assumption.

**Judge-artifact (must be screenshotable + emotional):** A **Trust Passport** — a page that looks like an immigration stamp. For each module: green **TRUSTED**, amber **BELIEVED**, red **NO-MAN'S-LAND**, each with `file:line` and the proof or the absence of it. The sticky frame is the red "NO-MAN'S-LAND" zone — juniors instantly see which files would eat their month.

**Measurable impact:** New-dev time-to-first-safe-commit; number of "dead-end beliefs" adopted by the successor (planted: the outgoing dev believes a module is hardened; Bob shows it has no test and hasn't run green in 6 months); incidents caused by patching a NO-MAN'S-LAND file.

**Builds in 48h / 40 coins on synthetic sample:** Sample repo "Voltage." Plant: one module the outgoing dev claims is hardened (it isn't — no test, stale), one genuinely orphaned `utils/` swarm, one contested ownership. Author `.bob/` by hand (0 coins). One gold Bob session runs the three subagents and produces `HANDOFF.md` (~12–15 coins). One rehearsal + PNGs (~10). Static "passport" HTML renders the three-colored zones. If time dies, drop the Exorcist and let the subagents each stovepipe one claim.

**Honest originality vs WHERE_WAS_I + the whole onboarding family:** WHERE_WAS_I / onboarding answer *"where do things live"* — geography. OKHANDOFF answers *"what can I trust, what must I not touch, and who owns it"* — **liability**, which is the actual psychological blocker for a successor. That is a different question than "onboard me to the repo," and it happens at the *exit* moment, not the entry moment, so it's not the saturated appendix #1. Where it's *weak:* the screenshot is a dashboard-like page, so it can look like appendix #1 unless the "no-man's-land" red zone and git-backed blame are visually loud. Mitigate: make the passport *look* like documentation with redaction tape, not a metric board.

---

## RANK 2 — SHRUGSHIELD (reviewer-brainshare, NOT per-diff risk)
**12-word pitch:** Tells each reviewer only the blast radius *they* own in this diff — empathy, not risk score.

**Human pain (not code pain):** Code review time is +91% and PRs are +154% bigger. The real friction is not "is this PR bad" (that's a saturated risk score) — it's **each reviewer drowning in the full diff when they only care about their own slice**. The backend owner for a frontend-touching PR feels obligated to read everything; nobody feels safe to say "that's not mine." The human wound is **relevance anxiety + reviewer guilt** — feelings, not findings.

**Bob architecture proving Bob is core:**
```
.bob/
  modes/curator/        # reads diff + reviewer profile; CANNOT edit src/
  skills/shrugshield/
  .bob/modes/blast-agent (explore, read-only)
```
1. **Profile build (deterministic + one subagent):** from git history + codeowners + past review comments, build per-developer "ownership surface" — which files/symbols each person actually owns and has reviewed historically. This is code-aware and personal.
2. **Diff decomposition (parallel):** chunk the PR into independent blast-radius units.
3. **Per-reviewer lens:** one **parallel subagent per reviewer**, each fed (a) the diff units intersecting that reviewer's ownership surface, and (b) *only those*. Bob answers: "Here are the 3 hunks that are YOURS. Here's the one sentence a non-owner would not notice but you must. Here are the changes that touch your past decisions" — plus a bold **NOT-YOURS** boundary so the reviewer can guiltlessly skip the rest.
4. Output to each reviewer individually via a generated `REVIEW-ME.md` (git-backed, per-person), not one giant thread.

**Judge-artifact (sticky):** A **per-personal lens view** — the same PR rendered as a card that physically re-sizes to the reviewer's own blast radius: their hunks big, everyone else's collapsed gray. Pair with the patristic emotion: "the senior backend owner got told to look at exactly 3 hunks and stop."

**Measurable impact:** Time-to-first-*owned* comment; reviewer burnout proxy (comments-per-PR owned vs total); "guiltless skip" rate (reviewers engage only their slice). Planted: a security-critical hunk in a file only one dev owns — ShrugShield flags that *one person*, where a generic risk score flags it to *everyone* and it gets lost.

**Builds in 48h / 40 coins:** Synthetic: one PR touching frontend + a shared lib + a money path. Two fake reviewer profiles (frontend dev, payments dev). Chromium ownership from git log. One gold Bob session builds the per-person lenses. The "collapsed gray vs enlarged" visual is CSS. Very fast to make look real.

**Honest originality:** The whole market scores the *PR*. Reviewer-brainshare personalizes the *receiver*. That flips a saturated category (blast radius) into an empathy tool ("show only the blast radius the dev owns" — literally in the brief). **Weakness:** genuinely adjacent to "smart review," so a judge could call it a PR tool. The differentiation must be the **per-persona reduced view + guiltless-skip + "a change touching your past decision"**, shown as the hero shot — a risk score never tells a reviewer "this violates what *you* decided in March."

---

## RANK 3 — RECEIPT (training-as-artifact — the WHY narrated)
**12-word pitch:** Turns a fresh AI-authored PR into a 90-second narrated tutorial of the decision the author made.

**Human pain (not code pain):** The biggest learning collapse in 2026: juniors inherit diffs written by an agent, and nobody can explain the *why*. The PR description is generated-from-commits-generated; the "decision" is a cold model. Learning plateau: juniors learn the WHAT by reading, but the WHY (tradeoffs, rejected alternatives, blast radius chosen) died in the agent's compacted session. Retraining is now the org's #1 retention lever and it's *impossible*.

**Bob architecture proving Bob is core:**
1. **Decision recovery (parallel, read-only):** subagents reconstruct *the decision* from the diff, the rejected branch, the ticket, comments, commit messages: (a) **Why here?** — why was the change scoped to these files and not the obvious neighbor? (b) **What was tried?** — the earlier commit that was walked back (git history is the "rejected alternative"). (c) **What was chosen and why not X.**
2. **Document understanding** of the ticket + ADR to ground the narration in intent, not hallucination.
3. **Narrator subagent** writes a 90-second **RECEIPT** — a Markdown/HTML "receipt" of the decision: *You, junior, are about to maintain code that exists because: [one paragraph]. If you ever change [X], you invalidate [Y]. The first commit tried [Z] and here's why it died.*
4. Optionally Bob narrates it (TTS via a render, or a `.mdx` story) so it's genuinely a *tutorial*, watchable in 90s.

**Judge-artifact (sticky):** A **Decision Receipt** — physical, like a sales receipt from the codebase, itemizing the decision with "TRYED [tour], DIED WHY, CHOSE [this]." The emotional hit: a junior's first week uses REDLINE-style *receipts* instead of guessing — "the codebase hands me its receipts now."

**Measurable impact:** Time-to-first-correct-modification of inherited code; questions-asked-on-owning-new-code; junior mistakes that invalidate a load-bearing decision (planted: a decision with a documented "if you change this you invalidate X").

**Builds in 48h / 40 coins:** Synthetic: one PR with a *deliberately rejected first approach* preserved in git (the gold nugget — two commits). Bob's Narrator produces a RECEIPT that cites the walk-back commit. 90s is the format; render HTML. Clean and demo-able.

**Honest originality:** WHERE_WAS_I reconstructs *what was done*. RECEIPT reconstructs *the deliberation that was lost* — including the rejected branch only git remembers. This is genuinely orthogonal to onboarding and to REDLINE (which proves the spec; this narrates the decision). **Weakness:** the "narrated tutorial" is conceptually close to "AI explains a PR," which is appendix-adjacent. The differentiator is the *rejected-branch archaeology* + the *why-not* — those must be the named hero, not "an explanation." Also, "training" per se isn't a listed workflow, so it reads as the *onboarding* workflow's learning half — position it as **on-call uptime** ("the person who rewrites this 12 months from now") rather than a training module.

---

## RANK 4 — GAUNTLET (psychological safety — "AI ghost writer" for the hard conversation)
**12-word pitch:** Drafts the engineering conversation, as an artifact, that nobody ghosts-writes. Culture tool.

**Human pain (not code pain):** The hardest 2% of engineering work is not code — it's the *awkward conversation*: telling a lead their design is wrong, saying no to a datacenter migration, pushing back on a senior reviewer's idea, proposing a rollback that embarrasses someone. Teams don't lack technical ability; they lack *safe words*. Nobody productized this because it's "just a writing tool" — but a *code-aware* version can ground the argument in evidence, which is what makes it safe to say.

**Bob architecture proving Bob is core (and where it gets real):**
1. **Code-aware dispute evidence:** Bob reads the actual design doc/code/PR the pushback is about, and extracts *neutral, citable evidence* (the finding, the `file:line`, the dependency that breaks, the ambiguous requirement) — so the ghost-written email is a weapon of *proof*, not a weapon of *feeling*.
2. **Two subagents in parallel:** **Advocate** drafts the direct version; **Diplomat** drafts the "we might be missing something, help me" version — and Bob *labels the register* ("this is the confrontation register, use only if X"). It gives the junior the *choice*, which is the safety.
3. **Rehearsal space:** Bob red-teams the draft (reverse-role) — "here's the three ways your lead could take this wrong, here's the softer frame." This is the psychological-safety product: a no-risk rehearsal before the real one.
4. Output is a git-backed `conversations/` artifact with `file:line` citations — **evidence you can stand behind.**

**Judge-artifact (sticky):** Anything that makes a judge *feel* the safety. Best: a side-by-side **two-register draft card** — "Direct / Diplomat" — with the citable code evidence pinned, plus the red-team "3 ways this could land wrong." The emotional frame is "we built a safe space for the hardest sentence in your week."

**Measurable impact (honest):** Hardest to quantify, so pivot to *adoption* and *turnover*: number of documented pushbacks raised (which was zero), time-to-raise, and retention of the person who could not speak. Frame as "we make the unsayable sayable with evidence."

**Honest originality + BLUNT weakness:** This is original (nobody productizes psychological safety for engineers with code-grounded evidence) but it is also the **weakest of the five on every hard judging axis**:
- **Bob-core risk:** the *writing* could be done by any LLM. Bob only stays core if the *evidence extraction* (reading the design/PR and citing `file:line`) is the irreplaceable step. If the demo leans on prose, it's a wrapper.
- **Business-value risk:** HR-adjacent, harder to map to a "Monday buyer," and judges may discount "culture" as soft. Must recruit 2–3 *technical* evidence screenshots, not a writing aesthetic.
- **Demo risk:** can't easily "before/after" an emotion. Bring a real, awkward, repo-grounded scenario with a visible `file:line` disproof.
Ranked here because it's a stretch and honest stretch — build it only if you want maximal Originality on a *human* angle and accept a weaker Business-Value story.

---

## RANK 5 — FRICTION (Toil Index — measuring manual drift-fixing vs real work)
**12-word pitch:** Reads a dev's PR history and shows where they're doing manual toil, not real work — a plan to end it.

**Human pain (not code pain):** Developer burnout correlates strongly with **toil** — hours un-doing drift, re-syncing, manually fixing what automation should fix — *disguised as productivity*. Nobody measures it per dev; it hides inside "same-diff rewrites," "revert-and-redo" commits, and "emergency fixes to the same file." The product is *flight-level awareness that you are a janitor 40% of the time* — and a plan.

**Bob architecture proving Bob is core:**
1. **Deterministic signals (0 tokens, MCP):** from git + PR history, compute a **Toil Index** per dev: ratio of *rework* commits (changes that fix a previous change of the same author) to *greenfield* commits; churn (files re-touched within N days); fix-to-feature ratio; "the same file appears in 60% of my reverts."
2. **Parallel subagents classify intent:** each PR → TOIL / FEATURE / DEFENSE / DEBT, grounded in the actual diff, not just message keywords.
3. **Root-cause planner subagent:** for the top toil source (e.g., "3 of your 5 emergency fixes were to the same migration file"), Bob proposes the automation that would kill it — an actual `SKILL.md` or MCP tool that automates the manual drift-fix Bob detected.
4. **Rollback/hook:** the resulting `TOIL.md` + the automation it proposes are version-controlled; the *automation is the artifact's payoff* — Bob converts detected toil into a reusable remediation.

**Judge-artifact (sticky):** A **Toil Index card** per dev — a "health score of your day" with the red line: "58% of your PRs this quarter were rework." The emotional frame is *recognition* — "you aren't lazy, your workflow is.* That's the screenshot: one dev's red 58%.

**Measurable impact:** toil ratio before/after; hours returned; the *named automation* that kills one recurring toil (e.g., a migration-resync MCP) — measurable because the toil is defined and the fix is deployed.

**Builds in 48h / 40 coins:** Synthetic: a fake dev's commit history with planted rework/same-file churn (gold: repeats of "fix same migration" over 12 commits). Deterministic signals are scripts; the intent-classification is one subagent. Clean, honest, and genuinely *emotionally* resonant to any judge who's ever felt like a janitor.

**Honest originality:** This borrows DORA's "toil" concept (well-evidenced) but is NOT a metrics dashboard — its product is a *per-person burnout diagnosis + a remediation automation*, which dashboards don't do. **Weakness:** the risk of looking like a "developer analytics dashboard," which the kill-list and saturated-zone both punish. Must lean hard on the *remediation — the automation* ("we didn't just tell you you're a janitor, we eliminated the janitor task") and keep the delivery as a *per-person intervention*, not a team dashboard. Where_WAS_I is memory; this is *diagnosis* — different.

---

# Ranking rationale

| Rank | Idea | Crowd-wow | IBM-enterprise | Bob 2.0 depth | 48h safety | Clone/graveyard risk | Human-pain purity |
|---|---|---|---|---|---|---|---|
| 1 | **OKHANDOFF** | ★★★★ red NO-MAN'S-LAND zone | High (retention, ownership) | modes + parallel subagents + MCP + hooks + rollback + git-blame | High | Medium (looks like onboarding unless red zone + git blame are loud) | ★★★★★ |
| 2 | **SHRUGSHIELD** | ★★★★ per-person shrink | High (review bandwidth) | parallel per-reviewer subagents + code-aware profile | High | **Medium** (flips a saturated category — must nail "your past decision") | ★★★★ |
| 3 | **RECEIPT** | ★★★ decision receipt | Medium-High (juniors inherit AI code) | rejected-branch archaeology + doc-understanding + narrator | High | **Medium** (explains-a-PR adjacency) | ★★★★ |
| 4 | **GAUNTLET** | ★★★ two-register safety card | Low | code-aware evidence = the only core part | Medium | High wrapper-risk | ★★★★★ |
| 5 | **FRICTION** | ★★★★ red "58% rework" | High (retention) | deterministic signals + intent classify + *remediation automation* | High | **High** (looks like an analytics dashboard) | ★★★★★ |

**Build ONE:**
- Pick **OKHANDOFF** if you want the safest big win and a genuinely sticky emotional artifact (red NO-MAN'S-LAND) that is *not* the round-1 REDLINE wall and is *not* appendix onboarding.
- Pick **SHRUGSHIELD** if you think the judges will reward you for *flipping the saturated PR/blast-radius category into an empathy product* — highest wow for a reviewer-heavy room, but you must nail the "it shows a reviewer only their own blast radius and their own past decisions" hero shot.
- Pick **FRICTION** if a retention/"developer wellbeing as business value" story lands hardest and you trust yourself to keep it off the dashboard graveyard by leading with remediation.
- **Skip GAUNTLET** as the primary — commercial-buyer story is thinnest and the wrapper-risk is highest — keep it in your back pocket only as an originality swing if the room is HR/leadership-heavy.

---

## Cross-cutting: how these differ from REDLINE (complementarity statement)
REDLINE = authority (spec) vs artifact truth. The runner is:
- **OKHANDOFF** = outgoing *human* vs incoming *human* trust + liability.
- **SHRUGSHIELD** = artifact vs *individual human receiver*.
- **RECEIPT** = artifact vs *next human learner's why-gap*.
- **FRICTION** = human *effort* vs human *purpose* (toil vs real work).
- **GAUNTLET** = human *speaking* vs human *safety*.

All five still produce **a named, git-backed artifact**; all five still route through Bob's **modes as org walls, parallel subagents as the workforce, MCP for deterministic hands, document-understanding for intent, and rollback as the safety net** — so Bob is the engine, not a prompt. None of them clone REDLINE.

## The one-shot demo skeleton (any of the five)
```
0:00–0:08  The artifact, full screen. One sentence.
0:08–0:22  The human at their worst day (turnover / reviewer drowning / janitor burnout).
0:22–0:55  BOB IDE. Parallel subagent panel. Document-understanding @. Deterministic MCP.
           THIS IS THE ELIGIBILITY SHOT.
0:55–1:18  The artifact artifact (trust passport / shrunk lens / decision receipt / toil card).
1:18–1:38  Before/after, three honest numbers.
1:38–1:52  README, .bob/ pack, bob_sessions PNGs, clone-and-run.
1:52–2:00  Hook again. Stop on the artifact.
```
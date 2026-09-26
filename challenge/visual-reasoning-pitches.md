# THE RENDERED ARGUMENT — Bob's Human-Facing Superpower

**Pivot thesis:** Round 1 (REDLINE) showed Bob the *verifier* (spec-as-law, isolation, audit). Judges have now seen that. The untapped, most-judge-memorable mode of Bob is **the explainer** — Bob as an *articulate tech-lead who shows its reasoning and lets a human steer it.* Not pass/fail. Not governance. **The artifact is a rendered chain of thought you can grab.** That is "App of Tech + Originality" in one screen.

Every idea below shares one conviction: **the screenshot is not text deciding "safe/unsafe" — it is the argument itself, drawn, and clickable.**

---

## The Bob primitives each idea leans on (real, from features-and-configuration.md)

- **Subagents** — isolated contexts for focused parallel tasks (each agent = one branch / one juror / one era).
- **Custom Modes** — a named persona per argument-side (Prosecutor, Defense, Skeptic, Junior, CEO).
- **Skills** — reusable instruction sets; the packaging unit for "Teach-the-Teacher."
- **Context mentions (@)** — pin a file/PR/commit to a subagent.
- **Code reviews + Pull requests** — the built-in workflow hooks we trigger then re-render.
- **Rollback/versioning** — used by Time Machine to rewind deterministically.
- **Custom rules / Bob tips** — source of the "rules" a Decision Dendrite reweights.
- **Render step** — Bob emits structured markup (tree/mermaid/deck-frame/caption) that our shell renders to a beautiful SVG/PNG. **This render step is the on-camera differentiator.**

---

# 1. DECISION DENDRITE — "Steer the break."

**12-word pitch:** *"A PR's failure tree you click to reweight — the judge sees you re-see the risk."*

**Developer pain:** Reviewers approve shallowly because they can't enumerate *which* if-this-then-break path actually scares them — so risk stays a vibe, and regressions get shipped.

**Bob primitives proving core:** A **subagent** per dependency/branch traces one causal failure path from the PR diff. **Custom mode** "Failure Auditor" forces each branch to name the exact trigger→break. **Context mention** pins the changed files. All branches collect in the main context, then the **render step** draws an interactive dendrite (Mermaid/React-flow → PNG). **Rollback** keeps branches honest against the actual diff.

**Screenshot artifact:** A branching tree rendered live: root = "Merge PR #172." Each child branch = a named failure ("null deref on legacy path," "schema drift hits cache warmer"). Each branch shows a weight bar (e.g. 0.62) = Bob's confidence × blast radius. **One branch is highlighted; the judge sees a slider.** That's the hook.

**30-second judge line:** *"This isn't 'merge / don't merge.' This is the argument a senior engineer makes in their head, drawn, and you can grab a branch and say 'actually, that scares me more' — and the whole tree re-balances live."*

**48h build path:** Day 1 → seed a synthetic repo with a real-ish buggy PR; stub the Failure Auditor custom mode; emit branch model as JSON. Day 2 → build the dendrite renderer (react-flow or matplotlib) and the live-reweight slider wired back to Bob choices; screenshot the "click a branch → it re-prioritizes" moment.

**Honest complexity:** Medium-high. The reweight loop is straightforward; the *credible* branch generation needs good prompting on a planted bug. **Coin cost:** ~8–12 coins (several subagent branches + rerenders). **Watch:** don't let it read as "blast radius tool" (last-year saturation) — the *reweight interaction* is the differentiation, keep it on screen.

**Out-memorizes REDLINE because:** REDLINE proved Bob can *judge.* This proves Bob can *think in public and take direction.* A judge can't screenshot REDLINE's drama; **this has a manipulable artifact.**

---

# 2. THE CONFESSION — "Three frames that were the bug."

**12-word pitch:** *"The bug isn't the code — it's the three calls that looked right at the time."*

**Developer pain:** Juniors read a fixed bug but never learn *the decision path that created it*, so the same class of mistake recurs on every team.

**Bob primitives proving core:** **Custom mode** "Confessor" narrates with full honesty-of-decision. **Subagents** each take one *decision point* in the bad commit and reconstruct "what I thought I knew → where it was wrong → what I'd do now." **Context mentions** lock each frame to the exact lines. Render step emits frame-by-frame captioned stills.

**Screenshot artifact:** Three side-by-side decision cards over a git diff — each card is a translation unit: input it saw, assumption it made, why it was wrong. **Frame 2 contains the lie.** The artifact makes the *mental model* visible, which text never does.

**30-second judge line:** *"Every junior asks 'how did they even think that was right?' Here Bob confesses the three decisions that were the bug — so the lesson lands instead of the shame."*

**48h build path:** Day 1 → pick a planted multi-call bug; write the Confessor mode + decision tracer over `git log -p`. Day 2 → render the 3-frame deck (caption cards); screenshot frame 2 mid-narration.

**Honest complexity:** Low-medium; mostly prompt craftsmanship. **Coin cost:** ~4–6. **Watch:** harder to make look like "tech" — dress it as a diagnostic, not therapy.

**Out-memorizes REDLINE because:** REDLINE told you it complies. This tells you *how a mistake gets born* — original, human, and impossible to confuse with an audit tool.

---

# 3. EXECVICE / THE BOARDROOM — "Let four AIs litigate."

**12-word pitch:** *"Three agents argue for, one against; a board of AI reaches a verdict."*

**Developer pain:** Architectural decisions fail to get bought off because non-technical stakeholders get a wall of jargon instead of a decision with an adversarial record.

**Bob primitives proving core:** This is Bob's **parallelism on camera at its purest.** Four **subagents**, each a distinct **custom mode** persona: three Advocates (Scalability, Speed-to-ship, Cost) + one **Devil's Advocate**. They run in parallel, produce one argument each. A fifth **Verdict** subagent synthesizes. Render step typesets a one-page board deck → next-style slides.

**Screenshot artifact:** A real board slide: four quadrant cards (names, color, one thesis each) and a bottom **VERDICT** bar with a dissent note. Subagents visibly fan-out in the Bob IDE status panel — that's the App-of-Tech shot.

**30-second judge line:** *"Make the technical decision a board meeting: three AIs argue for, one argues against, and the verdict owns its dissent. Stakeholders finally see the trade — not the jargon."*

**48h build path:** Day 1 → wire a synthetic architecture fork; define the 4 persona modes + Verdict. Day 2 → style a genuine board deck (HTML→PNG); screenshot the fan-out panel mid-run.

**Honest complexity:** Low-medium; parallelism is native. **Coin cost:** ~5–7 (5 subagents + rerenders). **Watch:** the *visual* must carry it — a text chat of 4 AIs is boring; the *board render* is the winner.

**Out-memorizes REDLINE because:** REDLINE was solo-judge agreement. This is *visible disagreeing intelligence* — more motion, more story, more "wow."

---

# 4. THE TIME MACHINE — "Pause the divergence."

**12-word pitch:** *"git blame, replayed as a film that stops at the wrong mental model."*

**Developer pain:** Teams debate *when* a system went wrong, but git shows the commit, not the *causal divergence* — so the myth of "that commit broke it" lives forever.

**Bob primitives proving core:** **Subagents** rewind sequentially at each commit, each reconstructing the author's then-mental model vs. reality. **Rollback** exploits Bob's native versioning to rehydrate each snapshot deterministically. **Context mentions** pin files per era. Render step emits a timeline filmstrip with a paused frame.

**Screenshot artifact:** A causal timeline filmstrip of commits — each frame shows model-vs-reality gap shrinking/widening. **The film is paused exactly on the commit whose model diverged from reality**, captioned with the delta.

**30-second judge line:** *"Stop asking who's to blame. Bob replays the code's life like a film and freezes the exact frame where the author's mental model drifted from reality — now you debrief the why, not the who."*

**48h build path:** Day 1 → synthetic multi-commit repo with a planted drift; subagent-per-commit model tracer. Day 2 → filmstrip renderer + pause-at-divergence logic; screenshot the frozen wrong-frame.

**Honest complexity:** High — per-commit model reconstruction is the hardest to make *credible*. **Coin cost:** ~10–14 (many subagents across commits + renders). **Watch:** risk of being seen as "blame/audit history" (REDLINE-adjacent) — **frame it as pedagogy, not forensics.**

**Out-memorizes REDLINE because:** REDLINE arrests. This *narrates causation* — more vintage, more surprising, less compliance-flavored.

---

# 5. THE MATCHMAKER — "Two shops, one fight, a lesson."

**12-word pitch:** *"Two projects solving the same problem, head-to-head — the winner is the lesson."*

**Developer pain:** Teams reinvent and re-lose the same architectural war; nobody compares the two *warring solutions* because they live in different repos nobody connects.

**Bob primitives proving core:** Two **subagents** each deep-read one repo and extract the architecture + decision trail (requires **document understanding** — parse READMEs, PRs, configs — Bob's core). A third **Debate** subagent does head-to-head. **Context mentions** pin the comparative files. Render step emits a side-by-side verdict table that doubles as a learning artifact.

**Screenshot artifact:** A two-column duel: repo A vs repo B, constraints, trade-offs, and a **Why-One-Wins** verdict with the single deciding constraint highlighted. Visual: a scored comparison, not prose.

**30-second judge line:** *"Two strangers solving the same problem, and Bob gives you one head-to-head: here's why one wins — and it's a lesson your next project can cash."*

**48h build path:** Day 1 → two small synthetic repos, same problem, different architecture; subagent extractors. Day 2 → side-by-side comparator render; screenshot the "deciding constraint" moment.

**Honest complexity:** Medium — cross-repo *causal* comparison is prompt-heavy. **Coin cost:** ~7–9. **Watch:** needs label/document tokens so it reads as intelligence, not a diff tool.

**Out-memorizes REDLINE because:** REDLINE enforced one truth. This *surfaces a decision worth stealing* — positive, generative, and plainly original.

---

# 6. TEACH-THE-TEACHER — "Your pattern, made a skill."

**12-word pitch:** *"A senior's explanation + code becomes a tested skill pack, human-curated, repo-verified."*

**Developer pain:** Hard-won senior patterns live in a Slack message and die; onboarding can't reuse what the expert taught once.

**Bob primitives proving core:** **Skills** are the flagship primitive — Bob ingests the (synthetic) senior conversation + code into a reusable skill. **Custom mode** "Pattern Curator" drafts it. A **verify loop** runs the skill against the live repo (Bob **code-reviews** its own output). The **human-curated gate** is the differentiator: a judge sees Bob produce-and-verify, then a human approve. Render step emits a "skill receiving report."

**Screenshot artifact:** A skill-pack "receipt": the conversation excerpt → codified steps → **verification pass/fail against live repo** → a prominent **HUMAN CURATED** gate already flipped. It's a rendered *packaging* argument.

**30-second judge line:** *"The pattern that took a senior three years to learn is now a tested, human-approved skill any new hire can invoke on the real repo — Bob turned talk into leverage."*

**48h build path:** Day 1 → write a custom Bob skill; feed a synthetic senior chat + pattern code. Day 2 → verify loop against a planted repo + render the receipt; screenshot the human-curate confirmation.

**Honest complexity:** Medium — Skills + verify loop is real work but well-trodden. **Coin cost:** ~6–8. **Watch:** skills/docs feel saturated (last year's theme) — the **verification loop + human curation + rendered receipt** are what lift it out; say those words on camera.

**Out-memorizes REDLINE because:** REDLINE codified rules. This *compressively packages human judgment into reusable, verified leverage* — arguably the highest business value and the most human story.

---

# TOP PICK: DECISION DENDRITE

**Why it wins the room:** It is the *only one where the judge, live, changes the system's mind on screen* — a click changes weights and the rendered tree re-balances. That's irreversible "wow." It nails **App of Tech** (interactive render), **Originality** (no one does reweightable argument trees), **Business Value** (real merge-risk decision support), **Presentation** (one beautiful, manipulable image). It also showcases Bob's parallelism on camera (fan of Failure-Auditor subagents) without the governance/REDLINE taint.

**Blunt buildability risk (top pick):** The credible *reweight* loop depends entirely on model quality — if the auto-generated failure branches are generic or the clicked reweight produces a barely-different tree, the demo dies. **Mitigation:** plant a synthetic PR with a richly documented bug so branch generation is guided and the reweight delta is unmistakable; rehearse the exact click→re-balance moment; keep a trimmed tree so the visual read is instant. Budget enough Rerenders (~12 coins) to arrive at a good tree *before* the camera rolls.

**Runner-up: EXECVICE / THE BOARDROOM** — lowest build risk, the parallel-fan-out shot prints almost for free, and "visible disagreeing AI reaching a verdict with dissent" is the most immediately legible to judge who isn't a deep engineer. If the dendrite tree renders badly, this is the safe-money pivot in ~4 hours.

---

## One-line disambiguation matrix

| Idea | Talk-track | Why NOT look like REDLINE |
|------|-----------|---------------------------|
| Dendrite | reasoning you can steer | interactive, not audit |
| Confession | the bug's birth | pedagogy, not blame |
| Boardroom | visible disagreement | motion, not compliance |
| Time Machine | causal narration | causation, not forensics |
| Matchmaker | a lesson worth stealing | generative, not governance |
| Teach-the-Teacher | talk → leverage | human-leverage, not rules |

**Rule of thumb for the whole run:** never let Bob *declare.* Always let Bob *argue, render, and hand you a lever.* That sentence is the entire differentiator from round 1.
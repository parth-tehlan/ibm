# Demo & Judge-Psychology Strategy
IBM Bob 2.0 Hackathon · 48h · 15k+ registrants · presentation is scored

**Recommended pick:** REDLINE. Build nothing else.

---

## What actually won last time (steal the pattern, not the product)

| Winner | Sticky artifact | Judge-repeatable sentence |
|---|---|---|
| **Pedigree** | Code Passport + QR | "They sign every AI commit and an auditor verifies authorship in 10 seconds." |
| **Verdict** | PASS / SUSPICIOUS / LIED | "It's a lie detector for AI agents that doesn't use an LLM." |
| **StoreGreen** | Store-reviewer preflight | "It names the rule, file, and line that would get you rejected — before you upload." |

None of them were "an AI assistant for X." All of them had a **named object** a judge could screenshot and retell.

---

## 1. The winning 2-minute formula (shot list)

Judges will not rewind. If the first 8 seconds are a logo + "Hi we're team X," you're dead.

### 0:00–0:08 — Hook (one sentence, artifact on screen)
- Black frame → the named artifact, full screen.
- Voice: one sentence. No names, no stack, no "in today's world."
- Test: a judge walking past a laptop should understand the product.

### 0:08–0:22 — Pain, on a real-looking repo
- Real files, real filenames, real mess. Not `todo-app`.
- Show the *human* version of the workflow with a timer on screen.
- One concrete failure (the Friday incident, the rejected audit, the 2-day onboarding).

### 0:22–0:55 — BOB DOES THE HARD THING (the IBM money shot)
**Do not cut away. Do not overlay a dashboard. Do not speed this up into mush.**

Full-screen Bob IDE, Agent mode, on the sample repo:
1. `@` the PDF / log / runbook (document understanding — called out in the brief).
2. Skill auto-activates (`SKILL.md` visible in the file tree).
3. Parallel subagents panel: 3–4 agents, tool counts, elapsed time.
4. Deterministic sensors fire (tests, grep, scripts) — not just chat.

This is the eligibility shot. If Bob is off-screen here, you are a wrapper.

### 0:55–1:18 — The artifact
- Cut to the named visual. It must be readable paused.
- Click **one** red item → file:line in the real repo.
- Optional: one-click "fix this" returns to Bob; a subagent writes the test + the patch; tests go green.

### 1:18–1:38 — Before / after + numbers
Split screen. Three numbers max. Inventing 10,000% is worse than a honest 12×.

| Bad | Good |
|---|---|
| "increases productivity" | "PCI MUST-audit: 2 days → 4 min. 23/41 clauses already failing." |
| "reduces errors" | "Caught the missing migration that would have taken prod down for 2 hours." |

### 1:38–1:52 — Looks complete
Fast cuts, 1 second each:
- README that looks like a product (install in 3 steps)
- `.bob/skills/` + custom mode + `AGENTS.md`
- `bob_sessions/` PNGs
- Sample project with a planted, documented defect
- Clone-and-run of the artifact (`npx serve artifact/` or similar)

### 1:52–2:00 — Close
Repeat the hook. Stop talking. End on the artifact.

**Audio rules:** one speaker. No music under the Bob IDE shot (judges must read the UI). No "um." Burn the first 20 seconds of every take.

**The one-screenshot test:** if a judge tweets one paused frame, does it explain the product? If no, the visual is not done.

---

## 2. Four showstoppers

Each has a named artifact, a Bob-native multi-step, a 48h path, and a Monday buyer. Ranked.

### 1. REDLINE — Spec PDF vs the repo (PICK THIS)

**Artifact:** A clause wall. Left: every MUST/SHOULD from a real spec PDF. Right: file:line. Red / yellow / green. Click a red clause → failing test + proposed patch.

**Why it wins**
- Document understanding is in the brief and **underused**. 500 teams will do "AI onboarding" and "AI code review." Almost nobody will drop an 80-page PDF on a repo and make it light up.
- Visual is as sticky as Pedigree's passport.
- IBM-shaped: governance, audit, enterprise. Judges can sell this internally on Monday.
- Dataset requirement is natural (public OWASP ASVS, OpenAPI, RFC, PCI excerpts — no PI).
- Bob is the auditor. Your HTML is a renderer. Wrapper-proof.

**Bob 2.0 usage (must be on camera)**
- Document understanding: `@pci-dss-excerpt.pdf` / `@asvs-v4.md`
- Custom mode: `Compliance Officer` (read-heavy, no drive-by refactors)
- Skill: `.bob/skills/redline/SKILL.md` + clause schema + severity guide
- Explore subagents: map clauses → symbols
- General subagents (parallel): write characterization tests, propose fixes, update the scorecard JSON
- Sensors: `pytest` / `npm test` must go red for a planted violation, then green after the fix
- Output: `redline/scorecard.json` → static HTML wall

**48h path (ruthless)**
- Hours 0–4: fork a real-looking payments/API repo. Plant 8–12 spec violations. Write the spec PDF (10–15 MUST clauses, not 400).
- Hours 4–10: skill + mode + `AGENTS.md` + JSON schema for the scorecard.
- Hours 10–18: **one** gold Bob session that produces a correct `scorecard.json`. Guard the Bobcoins. Rollback, don't argue.
- Hours 18–28: the wall (static HTML, no auth, no DB). Big type. Red is red.
- Hours 28–36: click-to-fix loop: one clause, Bob spawns 2 subagents, tests flip.
- Hours 36–42: README, `bob_sessions` PNGs, video.
- Hours 42–48: buffer. You will need it.

**Kill risks:** PDF parsing is flaky — also `@` a markdown extract of the same spec so the demo cannot die. Do not build a clause editor. Do not support 12 frameworks.

---

### 2. DEPARTURES — The release as an airport board

**Artifact:** A FIDS-style departures board. Each "flight" is a service/release. Status: GO / HOLD / CANCELLED. Reason in 8 words. Gate = check that failed.

**Why it wins**
- Instantly readable paused. Emotional ("that's the Friday incident").
- "I need this Monday" is the highest of the four.
- Maps to release/deploy (brief) without looking like the appendix example.

**Bob 2.0 usage**
- Document understanding: release runbook PDF + last incident postmortem
- Deterministic sensors first (tests, migration presence, changelog non-empty, dep audit) — this is how Bob v2 workflows are supposed to work
- Parallel subagents: changelog, deps, migrations, feature flags
- Skill `departures` writes `board.json`
- Custom mode `Release Captain`

**48h path:** Easier than Redline. The board is CSS. The intelligence is scripts + one Bob session summarizing *why* HOLD. Plant a missing migration. That's the money clip.

**Kill risks:** Looks like a CI dashboard if the visual is lazy. If it doesn't look like an *airport*, don't bother. StoreGreen already owns "preflight." Differentiate with the board + the runbook-PDF → HOLD reason.

---

### 3. BLACKBOX — Incident as an NTSB accident report

**Artifact:** A one-page aviation accident report: timeline, probable cause, contributing factors, the 2-line fix, the test that would have caught it, sign-off.

**Why it wins**
- Emotional. Surprising. Pedigree had a passport; you have a crash report.
- Document understanding of logs + runbooks is a clean Bob demo.
- Quantifies MTTR, which judges already believe is a problem.

**Bob 2.0 usage**
- `@crash.log` + `@runbook.pdf`
- Parallel: log-parser (explore), blast-radius (explore), test-writer (general), patcher (general)
- Skill `blackbox` enforces the report schema
- Mode `Incident Commander`

**48h path:** Pre-bake a broken sample app + a realistic log. The RCA **must be obviously correct** on camera. If Bob hallucinates the cause, the demo dies. Plant a loud NPE / bad config. Do not demo a heisenbug.

**Kill risks:** Last cycle had OpsPilot (autonomous SRE). You lose if this looks like "AI SRE platform." You win if it looks like **a report that did not exist this morning**, produced inside Bob, on a real repo. No separate SaaS. No agent swarm dashboard.

---

### 4. THE BENCH — Four specialists, one court order

**Artifact:** Four judge cards (Security, Contracts, Tests, Docs) stamped PASS / HOLD / BLOCK, then a one-page **Order of the Court** with file:line citations.

**Why it wins**
- The parallel-subagents panel *is* the product. This is the most literal Bob 2.0 feature demo.
- Three-word stamps (Verdict energy).
- Fastest of the four to ship.

**Bob 2.0 usage**
- Four named subagents spawned together (the collapsible panel is the hero shot)
- Four skills, one custom mode `Chief Justice`
- Sensors: semgrep / tests / OpenAPI diff — computational, not "the LLM reviewed itself"
- Output: `order.md` + HTML stamps

**48h path:** Almost too easy. That's the trap.

**Kill risks:** This **is** appendix example #2 (intelligent code review). Originality score gets hammered unless the court visual is 10/10 **and** at least one judge is a non-LLM sensor (AST, typeshed, coverage delta — Verdict's lesson). If all four judges are just four prompts, you are a wrapper with extra CSS.

---

## 3. 30-second pitches a judge says to another judge

These are not your voiceover. This is what you want them to repeat in the room.

**REDLINE.**
"They dropped an 80-page spec on a real payments repo and every MUST clause went red or green with file and line. Then Bob spawned three subagents and fixed two of the reds while we watched. Two-day audit in four minutes."

**DEPARTURES.**
"Their release board looks like an airport. The flight went HOLD because of a missing migration Bob found from the runbook PDF. That's the Friday outage you didn't have. Seventy seconds."

**BLACKBOX.**
"They pasted a crash log and got an accident report — timeline, probable cause, the two-line fix, and a test that would have caught it. Six minutes. It looks like the NTSB."

**THE BENCH.**
"Four Bob subagents reviewed the PR in parallel — security, contracts, tests, docs — and stamped a one-page court order. Not forty comments. One BLOCK with a citation. Ninety seconds."

If a teammate cannot say the pitch without notes, the product is not simple enough.

---

## 4. Cool ideas that lose because Bob is a wrapper

If you can swap Bob for Cursor and the demo still works, you lose **Application of Technology**. Eligibility requires Bob IDE as a core component. Judges will smell these:

| Idea | Why it dies |
|---|---|
| Chatbot UI that "talks to the repo" | That's Bob's chat. You built a skin. |
| "We used Bob to generate our app" | Bob is the intern, not the product. |
| watsonx Orchestrate as the demo | Optional extra. If Orchestrate is the hero, Bob is a footnote. Use it only to *route the artifact* (red clause → ticket). |
| Architecture-diagram generator | Official Bob tutorial. Looks like you followed the homework. |
| Generic test generator | Official Java unit-test workflow. Same problem. |
| RAG over Confluence | Document understanding without a named artifact is a chatbot. |
| "AI onboarding assistant" with a chat window | Appendix example #1 × 500 teams. No visual. |
| Multi-agent dashboard with swarm graphs | Looks like every 2025 hackathon. IBM wants the IDE, not your React canvas. |
| VS Code extension that calls an LLM | Wrong IDE. Must be Bob IDE on camera. |
| Fine-tuned model / Prompt Lab showcase | That's watsonx.ai, not Bob. |
| Beautiful SaaS with auth, billing, teams | 48h tax. The visual and the Bob session suffer. |

**The harness test (pass this or don't submit):**
Your repo contains guides Bob did not have yesterday (`SKILL.md`, custom mode, `AGENTS.md`) and sensors Bob can run (tests, scripts, hooks). Bob produces a **structured artifact** your UI only renders. The before/after is a **real sample project**, not the UI.

---

## Competition graveyard (do not "improve" the appendix)

The guide literally lists: onboarding, code review, testing, release, modernization. Treat those as **genres**, not ideas. Pedigree was "governance," not "code review." StoreGreen was "release," but the visual was a store reviewer.

| Appendix bait | Only viable if… |
|---|---|
| Onboarding | You invent a Mission Brief as physical as a NASA flight plan. Chat onboarding = death. |
| Code review | You have a non-LLM sensor + a 3-word stamp. Otherwise Verdict already won this. |
| Testing | You show a visual coverage/mutation story, not "Bob wrote tests." |
| Release | DEPARTURES. Nothing else. |
| Modernization | Only if you have a shocking before/after on real legacy. 48h is too short unless the sample is pre-chosen and tiny. |

---

## Constraints that kill sloppy teams

- **40 Bobcoins.** One gold-path session. Split explore / plan / implement / verify into separate chats (Bob's own best practice — context is the scarce resource). Rollback, don't argue. Do not burn the budget regenerating the README.
- **`bob_sessions/` PNGs are a deliverable.** Screenshot the *interesting* tasks (subagents, PDF, skill activation), not "fix typo."
- **Dataset:** public specs/logs you generated. No PI, no client data, no social. Keep a source list.
- **Working prototype on a real or sample project** — the sample project is half the demo. Spend time making it look like a company, not a tutorial.

---

## Decision

Build **REDLINE**.

- Highest originality vs the appendix.
- Best use of the feature the brief named (document understanding) plus the feature Bob 2.0 sold (parallel subagents).
- Best "judge tweets one screenshot" visual after Pedigree's passport.
- Honest 48h scope: JSON + static HTML + one planted repo + one gold Bob session.

Ship DEPARTURES only if PDF-to-clause mapping is broken on day 1 and cannot be saved with a markdown extract. Do not hedge by building two products.

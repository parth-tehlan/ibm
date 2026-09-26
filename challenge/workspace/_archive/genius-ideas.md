# Genius ideas to win IBM Bob 2.0

**Date:** 2026-09-25  
**Event:** IBM Bob 2.0 Hackathon (lablab.ai) · 48h · deadline Sep 27 11:00 AM EDT  
**Prize:** ~$12,000  
**Judging:** Application of Technology · Originality · Business Value · Presentation  

This memo synthesizes five parallel research tracks: last-hackathon white space, Bob-native architecture, IBM enterprise buyers, 2026 AI-coding hangover, and judge-demo psychology.

---

## How you actually win

Last cycle (May 2026) **Pedigree** won with one tweetable object: a **Code Passport** for AI-authored lines. Hundreds of teams shipped “paste a GitHub URL, get a report.” Those lose again.

This cycle the brief *names* the features they want to see: **Agent mode, parallel tasks, subagents, document understanding**. The product must **live inside Bob IDE** (skills, custom modes, tool-walled personas, MCP, hooks, rollback) — not a Streamlit skin over an LLM.

**Winning formula**

1. One named artifact a judge can screenshot (the Code Passport test).
2. Bob IDE on camera for 30+ seconds doing parallel subagent work, `@`-ing a real PDF.
3. A structural constraint (a mode that *cannot* cheat) is the product, not a chatbot.
4. Before → after on a planted sample repo. Three numbers, not adjectives.
5. Opposite of the appendix bait (onboarding, generic review, test generators, release notes).

**Kill list:** paste-URL onboarding, PR risk scores, blast-radius clones, auto test/docs generators, HIPAA/EU-AI-Act scanners, COBOL→TypeScript toys, “we used Bob to build our app.”

---

## The 2026 thesis (all tracks agreed)

Coding is no longer the bottleneck. Agents write most of the diffs. The new tax is **believing, owning, and being allowed to ship** that code.

DORA already measured the hangover: review time **+91%**, PR size **+154%**, bugs **+9%**. Tests written by the same model that wrote the code stay green when you flip a comparator. Specs, OpenAPI, READMEs, and runbooks become four independent liars. CAB still runs on Word.

Pedigree answered *who wrote this line*.  
**This year answers: who is lying, and who is allowed to act.**

---

## Ranked shortlist — build ONE

### 1. REDLINE — **build this**
**Tagline:** *The spec is the law. The repo is the defendant.*

Drop an 80-page spec / RFC / policy / OpenAPI / ASVS PDF onto a real repo. Isolated **Witness** subagents that **cannot see `src/`** extract every MUST clause and write characterization tests from the document alone. Implementation is cross-examined. Visual: a **clause wall** — every MUST is red / yellow / green with `file:line`. Click a red clause → failing test + patch. Human picks which side is truth. Bob patches the perjurer.

| | |
|---|---|
| **Workflow** | Testing + review + release (permission to ship) |
| **Pain** | AI patches the handler and the tests together. Coverage 94%. Behavior is wrong vs the spec nobody re-read. Audits still take two days. |
| **Bob-native** | Document understanding (`@spec.pdf`). Custom mode `Compliance Officer` (read + skills + subagents; cannot edit `src/`). Skill `redline`. Parallel Witness / Mutineer / Surgeon subagents. `.bobignore` of `src/` on the Witness (if the Witness can see code, the product is broken). Rollback before surgeon. |
| **IBM angle** | Governance without being a HIPAA clone. Evidence pack Internal Audit would open. Optional Granite residual-risk paragraph. Optional Orchestrate: red clause → CAB ticket. |
| **Demo hook** | “They dropped an 80-page spec on a payments repo and every MUST went red or green with file and line. Then three subagents fixed two reds while we watched. Two-day audit in four minutes.” |
| **48h** | Plant 8–12 violations in a fake payments API. One gold Bob session. Static HTML clause wall. Keep a markdown extract of the spec so a flaky PDF cannot kill the demo. |
| **Dataset** | OWASP ASVS / OpenAPI / RFC 2119-style synthetic spec. No PI. |
| **Why original** | Appendix #1–5 are chatbots over the repo. This is the *document* as a first-class citizen — the feature the brief named and almost nobody will actually demo. |

**Judge-tweet test:** one paused frame of the clause wall.

---

### 2. SPLITBRAIN
**Tagline:** *Never let the same model grade its own homework.*

A Witness subagent is physically forbidden from reading `src/`. It only sees the policy. A Mutineer injects mutants. A Liar-finder greps tautologies (`expect(fn(x)).toEqual(fn(x))`). Parent publishes a **Trust Gap**. Human picks the behavior; Bob patches tests.

| | |
|---|---|
| **Workflow** | Testing |
| **Pain** | Autonoma (2026): coverage-shaped tests. Saturated “test generators” *are* this failure mode. Flip `>=` to `>`; suite stays green. |
| **Bob-native** | Isolated subagents + `.bobignore` as a *correctness property*, not context hygiene. Skill `splitbrain`. |
| **Demo** | `pricing.py` stacks discounts; policy says “single best, never stack.” BEFORE: flip a comparator, all green. AFTER: Witness writes `expect(discount).toBe(0.15)` and it **fails**. Mutation 11% → 81%. |
| **Why original** | Exact opposite of appendix #3. Uses Bob’s isolation as a security boundary. |
| **Risk** | Less “IBM enterprise” visual than Redline unless you render a Trust Gap dashboard. **Fold the Witness mechanic into Redline.** |

---

### 3. WARPATH
**Tagline:** *Paste a stack trace. Bob stands up a war room.*

Custom modes are the org chart: Incident Commander (cannot touch `src/`), Forensic Explorers (read-only, parallel), Patch Surgeon (`src/` + `test/` only), Comms Officer (markdown only). MCP serves **fixtures**, not live Datadog. Runbook PDF is consumed *during* the incident.

| | |
|---|---|
| **Workflow** | Debugging / on-call |
| **Pain** | 14 hours debugging what an agent wrote in 14 seconds. Blame is `ibm-bob`. |
| **Demo** | Red terminal → four explorers in the parallel panel (the screenshot) → RCA cites runbook PDF → fix + test + postmortem. Overlay *47 min → 82 sec*. |
| **Why original** | Last year explained stack traces. This is a live incident *org* whose walls are modes + hooks. |
| **Risk** | Last cycle had OpsPilot / Incident Commander clones. You win only if the **parallel panel + runbook PDF + mode walls** are on camera. Lose if it looks like a SaaS agent swarm. |

---

### 4. DEPARTURES / LAUNCHCODES
**Tagline:** *Release as an airport board. The captain cannot write application code.*

FIDS board: each service is a flight. **GO / HOLD / CANCELLED.** Reason in eight words. Mode `release-captain` is structurally forbidden from editing `src/`. Parallel gates: tests, migrations, CVE, changelog vs runtime behavior, runbook completeness. Silent behavior (TTL 24h→15m, flag default flip) is first-class.

| | |
|---|---|
| **Workflow** | Release & deployment |
| **Pain** | Changelog is generated from commit messages that were generated. “Improved authentication.” Customers locked out. |
| **Demo** | Looks shippable → HOLD because missing down-migration Bob found from the runbook PDF. “Just publish it” **blocked by hook**. |
| **Why original** | Appendix #4 is release *notes*. This is permission to ship, with a visual. |
| **Risk** | Looks like a CI dashboard if it doesn’t look like an *airport*. StoreGreen already owns “preflight.” |

---

### 5. CHANGEFORGE
**Tagline:** *The CAB pack for agent-authored changes.*

Bob reads RFC PDF + ADR set + runbook + ticket. Parallel subagents: blast radius, runbook delta, rollback, test gaps, interface conflict. Writes the patch + updated runbook + `evidence/CHG-xxxx/`. Granite classifies Standard / Normal / Emergency. Orchestrate is the gated business process. Merge cannot open on Block.

| | |
|---|---|
| **Workflow** | Release / change management |
| **Buyer** | VP Eng + Change Manager at a bank. Internal Audit: “agents are not in the change model.” |
| **Demo** | Ticket “rate-limit ACH before 17:00 cutoff” → pack cites ICD + runbook rollback → Path B: dual-write contradicts ADR-003, **blocked**. |
| **Why IBM would productize it** | Concert’s missing SDLC action layer. ~80% of unplanned downtime is change-related. |
| **Risk** | Heavier 48h. Orchestrate provisioning may slip — ship a FastAPI state machine with the same states. **Steal the evidence-pack into Redline rather than building this whole product.** |

---

### 6. LOADBEARING (strong runner-up mechanic)
**Tagline:** *Protect the walls agents keep knocking through.*

A short, testable constitution (`LOADBEARING.md`). Custom **Architect** mode can only edit the constitution. A **Veto** subagent sees the diff, *not* the implementer’s rationale. Parallel tasks that invent two payment clients do not merge. Every fired veto becomes a new clause.

Use as Redline’s “Architect” mode, not a standalone submission.

---

### 7–10. Do not start here (good, but lose the originality or demo war)

| Idea | Why not #1 |
|---|---|
| **TRIBUNAL** (four judges, court order) | Appendix #2 unless one judge is a non-LLM sensor. |
| **CANON** (four witnesses: code/spec/docs/tests) | Fold into Redline. |
| **ANNEX** (strangler fig with write-walls) | Official modernization tutorial adjacent. |
| **Agent Ledger** (control plane for coding agents) | Highest 2026 CISO story; more platform than plot. Embed as `provenance.json` in the evidence pack. |
| **TraceLock** (ISO 26262 REQ matrix) | Looks like “we generated Excel” unless the blocked unsafe optimization is brutal. |
| **NIGHTSHIFT / BLACKBOX** | Warpath with different costume. |
| **SHIPFACTS** | Fold into Departures. |

---

## Recommended product: REDLINE (with Splitbrain Witness + CAB evidence pack)

One repo. One visual. Three IBM talking points.

```
redline/
  sample/northstar-pay/          planted payments API
  docs/spec.pdf                  RFC-2119 MUSTs (also spec.md fallback)
  docs/runbook.pdf
  .bob/skills/redline/
  .bob/modes/compliance-officer  cannot edit src/
  .bob/modes/witness             .bobignore src/
  .bob/modes/surgeon             src/ + test/ only
  evidence/                      clause wall JSON + CAB pack
  clause-wall/                   static HTML
  bob_sessions/                  required PNGs
```

**The 90-second demo (do not improvise)**

| Time | Shot |
|---|---|
| 0:00–0:08 | Clause wall, full screen. “The spec is the law.” |
| 0:08–0:22 | Northstar Pay. Human drowning in a 2-day audit. |
| 0:22–0:55 | **Bob IDE, do not cut.** `@spec.pdf`. Skill `redline`. Parallel Witness / Mutineer / Surgeon. |
| 0:55–1:18 | Click one red MUST → `file:line` + failing test. Surgeon patches. Green. |
| 1:18–1:38 | 2 days → 4 min. 23/41 clauses failing → 2 remaining, both waived with evidence. |
| 1:38–1:52 | README, `.bob/skills/`, custom mode, `bob_sessions/` PNGs. |
| 1:52–2:00 | Repeat the hook. End on the wall. |

**Coin rule:** author `.bob/` outside Bob. Spend the 40 Bobcoins on 2–3 gold-path rehearsals. Explore / plan / implement / verify in **separate chats**. MCP serves fixtures, not the internet.

**Harness test:** if you can swap Bob for Cursor and the demo still works, you lose Application of Technology.

---

## If Redline’s PDF mapping dies on day 1

Fall back to **WARPATH** (parallel-panel screenshot is almost as sticky) or **DEPARTURES** (airport board). Keep the Witness isolation mechanic in all three.

---

## Sources in this folder

- `winning-ideas.md` — Bob-native architectures (Warpath, Tribunal, Launchcodes, Annex, Harness)
- `enterprise-ibm-angle.md` — ChangeForge, Agent Ledger, TraceLock, Z-Edge, HashiPreflight
- `2026-developer-pain-research.md` — Splitbrain, Nightshift, Canon, Loadbearing, Shipfacts
- `demo-strategy.md` — 2-minute shot list, wrapper kill-list

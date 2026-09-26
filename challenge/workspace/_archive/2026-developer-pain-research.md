# 2026 Developer Pain Research
## AI coding assistants did not just fail to solve old problems. They manufactured new ones.

**Thesis:** The 2026 bottleneck is no longer "write the code." It is *believing* the code, *owning* the code, and *stopping* the code from lying to you. IBM Bob 2.0's actual superpower is not generation — it is **isolated subagents, parallel tasks, and document understanding**. The winning products use those as *adversarial architecture*, not as a faster intern.

**Hard constraints (do not violate):**
- Original vs May 2026 **Pedigree** (provenance won — do not rebuild "who wrote this line")
- Saturated: onboarding dashboards, PR risk scores, test generators, architecture-diagram generators, "smart" release-note writers
- Must improve a named workflow: debug / review / test / maintain / release / onboard
- Must use Agent mode, subagents, parallel tasks, document understanding
- Must demo BEFORE vs AFTER on a sample project in **2 minutes**

---

## The evidence (why these pains are real, not vibes)

| Signal | What it actually says |
|---|---|
| Google DORA 2025 | 90% AI-adoption increase correlates with **+9% bug rate, +91% code-review time, +154% PR size** |
| GitClear (211M LOC, 2020–2024) | Churn doubled; refactoring 25% → <10%; copy/paste 8.3% → 12.3% |
| Apiiro, Sep 2025 | **10×** new security findings in 6 months; privilege-escalation paths **+322%**; architectural design flaws **+153%** |
| CodeRabbit | AI PRs: **1.75×** more logic errors, **1.57×** more security findings, **2.74×** more XSS |
| Cortex 2026 Benchmark | PRs/author **+20%**, incidents/PR **+23.5%**, change-failure **~+30%** |
| LinearB | **67.3%** of AI-generated PRs rejected vs **15.6%** of human PRs |
| METR | Experienced maintainers **19% slower** with AI, while believing they were 20% faster |
| Veracode 2025 | **45%** of AI-generated code vulnerable (OWASP Top 10); Java >70% |
| Stack Overflow 2025 | **84%** use or plan to use AI assistants; **72%** say vibe-coding is **not** professional work |
| MCP 2026 | **82%** of MCP servers vulnerable to path traversal; **8.5%** using OAuth; over-privilege is the default |
| Yegge / Beads | Agents have **no memory between sessions** ("50 First Dates"); they rewrite architecture every morning |
| Thoughtworks (Boeckeler) | "GenAI amplifies indiscriminately." Death by 1,000 paper cuts until **AIs can no longer build on the code** |

The pattern underneath every row: **velocity moved to generation; verification, memory, and authority did not.**

---

## What we are *not* building (and why)

| Tempting idea | Why it's dead |
|---|---|
| Onboarding dashboard / "explain the repo" | Example use-case #1 in the official guide. Every team has one. |
| PR risk score / "smart review" | Example use-case #2. Qodo, CodeRabbit, Kusari already own the category. |
| Test generator | Example use-case #3. **This is the disease.** Generators write coverage-shaped tests that ratify bugs. |
| Auto release notes | Example use-case #4. The notes are written by the same model that wrote the code. Nobody believes them. |
| Architecture diagrams | Bob already ships a tutorial for this. Diagrams of a landfill are still a landfill. |
| Provenance / Pedigree 2.0 | May 2026 winner. "Who generated this line" is solved-enough. The 2026 question is **"which artifact is lying."** |

---

## The 5 sharpest pains, and the products

One sample repo, five wounds: **Cartwright** — a small checkout/payments API that looks like a 2026 AI-assisted codebase (high coverage, three payment abstractions, a README from last month, a changelog that says "improvements").

---

### 1. SPLITBRAIN
**Tagline:** *Never let the same model grade its own homework.*

**Pain it attacks:** Silent behavioral regressions that tests miss — because the tests were written by the same agent that wrote the bug.

**Workflow:** Testing.

**Why this is an AI-created wound:** Pre-AI, a human wrote the code and a different human (or at least a different sitting) wrote the test. In 2026 the same reasoning process produces both. The generator reads the function, copies its current return value into the assertion, and CI goes green. Mutation testing then reveals the suite would not catch a flipped comparison. Autonoma (Jun 2026) named this precisely: *coverage-shaped vs behavior-shaped*. Test generators — the saturated category — **made this worse**.

**Product idea:** A Bob skill + custom mode that **physically isolates** the test-writer from the implementation.

**How Bob 2.0 is the core, not a wrapper:**

1. **Deterministic prep (0 tokens):** collect the ticket, pricing PDF / OpenAPI / ADR, and the list of changed public functions. No model.
2. **Agent mode** orchestrates three parallel **subagents with isolated context** (this is the product):
   - **Witness** (`explore` subagent, `fork_context: false`): sees **only** the spec documents. Forbidden from reading implementation. Writes behavior-shaped tests and property cases from the business rule.
   - **Mutineer** (`general` subagent): takes the existing (AI-written) test suite, injects mutants into the implementation (flip comparators, off-by-ones, invert booleans), reports mutation score.
   - **Liar-finder** (`explore` subagent): greps the existing tests for tautologies (`expect(fn(x)).toEqual(fn(x))`, snapshots of whatever the code returned, asserts on "does not throw").
3. Parent agent **cross-examines**. It does not "generate more tests." It produces a **Trust Gap** report: spec clauses with no failing test, mutants the suite cannot kill, tautological assertions.
4. Human picks the canon behavior. Bob (rollback-safe) patches tests, not just code.
5. A **Skill** (`.bob/skills/splitbrain/SKILL.md`) makes this the default on every PR that touches business logic.

**The Bob-native insight:** Subagent isolation is not context hygiene. It is a **correctness boundary**. If the Witness can `read_file` the implementation, the product is broken. Mode restrictions + `.bobignore` of `src/` for the Witness agent enforce this.

**2-minute demo (Cartwright):**

- **BEFORE (0:00–0:40):** Show `pricing.py` — volume discount stacking. Coverage 94%. Flip `>=` to `>`. Run tests. **All green.** Point at the AI-generated test: `expect(discount(cart)).toBe(pricing.discount(cart))`.
- **AFTER (0:40–2:00):** Run `/splitbrain`. Parallel subagent panel lights up. Witness, which only read `PRICING_POLICY.md` ("discounts do not stack; take the single best"), writes `expect(discount).toBe(0.15)` and it **fails**. Mutineer: mutation score **11% → after fix 81%**. Trust Gap: "3 tautologies, 1 spec clause untested, 7 surviving mutants in money math."

**Impact to claim:** Green no longer means "the model agreed with itself." Catch the class of bugs QA still finds after 94% coverage.

**Do not call it:** a test generator. Call it a **test adversary**.

---

### 2. NIGHTSHIFT
**Tagline:** *Own the code you didn't write — at 2am, in 90 seconds.*

**Pain it attacks:** On-call for AI-authored code. The 14-hour debug of a 14-second generation. Git blame is `ibm-bob` / `cursor-agent`. No mental model, no owner, no "why."

**Workflow:** Debugging (incident / on-call). Also maintenance.

**Why this is an AI-created wound:** Pre-AI, the person who got paged had usually written the code, or sat next to the person who did. In 2026 a junior accepted a 400-line agent patch on Friday; Saturday the retry loop thunders a partner API and takes down checkout. The "senior" who would have remembered the invariant is an LLM that compacted the session and forgot. Knowledge silo + ownership collapse in one pager.

**Product idea:** An incident **handoff brief**, not an explainer chatbot. Reconstruct *intent, blast radius, and the one safe knob*.

**How Bob 2.0 is the core:**

1. **Document understanding** of runbook, past incident notes, ADRs, `AGENTS.md`, the original PR description (often itself AI-written — treat as a claim, not truth).
2. Agent mode spawns parallel **explore** subagents (read-only, cheap model):
   - **Blast:** symbol → callers → queues → partner APIs → feature flags. Produce a blast-radius graph of the failing path only (not the whole repo — token diet).
   - **Seance:** reconstruct why this code exists from commit messages, leftover comments, adjacent files, and "TODO added by agent." Extract the *hypothesis the generating agent believed*.
   - **Invariant:** find the last human-reviewed rule this code was supposed to preserve ("retries live at the gateway, never in the service").
3. Parent agent writes a one-page **NightShift Brief**:
   - What it thinks it does vs what it does on the failing input
   - The 3 knobs that are safe at 2am
   - The 1 that is not (shared circuit breaker, money path, auth)
   - A proposed rollback vs surgical patch, using Bob **Rollback** as the default
4. After the incident, a subagent **lands the plane**: writes a durable Decision Record into git so the next session is not 50 First Dates. This is the knowledge-silo fix, attached to the pager, not an onboarding dashboard.

**2-minute demo (Cartwright):**

- **BEFORE:** Pager: `checkout p95 12s, partner 429s`. Engineer greps 40 AI-generated files. Retry in the service, retry in the SDK, retry at the gateway. Nobody knows which one is new.
- **AFTER:** `/nightshift checkout-latency`. Brief appears: "Local retry added by agent 11 days ago to 'fix flaky 3rd party'. No backoff. Stacks with gateway (3) × SDK (3) = 9× amplification. **Safe: set `LOCAL_RETRY=0`.** Unsafe: touching `CircuitBreaker` (shared with auth). Rollback commit `abc123` is clean." Toggle the flag, p95 recovers. Decision Record committed.

**Impact to claim:** Mean-time-to-first-safe-action, not mean-time-to-explain-the-file.

**Do not call it:** an onboarding assistant or "explain this codebase."

---

### 3. CANON
**Tagline:** *One source of truth. Four witnesses. Cross-examine them.*

**Pain it attacks:** Specs, docs, tests, and code drift independently under AI patches. The agent rewrites the handler and does not touch OpenAPI, README, mocks, or the ticket. Or worse: it *does* rewrite the README to match the bug.

**Workflow:** Application maintenance (also review).

**Why this is an AI-created wound:** Humans were already bad at docs. AI made the **rate of code motion** 10× while the rate of contract motion stayed 1× — except when the agent hallucinates a new contract and writes it into three places inconsistently. "Generate the docs" (saturated) **adds a fifth liar**.

**Product idea:** A **tribunal**, not a writer. Four isolated witnesses produce claim-sets. Canon diffs them. You pick who is telling the truth; Bob patches the perjurers.

**How Bob 2.0 is the core:**

1. Deterministic: detect the contract surface (OpenAPI/GraphQL, README, ADRs, tests, env/flags, Terraform).
2. Four parallel subagents, **each locked to one artifact class** (`.bobignore` the others):
   - **Code witness** — what the handlers actually accept/return
   - **Spec witness** — OpenAPI / proto / JSON schema
   - **Doc witness** — README, runbooks, ADRs (document understanding)
   - **Test witness** — what the tests would still allow
3. Parent agent emits a **Canon Conflict**:
   - Claim: "Auth is JWT"
   - Code: yes (as of Friday)
   - Spec: yes
   - README: "send `X-API-Key`" (3 weeks stale)
   - Tests: still mock API-key header; JWT path untested
   - Git timeline: who moved last (this is *recency of artifact*, not Pedigree's *authorship*)
4. Interactive gate: pick the canon. Bob patches the liars, or reverts the code. Skill makes this a merge gate for any change to a public surface.

**2-minute demo (Cartwright):**

- **BEFORE:** Ship v2.1. Support ticket: "API key stopped working." README still documents it. Tests green (they mock the old header). OpenAPI says JWT.
- **AFTER:** `/canon auth`. Four-column conflict. "Code+OpenAPI moved Friday. README+tests are 22 days stale." One click: patch tests and README to JWT, add a failing test for API-key 401. Or revert the handler. No new prose was generated until a human chose the canon.

**Impact to claim:** Stop shipping "the docs and the code had a meeting and didn't tell each other."

**Vs Pedigree:** Pedigree answers *who generated the line*. Canon answers *which living artifact is currently false*. Different question, different demo.

---

### 4. LOADBEARING
**Tagline:** *Protect the walls agents keep knocking through.*

**Pain it attacks:** Architectural coherence collapse + multi-agent conflicting changes. Locally-sensible patches, globally-incoherent system. Two parallel Bob tasks invent two payment clients and two money types before lunch.

**Workflow:** Code review (the review that happens *before* the PR exists — the veto).

**Why this is an AI-created wound:** A human senior used to be the merge queue. Now 5–10 agents write in parallel (Anthropic's own published workflow; Yegge's Gas Town; Cursor's planner/worker/judge). DORA's +154% PR size is the symptom. The disease is **agents that cannot see each other's abstractions** and a review process that scores "risk" instead of enforcing **invariants**. PR risk scores (saturated) tell you the PR is scary. They do not stop the second `HttpClient` from landing.

**Product idea:** A living **constitution** of load-bearing invariants, plus a **Veto subagent** that is not allowed to implement features — only to refuse them.

**How Bob 2.0 is the core:**

1. Document understanding of ADRs + `AGENTS.md` + existing ports/interfaces → generate `LOADBEARING.md` (short, numbered, testable clauses):
   - Money is integer cents. No floats.
   - All payments go through `PaymentPort`. No new HTTP clients to processors.
   - Authz is in the middleware, never in the handler.
   - Retries live at the gateway.
2. Custom Bob **mode: Architect** — write access only to `LOADBEARING.md` and Decision Records. Cannot ship features.
3. On any Agent-mode implementation (or when two parallel tasks are running):
   - Spawn a **Veto** subagent with the constitution + the diff. Isolated: it does not see the implementer's "rationale" paragraph (that's how agents talk each other into violations).
   - If two parallel tasks conflict (PayPal task creates `PaypalClient`, Refunds task creates `BillingService`), parent **refuses to merge** until a human picks the surviving abstraction; the loser is rewritten onto it.
4. Every fired veto becomes a new clause ("every mistake becomes a rule") — the anti-amnesia mechanism, attached to architecture, not to chat history.
5. Review workflow in Bob becomes: **Veto first, style later.** Humans review only the constitution exceptions.

**2-minute demo (Cartwright):**

- **BEFORE:** Split-screen. Task A: "add PayPal." Task B: "add refunds." Both succeed. Repo now has `PaypalClient` (float dollars) and `RefundService` (integer cents, Stripe-only). Refunds cannot see PayPal. Two money types. Architecture landfill in 8 minutes.
- **AFTER:** Same two tasks under Loadbearing. Veto on Task A: "new HTTP client — use `PaymentPort`." Veto on Task B: "float dollars." Both land on `PaymentPort` + integer cents. Refunds work for PayPal because they never knew a processor name. Constitution gains clause #12: "Processors are adapters, never call sites."

**Impact to claim:** Parallel agents stop being a merge-conflict generator. Review time drops because the scary PRs never form.

**Do not call it:** an architecture diagrammer or a PR risk score.

---

### 5. SHIPFACTS
**Tagline:** *Release notes you can fail a test with.*

**Pain it attacks:** Release notes nobody trusts, because AI wrote the code *and* the notes. "Improved authentication and miscellaneous bug fixes." Compliance, support, and downstream consumers cannot act on prose.

**Workflow:** Release and deployment.

**Why this is an AI-created wound:** Changelogs were always slightly fictional. In 2026 they are **generated from commit messages that were also generated**, summarizing PRs whose descriptions were generated, for code nobody read. Example use-case #4 in the official guide is "generate release notes." That is the failure mode, productized. The Cortex number (change-failure +30%) is what happens when you ship on a story.

**Product idea:** A **behavioral changelog**: user-visible facts with a reproducing command. If the command's output doesn't match the fact, the note is a lie and the release is blocked.

**How Bob 2.0 is the core:**

1. Deterministic: diff public surface between tags — OpenAPI, CLI flags, env vars, feature-flag defaults, HTTP status mappings, file formats. Zero tokens.
2. Parallel subagents:
   - **Surface:** the deterministic diff, explained.
   - **Behavior:** characterization of changed code paths (what happens to a request that used to work).
   - **Claim-check:** document understanding of tickets + AI-written PR bodies vs the surface diff. Flag "PR said X, runtime says Y."
3. Output is `SHIPFACTS.md` + a **release test file**:
   - `API keys now return 401. Repro: curl -H 'X-API-Key: …' → 401`
   - `Session TTL 24h → 15m. Repro: decode exp`
   - `legacy_auth default flipped false. Repro: unset flag, old client fails`
   - Silent: "retry budget 3 → 9. Not in the PR description."
4. Release skill: the facts **must run green against staging**. If a fact cannot be reproduced, it cannot be published. Support gets the same file. Marketing can paraphrase; they cannot invent.

**2-minute demo (Cartwright):**

- **BEFORE:** v2.1 changelog (AI): "Improved authentication, performance, and bug fixes." Customer Slack: "you locked us out."
- **AFTER:** `/shipfacts v2.0 v2.1`. Facts:
  1. Breaking: JWT required, API keys 401. `curl` shown live.
  2. Silent: session TTL 24h → 15m.
  3. Silent: `legacy_auth` default false.
  4. Claim-check: PR #412 said "backwards compatible." **False.**
- Release is blocked until the breaking fact is in the notes and a migration flag is documented. Notes and code can no longer diverge.

**Impact to claim:** Trustworthy releases. Support stops using the changelog as fiction. Change-failure drops because silent breaks become visible *before* the tag.

**Do not call it:** a release-note generator.

---

## Honorable mention (build this if you want the 2026 landmine)

### LEASH — *Your agent can fetch. It cannot run off with production.*

**Pain:** MCP + auto-approve + developer-admin tokens. 82% of MCP servers path-traversal-vulnerable. Agents asked to "fix a flaky test" dump `users`, commit `.env`, or follow a poisoned README. This is not AppSec of the *code*. It is AppSec of the *session*.

**Workflow:** Review of agent permissions (maps to release of MCP config, and to debug).

**Bob-native:** Document understanding of MCP configs, `.bobignore`, auto-approve settings. A **policy rehearsal** subagent proposes the least tool set for *this task*. A **red-team** subagent tries to jailbreak it (prompt injection via README, malicious tool descriptor, path traversal). Human approves a session leash. Transcript of blocked calls is the demo.

**2-minute demo:** "fix flaky test" with GitHub+Postgres+fs MCP. BEFORE: agent SELECTs users, writes `.env`. AFTER: leash allows `pytest` + 2 files; red-team's `SELECT * FROM users` is denied; 2 blocked calls in the transcript.

Skip as a primary if the judges read it as "yet another security scanner." It is not — it scans the **agent**, not the repo — but you must say that in the first 10 seconds.

---

## Token cost / context rot (do not productize alone; bake into all five)

Repo-aware agents are expensive and they **forget**. Chroma: a 200K window degrades by 50K. Compaction drops the ADR in the middle. Bobcoins (40 for this hackathon) make this locally painful.

**Principle, not a product:** every idea above starts with **deterministic, zero-token steps**, then isolated subagents on a diet context. Bobalytics is the before/after cost slide. "Ration" as a sixth product is too infra; as an implementation rule it makes the other five cheaper and more correct.

---

## If you can only build one for the hackathon

**Build SPLITBRAIN.**

| Criterion | Why SplitBrain wins |
|---|---|
| Original vs Pedigree | Opposite of provenance. Isolation of *witnesses*, not lineage of *lines*. |
| Unsaturated | The market is drowning in test *generators*. An adversary is a different category. |
| Bob as core | Isolated subagents are the product. If you remove Bob, you cannot enforce the Witness-never-sees-src boundary as cleanly in a 2-minute IDE demo. |
| 2-minute demo | Flip a comparator → suite stays green → Witness test goes red. Visceral. |
| Multi-step | Deterministic collect → 3 parallel subagents → tribunal → patch → mutation re-score. |
| Dataset | `PRICING_POLICY.md` + a small suite of planted tautological tests + mutants. Fully synthetic, no PI. |
| Opinion | "Test generators are how 2026 teams launder bugs into CI." Memorable. |

**Runner-up:** CANON, if you want a maintenance story and a cleaner Pedigree contrast ("liar vs author").

**Cinematic runner-up:** NIGHTSHIFT, if you want the 2am pager screenshot.

---

## Cartwright — one sample project, five wounds

A tiny checkout API (Python or Node) you can seed in an afternoon:

| Wound | File | Planted lie |
|---|---|---|
| SplitBrain | `pricing.py` + `test_pricing.py` | Discounts stack; tests assert `fn(x)==fn(x)`; policy PDF says "best single discount" |
| NightShift | `partner_client.py` | Agent-added retry, no backoff, stacks with gateway |
| Canon | `README.md` vs `openapi.yaml` vs `test_auth.py` vs `auth.py` | JWT in code/spec, API key in README and tests |
| Loadbearing | `paypal_client.py` (float) vs `refunds.py` (cents, Stripe-only) | Two payment abstractions, two money types |
| ShipFacts | `CHANGELOG.md` vs actual TTL/flag/auth diffs | "backwards compatible improvements" |
| Leash | `.bob/mcp.json` with Postgres + fs | Auto-approve on, admin DSN in env |

Synthetic policy PDF + OpenAPI + planted tests = the required "bring your own dataset," with no PI, no client data.

---

## Demo script skeleton (any of the five)

```
0:00  Name + tagline. One sentence: "AI created this wound."
0:15  BEFORE on Cartwright. Make the audience feel the lie (green tests / pager / README).
0:45  Run the Bob skill. Show parallel subagents panel (this is the Bob-core shot).
1:15  AFTER artifact (Trust Gap / NightShift Brief / Canon Conflict / Veto / ShipFacts).
1:40  One action (failing spec test, flag flip, pick the canon, refuse the merge, block the tag).
1:55  Impact sentence with a number (mutation 11%→81%, 9× retry, 22-day stale README, two money types, blocked release).
```

The screenshot that must land in `bob_sessions/`: the **parallel subagents panel** with aggregate token cost — proof Bob was the engine, not a mascot.

---

## Sources (primary)

- Mike Mason, *AI Coding Agents in 2026: Coherence Through Orchestration, Not Autonomy* (Jan 2026) — DORA, Yegge/Beads, Cursor browser, Boeckeler, METR
- Kusari, *AI Coding Assistants in 2026: 4× Faster, 10× Riskier* (Jul 2026) — Apiiro, CodeRabbit, slopsquatting, Copilot secret leakage
- Autonoma, *What AI Test Generation Gets Right, and the One Thing It Can't Fix* (Jun 2026) — tautological / coverage-shaped tests
- Heidloff, *Workflows and Sub-Agents in IBM Bob v2* (Jul 2026) — deterministic steps + isolated subagents
- IBM Bob docs: subagents, skills, modes, MCP, rollback, Bobalytics
- Aembit, *MCP Security Vulnerabilities: Complete Guide for 2026* (Mar 2026)
- Practical DevSecOps, *MCP Security Statistics 2026* — 82% path traversal, 8.5% OAuth
- Cortex, *Engineering in the Age of AI: 2026 Benchmark Report*
- GitClear 2020–2024 code-quality study
- METR early-2025 experienced-developer study

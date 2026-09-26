# THREAD: THE UNDERPASS — Infrastructure & Platform Strategy
**IBM Bob 2.0 Hackathon | Round 2 | infra/platform strategist | workspace: bob**

Round 1 converged on **REDLINE** (spec-governance, document-understanding clause wall). This thread **DIFFERS**: it owns the layer *under* the spec — IaC, Kubernetes, migrations, build/CI, secrets & env config, multi-repo consistency, cloud cost.

**The thesis (one sentence for every pitch here):** *Agents now write the Terraform, the Helm chart, the migration file, the `.env`, the CI YAML, and the code in repo N that consumes repo M — and then an AI writes the verification that makes it all look healthy.* In 2026 the infra wound is no longer "someone forgot to config" — it is **the declared state, the deployed state, and the last code that called it have all drifted apart, and every agent is now a co-author of all three.**

**What every idea here refuses to be** (shared with the theme kill-list):
- ❌ A blast-radius / PR-risk clone. Blast radius *predicts what your change might break*. These ideas *prove what is already broken* and gate the merge. Different object, different demo.
- ❌ An incident war-room (round-1 family). These are **pre-merge, pre-deployment gates**, not postmortems.
- ❌ A HIPAA/EU-AI compliance scanner, a COBOL toy, an onboarding dashboard, a docs/test generator.
- ❌ A CI dashboard. Any of these that show a number without a **merge-block the agent physically cannot bypass** is a dashboard, and dashboards lose.

**The shared Bob-core mechanic that makes all five Bob-native (not wrappers):**
1. **Deterministic, zero-token sensors first** — parse `terraform plan -json`, grep env vars, read migration files, parse CI artifacts. No model has touched anything yet.
2. **Parallel subagents, each locked to ONE artifact class via `.bobignore`** (the "resource family" wall for drift, the "one service" wall for env, the "one repo" wall for multi-repo). Isolated context is a *correctness boundary*, not hygiene.
3. **A custom mode that CANNOT write the thing it is auditing** (read-only auditor) + **a Surgeon mode** that can only patch the loser + **hooks** that `exit 2` on a merge/deploy if a gate is red.
4. **Rollback as the default** — every patch is a reversible patch.
5. **A named, tweetable artifact** per product (the Zombie Graveyard, the Drift Wall, the Rollback Proof Card, the Flake Verdict, the Cross-Repo Lens).

---

# THE FIVE IDEAS

---

## 1. ZOMBIE — *The env/secret obituary desk. It buries dead config so nothing ever reads a ghost.*

**12-word pitch:** Traces every env var and secret READ/WRITTEN/DYING across the monorepo; retires zombies safely.

**Pain (with a 2026 stat):** Secrets scanners are the market's favorite *detector* — and GitGuardian's State of Secrets Sprawl 2026 is literally titled around the fact that **detection is not the bottleneck; remediation is**: **64% of secrets confirmed valid in 2022 were STILL valid and exploitable in Jan 2026**, and new hardcoded secrets on public GitHub hit **28.65M in 2025, +34% YoY**, a jump GitGuardian attributes in part to **AI-assisted commits** (a "34% leak share in AI-assisted commits" figure they now track). Teams do not rotate because **they cannot prove what still reads them** — rotating a secret that a 6-month-old service still depends on is an outage. The wound AI made worse: an agent that adds a service copies `.env`, defines a new var, and never removes the dead one; every agent run adds a few more entries to the sprawl and a few more "mystery reads." The single most dangerous object in the monorepo is **a zombie secret: dead to the person who created it, load-bearing to code nobody remembers.**

**Why this is the highest-EV:** remediation is empirically "the industry's limiting factor" (multiple 2026 sources). Nobody owns "the lifecycle of a config key." Env var lifecycle is a *reading problem across N identities* — which is exactly what parallel subagents do well.

**Concrete Bob primitives:**
- **Deterministic sensor (0 tokens):** a local script/library that statically finds every `process.env.X`, `os.getenv`, `getConfig("X")`, `.env*`, secret-store aliases, hardcoded keys, plus a git-history pass for "was ever there" and "last touched by." Emits `env-manifest.json` with one entry per key per file (key, service, read/write/define/used-in-test).
- **Parallel subagents, one per service (`explore`, `.bobignore` the other services):** each returns "this service READS keys {…}, WRITES {…}, DEFINES {…}, and its git history shows last touch." This is the parallel-panel money shot: 6 services, 6 subagents, one panel.
- **A parent agent cross-examines** the manifest into a **lifecycle verdict per key**:
  - `LIVE` (read somewhere, defined somewhere sane)
  - `WRITE-ONLY` (defined, never read — candidate to delete)
  - `READ-ORPHAN` (read but never defined in any env — running off defaults or ghosts)
  - `ZOMBIE` (was once defined, now only dead code / a 6-month-old service / a test still depends on it)
- **Custom mode `gravedigger`:** read+`edit` only files *under* `infra/env-maps/` and `.env` catalogs; **cannot touch service code** — it certifies the retirement, never the code.
- **Custom mode `surgeon`:** `fileRegex` = `src/.*` + `test/.*` only; patches the three callers that actually need the key, or deletes the define.
- **Hooks:** `PreToolUse` `exit 2` if any tool (or the user) attempts to *delete* a key that `env-manifest.json` still marks `READ-ORPHAN` or `ZOMBIE`. The killer: **you literally cannot delete a secret that still has a live reader.**
- **Skill `zombie`:** the pipeline above + the retirement protocol (mark REMOVED → safe-rotate → re-run → confirm no remaining readers → push).

**Judge-screenshot artifact:** the **Zombie Graveyard** — a two-panel HTML. Left: the env/sprawl map (one card per key, colored LIVE / WRITE-ONLY / READ-ORPHAN / ZOMBIE, with the one line of dead-but-load-bearing code that references it). Right: a "Rotation Risk" line — *"rotating `PAYMENTS_TARGET` breaks: [`checkout-fallback.js:41`, `legacy-failover:88`]"* — proving which keys are safe to retire and which are booby-trapped. One red ZOMBIE card with the live reader is the single-paused-frame that explains the product.

**Measurable impact (numbers to claim on the synthetic repo):**
- Sprawl: `~140 env keys` scanned across `6 services` in `~90s` (the before).
- `41` WRITE-ONLY keys identified for cleanup, `9` READ-ORPHANs, `5` ZOMBIEs.
- Rotation-risk resolution: `5` keys that previously *could not* be rotated (outage fear) reduced to `0` blockers because each now has a certified empty-reader graph.
- The "before" number from the wild: GitGuardian's **64%-still-valid-after-4-years** remediation gap → our line: "safe-rotation time per secret: fear-of-outage → certified no-reader."

**48h / 40-coin build path (synthetic sample: `acme-checkout` monorepo):**
| Hours | Work | Coins |
|---|---|---|
| 0–4 | Build `acme-checkout/` monorepo: 6 microservices, 3 `.env` per service, hardcoded key in one, dead var in another, a test that reads an orphan, git history with a "service killed 6 months ago" commit. | 0 |
| 4–9 | Write the deterministic env-scanner (Node/Python, ~150 lines) → `env-manifest.json`. Plant exactly 5 ZOMBIEs with live readers. | 0 |
| 9–14 | `.bob/` pack: skill `zombie`, modes `gravedigger` + `surgeon`, hook script `block-zombie-delete.sh`, `.bobignore` per-service walls for subagents. Author OUTSIDE Bob (save coins). | 0 |
| 14–20 | **One gold Bob rehearsal** on the sample. Tighten skill text. Capture the subagents-panel screenshot. | ~12–15 |
| 20–26 | Zombie Graveyard static HTML (cards + graph). Wire `env-manifest.json` JSON → wall. | ~3 |
| 26–32 | Demo the blocking hook live: attempt to delete a ZOMBIE key → refused. Then Gravedigger + Surgeon retire it → second run shows no readers → delete succeeds. | ~8–10 |
| 32–40 | README, `bob_sessions` PNGs, 90s script, data-source list. | 0 |
| 40–48 | Buffer; collapse to 3 services if flaking. | reserve |

**Originality (honest):** Secret scanners (GitGuardian, TruffleHog, Copilot's own warning) detect *leaks*. This product detects *lifecycle* — READ vs WRITTEN vs DYING — and makes **safe retirement** the merge-blockable event. That is the remediation gap GitGuardian names, not the detection gap they solved. It is not "we built a scanner with an LLM"; the LLM's whole job is the **cross-service reference graph** that deterministic scanners cannot build, and the gate is a hook. Clean vs REDLINE (which owns READABILITY of a spec); this owns **mortality of config**.

**Rank: #1 (WINNER).** Reasons below.

---

## 2. DRIFTLINE — *The declared-state indictment. Every resource family sworn in, cross-examined against reality.*

**12-word pitch:** Parallel subagents on Terraform, Helm, CloudFormation, and k8s audit declared-vs-deployed drift.

**Pain (with a 2026 stat):** The community reality is stark: one 2026 drift guide opens with a production estate that is **83% "unmanaged" and ~3% drifted** even for teams that *believe* they are IaC-managed; drift is routinely called "silent" because `terraform plan` only shows what the *next apply* would change, not what already diverged. AI made this *worse*: agents now generate the Terraform, run `terraform validate` (which passes on local syntax), and merge a change that silently adds `prevent_destroy`-less state or an SG `0.0.0.0/0` — and the agent that wrote it also writes the "it's fine" story. Nobody runs `terraform plan -refresh-only` on every resource family every day because it is a wall of cognition.

**Why this is strong:** it is the literal "parallel subagents on each resource family" brief, it maps to a Monday buyer (Platform/Cloud CoE), and IBM has a HashiCorp estate to sell against. Its risk is looking like REDLINE's clause wall worn as a costume — I differentiate on the *mechanism* (plan/runtime parsing + per-family cross-exam) and the *gate* (you cannot merge a drift-creating plan).

**Concrete Bob primitives:**
- **Deterministic sensor (0 tokens):** ingest previously-snapshot `*plan-last-known.json` + a live `terraform plan -refresh-only -json` fixture + `helm diff` + a `kubectl get ... -o json` snapshot. Normalize into `desired-resources[]` vs `observed-resources[]`.
- **Parallel subagents, one per resource family (`explore`, `.bobignore` everything else):** Network auditor, Compute/EC2, Stateful/DB (terraform only), Workloads (helm/k8s), each returns a per-resource `drift` verdict (unchanged / drifted / only-in-IaC / only-in-cloud) with the **one line of HCL or manifest that disagrees**.
- **Parent agent** produces the **Drift Wall** and a per-resource-family **blame** ("who moved first: the plan or the cloud?" — is the agent's plan lying, or did a console change escape?).
- **Custom mode `registrar`:** the read-only auditor; cannot write any IaC.
- **Custom mode `lineman`:** `fileRegex` = `infra/(terraform|helm|k8s)/.*` only; can patch the drifting declaration (the deterministic reconcile).
- **Hooks:** `PreToolUse` on `terraform apply` / `kubectl apply` / `helm install` — if the Drift Wall for that family has `drifted` entries, **`exit 2`: the agent cannot apply a plan over known drift** (this is the merge/deploy gate). Rollback snapshot before any `lineman` patch.

**Judge-screenshot artifact:** the **Drift Wall** — a per-resource-family board (Networking / Compute / Storage / Workloads) where each resource is a tile: `desired` vs `observed`, the one disagreeing line, and a `DRIFT!` stamp. One tile already applied-by-agent with `0.0.0.0/0` is the money frame.

**Measurable impact:** Audit of `~60 resources` across `4 families` in `~2 min` (before: "nobody runs refresh-only"). `9` drifted, `2` of them security-relevant (`0.0.0.0/0` SG, `prevent_destroy` removed). One **blocked merge/apply**. Demo number: *"drift triage: a full-day `terraform plan -refresh-only` archaeology → under 2 minutes per family, with the gate closed on a live-upstream drift."*

**48h path:** One synthetic infra repo (`acme-infra/`) with terraform modules + one helm chart + a checked-in `refresh-only` plan JSON fixture for each family (so it never depends on live cloud). Plant drift in 2 families. Same `.bob/` shape as ZOMBIE (skill `driftline`, modes, hook). ~10–15 coins for one gold rehearsal.

**Originality (honest):** Tools like Firefly, Spacelift, and Firefly detect drift with dashboards. None present drift as a *merge-block the agent cannot bypass solved by cross-examining one family per isolated subagent*. The distinct mechanism is **allocation of disbelief across families** — deterministic scan, then a *credulous* model per family, then a cross-exam. Risk: if the visual reads as "a CI dashboard," it loses — so the artifact must be a **court docket per family**, not a chart. Pairs beautifully as a fallback because it reuses REDLINE's wall-DNA.

**Rank: #2.**

---

## 3. REVERSE — *Rollback proof required. No proof, no merge.*

**12-word pitch:** Treats a DB migration as a spec, chars the rollback path, and blocks a merge if rollback can't be proven.

**Pain (with a 2026 stat):** Rule of thumb the industry repeats: **~80% of unplanned downtime is change-related**, and the cite that recurs is the **schema migration you cannot reverse on a Friday 17:00** (every migration-horror-story roundup opens with "took production down because the down-migration didn't exist / didn't work"). AI made this *worse*: an agent asked for "migration `004_add_vat_rate`" generates the up-`ALTER` and either skips the down, writes a `down` that references a column that doesn't exist, or writes a `down` that silently drops data — and because the agent also wrote the CI check that runs migrations, the suite goes green. The wound: **modern agents treat migrations as "write the up" and the rollback as an afterthought, then ratify the omission.**

**Why this is strong:** It reuses REDLINE's winning gate mechanic (block the merge) but shifts the subject from *document-understanding of a spec* to *characterizing the down path* — correct, non-HIPAA, correctness-focused. It's a crisp, decisive demo.

**Concrete Bob primitives:**
- **Deterministic sensor (0 tokens):** parse the migration files (Alembic/Knex/Prisma/Rails), extract the exact SQL/ORM ops of `up` and `down`, build a `rollback-graph.json` of (op, reversibility).
- **Parallel subagents:**
  - **Canceller** (sees ONLY the migration file + schema-v-next): can it name, op-for-op, what `down` restores? Flag irreversibles: column-drop with no default, `DELETE` without retention, `RENAME`, `NOT NULL` added with no data fix.
  - **Archive** (sees the schema history + data fixtures): simulate `up` → write rows → `down` → assert the original rows/columns return. Runs a real migration against an in-memory SQLite/Postgres fixture.
  - **Failsafe** (sees the deploy runbook PDF, not the migration): "does the rollback fit inside the documented window / zero-downtime pattern?"
- **Custom mode `paradox`:** the read-only reviewer — **cannot edit migrations** (the product *is* the refusal to silently fix).
- **Custom mode `migrator`:** can only edit migration files (`fileRegex`) — to add the missing down after the human rules it required.
- **Hooks:** `PreToolUse` `exit 2` on the **merge/deploy PR** if any migration has an **unprovable** rollback (Canceller says "can't" OR Archive's `down` failed). Message: *"004 has no provable down. Merging a migration you cannot reverse."* Rollback snapshot before `migrator` edits.

**Judge-screenshot artifact:** the **Rollback Proof Card** — one card per migration. Left: the up-ops. Right: the down-ops, each stamped `PROVEN` (with the simulated restore result) or `UNPROVABLE` (why). The `004` card stamped `UNPROVABLE — down deletes `vat_rate` with no backup` (paused frame).

**Measurable impact:** `6` migrations reviewed; `2` have no working down; `1` (`004`) loses a column with no data fix. **Merge blocked.** Simulated restore for the good ones shows 100% row fidelity. Demo number: *"rollback-proof review: a corridor argument that used to take an afternoon → proven per-migration in ~40s, merge physically refused on the liar."*

**48h path:** Synthetic `acme-ledger/` with Prisma/Alembic migrations + a runbook PDF mentioning zero-downtime. Plant `004` broken, `005` fine. In-memory Postgres via Docker or SQLite for the Archive simulation (fixture-driven, deterministic). ~10–15 coins.

**Originality (honest):** Lighthouse/`prisma migrate status` and tools like `liquibase` *check* rollback exists syntactically. None *prove it works* and then **block the merge on proof**, and none treat the migration as a spec the way round-1 treated the PDF. Distinct from a PR-risk gate because it refuses on *correctness of the down*, never on "is this PR scary." **Risk:** it can be misread as a generic merge gate — the Archive's *simulated restore running live* is what kills that reading, so it must be on camera.

**Rank: #3.**

---

## 4. FLAKEBUST / "FLAKE VERDICT" — *Root-cause the flake to a commit, not to a machine.*

**12-word pitch:** Cross-correlates flaky CI runs with code-change windows to attribute a flake to a commit, not a machine.

**Pain (with a 2026 stat):** Flakiness is epidemic: **13–16% of test failures are flakes (Google/Microsoft/Atlassian)**, **24% of large orgs see >5% of runs non-deterministic**, and flakes **consume up to 20% of CI time**. The wound AI made *worse*: AI PR volume (DORA/LinearB: PRs/author +20%, rejected rates through the roof, PR size +154%) pumps far more commits into CI with far less human "did *this* change break the timing?" — so a flaky `orders.test` that used to be blamed on "the Friday infra hiccup" is now blamed on "the machine," while the real cause was a commit 3 days earlier that shifted shared-state ordering. The cost is **engineers re-running CI 4–5×/day and a merge queue that consumes the wall** — exactly the "vibe" problem that attributes to the wrong object.

**Concrete Bob primitives:**
- **Deterministic sensor (0 tokens):** ingest a checked-in `ci-runs.jsonl` fixture — per run: SHA, changed-files, test outcomes, timing, runner ID, flaky-retry results. No model needed to parse.
- **Parallel subagents (this is the differentiator):**
  - **Commit-window correlator** (`explore`, sees git log + diffs): for each flaky test, which commits landed in the window where it became flaky, and which of *their changed files* touch the test's dependencies (locals/imports, shared fixtures, `.env`, global hooks).
  - **Runner-vs-commit doctor** (`explore`, sees runner metadata + retries): separate "same test fails on *all* runners after SHA X (commit-caused)" from "fails only on runner-D (machine-caused)" — the exact attribution the brief's "not a machine" demands.
  - **Order detective** (`explore`, sees test order + shared state): is the flake an order-dependency that commit Y's new test introduced, or a genuine race?
- **Parent agent** emits a **Flake Verdict** per flaky test: `COMMIT-CAUSED → blame `abc123` (the one line)` | `MACHINE-CAUSED → quarantine to runner pool` | `ORDER-CAUSED → that new test shifted state`.
- **Custom mode `prosecutor`:** read-only; it files the verdict but **cannot patch tests** (so it doesn't "fix" the discovery away).
- **Custom mode `raft-captain` / `test-medic`:** can edit `test/.*` and the CI matrix only — to add the `order`-isolator or quarantine.
- **Hooks:** `PreToolUse` `exit 2` if anyone (agent or user) **marks a flaky test `skip`/quarantine without a filed Verdict** — forces the attribution discipline.

**Judge-screenshot artifact:** the **Flake Courtroom** — a split panel: one flaky test, left column = "commits in the window (with the one diff line)", right column = "runner distribution (same test on 5 runners)". The stamp across: **`COMMIT-CAUSED · blame 8f13ae2 · `orders.lib.ts:42`** — versus a machine-caused one stamped `MACHINE · quarantine`. This is the "not a machine" brief, visualized.

**Measurable impact:** `14` flaky test-milestones from `200` CI runs attributed in `~60s` (before: engineers re-running the queue all day). **`9` blamed on commits, `3` on machine, `2` order-caused**; `4` were previously being dismissed as "infra." CI re-run noise → the queue drains. Demo number: *"flake triage: a week of 'rerun it' → 60s to a commit, on camera."*

**48h path:** Synthetic `acme-orders/` Jest/Playwright + `ci-runs.jsonl` (checked-in, deterministic — no live CI). Plant: one commit that shifts a shared fixture (commit-caused), one runner-specific timezone flake. Same `.bob/` shape. ~8–12 coins.

**Originality (honest):** Flake detection (BuildPulse, Datadog Test Visibility) points at the *test*. The wound is *attribution* — commit vs machine — which the existing tools leave as a human guess, and which AI commit-volume makes un-answerable by eye. This product files a *verdict with a blamed SHA*, and the hook enforces that you can't hide a flake without one. NOT an incident war-room (it's a pre-merge/leave-decorator gate, not a postmortem). **Risk:** if it renders as a chart, it's a dashboard — the *blame-SHA stamp + "can't-skip-without-a-verdict" hook* is what keeps it a product.

**Rank: #4.**

---

## 5. CROSSWIRES — *One repo-mental-model across N repos. Change `lib-x` and it ripples to every consumer, shown as ordinary browsing.*

**12-word pitch:** Presents N repositories as one navigable codebase; every lib change lights up its consumers before you commit.

**Pain (with a 2026 stat):** The DORA/2026 reality: **PR size +154% and refactoring down** (GitClear) because multi-repo change is so cognitively expensive that a change to `lib-shared` is made, compiled locally against *one* consumer, and shipped while the other 11 consumers silently break. In 2026 the wound AI made *worse* is precisely **cross-repo**: an agent working in repo `B` cannot see repo `A` where the API it just changed lives, and it cannot see the `C..H` consumers it just broke — so it "fixes locally, breaks globally" (Yegge's "agents have no memory"; Thoughtworks' "can no longer build on the code"). The expensive part isn't *finding* subscribers (grep). It's *holding the merged mental model* while you change an API and checking every consumer compiles+behaves.

**Reframe defense (this is NOT a blast-radius clone):** Blast radius *predicts* "what might break if you touch X" as a *risk report*. CROSSWIRES does not predict — it gives the developer **navigation into the actual consuming repo** so a change in `lib-x` is *read as if it were a single-repo change*, and the artifact is a **live compile/degradation map you can `go-to-def` through**, not a probability. The moment it becomes "here are 12 repos you might have broken" it's a blast-radius report and we've lost — so the demo must foreground **"this is one repo in the lens,"** i.e. `ctrl-click` a symbol in `lib-x` and *land inside consumer repo `B`*.

**Concrete Bob primitives:**
- **Deterministic sensor (0 tokens):** a workspace-manifest reader (workspace tooling / one symlinked index of N repos) + per-repo import graph + a type-level/compile "interface usage" pass (`getConfig/2`, function signatures, exported types) emitting `crosswire-graph.json`.
- **Parallel subagents, one per consuming repo (`explore`, `.bobignore` all but that repo):** "Given this lib change, does repo `B` still compile / still pass its surface contract?" Each returns `CONTRACT-OK` or a `file:line` breakage.
- **Parent agent** emits the **Cross-Repo Lens**: every consumer is a node; green (compiles) vs red (breaks); each red has the exact call-site.
- **Custom mode `weaver`:** read+`edit` across ALL repos (the only mode that can) — makes the multi-repo patch in one pass, Rollback-enabled.
- **Custom mode `sherpa`:** read-only per-consumer auditor.
- **Hooks:** `PreToolUse` `exit 2` on the *cross-repo publish job / the PR that touches a shared lib* if any consumer's `CONTRACT-OK` is red — **you cannot publish a lib that breaks a consumer** (the honest cross-repo gate).

**Judge-screenshot artifact:** the **Tapestry** — one HTML with `lib-x` at the center and N consumer nodes radiating; red nodes show the broken call-site inline; clicking a red node jumps to the actual file *in the other repo*. The single frame: a change to `lib-shared.getConfig()` and a red `checkout-service` node with `from: 12`.

**Measurable impact:** `1` change to `lib-x` evaluated against `14` consumer repos in `~90s`. `3` consumers would break (compile/contract), `0` of which were caught by the author's local-only build. Cross-repo publish gated. Demo number: *"a single-repo-feeling change across 14 repos, with the merge refused on the 3 it would have broken."*

**48h path:** Synthetic mono-… no, **synthetic N real repos** — a `repos/` folder containing 5–6 tiny repos + one shared `lib-x` (published locally via a module path). Plant one consumer that will break. Avoid the saturation trap by keeping the *publishing gate* (the hook) front-and-center. ~10–15 coins.

**Originality (honest):** Cross-repo "impact" tools are the *blast-radius risk* category — **saturated, and on the kill-list in that costume.** CROSSWIRES survives only as *navigation + a publish gate*, not a risk report. That is genuinely different (it is "one merged codebase" the way a Monorepo feels, but for N repos — the "last-year single-repo clone" the brief itself warns about) but it is the **most dangerous to mis-pitch** of the five. I list it at #5 for demo-economics, not because the pain is small — the pain is the realest enterprise one there is, it's just the hardest to make visceral in 2 minutes without falling into the blast-radius costume.

**Rank: #5.**

---

## 6. BURN RATE (honorable mention — cost-of-compute per change) — *Every CI run has a price tag; budget goes red before the agent does.*

**12-word pitch:** Measures GPU/CPU + token cost of each CI run and test; keeps a hard change-budget.

**Why it's honorable, not a pick:** The cost-per-change pain is real and *very* 2026 (AI CI spend exploded; this hackathon even budgets "Bobcoins"). But as a *product* it drifts toward a **cost dashboard** (the kill-list), the demo is a number, not a gate-stopping artifact, and "here is a budget that goes red" is something a spreadsheet already does. It only wins if fused into another idea as a **second axis** (e.g., "rotating this secret costs 400 test-minutes; retiring it saves 700"). Fold the budget mechanic into any idea as a "what did this cost" overlay (Bobalytics is already our before/after coin slide) rather than pitching it alone.

---

# THE WINNER & THE FALLBACK

## WINNER: ZOMBIE (#1)

| Criterion | Why ZOMBIE |
|---|---|
| **Highest-EV pain AI worsens** | GitGuardian 2026: remediation is *the* limiting factor; **64% of 2022 secrets still valid in 2026**; new leaks **+34% YoY** pushed by AI commits. Detectors are saturated; the **env-variable lifecycle** (READ vs WRITTEN vs DYING) is un-owned. |
| **NOT on the kill-list** | Not a PR-risk/blast map, not a spec/incident round-1 item, not HIPAA, not a test/docs generator. It's a **config-archaeology + retirement gate**. Nothing in last year or round-1 touched "mortality of a secret." |
| **Bob is the CORE** | The cross-service READ/WRITE/DYING graph is **only buildable by parallel subagents each locked to one service** (a deterministic grep cannot infer "this 6-month-old code still reads it"). The retire/rotate decision is a gate enforced by a hook the agent **cannot** bypass. Wrapper-proof: swap Bob for a linter and you lose the isolation boundary. |
| **2-minute demo** | Visceral and fast: show a ZOMBIE card with the one load-bearing line → attempt delete → **refused by hook** → Gravedigger certifies no-reader → delete succeeds → the "Rotation Risk" counter drops. The parallel subagents panel on 6 services is the eligibility shot. |
| **Business value** | Directly maps to the CISO's #1 blocker in 2026 (GitGuardian: "teams can't rotate without outage fear, so they don't"). This converts "fear of rotation" into "a certified no-reader graph." Banks/retail/payments buyers. IBM-Watsonx/governance sellable. |
| **Demo economics 48h/40 coins** | One synthetic monorepo, one scanner, one `.bob/` pack, one gold rehearsal (~12–15 coins). Static HTML for the graveyard. Highest safety margin of the five. |

**One-sentence the judge repeats:** *"They scanned a 6-service monorepo, found five secrets still load-bearing in dead code nobody owns, and the IDE refused to delete any of them until no live reader remained."*

## Fallback if REDLINE dies: DRIFTLINE (#2)

REDLINE's risk is the **PDF→clause mapping flaking on day 1** (noted in your own demo-strategy: keep a markdown extract ready). If that dies, **DRIFTLINE pairs best** for three reasons:

1. **Same wall-DNA, different mechanism.** It reuses the team's proven "clause-wall / docket" visual language (judges already know your signature) but the subject moves from *parse-the-document* to *cross-examine-declared-vs-deployed*. A team that already built a wall for specs can rebuild a wall for drift with the same CSS and a different data source.
2. **Same gate mechanic, same modes.** REDLINE's auditor-vs-surgeon split and `PreToolUse exit 2` merge-block transfer almost 1:1 to DRIFTLINE's `registrar`/`lineman` and apply-gate. Least rework of any pairing.
3. **The "parallel subagents on each resource family" is literally in the brief** — so DRIFTLINE is the safest high-signal Ideas-loaded fallback if REDLINE's document-understanding angle is what broke.
4. **Bob remains core** (per-family `.bobignore` walls + gate hook), keeping wrapper-immunity if you have to pivot.

> Do NOT pivot to CROSSWIRES or FLAKEBUST as the fallback — those are the riskiest to mis-pitch toward the saturated blast-radius/dashboard categories under a live pressure pivot. ZOMBIE→DRIFTLINE is the only pivot that preserves Bob-core + business value + originality without re-skinning a saturated category.

---

## Anti-patterns this thread explicitly refuses (so we never blur our lane)

1. **Any "here's what your change might break" report** — that's blast radius / PR-risk; saturated, and that costume would kill ZOMBIE, DRIFTLINE, and CROSSWIRES regardless of merits. We prove *what is already broken and gate the merge*.
2. **A live-cloud demo** — drift/flake/cost must be **fixture-driven** (checked-in `plan -json`, `ci-runs.jsonl`, `env-manifest`), never a live `terraform apply` or real CI. It will flake on stage.
3. **Spending Bobcoins to author YAML** — the `.bob/` pack is authored here, in the workspace; the 40 coins go to 2–3 gold-path rehearsals only.
4. **"We used Bob to build our sample app"** — Bob is the *auditor/gate*, never the scaffold of the demo repo.
5. **A cost/CI dashboard** — BURN RATE stays a second axis inside the other products, never a standalone submission.
6. **Pre-merge ≠ postmortem** — nothing in this thread is an incident war-room; every product is a gate that *refuses a harmful merge/apply/delete before it happens*.

## Shared 48h sequencing rule (for whichever single idea ships)

1. **Hours 0–4:** plant the sample + the deterministic sensor (this is the highest-risk, do it first, no coins).
2. **Hours 4–14:** author the identical `.bob/` skeleton (skill + read-only auditor mode + surgeon mode + one `PreToolUse exit 2` hook + per-context `.bobignore`) — the exact same pack shape works for ZOMBIE, DRIFTLINE, REVERSE, FLAKEBUST. Build it once, reuse.
3. **Hours 14–20:** the ONE gold Bob rehearsal (the expensive coin event).
4. **Hours 20–30:** the static artifact (Graveyard / Drift Wall / Proof Card / Courtroom / Tapestry) wired to the sensor JSON.
5. **Hours 30–40:** the live block-demo (hook refusal → certified fix → gate reopens) + `bob_sessions` PNGs + README + 90s script.
6. **Hours 40–48:** buffer + collapse scope ruthlessly (fewer services/resources/migrations, never fewer gates).

## Data compliance (all synthetic, per guidelines)
- `acme-checkout/`, `acme-infra/`, `acme-ledger/`, `acme-orders/`, `repos/` are **all fake** names/keys/values — no client data, no PI, no real secrets, no social.
- Envs use fake placeholders (`PAYMENTS_TARGET=sk-live-fake-…`), logs are invented JSON, terraform plans are checked-in fixtures. Keep a `DATA-SOURCES.md` ("all synthetic, structure inspired by public 2026 GitGuardian/HashiCorp/TestDino reports").

---

## Ranking recap

1. **ZOMBIE** — env/secret lifecycle + safe retirement gate. Winner.
2. **DRIFTLINE** — IaC drift docket per resource family. Fallback pairs BEST with REDLINE.
3. **REVERSE** — migration rollback-proof merge-block gate.
4. **FLAKEBUST** — flake→commit attribution with a blame-SHA stamp.
5. **CROSSWIRES** — N-repos-as-one navigation + cross-repo publish gate (highest real pain, hardest 2-min demo, most saturation-risk if mis-pitched).
6. **BURN RATE** — cost-per-change as a second axis only, never standalone.
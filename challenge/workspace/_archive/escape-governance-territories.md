# ESCAPE POD — Redefining "developer workflow" far outside the governance silo

**Date:** 2026 (IBM Bob 2.0 hackathon prep) · 48h · **Judging:** Technology · Originality · Business Value · Presentation
**This memo deliberately flees** the REV/SPEC/TEST/COMPLIANCE family (REDLINE, SPLITBRAIN, WARPATH, DEPARTURES, CHANGEFORGE + all saturated onboarding/PR/blast-radius/docs/CVE-scan categories).
**The bet:** Bob 2.0's engine — isolated subagents, parallel tasks, document understanding, modes as tool-walls, MCP as deterministic hands, hooks as policy, rollback as the undo net — is *workflow-agnostic*. The winner is whoever proves it in a territory nobody else is fighting over, where the code-review metaphor *doesn't fit* and therefore can't be cloned.

**Filter applied to every idea below:**
1. A judge can screenshot ONE artifact (not a chatbot wall).
2. Bob IDE on camera 30s+ doing parallel subagent work + `@`-ing a non-source artifact (PDF / scope dump / proto / migration SQL).
3. A structural constraint (a mode that *cannot*, or a hook that *blocks*) is the product, not a prompt.
4. Before→after on a planted sample. Three numbers, not adjectives.
5. Swap test: if swapping Bob for Cursor keeps the demo alive, it loses Application of Technology.

---

## RANK 1 — RECON (Hardware / Embedded / IoT race-condition hunt) ★★★★★ win chance
**Territory #1** — the single most underexploited field you listed. CircuitSense did *EDA* last round and it won attention precisely because nobody else is there. **WE GO DEEPER INTO THE PHYSICAL WORLD, NOT THE BOARD.** EDA = schematic. RECON = *runtime concurrency* on firmware — the one domain where a purely-software agent stack is genuinely novel.

> **One-liner:** Drop a firmware repo + a logic-analyzer scope dump; Bob fans out isolated subagents to bisect a race condition, then generates the Rust/C test harness that *proves* the fix — all with the hardware byte-stream as the ground truth both sides must agree on.

**The exact pain:** A microcontroller interrupts an ISR mid-transaction. Symptom: "works on my bench, corrupts on the production line, flaky 1-in-3000." The bug is **nondeterministic** — you cannot paste a stack trace, click a line, fix it. It needs: reading a µs-scale logic analyzer trace, correlating it to the firmware state machine, generating a deterministic harness that replays the *interleaving* (not the test), and fixing the variable shared between ISR and main loop. Today that's a two-day oscilloscope vigil by the most senior costliest engineer on the team.

**Bob 2.0 primitives carrying it:**
- **MCP `recor-sampler`** (Node STDIO) = the **scope + log fixture**. Deterministic commands: `get_trace(trigger)`, `get_timeline(channel)`, `get_isr_entry_count()`, `get_fifo_state(t)`. Live hardware is off the stage — the fixture *is* the instrument. This is the anti-flake guarantee.
- **Parallel subagents (the camera shot):** (1) *Trace-reader* parses the logic-analyzer dump (this is **document understanding** on a *binary/CSV* artifact — a non-source document), collates ISR entry/exit and the shared flag. (2) *State-modeler* reads `main.c` + `isr.c` and builds the event-order hypothesis. (3) *FIFO-forensic* counts producer/consumer windows. Four explorers rerun in parallel until one lines up a *candidate interleaving*.
- **Mode `trace-witness`** — `.bobignore` on `src/`, sees **only** the scope dump + the vendor datasheet PDF. Cannot look at code. It writes the *expected* ordering from the datasheet alone. This isolates "does the hardware contract say this should be atomic?" from "what did the code actually do?" — the SPLITBRAIN mechanic transplanted to physics.
- **Mode `harness-surgeon`** — edit locked to `test/` + a generated `harness.rs`. Cannot touch `src/firmware.c`. Force-tests the fix by **replaying the captured interleaving** thousands of times.
- **Hooks:** `PreToolUse` blocks any write outside `test/` or `analysis/`. `Stop` emits `analysis/race.md` (root cause + proof) into the submission.
- **Rollback:** snapshot of `harness.rs` before the surgeon's first attempt; demo a wrong interleaving-fix → restore → correct one.
- **Skills:** `glean-trace`, `hypothesize-race`, `replay-harness`, `paper-the-fix`.

**Artifact a judge screenshots:** A **race timeline canvas** — the µs-scale trace with the two failing windows circled in red, overlaid with the shared-variable access counts, and a green marker "harness replay 5000×: 0 corruption after fix." One paused frame tells the entire story.

**Measurable impact:** Time-to-root-cause: **~2 days of scope vigil → 6 minutes** (planted). Harness proves it deterministically (before: flaky 1/3000; after: 5000/5000 clean). Artifact `analysis/race.md` + `harness.rs` in the repo.

**Why it beats REDLINE on ORIGINALITY (honest):** REDLINE is *a letter-perfect execution of a well-known (if badly-executed by others) governance pattern* — spec-vs-implementation audits exist everywhere. **RECON attacks a problem class almost nobody in the agent space targets** (runtime concurrency on firmware) and, crucially, it is **not expressible as a code-review** — you cannot review your way to finding a race you can't reproduce. That reframe is the originality win. The datasheet PDF-as-document-understanding + binary trace = document-understanding used on *non-filth* artifacts the way the brief intended.

**Demo risk (LOW-MED):** Highest novelty, but the classic hardware-adjacent trap is *looking like fake hardware* (a "scope UI" skin). Mitigation: the MCP returns **real fixture CSVs**, not a mocked UI; the parallel-panel screenshot does the selling. Keep the datasheet a one-page PDF. **If time dies, drop to 2 subagents + 1 mode.**

**Build in 48h:** Planted `stm32-ish` firmware (ISR + main loop sharing a flag), a real 2048-row scope CSV fixture, one-page datasheet PDF, 4 skills, 3 modes, 1 MCP. Replay harness in 30 lines of Rust (or C if Rust toolchain is unavailable).

---

## RANK 2 — DERIVE (ML-Ops / Data-pipeline / feature-store drift) ★★★★
**Territory #2** — train-time vs serve-time drift. This is the "two machines are lying to each other" territory: the training pipeline, the feature store, and the serving inference all evolved independently (often by different agents at different times), and the model card still says last month's truth.

> **One-liner:** Bob cross-examines the *data path* — training SQL → feature store → inference runtime — as three isolated witnesses, and produces a **drift map** showing exactly which feature's definition changed between train-time and serve-time, with the silent-behavior diff filed as a model-card correction.

**The exact pain:** A churn model silently degrades. Root cause isn't in code review — it's that `avg_session_len` was computed as a *7-day window* at training time and a *1-day window* at serving time because the feature-store yaml drifted. No CI failure, coverage 92%, tests green. Data scientists burn a week bisecting "why did the model flip." The **pipeline DAG and the model card are documents that routinely lie** — nobody re-reads them against each other.

**Bob 2.0 primitives carrying it:**
- **Document understanding (`@model_card.pdf`, `@feature_store.yaml`, `@pipeline.dag`):** three non-source artifacts become first-class citizens. This is exactly the "document-to-interface contract" mechanic from **Territory #4**, applied to *data* instead of a gRPC/DB.
- **Isolated Witness subagents, one per machine (the SPLITBRAIN principle, retargeted):**
  - *Train-witness*: `.bobignore` serving code. Computes feature definitions from `train/*.sql` + the model card.
  - *Serve-witness*: `.bobignore` training code. Computes feature definitions from `serving/feature_store.yaml` + the inference runtime.
  - Neither can see the other side, so neither can rationalize the drift away.
- **Mode `data-ombudsman`**: orchestrates; `fileRegex` only `derive/**` (can't edit pipelines themselves). The product *is the refusal to touch the code* — it surfaces truth, a human chooses which side is canonical, Bob patches the *document* (the model card), not the pipeline.
- **MCP `derive-store`**: `get_feature_def(side, name)`, `get_feature_agg(feature, window)`, `get_serve_schema()`, `get_train_schema()`. Deterministic fixtures on disk.
- **Parallel subagents (camera shot):** each feature name checked across both sides simultaneously; the ones with differing definitions bubble to the top.
- **Hooks:** `Stop` writes `derive/drift-map.json`. Blocks writes to `train/`, `serving/`, `src/`.
- **Skills:** `read-feature-def`, `cross-examine-side`, `patch-model-card`, `drift-map`.

**Artifact a judge screenshots:** A **drift map grid** — rows = features, columns = train vs serve, cells showing the *computed definition string*, mismatched cells red. One red cell (`avg_session_len: 7d → 1d`) is the whole pitch.

**Measurable impact:** Time-to-identify silent model regression: **~1 week of DS archaeology → 4 minutes** (planted). Number of conflicting feature definitions surfaced (say 3). Artifact `derive/drift-map.json` + corrected `model_card.md`.

**Why it beats REDLINE (honest):** REDLINE is *reactive legal audit*; DERIVE is *proactive data-integrity truthing* across two machines that cannot see each other. REDLINE's Witness mechanic is reused but the *artifact being cross-examined is a data-flow contract, not a prose spec* — a genuinely different pain (silent model regression) that governance-report clones ignore. Originality is real but slightly lower than RECON because "AI for data QA" has more prior art than "AI for firmware concurrency."

**Demo risk (MEDIUM):** Risk = judges think it's a generic monitoring dashboard. Mitigation: the **isolation wall** (train-witness can't see serve) is the product, and it must be on camera as `.bobignore` + the two isolated contexts. The drift-map screenshot is the anchor. **Fallback if ML jargon scares the room:** relabel examples as "payment risk model" so the data-science story is universal.

**Build in 48h:** Planted 3-feature example (7d vs 1d window, renamed column, missing normalization). Two YAML/CSV fixtures, one-page model card PDF, 3 skills, 2 modes, 1 MCP.

---

## RANK 3 — DARKSIDE (Supply-chain semantic backdoor honeypot) ★★★★
**Territory #3** — NOT a CVE scanner. CVE scanning is saturated. DARKSIDE *assumes* the vendored dep is guilty and looks for a **planted, semantic backdoor that no signature database would ever flag** — because it's clever, obfuscated, credential-oriented, not a known exploit.

> **One-liner:** Bob treats every vendored dependency as a hostile witness — isolated subagents trace each dep's *actual data flows* (where user input goes, where secrets leave, what the exit strategy is) and produces a **behavioral heatmap** flagging the code that *looks useful but exfiltrates*, so a 0-day planted backdoor surfaces before you ever ship it.

**The exact pain:** Modern supply-chain guarantees (SBOM, lockfiles, hash pinning, `npm audit`) prove **integrity**, not **intent**. `eth-crypto@8` passes signature checks — but its `recover()` helper has an extra byte that walks the key into an attacker's endpoint on a specific curve. Signature tooling says "clean"; a semantic backdoor needs a human to *read the flow* to catch it. That's exactly the thing agents do well — except the reading must be adversarial and isolated, else the agent rationalizes the innocent-looking path.

**Bob 2.0 primitives carrying it:**
- **Isolated witness per flow (SPLITBRAIN, hardest form):** each subagent gets ONE dep and is `.bobignore`d from everything else — no context contamination, no "the library is popular so it's fine" anchoring.
- **Modes as do-not-touch walls:**
  - `flow-tracer`: read + analyze only; writes to `dark/` reports. Cannot even read the app's secrets file (so it can't "find" a leak by accident and rubber-stamp).
  - `prosecutor`: receives the potential exfiltration triage and files *proof* for a human.
  - `innocent` (the second main witness): must read the same dep and find a benign explanation. Two witnesses, opposing goals — if both can't agree, the dep stays quarantined. (This seeds **Territory #6's** cooperative-adversarial mechanic.)
- **MCP `dark-trace`**: `get_dep(path)`, `get_runtime_env()`, `get_outbound_ends()`, `get_recover_path(fn)`. Deterministic fixture of a planted backdoor.
- **Hooks:** `PreToolUse` blocks any network write (so the honeypot is a honeypot, not a leak). Block writes to `vendor/` — the analyst cannot "clean" the dep, only quarantine it.
- **Rollback:** a legitimately-flagged-then-cleared dep is reversible — demo that DARKSIDE *clears* a false positive.
- **Skills:** `trace-dep-flow`, `enumerate-outbound`, `file-proof`, `quarantine-dep`.

**Artifact a judge screenshots:** A **behavioral heatmap** — the vendored dep's call graph, edges colored from "reads config only" to "RED: user-controlled bytes + outbound socket + key material in scope." One RED edge with the offending file:line and a proof snippet. The words **"`npm audit`: none."** next to it.

**Measurable impact:** Backdoor-planted-in-vendored-dep caught: **1/1** (vs `npm audit` reporting 0). Time to triage a dep: minutes. Artifact: `dark/heatmap.json` + `dark/quarantine.md`.

**Why it beats REDLINE (honest, partially):** REDLINE is rules-vs-implementation. DARKSIDE is *intent vs function* — a strictly harder, more original problem that **no existing scanner claims to solve** (scanners prove absence of known vulns, they can't reason about novel malicious *semantics*). This is probably the most "novel" framing, but it's also the riskiest to demo believably in 48h (a convincing planted backdoor must be *subtle enough to be plausible* yet *obvious enough to film*). It beats REDLINE on originality, arguably more than RECON, but carries higher build risk.

**Demo risk (MEDIUM-HIGH):** The planted backdoor must read as non-trivial (not `eval(user_input)` — that's a lint finding). Risk = judges think "Bob is just reading code." Mitigation depends on the **two-witness opposing-goal mechanic** being visible (innocent vs prosecutor), which is a Bob 2.0-only trick.

**Build in 48h:** Take a real (small) npm/Rust dep, plant a realistic backdoor in a fork, pin it in `package-lock`. 3 skills, 3 modes, 1 MCP. If the fork plumbing is too fiddly, use a plain-text vendored file (git submodule to a local `vendor/`) — same demo, less toolchain risk.

---

## RANK 4 — RECANON (Document→Interface contract for non-source artifacts) ★★★★
**Territory #4** — compress a 2000-line DB migration or a gRPC proto against the *actual code path* — i.e., treat the doc as the *contract* and the code as the *implementation*, the way REDLINE did — but for artifacts that are **not governance specs** and **not prose**: schemas, migrations, protos, wire formats.

> **One-liner:** Bob reads a gRPC proto / DB migration / message schema as the *canon*, then cross-examines the code paths that are *supposed to implement it* — producing a **contract-vs-code drift surface** that tightens when the wire format lies to the handler.

**The exact pain:** A migration renames `users.email` → `users.email_address`, a handler still reads `result.email`, and every team member's mental model differs. Protos drift from server stubs on long-lived services. "The schema is the law" is never enforced because nobody wants to hand-maintain a contract. This is REDLINE's engine applied to **binary/structured documents**, not prose — and, crucially, it *fixes* (patches code and doc together) rather than just accusing, because in this domain the two sides are *mechanically reconcilable*.

**Bob 2.0 primitives carrying it:**
- **Document understanding on the non-prose artifact:** `@schema.sql`, `@service.proto`, `@events.avsc`. This is the bit most teams can't do — and Bob is the first-class reader.
- **Isolated witness** `.bobignore`d to the *code side*, writing expectation tests from the proto alone (SPLITBRAIN again). The witness cannot see the handler, so it can't paper over a drift.
- **Mode `contract-librarian`**: `.bobignore` of `src/` — reads canon only, files the drift-map. Cannot "fix" the code.
- **Mode `reconciler`**: `fileRegex` = `src/` + `schema/` + docs; may patch *both* sides to converge. Because the contract is mechanical, the patch is provable by a replay.
- **MCP `call-canon`**: `get_field(schema, msg)`, `get_proto_methods()`, `migration_diff(from,to)`, `field_access_heatmap()`. Fixtures on disk.
- **Parallel subagents:** one per message type / migration / protocol field — each checks its code path simultaneously.
- **Hooks:** `PreToolUse` blocks writes to `src/` while in `contract-librarian`. `Stop` emits `contract/drift-map.json`.
- **Rollback:** reconcile an aggressively-wrong migration then roll back to show the undo net.

**Artifact a judge screenshots:** A **contract-vs-code drift matrix** — rows = fields/methods/migration steps, columns = "canon says" vs "code does", mismatched cells red with file:line. The punchline: a field that the proto declares `required` but the handler treats as optional.

**Measurable impact:** Drift items surfaced between schema/proto and code: **5 on a planted service** (vs "we re-read it manually"). Reconciler closes them with replay proof. Artifact `contract/drift-map.json` + converged files.

**Why it beats REDLINE (honest, mixed):** It *reuses* REDLINE's core mechanic (doc-as-law, isolated witness), so **on pure originality it does NOT clearly beat REDLINE** — it's REDLINE preaching to a different (binary) congregation. Honest call: **this is the weakest originality claim of the five.** It wins on *business value* (wire-format drift is universal and mechanical) and *demo robustness* (the reconciliation loop is satisfying), but a judge who saw REDLINE may read it as a sequel. **Flag as medium-originality workhorse, not the originality winner.**

**Demo risk (LOW):** The drift-matrix + reconcile-closes-it loop is the easiest of all five to make look polished and deterministic. If the room rewards "clean, working, valuable" over "astounding novelty," this is a safe bet that still clears the saturated list (it's NOT PR review / blast radius / onboarding — it's schema/proto truthing).

**Build in 48h:** Planted gRPC proto + 3 offending handlers + a DB migration story. 3 skills, 2 modes, 1 MCP. Easiest of the set to complete.

---

## RANK 5 — RELIVE (Deterministic replay / record-replay of an AI's own edits) ★★★★
**Territory #5** — capture the agent's own edit history and replay it as a **correctness harness on other machines.** Reframe Bob's **rollback** + versioning machinery into a *testing instrument*: instead of just undoing a bad edit, RELIVE re-does it under a different test observer to *prove* reproducibility.

> **One-liner:** Bob records every edit it makes to a repo (via rollback/versioning), wraps the sequence into a **deterministic replay script**, and executes it on a target machine under a hostile observer — so your agent-authored change is *provably reproducible and safe to ship elsewhere*, not just "green on my box."

**The exact pain:** An agent fires 14 edits, tests go green, the PR merges — but the change isn't reproducible: it wrote a timestamp into a config, depends on a local env var, or mutates global state. "It works on my machine → it works on the agent's machine" is the new CI lie. Teams need a **commit-from-scratch replay** that proves a change is *self-contained*, but nobody wants to hand-write the setup+teardown.

**Bob 2.0 primitives carrying it:**
- **Rollback / workspace versioning** is the *recording instrument* — every snapshot Bob took becomes (1) a safety net and (2) the **replay tape**. This is the clever reuse: rollback is usually a safety feature; RELIVE turns it into a test.
- **Hooks:** `RecordEdit` hooks append each write to `relive/tape.json` (path, content-hash, timestamp). `SessionStart` / `SessionEnd` bracket the sequence.
- **Mode `tape-recorder`**: the mode that performs the work while capturing. `.bobignore` keeps `relive/tape.json` from being treated as app code.
- **Mode `replay-auditor`**: receives `tape.json`, reconstructs the edit order, spins up a **clean target** (nix/sandbox), replays the writes, and runs the tests *in that fresh context*. If tests pass on the clean box, the change is self-contained. `.bobignore` of the original workspace so it can't cheat by reading the source it already has.
- **MCP `relive-exec`**: `tape_ops()`, `apply_to_clean(checkpoint)`, `diff_against_original()`, `check_global_state()`. Deterministic.
- **Parallel subagents:** (1) replay on clean target, (2) global-state/mutation auditor, (3) env-coupling tracer (which vars does the tape actually depend on?).
- **Skills:** `start-tape`, `reconstruct-order`, `replay-clean`, `file-reproducibility-cert`.
- **Rollback** becomes the *dedup* of undo-vs-replay (roll back an edit, then replay proves it's recursive/restorable).

**Artifact a judge screenshots:** A **reproducibility certificate** — the tape's full edit sequence, a clean-box replay log showing "tests passed on a blank machine with only these inputs," and a red flag if RELIVE caught an environment dependency. Text: *"Agent change is reproducible. 14/14 edits replayed clean; 0 hidden dependencies."*

**Measurable impact:** Env-dependency bugs caught before merge: **1 planted** (a `PUT_ENV`-style hidden dep). Time to a reproducible-proof: minutes. Artifact `relive/certificate.json` + before/after replay.

**Why it beats REDLINE (honest):** RELIVE is about *provable reproducibility*, a problem REDLINE (spec-vs-implementation) doesn't touch, and it does something no review tool does: it *converts the agent's own operational history (rollback tape) into a correctness artifact*. That's a fresh, Bob-2.0-native idea. It moderately beats REDLINE on originality but it's a narrower win-belt than RECON/RECANON.

**Demo risk (MEDIUM):** The clean-target replay is conceptually strong but *looks like CI* unless you make the tape + certificate the star. Risk = "we ran tests twice." Mitigation: the **hostile global-state observer** finding the planted hidden dependency is the money shot — it's the *detection of a lie*, not a re-run. Prioritize that flip in the demo.

**Build in 48h:** A small repo where the agent's "fix" secretly writes an env var. 2 skills, 2 modes, 1 MCP (clean-target can be a `nix-shell` or a plain temp-dir environment — no heavy infra). 

---

## HONORABLE MENTION — CONSENSUS (Territory #6: cooperative competing delegations)
**Not ranked no. 1 because it's hardest to demo crisply in 48h**, but it's the mechanic-leader worth seeding into RECON/DARKSIDE now:
- One subagent optimizes for *correctness*, one for *speed*, one for *compat*. Bob is the **mediator**, not a judge — it proposes a merge, delineates the tradeoffs, and if the two delegations genuinely conflict, it files a **consensus record** with both positions and the human chooses. **Rollback** is the "safe to experiment" guarantee.
- Where lives: as the **innocent-vs-prosecutor** mechanic in DARKSIDE (RANK 3) and as part of RECON's hypothesis-vs-trace loop. **Standalone product later**, not today.
- **Honest originality:** VERY high (nobody does cooperative, not adversarial, delegation), but the demo is a talking-head conversation unless you build a good decision-record visual — a 48h risk. **Defer.**

---

## FINAL RANKING & CALL (win probability)

| Rank | Product | Territory | Originality vs REDLINE | Business value | 48h safety | Demo risk | Win probability |
|---|---|---|---|---|---|---|---|
| **1** | **RECON** | Hardware/embedded concurrency | **+ high** | Med (niche but real) | High | Low-Med | ★★★★★ |
| **2** | **DERIVE** | ML/data-pipeline drift | + med-high | Med-High | High | Med | ★★★★ |
| **3** | **DARKSIDE** | Supply-chain semantics | **+ highest** | Med | Med-High | Med-High | ★★★★ |
| **4** | **RECANON** | Schema/proto contracts | ~equal (weakest) | **High** | **Highest** | **Low** | ★★★★ |
| **5** | **RELIVE** | Reproducible replay | + med | Med | Med-High | Med | ★★★ |

**RECOMMENDED: RECON** (RANK 1) as the headline — it has the cleanest "escape the governance silo" story (a *hardware* race condition and a *binary scope trace* as the document-understanding target), the strongest parallel-subagent + isolated-witness camera shot, the lowest clone-ability, and the most memorable screenshot (the race-timeline canvas). **Keep RECANON (RANK 4) as the safety fallback** — it's the easiest to complete perfectly and its *contract-vs-code drift matrix* is the most universally-understood demo if the room leans enterprise-plain rather than "wow me with novelty."

**Kill:** pure reopening of any governance/review/spec/test/compliance family. The five above live on *different axes* — physics, data-flow trust, intent, wire-format, and reproducibility — none of which REDLINE colonized.
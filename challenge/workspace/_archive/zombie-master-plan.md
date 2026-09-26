# ZOMBIE — Master Plan & Repo Scaffold

**Codename:** ZOMBIE
**Status:** SECOND-PRIORITY "extra-time" idea. Build only if REDLINE / SPLITBRAIN / WARPATH are done AND time & Bobcoins remain. If not built, this document is the complete, buildable spec so a fresh pair of hands (or final-hours you) can execute without thinking.
**Lane:** Infrastructure secrets & env-var lifecycle (the "infra-secret lane").
**Builder guide note:** Everything below is copy-paste buildable. Repo paths, file names, env var names, tool signatures, prompts, and shot lists are concrete. We decided: *author `.bob/` outside Bob* to protect Bobcoins, spend the 40 coins only on 2–3 gold-path rehearsal sessions.

---

## 0. TL;DR for the busy builder

| Item | Value |
|---|---|
| **What it is** | Because 64% of 2022 secrets are still valid in 2026 and nobody owns the lifecycle, ZOMBIE traces every env var / secret as **READ / WRITTEN / DYING** across a monorepo and retires zombies safely. A Bob hook refuses to delete any key that still has a live reader. |
| **The sticky artifact** | **Zombie Graveyard + Rotation-Risk map** (the judge screenshot). |
| **The judge line** | *"Scanners only detect the leak. Nobody retires the secret. ZOMBIE refuses to delete a key that's still being read."* |
| **Bob-native proof** | A mode that physically *cannot* cheat + a PreToolUse exit-2 hook that *blocks* the destructive delete. MCP serves local fixtures, not the internet. |
| **Build time** | Reduced 10–12h "extra-time" plan (full 48h plan included). |
| **If time runs out** | Repo scaffold + sample data are buildable *outside* Bob in ~2h. At minimum ship the `.bob/` config, sample repo, MCP fixture server, and README as a fully-documented submission. |

---

## 1. Product Concept & Pitch

### Name
**ZOMBIE** — *(the acronym, kept loose so the visual zing wins)*: **Z**ombie **O**ver **M**onorepos, **B**locking **I**nert **E**nvironments. (We pronounce it how it reads; the point is the graveyard.)

### One-liner
> Trace every env var and secret as **READ / WRITTEN / DYING** across a monorepo, and retire the zombies — the keys nothing reads anymore — safely.

### Tagline (on the graveyard UI)
> *Dead keys can't leak. Safe retirement starts here.*

### Judge-repeatable sentence (memorize this, say it once, end on it)
> **"Scanners only catch the leak that's already out. Nobody owns the lifecycle. 64% of secrets written four years ago are still valid today — ZOMBIE is the first thing that refuses to delete a key that's still being read."**

### The pain thesis (from the agreed GitGuardian reality)
- **64%** of 2022 secrets are **still valid** in 2026.
- **+34% YoY** leak growth driven by AI-committed code that pastes credentials.
- **59%** of compromised machines in breaches are **CI runners** — the machines that run on your env vars.
- Secret **scanners** (GitGuardian, TruffleHog, gitleaks) only detect leakage. **Nobody owns the lifecycle and safe retirement.** GitGuardian itself names this the industry's limiting factor.
- Result: a graveyard of **zombie env vars** — keys still in `.env` or the vault that **no code reads anymore**. They outlive their use, accumulate blast radius, and get included in every scan as noise (masking the real leaks).

### ZOMBIE answers one question nobody else answers
> **"Is anyone actually reading this key? Is it safe to delete?"**

Scanners answer *"did this get leaked?"* ZOMBIE answers *"is this key alive, dying, or dead?"* — and **enforces** the answer with a hook.

### Why it is not a chatbot / not a wrapper
The product is a **structural constraint**: a Bob mode that *cannot* see the code it would need to cheat, and a Bob **hook** that *blocks* a destructive delete when a live reader exists. MCP serves **local fixtures**. Bob is core and on camera. Swap Bob for Cursor and the hook + mode + tool-boundaries vanish — the harness test passes.

---

## 2. The Exact Sample Repo

### Repo name & layout
**Repo:** `necropolis` — *a "tech-debt graveyard" themed 5-service monorepo.* Feel free to rename, but keep the graveyard theme in file names (it sells the demo).

**Language / stack:** Node.js + TypeScript services (auth, payments, notifications, inventory, audit) sharing a common config; one Python CI fixture script (the scanner gate). This is realistic for an enterprise microservices monorepo. No PI, all synthetic.

```
necropolis/
├── .bobignore
├── .env.example                       # THE clean inventory: every key documented, statused
├── .env.plants                        # the "live" env file with the zombie keys planted (gitignored in real life)
├── package.json
├── tsconfig.base.json
├── services/
│   ├── auth/          (auth-service)
│   ├── payments/      (payment-service)
│   ├── notifications/ (notification-service)
│   ├── inventory/     (inventory-service)
│   └── audit/         (audit-service)
├── libs/
│   └── config/                        # shared config loader (reads env vars, gateway for READ detection)
├── ci/
│   ├── gate.js                        # non-LLM sensor: greps readers, writes zombie-report.json
│   └── fixtures/                      # MCP fixture data (read_env_refs source)
├── .bob/
│   ├── rules/zombie-rules.md
│   ├── modes/zombie-gravedigger.md    # THE cannot-cheat mode
│   ├── modes/zombie-surgeon.md        # the only mode that can delete
│   ├── skills/zombie/SKILL.md
│   ├── hooks/deletion-guard.hook.md   # THE hook rule
│   └── mcp/zombie-mcp/                # MCP server spec + fixtures
├── evidence/
│   ├── zombie-report.json             # structured artifact the UI renders
│   └── rotation-risk-map.html         # the judge screenshot
├── bob_sessions/                      # required task-session PNGs
└── README.md                          # standalone, generated README spec in §10
```

### Planted secrets — the exact story (READ / WRITTEN / DYING)

**Environment variables (env var names) and their lifecycle state:**

| Env var | Written by | Read by | Status | Verdict |
|---|---|---|---|---|
| `AUTH_JWT_SECRET` | auth-service | auth-service, api-gateway | **ALIVE** — actively read | KEEP |
| `PAYMENTS_API_KEY` | payments-service | payments-service | **ALIVE** | KEEP |
| `PAYMENTS_LEGACY_KEY` | payments-service (`old/` shim) | **nothing** (was read by deleted `charge-legacy.ts`) | **DYING → DEAD** | **ZOMBIE → RETIRE** |
| `NOTIFY_SENDGRID_KEY` | notifications-service | notifications-service, email-worker | **ALIVE** | KEEP |
| `NOTIFY_LO_LEGACY_TOKEN` | notifications-service | `worker/legacy_fallback.js` (dead code, no callers) | **DYING** | **ZOMBIE → RETIRE** |
| `INVENTORY_DB_URL` | inventory-service | inventory-service, report-batch | **ALIVE** | KEEP |
| `INVENTORY_RO_DB_URL` | inventory-service | **report-batch only** (dead script) | **DEAD** | **ZOMBIE → RETIRE** |
| `AUDIT_INGEST_KEY` | audit-service | audit-service (see below) | **ALIVE** — *do NOT delete* | **!!! KEEP (a live reader exists)** |
| `AUDIT_OLD_INGEST_KEY` | audit-service | **nothing** (workers migrated) | **DEAD** | **ZOMBIE → RETIRE** |
| `SEARCH_SERVICE_API_KEY` | (was listed in `.env.example`) | **never referenced anywhere** | **DEAD on arrival** | **ZOMBIE → RETIRE** |
| `CRON_MASTER_KEY` | CI config | cron-scheduler | ALIVE | KEEP |

### The critical "trap" secret (the demo's money moment)
`AUDIT_INGEST_KEY` — a judge or an impatient agent sees `audit-service` and assumes it's dead because the "obvious" worker was removed. But **`audit-service/src/routes/ingest.ts` still imports and reads it on a new hot-path**. ZOMBIE's hook must **block** the deletion here. This is the part of the demo that PROVES the product isn't a dumb grep: it's a **reader graph**, and the reader is non-obvious (deep in `src/routes/`, imported via `libs/config`).

### Concrete file paths that plant each zombie

1. **`PAYMENTS_LEGACY_KEY` (zombie #1)**
   - Written: `services/payments/src/config.ts` → `process.env.PAYMENTS_LEGACY_KEY`
   - Was read by: `services/payments/src/legacy/charge-legacy.ts` → **deleted** (gone from repo, entry remains in `.env.plants`)
   - Now: referenced **only** by `ci/fixtures/payments_legacy_reader.json` as a DECAYING reader we certify as gone.
   - Path a scanner/agent would falsely "find": a stale comment in `services/payments/README.md` mentions it (our README "lie").

2. **`NOTIFY_LO_LEGACY_TOKEN` (zombie #2)** — write in `services/notifications/src/worker/index.ts`; the only "reader" is `services/notifications/src/worker/legacy_fallback.js`, which has **zero callers** (dead module). The reader graph must classify it DYING (file present, no inbound calls).

3. **`INVENTORY_RO_DB_URL` (zombie #3)** — write in `services/inventory/src/db.ts`; reader is `services/inventory/scripts/report-batch.js`, which is **not invoked by any package.json script** and is a standalone orphan.

4. **`AUDIT_OLD_INGEST_KEY` (zombie #4)** — worker migrated; grep sees an old reference in a **test that was disabled** (`services/audit/test/migrated.spec.ts.skip`). The reader graph must properly treat `.skip` tests as non-readers (ZOMBIE's reader-parser excludes `*.skip.*` and `*.disabled.*`).

5. **`SEARCH_SERVICE_API_KEY` (zombie #5, dead-on-arrival)** — present in `.env.example` and `ci/fixtures/*` only. **Zero references anywhere in code.** An instant, unambiguous zombie for the "one-second win."

6. **`AUDIT_INGEST_KEY` (THE TRAP — must NOT be deleted)** — active reader at `services/audit/src/routes/ingest.ts`. The hook blocks deletion.

### `.env.example` (fragment — show the *status* column this is the inventory contract)

```dotenv
# necropolis .env.example — the ONE source of truth for env lifecycle.
# Every key BELOW has a status. ZOMBIE keeps this file in sync with reality.

# --- auth ---
AUTH_JWT_SECRET=              # status: ALIVE (reader: auth-service, api-gateway)
# --- payments ---
PAYMENTS_API_KEY=             # status: ALIVE
PAYMENTS_LEGACY_KEY=          # status: ZOMBIE-DEAD (reader removed: charge-legacy.ts)
# --- notifications ---
NOTIFY_SENDGRID_KEY=          # status: ALIVE
NOTIFY_LO_LEGACY_TOKEN=       # status: ZOMBIE-DYING (reader dead-module: legacy_fallback.js)
# --- inventory ---
INVENTORY_DB_URL=             # status: ALIVE
INVENTORY_RO_DB_URL=          # status: ZOMBIE-DEAD (orphan script: report-batch.js)
# --- audit ---
AUDIT_INGEST_KEY=             # status: ALIVE — have a live reader in routes/ingest.ts. DO NOT DELETE.
AUDIT_OLD_INGEST_KEY=         # status: ZOMBIE-DEAD (worker migrated)
# --- search ---
SEARCH_SERVICE_API_KEY=       # status: ZOMBIE-DOA (never referenced)
# --- cron ---
CRON_MASTER_KEY=              # status: ALIVE (reader: cron-scheduler)
```

### CI fixtures (non-PI, synthetic) — `ci/fixtures/`
- `payments_legacy_reader.json` — encodes a decaying reader we certify as gone.
- `audit_ingest_reader.json` — *proves* the live reader for the trap key (this is why `certify_no_reader` must return `false` for `AUDIT_INGEST_KEY`).
- `inventory_ro_reader.json` — orphaned script fixture.
- `notify_legacy_reader.json` — dead-module fixture.
- `.bobignore` served differently per mode (see §3).

---

## 3. Full `.bob/` Architecture

### 3.0 Design principle: "cannot cheat" is a filesystem + tool fact, not a promise

The whole product hinges on **two structural walls**:
1. **The Gravedigger mode cannot write to `services/`** — it can only *read code* and *run the reader-graph sensor*. It physically cannot remove a reader to "make the secret look dead." It cannot touch `.env.plants`, `ci/fixtures/`, or `evidence/`. If it can't edit a file, it can't cheat.
2. **The hook blocks deletion** whenever a live reader exists. Even a capable surgeon mode is stopped mid-action by a `PreToolUse` exit-2 blocker.

### 3.1 Custom modes

**Mode A — `zombie-gravedigger` (THE cannot-cheat mode; read-only, classified on cameras)**
- Role: Traces every env var → READER graph → classifies READ / WRITTEN / DYING / DEAD. Writes no code.
- Tool constraints: **read tools + MCP tools** (`read_env_refs`, `write_env_refs`, `classify_zombie`, `get_rotation_risk`) only. **No write/edit tool** exposed. `execute` limited to the deterministic gate script `node ci/gate.js --report`.
- File access (`fileRegex` / `.bobignore`): For the *gravedigger*, `.bobignore` **blocks `services/` from being edited** but allows reading; crucially it blocks `ci/fixtures/` (the gravedigger must NOT see our planted proof — it must derive the reader graph from real code so the demo is honest).
- Grants: read `**/*.{ts,js,config,env.example}`, `package.json`, `libs/**`. Denies: write anywhere.
- Canonical line for the demo script: *"This mode is physically unable to delete anything or edit code. Its only job is classification."*

**Mode B — `zombie-surgeon` (the only mode that can delete)**
- Role: Performs the retirement (removes the env var from `.env.plants` / code / `.env.example`), writes the graveyard entry, updates `rotation-risk-map.html`.
- Tool constraints: can **read + write**, runs `npm test`, runs `node ci/gate.js --verify-retired <KEY>`.
- File access: allowed to edit only **`services/**`, `.env.plants`, `.env.example`, `evidence/`**. **Denied** `ci/fixtures/` (so it cannot tamper with the reader graph that the hook trusts).
- **Critically**: even this mode can be **blocked by the hook** for `AUDIT_INGEST_KEY`. Surgeon ≠ authorized. Surgeon is the *agent that attempts* and the *hook decides*.

**Mode C — `zombie-witness` (optional verification subagent-safe mode)**
- Read-only, runs `certify_no_reader` and prints a verdict. Exists mainly to give the "second pair of eyes" shot in the demo.

### 3.2 Skills

**Skill root:** `.bob/skills/zombie/SKILL.md`

`SKILL.md` structure (this is what a judge should see in the file tree):
```markdown
---
name: zombie
description: Env-var / secret lifecycle triage. Classifies every key as READ/WRITTEN/DYING/DEAD,
             certifies readers, computes rotation risk, and gates safe retirement with a deletion hook.
version: 1.0.0
activates_on: ["Retire zombie secrets", "Find dead env vars", "secret lifecycle", "zombie trip"]
mcp: zombie-mcp
requires_mode: [zombie-gravedigger]
---

## Workflow
1. RUN `node ci/gate.js --report` (deterministic reader-graph sensor).
2. CALL MCP `read_env_refs` -> normalize every key + reference.
3. CALL MCP `write_env_refs` -> normalize who WRITES each key.
4. CALL MCP `classify_zombie` per key -> wether READERS > 0 (status).
5. CALL MCP `get_rotation_risk` for candidates.
6. Emit `evidence/zombie-report.json`.
7. For each DEAD key: RETIRE via surgeon mode + `verify-retired`.

## Rules
- NEVER certify_no_reader == true when the reader graph shows an inbound call in a live file.
- `.skip.*`, `.disabled.*` tests are NON-readers. Do not champion them.
- Comments and README mentions are NON-readers (they are lies). code paths are readers.
- AUDIT_INGEST_KEY is KEEP (live reader in routes/ingest.ts).
```

### 3.3 Parallel subagents (define who does what, running in parallel panel)

| Subagent | Job (exact) | Mode | Output |
|---|---|---|---|
| **`sweep-readers`** | Grep all `process.env.*`, `getEnv(...)`, `config.get(...)` references across `services/` and `libs/`. Exclude `.skip.*`/`.disabled.*`/comments/README. | gravedigger | `read_env_refs` normalized dataset |
| **`sweep-writers`** | Find every place that *writes/declares* an env var (`.env`, docker-compose, CI yaml, IaC). | gravedigger | `write_env_refs` dataset |
| **`classify`** | Cross the two datasets → per-key status READ / WRITTEN / DYING / DEAD / DOA; names the reader file:line for alive keys. | gravedigger | `classify_zombie` results |
| **`rotation-risk`** | For each death candidate, compute rotation risk (how many `deployments/` reference it, secrets-manager binding, downstream consumers). | gravedigger | `get_rotation_risk` |
| **`witness-verify`** | Runs `certify_no_reader` on the top candidate(s) and returns PASS / BLOCK. Runs LAST to gate retirement. | witness | BLOCK appended to `evidence/` |

These run in parallel in the Bob subagent panel **on camera**. Each is isolated so no one "sees the answer" — the five normalized datasets combine to the report the UI renders.

### 3.4 MCP server spec — `zombie-mcp`

Serves **local fixtures only** (never the internet — harness constraint). This is a small Node/Python MCP server exposing these tools:

| Tool | Signature (args → returns) | Purpose |
|---|---|---|
| `read_env_refs` | `()` → `{ env: [{ name, refs: [{ file, line, inLiveFile, inSkipped }] }] }` | Normalized READER graph |
| `write_env_refs` | `()` → `{ env: [{ name, writes: [{ file }] }] }` | Who writes/declares each key |
| `classify_zombie` | `(name: str)` → `{ name, status: READ|WRITTEN|DYING|DEAD|DOA, readers: [...], verdict: KEEP|RETIRE }` | The classifier gate |
| `get_rotation_risk` | `(name: str)` → `{ name, dependentServices: int, vaultBound: bool, blastRadius: LOW|MED|HIGH, yearsValid: float }` | Rotation-risk map input |
| `certify_no_reader` | `(name: str)` → `{ name, certified: bool, evidenceFiles: [...], liveReader: bool }` | THE deletion-gate oracle |

`certify_no_reader` is the load-bearing tool: it cross-checks `read_env_refs` and returns `false` whenever a live in-file reader exists — which is exactly why the hook trusts it. For `AUDIT_INGEST_KEY` it must return `certified:false` (trap).

### 3.5 Hooks — the block that is the product

**File:** `.bob/hooks/deletion-guard.hook.md` (and a runnable equivalent wired as a Bob PreToolUse hook).

**The exact rule (in plain words + pseudocode)**
> **Rule:** A deletion of an env-var name (via a `delete`, `.env` edit that removes a key, `unset`, config removal, or removal of a `process.env.<KEY>` binding) is **prevented (exit 2)** unless `certify_no_reader(<KEY>)` returned `certified:true` within the last sync.

```
PreToolUse (matched tool: Write/Edit that removes an env key, or Run of `unset`/`del`):
  KEY = extract_env_key_from(arguments)          # the env var name being deleted
  if KEY is null: allow                             # not an env deletion
  oracle = mcp.call("certify_no_reader", KEY)
  if oracle.certified is true and oracle.liveReader is false:
      ALLOW  # safe to retire
  else:
      BLOCK (exit 2) message:
        "ZOMBIE-BLOCK: '%s' still has a live reader at %s (%s:%d).
         A key that is still read cannot be retired.
         Delete the reader first, re-run the gate, and certify no-reader before removing this key."
```

**Why it physically cannot be bypassed on camera:** the hook is an exit-2 blocker *in Bob's own tool-use pipeline*. Even the surgeon mode gets stopped. The demo's trap moment = an agent attempts `delete AUDIT_INGEST_KEY` → **hook fires, exit 2, red block on screen**.

### 3.6 Rollback protects retirement
- Rollback version-controls workspace files during AI tasks. Because retirement is inherently destructive, we run it under **surgeon mode with Rollback ON**:
  - Every retirement = its own task so Rollback has a clean restore point.
  - If a retirement is wrong (a reader resurfaces, tests fail), **Rollback restores `.env.plants`, `libs/config`, and `services/**`** in one step — "we deleted safely, and safely means reversible."
  - The demo closing shot can show "Rollback: 3 files restored" to prove the delete isn't irreversible.

---

## 4. Bob Session Script — The Exact Demo Prompts (phases + on-screen)

Drive ONE gold rehearsal per command sequence. Author `.bob/` outside Bob; these are the prompts the *operator* types during the demo (or pre-baked so only the execution is on camera).

**On screen before phase 1:** Bob IDE open on `necropolis/`, task list up, `.bob/skills/zombie/SKILL.md` visible in the file tree, custom mode `zombie-gravedigger` selected.

### Phase 1 — The hook that can't be cheated (the money shot)
> *Prompt:* "Switch to `zombie-gravedigger`. Now, in `surgeon` mode semantics, I want to DELETE the env var `AUDIT_INGEST_KEY` from `.env.plants`. Go ahead and remove it."

- **On screen:** Bob begins a Write/Edit to remove `AUDIT_INGEST_KEY` → **PreToolUse hook fires** → red exit-2 block: *"ZOMBIE-BLOCK: 'AUDIT_INGEST_KEY' still has a live reader at services/audit/src/routes/ingest.ts:14."*
- **VO:** "Watch — Bob *cannot* delete this key. A scanner reading the PR diff would approve it, but the reader graph says there's a live consumer deep in the routing layer. The hook refuses."
- This is the **eligibility shot** — a hook blocking a destructive delete *is* the product, on camera, in Bob.

### Phase 2 — @ a config + skill auto-activates
> *Prompt:* "Run the `zombie` skill. @config sounds good — @libs/config as the reader source. Sweep and classify every env var in `necropolis`."

- **On screen:** `@libs/config` context mention; `SKILL.md` auto-activates; `<input>` shows skill loaded; gravedigger begins.

### Phase 3 — Parallel subagent panel (the hero panel shot)
> *Prompt:* "Launch the five subagents in parallel — sweep-readers, sweep-writers, classify, rotation-risk, and witness-verify. Show the report as they land."

- **On screen:** the collapsible **parallel subagent panel** — 5 agents, tool counts, elapsed times ticking, outputs streaming. Pause here for a screenshot; this panel is part of the bob_sessions PNG set.

### Phase 4 — The Zombie Graveyard appears
> *Prompt:* "Produce the zombie-report.json and render the graveyard + rotation-risk map."

- **On screen:** `evidence/zombie-report.json` writes; `evidence/rotation-risk-map.html` renders → **the judge screenshot** (see §5). Gravedigger is asked to name the zombies.

### Phase 5 — Retire a real zombie (the "no-reader → certify → delete → succeeded" loop)
> *Prompt:* "Now retire `SEARCH_SERVICE_API_KEY` — the dead-on-arrival key with zero references. Switch to `zombie-surgeon`, certify no-reader, delete it, verify the gate still passes and the code compiles."

- **On screen:** `certify_no_reader(SEARCH_SERVICE_API_KEY)` → `certified:true`; `node ci/gate.js --verify-retired SEARCH_SERVICE_API_KEY` → PASS; `.env.plants` line removed; `.env.example` status flips; graveyard adds a tombstone; `npm test` stays green. End line: **"no-reader → certify → delete → succeeded."**

### Phase 6 — Rollback shot
> *Prompt:* "Show me what Rollback would restore if this retirement were wrong — 3 files changed. We can revert the whole retirement in one step if the reader surfaces."

- **On screen:** Rollback panel with restore points. Proves safe/reversible.

---

## 5. Judge Screenshot Artifact Spec — Zombie Graveyard + Rotation-Risk Map

**File:** `evidence/rotation-risk-map.html` (also `evidence/zombie-report.json` as source). Static HTML, no auth/DB, big type. **This is the one paused frame a judge could tweeta.**

### Layout (top → bottom)
1. **Header bar** (dark, stark): `ZOMBIE` logo mark + tagline "Dead keys can't leak." + live counter: *"Secrets traced: 12 · Zombies: 5 · Alive: 7 · Safely retired: 1"* (three numbers max, honest).
2. **Zombie Graveyard table** (the row of tombstones):
   - Columns: **ENV VAR** | **STATUS badge** | **LAST READER** (file:line OR "none") | **RISK** | **ACTION** | **CERTIFY**.
   - Status badges color-coded: **ALIVE=green**, **DYING=amber**, **DEAD(zombie)=dark red/grey tombstone**, **DOA=red ✝**.
   - One row is the **trap**: `AUDIT_INGEST_KEY` shows **KEEP (live reader)** in green with reader `services/audit/src/routes/ingest.ts:14` — this must be *readable paused* so the judge sees "the one you'd wrongly delete still has a reader."
3. **Rotation-Risk map** (below, a 2-axis scatter): X-axis = **years valid** (secret shelf-life), Y-axis = **blast radius** (dependent services). Bubble size = dependent services. Color = status. The 5 zombies cluster in the **top-right/long-lived, high-blast** quadrant = where a leak hurts most and a scanner can't help. This is the "why now" visual.
4. **The one moment that must be readable paused:** a single visible line/marker showing the transition —
   - **`SEARCH_SERVICE_API_KEY`** with a small inline trail: `certified no-reader ✓ → deleted ✓ → succeeded`. A thin green check marks the header counter "Safely retired: 1."
   - A red **ZOMBIE-BLOCK** chip next to `AUDIT_INGEST_KEY` that reads "BLOCKED: live reader" so the trap is visually explicit on the same frame.

### Colors (readable paused, high-contrast)
- Background: near-black `#0e1116` · Alive `#18d26e` · Dying `#f6c344` · Zombie/Dead `#b91c1c`/`#6b6a6e` tombstone · DOA `#ff4646` · Keep/block `#ff9f1a` + red outline · Certify check `#22d3ee`.
- Minimum contrast for the paused screenshot, type ≥ 20px for table, ≥ 32px for the header counter.

### What must survive a paused still
✓ Any listener can name the 5 zombies. ✓ The trap key visibly "still has a reader / blocked." ✓ The retied key shows certify→delete→succeeded. ✓ The risk map makes the "long-lived + high blast radius" story obvious.

---

## 6. The 2-Minute Demo Shot List

| Time | Shot | On-screen | VO / callout |
|---|---|---|---|
| **0:00–0:08** | Hook — **the graveyard**, full screen | `rotation-risk-map.html`, header counter + tombstones | *"Scanners only catch the leak that's already out. Nobody retires the secret."* |
| **0:08–0:22** | Pain, real repo | `necropolis/` tree, `.env.example` with the status column, 2022 key still valid | *"64% of 2022 secrets are still valid. The keys nobody reads still hold the vault open."* |
| **0:22–0:30** | THE hook block (do not cut) | Surgeon tries `delete AUDIT_INGEST_KEY` → PreToolUse **exit 2** red block | *"Watch — Bob CANNOT delete a key that's still read. There's a live consumer at routes/ingest.ts."* |
| **0:30–0:55** | Bob IDE money shot (do not cut) | `@libs/config`, skill auto-activate, **parallel 5-subagent panel**, tool counts ticking | *"The mode physically can't edit code. Five subagents sweep readers, writers, classify, rotation-risk, and a witness verifies — in parallel."* |
| **0:55–1:18** | The artifact | Rotation-risk map; **click** the `SEARCH_SERVICE_API_KEY` row → certify→delete→succeeded | *"Zombie, no readers. For each one: no-reader → certify → delete → succeeded."* |
| **1:18–1:38** | Before/after numbers | Split screen: scanner view (leak detected) vs ZOMBIE (readers traced) | *"5 zombies retired across 5 services. 4 dead readers certified gone. The one everyone would wrongly delete still blocked."* |
| **1:38–1:52** | Looks complete | README, `.bob/skills/zombie`, modes, hook file, `bob_sessions/` PNGs, `npx serve evidence/` | Fast 1-second cuts, one sentence. |
| **1:52–2:00** | Close | End on the graveyard + trap chip | *"Dead keys can't leak. Safe retirement starts here."* (repeat hook) |

**Numbers we claim (honest, three max):** *5 zombies retired · 4 dead readers certified gone · 1 wrongly-deletable key blocked.* Optionally add *12 secrets traced*.

### `bob_sessions/` PNG filenames (follow submission naming: `{team}_{task}_{desc}_summary.png`)
- `teamzombie_task01_hook_block_live_reader_summary.png`  (the exit-2 block)
- `teamzombie_task02_parallel_subagents_panel_summary.png` (the 5-agent panel)
- `teamzombie_task03_graveyard_and_risk_map_summary.png`   (the artifact)
- `teamzombie_task04_retire_search_key_success_summary.png`(certify→delete→succeeded)
- `teamzombie_task05_rollback_restore_points_summary.png`  (safe/reversible)
*(Replace `teamzombie` with the real team name.)*

---

## 7. Build Plan

### 7A. Reduced 10–12h "extra-time" plan (since ZOMBIE is second priority) — RECOMMENDED IF YOU BUILD

Work in this order; each step is checkpointed. Author `.bob/` **outside Bob**.

| Hours | Task | Deliverable |
|---|---|---|
| **0–1.5** | Scaffold `necropolis/` monorepo: 5 services, `libs/config`, `package.json`, tsconfig. Plant all 11 env vars; build `.env.example` with status column + `.env.plants`. | Real-looking repo |
| **1.5–3** | Write the reader-graph sensor `ci/gate.js` (greps `process.env.*`, excludes `.skip/.disabled`/comments/README; outputs `zombie-report.json`). | Deterministic sensor |
| **3–4.5** | Build MCP `zombie-mcp` server (Node) with the 5 tools, backing off `ci/fixtures/`. Wire `certify_no_reader` to return `false` for `AUDIT_INGEST_KEY`. | MCP working |
| **4.5–6** | Write custom modes `zombie-gravedigger` + `zombie-surgeon` + `.bobignore` variants, skill `zombie/SKILL.md`, hook `deletion-guard.hook.md`. | `.bob/` complete |
| **6–8** | Build `evidence/rotation-risk-map.html` (graveyard table + risk map + certify/block chips). | Judge screenshot |
| **8–9.5** | **ONE gold Bob session** (gravedigger+surgeons+subagents) → correct `zombie-report.json` + graveyard. Guard Bobcoins; run the 5 subagents; screenshot tasks. | Gold report |
| **9.5–11** | Rehearse the 2-min demo twice; capture `bob_sessions` PNGs; finalize README + `npx serve evidence/`. | Demo + artifacts |
| **11–12** | Buffer: retake any screenshot, fix the trap key if gate misblocks, safe-pocket a markdown fallback of the report. | Shippable |

### 7B. Full 48h plan (if promoted to a first-class build)

| Window | Task |
|---|---|
| H0–3 | Scaffold + plant (same as 0–3 above), plus a CI `.github/workflows` gate so the scanner runs on every PR (the "rotation as a gate" story). |
| H3–6 | Sensor + MCP server + fixtures; add a `--diff` mode that reports *new* secrets added by AI commits (ties to +34% YoY leak stat). |
| H6–10 | Modes, `.bobignore` per mode, skill, hook rule; write a **custom rule** `zombie-rules.md` that nudges every Bob session to flag new `process.env.*` and inline them to `libs/config`. |
| H10–16 | Evidence HTML + static renderer; add a "deployments: consumer map" view for rotation risk. |
| H16–20 | Gold Bob session + subagents; capture bob_sessions PNGs. |
| H20–28 | Rotation-risk map polish + trap-key emphasis; make the blocked frame unmissable. |
| H28–36 | Click-to-retire loop: click a tombstone → surgeon retires it → verify → graveyard updates; add a second "reader resurfaces → Rollback restores" shot. |
| H36–44 | README, clone-and-run, video, `bob_sessions`, watsonx optional (Orchestrate route: a retirement → change ticket; Granite residual-risk on the risk map). |
| H44–48 | Buffer, retakes, fallback markdown report if MCP flakes. |

**Coin rule (both plans):** author `.bob/` outside Bob; spend the 40 coins on: 1× initial gravedigger sweep, 1× full gold session with 5 subagents, 1× rehearsal re-run, 1× reserve. Never regenerate the README with Bob. Rollback, don't argue.

---

## 8. Measurable Impact Metrics + IBM Business Value

| Metric | Value you can honest claim | Business story |
|---|---|---|
| **Secrets retired (zombies removed)** | 5 of 8 dead keys across 5 services | Directly shrinks the 64%-still-valid blast radius |
| **Dead readers certified gone** | 4 (charge-legacy, legacy_fallback, report-batch, migrated-worker) | Proof the delete is safe, not a guess |
| **Keys deleted against a live reader blocked** | 1 (`AUDIT_INGEST_KEY`) | The differentiator: scanners would approve this; ZOMBIE won't |
| **Secrets traced** | 12 (full inventory, one source of truth) | Every key has an owner/status; audit-ready |
| **CPE / audit reduction** | from "manual grep audit" (~a day) → "one-session report" (~minutes) | Audit, IR, and onboarding all read one artifact |
| **Leak-noise reduction** | Zombies no longer appear as false-positive scan rows | The real leaks stop being masked by dead-key noise (the quiet, hard-to-quantify win) |

**IBM business-value narrative (>1 line the judge can carry):**
> "Every CI runner is a machine running on your env vars, and 59% of compromised machines in 2026 were CI runners — yet the industry only scans for leaks, it never retires the keys. ZOMBIE turns IBM Bob from a code writer into the **enforcer of the secret lifecycle**: a mode that physically can't cheat, a hook that refuses unsafe deletes, and a graveyard+risk map that turns secret hygiene into an auditable, three-number statement. For IBM it's the enterprise answer to the #1 thing scanners cannot do — safe, provable secret retirement inside the SDLC where Bob already lives."

---

## 9. Risks & Mitigations + Differentiation

### Risks
| Risk | Mitigation |
|---|---|
| **MCP server flakes live** | Serve local fixtures only; ship a `zombie-report.json` committed fallback; keep a markdown extract of the report so the demo cannot die. |
| **Reader-grep is "too simple" (looks like a wrapper)** | The differentiation is the trap key + hook. Make the `AUDIT_INGEST_KEY` block the centerpiece; a dumb grep would approve it, the reader graph doesn't. Keep at least 2 non-obvious readers (deep import via `libs/config`, `.skip` test excluded). |
| **Judge thinks it's just a secret scanner** | Scanner = leak *detection* (GitGuardian lane). ZOMBIE = lifecycle *retirement* + deletion *enforcement*. Say it in the first 8 seconds, show the hook block within 30. |
| **Looks like "another SaaS dashboard"** | Bob IDE must fill ≥30s on camera doing the block + parallel subagents; the HTML is a *renderer* of Bob's structured output, not a product shell. |
| **Bobcoins run out** | Author `.bob/` outside Bob; one gold session for the report; screenshots from that session only. |
| **Sleep/Ops concerns from a destructive hook** | Retirement is Rollback-protected + gate-verified before and after; demo shows it's reversible, so reviewers see safety, not recklessness. |
| **Never-built (time runs out)** | The `.bob/` config, sample repo, MCP fixtures, and README are all buildable outside Bob in ~2h. At minimum ship the scaffold + this doc — a complete, judged submittable spec. |

### How ZOMBIE differs from REDLINE / SPLITBRAIN / WARPATH (and last year's scanners)

| Lane | Focus | ZOMBIE's difference |
|---|---|---|
| **REDLINE** | Spec-vs-repo compliance (document as law) | Different workflow (release/permission); ZOMBIE is secret-lifecycle infra. |
| **SPLITBRAIN** | Witness isolation → mutation testing / trust gap | ZOMBIE uses Bob isolation as a *security boundary* against devious deletion, not a grading property. |
| **WARPATH** | Incident org (debugging/on-call) | ZOMBIE is *preventative* secret hygiene, not reactive incident response. |
| **Last year's secret scanners** | Detect leaked keys; GitGuardian/TruffleHog/gitleaks | Scanners find *leaks that already happened*. ZOMBIE **owns the lifecycle and safe retirement** — the one thing the scanning industry names as its unfilled gap. It is the *enforcement* layer scanners lack. |

ZOMBIE is the **infra-secret lane**: while REDLINE proves the spec, ZOMBIE proves *deletion safety*. If built, it even complements REDLINE (audit/evidence pack overlap is light) — but it is deliberately second priority so it never endangers REDLINE's gold session.

---

## 10. Standalone, ZIP-able, Submission-Ready README

> Place `README.md` at the repo root. This exact text is submission-ready; trim names as needed.

```markdown
# ZOMBIE — Dead Keys Can't Leak

**Trace every env var / secret as READ / WRITTEN / DYING across a monorepo, and retire the zombies safely.**

Scanners only catch the leak that's already out. Nobody owns secret retirement.
64% of secrets written in 2022 are still valid in 2026. ZOMBIE is the first thing
that refuses to delete a key that's still being read.

## What it does
- Builds a **reader graph** for every env var in the monorepo (who writes it, who reads it).
- Classifies each key: **ALIVE / DYING / DEAD (zombie) / DOA / KEEP**.
- Emits `evidence/zombie-report.json` + a **Zombie Graveyard & Rotation-Risk map** (`evidence/rotation-risk-map.html`).
- Refuses to retire any key with a live reader, enforced by a **Bob PreToolUse exit-2 hook**.

## Install (3 steps)
1. `npm install` in the repo root.
2. `node ci/gate.js --report`  → builds `evidence/zombie-report.json`.
3. `npx serve evidence/`        → opens the zombie graveyard + rotation-risk map.

Optional: run the MCP fixture server to drive the Bob tools live:
`node .bob/mcp/zombie-mcp/server.js`

## The hook (the product)
Loops: attempt to delete `AUDIT_INGEST_KEY` → Bob **blocks** (exit 2) because
`services/audit/src/routes/ingest.ts:14` still reads it. A scanner would approve it; ZOMBIE won't.

## Retire a zombie safely (no-reader → certify → delete → succeeded)
For `SEARCH_SERVICE_API_KEY` (zero references):
`certify_no_reader(SEARCH_SERVICE_API_KEY)` → certified → `node ci/gate.js --verify-retired` → tombstone added. Rollback protects every retirement (safe & reversible).

## Repository layout
- `services/` — 5-service node-ts monorepo (auth, payments, notifications, inventory, audit)
- `.env.example` — the one source of truth, with a per-key lifecycle status
- `ci/gate.js`, `ci/fixtures/` — deterministic reader-graph sensor + synthetic fixtures (no PI, no client data, no social)
- `.bob/` — modes (`zombie-gravedigger` [cannot edit code], `zombie-surgeon`), skill `zombie`, hook `deletion-guard`, MCP `zombie-mcp`, rules
- `evidence/` — zombie-report.json + rotation-risk-map.html (the judge screenshot)
- `bob_sessions/` — required Bob task-session summary PNGs

## Demo numbers
- 12 secrets traced · 5 zombies retired · 4 dead readers certified gone · 1 wrongly-deletable key blocked.

## Built with IBM Bob 2.0
Core components: Custom modes (structural no-cheat wall), parallel Subagents
(readers/writers/classify/rotation-risk/witness), Skills (`zombie`), Context mentions
(`@libs/config`), MCP server (local fixtures), **PreToolUse deletion hook** (exit 2),
and Rollback (safe, reversible retirement). Bob IDE is the product, on camera.

## Data compliance
All data is synthetic (planted env vars in a fake monorepo). No PI, no client data,
no company-confidential data, no social media. MCP serves local fixtures only.
```

---

## Final checklist before you decide to build

- [ ] REDLINE + SPLITBRAIN + WARPATH are locked and demo-ready FIRST.
- [ ] Author all `.bob/` config **outside Bob** to protect Bobcoins.
- [ ] Spend 40 coins only on: 1× gravedigger sweep, 1× gold 5-subagent session, 1× rehearsal, 1× reserve.
- [ ] The trap key `AUDIT_INGEST_KEY` must be blocked by the hook on camera — test it first.
- [ ] `bob_sessions/` PNGs named `team_zombie_<task>_<desc>_summary.png`.
- [ ] If time runs out: ship the scaffold + `.bob/` config + MCP fixtures + this README as a complete, documented submission.

**Stop building here and build REDLINE. ZOMBIE only if time remains — and if it does, this plan is the fastest path to a shipped, judged submittable.**
# Northstar — Pre-Demo Audit

Audit of `northstar/` against an external "AI-slop and vaporware" review (11 findings). Each
finding was checked against the repo before anything was fixed. Several were right, some were
right for the wrong reason, and two were worse than reported.

Audited: 2026-09-26 · Tree: `northstar/` at `4fc4bf0` + uncommitted fixes · Bob reference: `BOB.md`

**Private reference.** Like `NORTHSTAR-PLANTED-BUGS.md`, this file lives outside `northstar/` and
must not be moved into the demo tree.

---

## 1. Bottom line

| | Before | After |
|---|---|---|
| `npm test` on a fresh clone | Crashes: `ReferenceError` in every clause suite | 8 fail / 3 pass suites, 19/38 tests, with W1–W8 failing only on their deliberate bugs |
| Witness "never touches `src/`" | Relied on hooks + `.claude/agents`, which Bob doesn't have. **No real enforcement.** | Enforced by Bob `groups` + `fileRegex`: only `surgeon` can write to `src/` |
| TrustGap headline | `"PLACEHOLDER"` | Measured: **trust gap 0.022** (see §4) |
| MTTR headline | `0` (fake) | `null` until measured with `scripts/mttr.mjs` |
| `npx tsc --noEmit` | not run | Clean |

---

## 2. Findings and verdicts

| # | Finding | Verdict | Fatal? | Status |
|---|---|---|---|---|
| 1 | `bind-seams.cjs` missing | **True, wrong cause.** It existed locally, but commit `4fc4bf0` gitignored `northstar/.bob/scratch/`, so no clone ever gets it. | **Yes** | Fixed |
| 2 | `jest.setup.cjs` dead | True: nothing references it. | No | Deleted |
| 3 | Hooks don't exist in Bob | True, and BOB.md §5.1 already said to cut them. | **Yes (with 8, 9)** | Fixed |
| 4 | Runbook is a placeholder | True: W6, `rcac.md` and 2 skills cite it. | Story-breaking | Fixed |
| 5 | TrustGap PLACEHOLDERs | True. The existing numbers were also inconsistent (the summary said 9 survived, the ledger summed to 19). | Headline missing | Fixed |
| 6 | MTTR = 0 | True, but no honest value exists before a real incident run. | No | Tooling fixed; value pending |
| 7 | `RetryPolicy.delayMs` ambiguous | True, cosmetic. | No | Fixed |
| 8 | `.claude/agents` isn't Bob config | True. It was also where the wall supposedly lived. | **Yes (with 3, 9)** | Fixed |
| 9 | Only 4 of 9 modes active | True. The missing 5 included `witness` and `isolate`, the two modes the wall exists for. | **Yes (with 3, 8)** | Fixed |
| 10 | `RKUTION 2119` typo | True. | No | Fixed |
| 11 | Stray `;.` in `confirm.ts` | True. | No | Fixed |

**3 + 8 + 9 are one defect.** The active 4-mode YAML stated that the wall was "enforced by the
tool-level allowlists in `.claude/agents/*.md` + PreToolUse hook". Bob reads neither, so the core
REDLINE claim had nothing behind it.

---

## 3. What changed

### Test harness (#1, #2)
- **Added** `harness/bind-seams.cjs`, a tracked binding with neutral comments and no "planted" language. Every `declare function` seam in every test file is bound.
- **Changed** `jest.config.js`: `setupFiles` now points at the new file, and the stale header was rewritten.
- **Deleted** `jest.setup.cjs`.

### The wall (#3, #8, #9)
- **Changed** `.bob/custom_modes.yaml`: all 9 modes are active. Persona content from the 4-mode file, the 9-mode backup and `.claude/agents/*.md` was folded into `roleDefinition`/`customInstructions`.
- **Deleted:**
  - `.bob/hooks/` (4 scripts)
  - `.bob/settings.json` (only held hooks and undocumented `permissions.deny`)
  - `.claude/`
  - `custom_modes.yaml.bak-9mode`
- **Rules:**
  - `rules-control/` renamed to `rules-control-agent/`, because Bob needs the folder name to match the slug.
  - `rules-isolate/` added.
  - The witness and surgeon rules were aligned with their fences.
- **Stale references removed:**
  - `.bobignore` header
  - `warpath-intake`, `warpath-postmortem`, `warpath-patch`, `warpath-forensics` and `redline-extract` skills

Write fences (every fence starts with `(?!.*\.\.)` to block `tests/../src/x` style paths):

| Mode | Groups | Can write |
|---|---|---|
| witness | read, skill, edit | `tests/(clause\|policy\|redline)-*`, `evidence/*` |
| control-agent | read, skill, subagent[explore], edit | `tests/control-*` |
| compliance-officer | read, skill, subagent[explore], mcp, mode, edit | `evidence/*` |
| surgeon | read, skill, execute, edit | `src/**`, `tests/**` |
| mutineer | read, skill, execute, mode, edit | `.bob/scratch/**` |
| isolate | read, skill, edit | `trustgap/*.json` |
| incident-commander | read, skill, execute, subagent[explore], mcp, mode, edit | `incident/*.md`, `evidence/*.md` |
| forensic-explorer | read, skill, mcp, subagent[explore] | nothing |
| comms-officer | read, skill, edit | `incident/*.md`, `CHANGELOG.md` |

Verified: each fence was tested with `src/retry.ts`, `docs/api-spec.md` and `tests/../src/retry.ts`.
Only `surgeon` matches `src/`, no mode matches `docs/`, and no mode matches the traversal path.

### Runbook (#4)
`docs/runbook-payments.md` is now a normative runbook with these values:

| Rule | Value |
|---|---|
| Retry delay | Base 200 ms, ×2 per attempt |
| Jitter | Bounded additive (+0–25%), so each delay is always larger than the last |
| Delay cap | 8 s |
| Attempts | At most 5; `Retry-After` wins when present |
| 409 idempotency conflict | Same key, never a new one; not a breaker failure |
| Breaker `openThreshold` | 5 consecutive failures, matching the W6 test |
| While open | Fail fast with `503` |
| Settle window | 30 s, then a single half-open probe |
| On-call | 5 operator steps |

### TrustGap (#5)
- **Added** `stryker.conf.json` and `stryker.jest.config.js`, which mutate `src/discounts.ts` against the two discount suites only.
- **Added** `scripts/build-trustgap.mjs`, which builds `TrustGap.json` from the Stryker and Jest JSON output only. Nothing is typed by hand.
- **Added** `npm run mutation` and `npm run trustgap` (regenerates the whole file).
- `.gitignore` now covers `.stryker-tmp/` and `reports/`.

### MTTR (#6)
- **Added** `scripts/mttr.mjs` with three commands:

  | Command | What it does |
  |---|---|
  | `start` | Records the incident start time |
  | `status` | Shows elapsed time so far |
  | `stop` | Computes MTTR and writes `incident/metrics.json` |

- `incident/metrics.json` now holds `mttrSeconds: null` with a note on how to fill it.
- The "Stop hook" wording is gone from `incident/rcac.md`, `incident/timeline.md` and both WARPATH skills.

### Cosmetic (#7, #10, #11)
- `delayMs` renamed to `previousDelayMs` in `src/retry.ts` and `tests/clause-W6.test.ts`. The field name and its doc comment are the only changes; assertions and the intentional constant are untouched.
- `RKUTION` → `RFC` in `redline-test/SKILL.md`.
- The stray `;.` scaffold sentence removed from `src/pay/confirm.ts`.

---

## 4. Measured TrustGap

From `npm run trustgap` (Stryker 8, perTest coverage):

| Metric | Value | Source |
|---|---|---|
| Mutants on `src/discounts.ts` | 20: 17 killed · 2 survived · 1 no-coverage | Stryker |
| Kills by the tautology suite | **0** | Stryker `killedBy` |
| `honestMutationScore` | 17 / 19 = **0.895** | Unique mutants killed by honest tests ÷ (killed + survived) |
| `claimedCoverage` | **0.917** | Jest line coverage |
| `trustGap` | **0.022** | Claimed coverage − honest mutation score |

**Read this before writing the pitch.** The gap is small because `policy-discounts.test.ts` is
honest and kills almost every mutant. The dramatic number is **tautology suite: 0 kills despite
covering the code**, not the suite-wide gap. If the demo needs a big gap, compute the tautology
suite's coverage on its own rather than inflating the suite-wide metric.

Surviving mutants: the `SAVE10` case guard (`discounts.ts:19`, 2 mutants). No-coverage: the
`default:` unknown-code branch (`discounts.ts:23`).

---

## 5. Still open

| Item | Why it matters | Where |
|---|---|---|
| Does Bob's `fileRegex` accept a `(?!…)` lookahead? | If not, every fence breaks. Drop the prefix if Bob rejects it. | `.bob/custom_modes.yaml` |
| Can read access be scoped per mode? | Decides the exact wording of the pitch (BOB.md §5.2) | Test `@src/…` from witness mode in Bob |
| `mcp.json` `alwaysAllow` lists `run_stryker`, `run_suite`, `get_stack_trace`, which `gauntlet.js` doesn't provide, and misses `get_mutants` | MCP approvals won't match reality | `.bob/mcp.json` |
| No `fixtures/` folder | `get_logs`, `get_metrics`, `get_recent_deploys`, `get_mutants` will error live | `northstar/fixtures/` |
| `rcac.md` says "the planted defect" | Leaks demo intent to judges | `incident/rcac.md:14` |
| `api-spec.pdf` may still contain the old `Bug site:` footnotes | Leaks bug locations | Regenerate from `api-spec.md` |
| `ibm/` is a stale, untracked copy of the whole repo | Easy to edit the wrong tree | Repo root |
| Record MTTR during the gold session | The only honest way to fill it | `node scripts/mttr.mjs start` / `stop` |
| Fixes are uncommitted | Nothing above ships until it's committed | `git status` |

---

## 6. How to re-verify

```sh
cd northstar
npm ci
npx jest            # expect: Test Suites 8 failed, 3 passed; Tests 19 failed, 19 passed
npx tsc --noEmit -p .
npm run trustgap    # regenerates trustgap/TrustGap.json
node scripts/mttr.mjs status
```

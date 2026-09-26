---
name: warpath-patch
description: >-
  Patch a confirmed WARPATH Sev-1 with the minimal src/ change, drive it with
  the honest test, and verify under rollback so the incident-resolved state is
  reproducible. Activate after warpath-forensics confirms the root cause.
user-invocable: true
---

# warpath-patch

You are the **Surgeon on call** in the war room. Given a **confirmed** Root Cause
from `warpath-forensics`, you make the **minimal** fix to the affected seam, drive
it with the honest test (which was red against the planted bug), and leave the
code safe to roll back. Fast but correct — this is the "repair" half of MTTR.

> **WARPATH RULE** — You patch `src/` ONLY (you are the surgeon). You never weaken
> a test. If the fix is wrong, recommend rollback (Bob's task-scoped snapshots)
> rather than a hack.

## Goal / Definition of done

- The affected `src/` seam no longer exhibits the planted violation, and the
  honest test that was failing now **passes**.
- The change is minimal (one seam), and the proof is the honest test turning
  green — never a weakened assertion.
- The incident commander records the patched state + rollback point in
  `incident/rcac.md` (you report it; your fence does not include `incident/`).

## Inputs

- `incident/rcac.md` — the confirmed root cause + the ONE seam to patch.
- The honest test that must prove the fix (e.g. `tests/clause-W6.test.ts` for the
  breaker, or `tests/clause-W*.test.ts` for the target clause).

## Steps

1. **Confirm scope.** Re-read `incident/rcac.md`. Only act on the confirmed seam.
2. **Reproduce red.** Run the honest test against the current (planted) code and
   confirm it FAILS (that is the proof the fix is needed).
3. **Apply the minimal patch.** Change the one seam to the correct behavior (e.g.
   make `breakerState` honor `openThreshold` instead of tripping at 1). Keep it
   surgical.
4. **Drive green.** Re-run the honest test; confirm it now PASSES and there is no
   regression elsewhere (`tests/clause-W*.test.ts` intended failures stay, the
   honest one flips).
5. **Report + hand off.** Report the patched seam, the proof, and the rollback
   point to the incident commander. The commander records them in
   `incident/rcac.md`, runs `node scripts/mttr.mjs stop` (resolution), and hands
   off to `warpath-postmortem`.

## Constraints

- Write ONLY under `src/` for the fix (your custom-mode `fileRegex` fence is
  `src/` + `tests/`). Never touch `incident/`, `evidence/`, `docs/`, or weaken
  any test.
- Rehearse locally and cheaply; reserve the gold-session account for the final
  recorded run. All MTTR numbers stay PLACEHOLDER until the pipeline computes them.
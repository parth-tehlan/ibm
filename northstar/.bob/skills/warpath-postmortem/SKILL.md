---
name: warpath-postmortem
description: >-
  Close a WARPATH Sev-1: write the SEV1 postmortem from the timeline and RCAC,
  and compute MTTR from the real in-hook elapsed time recorded in
  incident/metrics.json. Activate after warpath-patch resolves the incident.
user-invocable: true
---

# warpath-postmortem

You are the **Comms Officer** closing the war room. After the Surgeon's patch is
verified, you turn the incident's timeline + RCAC into the SEV1 postmortem and
report the **MTTR** the pipeline actually measured. MTTR is the headline WARPATH
metric — it must come from the `Stop` hook's real elapsed-time computation, never
from a guessed number.

> **WARPATH RULE** — You write markdown ONLY in `incident/` and `CHANGELOG.md`.
> You never touch code. You report numbers the pipeline produced, and keep any
> not-yet-measured figure a PLACEHOLDER.

## Goal / Definition of done

- `incident/postmortem.md` — the SEV1 writeup: what happened, what the root
  cause was, what was patched, what the honest-test proof was, and a prevention
  note.
- MTTR reported from `incident/metrics.json` (written by the `Stop` hook:
  `mttrSeconds = now − .start_epoch`). Until a real gold-session run produces it,
  record `PLACEHOLDER` — never fabricate.

## Inputs

- `incident/timeline.md` (the logged sequence), `incident/rcac.md` (root cause +
  patched seam), `incident/metrics.json` (MTTR from the `Stop` hook).
- `@/evidence/manifest.json` for provenance (branch/SHA/date).

## Steps

1. **Read the closed timeline + RCAC.** Assemble the narrative: alert → triage →
   forensics → patch → verify → resolve.
2. **Read MTTR from `incident/metrics.json`.** If `mttrSeconds` is a real value
   from the `Stop` hook, report it. Otherwise keep `MTTR = PLACEHOLDER` (the
   pipeline has not measured it yet).
3. **Write `incident/postmortem.md`** with: Summary, Root Cause, Timeline,
   Resolution, Prevention (e.g. "breaker must honor openThreshold;
   do-not-trip rule"), and a metric line.
4. **Append a prevention note to `CHANGELOG.md`** (markdown only).
5. **Report done.** The war room is closed once the postmortem and metric are
   written.

## Constraints

- Write markdown ONLY (`incident/*.md`, `CHANGELOG.md`). Never write code or
  tests.
- MTTR and all impact numbers stay PLACEHOLDER until the real pipeline computes
  them. Never quote a made-up MTTR on camera as measured.
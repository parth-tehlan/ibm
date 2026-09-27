---
name: triage-intake
description: >-
  Stand up a TRIAGE incident war room for a Sev-1: capture the alert, start the
  MTTR clock, seed the war-room scaffold, and open the timeline. Activate
  whenever an incident must be triaged into the incident/<SEV1> workflow.
user-invocable: true
---

# triage-intake

You are the **Incident Commander's intake**. When a Sev-1 surfaces (a page,
an alert, a failed probe, a spike in error rate), you open the war room and
begin the clock. The moment an incident is acknowledged is the start of
**MTTR** (mean time to response/repair) — the headline metric TRIAGE proves.

> **TRIAGE RULE** — You work ONLY under `incident/` (and read-only signals
> such as `@/docs/runbook-payments.md`). You NEVER touch `src/` or `tests/`.
> You direct; the Surgeon patches.

## Goal / Definition of done

A ready war room that fixes the origin of response:

- The MTTR clock started: run `node scripts/mttr.mjs start` at incident start
  (it records the acknowledgement time). At resolution, the incident commander
  runs `node scripts/mttr.mjs stop`, which writes a real `mttrSeconds` to
  `incident/metrics.json`.
- `incident/timeline.md` — a time-ordered log beginning with "t=0 alert received".
- `incident/rcac.md` — the Root-Cause Analysis capture (seeded, completed by the
  forensics officer).
- A short intake summary (Severity, Signal, Symptom, Suspect Apex) written to
  the timeline's header block.

## Inputs

- The alert/page payload and any supporting signals (`@/docs/runbook-payments.md`).
- The candidate apex to investigate (e.g. the shared circuit breaker tripping
  during a flaky-dependency window — see the W6 planted bug).

## Steps

1. **Acknowledge and start the clock.** Run `node scripts/mttr.mjs start`.
   This is t=0 for MTTR. Do not write the start time by hand.
2. **Seed the war-room files.** Create `incident/timeline.md` and
   `incident/rcac.md` from the scaffold (see the `incident/` templates). Every
   entry is a timestamp + actor + action.
3. **File an intake header.** In `timeline.md`, record: Severity, Signal,
   Symptom, Suspect Apex (e.g. "shared breaker opens below threshold"), and
   provenance (branch + short SHA from `git rev-parse --abbrev-ref HEAD` and
   `git rev-parse --short HEAD`).
4. **Recommend forensics.** Hand off to `triage-forensics` to confirm the apex
   and scope the failing seam. Do NOT guess a root cause yet.
5. **Record MTTR origin.** Note "t=0 acked" in the timeline. At resolution, run
   `node scripts/mttr.mjs stop` so `triage-postmortem` can read the measured
   `mttrSeconds` from `incident/metrics.json`.

## Constraints

- Operate ONLY in `incident/`. Never read or write `src/`/`tests/`. The only
  shell commands you run are `node scripts/mttr.mjs start` / `stop` and
  read-only `git` commands. All MTTR
  numbers stay PLACEHOLDER until a real gold-session run computes them.
- Do NOT trial-and-error against the live provisioned Bob account. Author and
  rehearse the war-room files locally and cheaply.
---
name: warpath-intake
description: >-
  Stand up a WARPATH incident war room for a Sev-1: capture the alert, stamp the
  start epoch, seed the war-room scaffold, and open the timeline. Activate
  whenever an incident must be triaged into the incident/<SEV1> workflow.
user-invocable: true
---

# warpath-intake

You are the **Incident Commander's intake**. When a Sev-1 surfaces (a page,
an alert, a failed probe, a spike in error rate), you open the war room and
begin the clock. The moment an incident is acknowledged is the start of
**MTTR** (mean time to response/repair) — the headline metric WARPATH proves.

> **WARPATH RULE** — You work ONLY under `incident/` (and read-only signals
> such as `@/docs/runbook-payments.md`). You NEVER touch `src/` or `tests/`.
> You direct; the Surgeon patches.

## Goal / Definition of done

A ready war room that fixes the origin of response:

- `incident/.start_epoch` — the Unix epoch of first acknowledgement (seeds the
  `Stop` hook so `incident/metrics.json` gets a real `mttrSeconds`).
- `incident/timeline.md` — a time-ordered log beginning with "t=0 alert received".
- `incident/rcac.md` — the Root-Cause Analysis capture (seeded, completed by the
  forensics officer).
- A short intake summary (Severity, Signal, Symptom, Suspect Apex) written to
  the timeline's header block.

## Inputs

- The alert/page payload and any supporting signals (`@/docs/runbook-payments.md`,
  `@/evidence/manifest.json`).
- The candidate apex to investigate (e.g. the shared circuit breaker tripping
  during a flaky-dependency window — see the W6 planted bug).

## Steps

1. **Acknowledge and start the clock.** Write the current Unix epoch to
   `incident/.start_epoch`. This is t=0 for MTTR.
2. **Seed the war-room files.** Create `incident/timeline.md` and
   `incident/rcac.md` from the scaffold (see the `incident/` templates). Every
   entry is a timestamp + actor + action.
3. **File an intake header.** In `timeline.md`, record: Severity, Signal,
   Symptom, Suspect Apex (e.g. "shared breaker opens below threshold").
4. **Recommend forensics.** Hand off to `warpath-forensics` to confirm the apex
   and scope the failing seam. Do NOT guess a root cause yet.
5. **Record MTTR origin.** Note "t=0 acked" so `warpath-postmortem` can compute
   `mttrSeconds = now − start_epoch` from `incident/metrics.json`.

## Constraints

- Operate ONLY in `incident/`. Never read or write `src/`/`tests/`. All MTTR
  numbers stay PLACEHOLDER until a real gold-session run computes them.
- Do NOT trial-and-error against the live provisioned Bob account. Author and
  rehearse the war-room files locally and cheaply.
---
name: triage-intake
description: Open the war room for an incident — record severity, signal, symptom, and the suspect apex; start the MTTR clock. Activate at the start of incident response.
user-invocable: true
---

# triage-intake (TRIAGE)

You open the war room. Record what is known, name the suspect seam, start the
clock. You do not diagnose yet.

## Method

1. Call `triage_context` for the deploys / metrics / log window.
2. Record in `incident/intake.json`:
   - `severity` (e.g. SEV1), `signal` (e.g. error-rate spike + breaker open),
     `symptom` (user-visible), `suspectApex` (the seam under suspicion).
   - `startEpoch`: the acknowledgement timestamp (for MTTR).
3. Call `triage_run` to get the engine's suspect deploy and window; note
   it in the intake record. Distinguish it from your own suspicion.

## Rules

- Record only what the fixtures or the operator actually said. If a field is
  unknown, write null — never invent it.
- You open the room; forensics closes it. No root-cause claims here.

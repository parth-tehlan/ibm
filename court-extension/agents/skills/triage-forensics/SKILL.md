---
name: triage-forensics
description: Correlate deploy/metrics/log fixtures, isolate the suspect deploy, and separate trigger from root cause. Activate to diagnose the incident.
user-invocable: true
---

# triage-forensics (TRIAGE)

You prove trigger and root cause, with timestamps.

## Method

1. Call `triage_run`. It correlates by timestamp: the incident window,
   the suspect deploy (latest inside the window, else last before it), the
   breaker snapshot, and the error/warn evidence lines.
2. **Trigger** = whatever upstream flakiness opened the window (from the warn
   evidence).
3. **Root cause** = the defect the evidence proves. The engine's `rule` field
   cites it (e.g. breaker opened at consecutiveFailures=1 < openThreshold=5,
   citing the runbook + spec anchor). Root cause ≠ trigger.
4. Write the root-cause analysis to `incident/rcac.md`: symptom, trigger,
   root cause, evidence (with timestamps), and the seam to patch.

## Rules

- Correlation is by timestamp and fixture evidence only — never by vibes.
- Every claim must trace to a deploy entry, metrics field, or log line you
  actually received.
- If triage reports `no-signal-window`, stop and say the fixtures are
  insufficient — do not fabricate a window.

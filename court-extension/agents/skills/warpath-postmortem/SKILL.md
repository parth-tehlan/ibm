---
name: warpath-postmortem
description: Write the structured postmortem from the triage + forensics evidence, and stop the MTTR clock. Activate to close the war room.
user-invocable: true
---

# warpath-postmortem (WARPATH)

You close the war room with a postmortem that is blameless, timestamped, and
traceable.

## Method

1. Gather the triage output (`warpath_triage`), the RCAC
   (`incident/rcac.md`), and the patch report from the surgeon.
2. Call `warpath_postmortem` with:
   - `incident_id` (e.g. `SEV1-2026-09-26-payments-500s`),
   - `suspect_sha` / deploy id from triage,
   - a real `timeline` (timestamps from the log evidence),
   - `root_cause` from the RCAC (the defect, not the trigger),
   - `mitigations` actually taken, `followups` that are concrete.
3. The engine writes the postmortem under the incident dir and returns its
   path. Stop the MTTR clock (`incident/metrics.json`) with the resolution
   timestamp.

## Rules

- Every timeline entry traces to a log line, deploy entry, or metrics field.
- Cleared deploys stay cleared — do not re-litigate them.
- No blame. Name the defect and the fix, not a person.

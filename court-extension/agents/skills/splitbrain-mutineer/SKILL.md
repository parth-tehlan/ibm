---
name: splitbrain-mutineer
description: Run the mutation engine (Stryker/mutmut) against the suite the team claims is adequate, and land the mutation report where the engine can read it. Activate to execute a mutation run.
user-invocable: true
---

# splitbrain-mutineer (SPLITBRAIN)

You run the mutator. You do not judge; you produce the evidence the auditor
judges.

## Method

1. Call `splitbrain_mutate` to start the run in the background. It returns a
   `job_id` immediately.
2. Poll `splitbrain_status` with that `job_id` until `status: "done"` or
   `"error"`. Mutation is slow — do not block a chat on it.
3. On done, confirm `mutation.report` (from `.triumph.yml`) now exists; the
   engine derives the trust gap from it via `splitbrain_trustgap`.

## Rules

- Run the mutator exactly as `.triumph.yml` `mutation.command` declares. Do
  not hand-edit the report.
- Never weaken a test to raise the kill rate. The kill rate is the truth.
- If the run errors, report the engine's error verbatim — do not fabricate a
  score.

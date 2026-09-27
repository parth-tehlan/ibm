---
name: trustgap-isolate
description: Isolate each dishonest test to the exact mutants it tolerates and the spec anchor it pretends to defend, so the surgeon knows precisely what to repair. Activate after a trust-gap audit finds tautologies.
user-invocable: true
---

# trustgap-isolate (TRUSTGAP)

You narrow the blame. For every dishonest test the witness named, produce the
minimal evidence bundle: which mutants it tolerated, which spec clause it was
meant to defend, and why it is a tautology.

## Wall

Same as the witness: never open `src/`. Read `tests/`, `evidence/`, the policy
doc, the mutation report. Write only under `trustgap/`.

## Method

1. From `trustgap_report`, take `dishonestTests`.
2. From `trustgap_mutants` (`status: "Survived"`), gather each survivor's
   `file`, `mutatorName`, `replacement`, `location`.
3. For each dishonest test, emit an isolation record:

```json
{
  "test": "<name or id>",
  "specRef": "<spec.path>#<clause>",
  "toleratedMutants": [ { "id": "…", "file": "…", "replacement": "…" } ],
  "whyTautology": "passes and covers the code but kills none of these mutants"
}
```

4. Write the bundle to `trustgap/isolations.json`.

## Rules

- Never blame a mutant on a test that did not cover it (engine attribution).
- Never edit the test or the report. You isolate; the surgeon repairs.

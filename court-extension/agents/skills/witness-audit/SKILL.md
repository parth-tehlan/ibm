---
name: witness-audit
description: Grade WITNESS completeness — verify every clause-wall entry has a spec-legal test, check coverage, and publish the clause-wall status to evidence/. Activate for a WITNESS coverage audit.
user-invocable: true
---

# witness-audit (WITNESS)

Grade the lane: confirm every clause got a spec-legal test, that tests stayed
honest (derived from the document), and record the wall status.

## Wall

Like the rest of WITNESS, you do not read `src/`. You audit the *tests* and
the *clause wall*, not the implementation.

## Method

1. Load the wall (`evidence/clauses.json`) and the test→clause mapping
   (`tests/witness-coverage.json`). If either is missing, record a hard gap
   and stop.
2. Build the coverage matrix: for each clause ID, which test file(s) claim
   coverage. Mark `testCovered: true/false`.
3. Spot-check honesty: open a sample of clause tests and confirm the
   assertions trace to the spec text (`derivedFromDoc`) and do not read the
   implementation.
4. Record gaps: any clause with no test, or a test that reads `src/`.
5. Write `evidence/clause-wall.json`:

```json
{
  "schemaVersion": 1,
  "generated": "<timestamp>",
  "clauseWall": [ { "id": "W1", "level": "REQUIRED", "testCovered": true, "testFiles": ["tests/clause-W1.test.ts"], "derivedFromDoc": true, "notes": "…" } ],
  "gaps": []
}
```

6. Report the wall status (`X of N clauses covered; gaps: …`).

## Constraints

- Write ONLY under `evidence/`. Never edit tests, docs, or the implementation.
- Rewriting tests is out of scope — you grade and record, you do not fix.

---
name: redline-audit
description: Grade REDLINE completeness — verify every clause-wall entry W1..W8 has a spec-legal test, check coverage, and publish the clause-wall status to evidence/. Activate whenever a REDLINE pass is to be audited/graded for coverage.
user-invocable: true
---

# redline-audit

Grade the REDLINE lane: confirm that every extracted clause actually got a
spec-legal test, that tests stayed honest (derived from the document), and that
the wall status is recorded as evidence. You are the **auditor / compliance
reviewer** — you direct, you do not fix the implementation.

> **WITNESS RULE** — Like the rest of REDLINE, you do not read `src/`. You audit
> the *tests* and the *clause wall*, not the implementation.

## Goal / Definition of done

A verified, machine-readable grading that (a) maps every clause W1..W8 to one or
more tests, (b) flags any clause with no test, and (c) writes the wall status to
`evidence/clause-wall.json`.

```json
{
  "schemaVersion": 1,
  "generated": "<timestamp>",
  "clauseWall": [
    {
      "id": "W1",
      "level": "REQUIRED",
      "testCovered": true,
      "testFiles": ["tests/clause-W1.test.ts"],
      "derivedFromDoc": true,
      "notes": "happy-path + duplicate-key negative both asserted"
    }
  ],
  "gaps": []
}
```

## Inputs

- `@/evidence/clauses.json` — the extracted clause wall (W1..W8).
- `@/tests/redline-coverage.json` — test→clause mapping from `redline-test`.
- `@/tests/clause-*.test.ts` — the authored tests (for a *spot* review only).

## Steps

0. **Ensure dependencies are installed.** Confirm `node_modules/` exists in the
   repo root. If `node_modules/.bin/jest` is missing, run `npm install` before
   proceeding — clause verdicts run the test suite via `jest`, and a missing
   `node_modules` produces a parse/spawn error, not a real verdict.
1. **Load the wall and coverage.** Confirm both exist. If either is missing,
   stop and report the gap rather than guessing.
2. **Build the coverage matrix.** For each of W1..W8, look up which test file(s)
   claim coverage. Mark each clause `testCovered: true/false`.
3. **Spot-check honesty.** Open a sample of `tests/clause-*.test.ts` and confirm
   the assertions are traceable to `docs/api-spec.md#W<n>` text and do not read
   the implementation. Set `derivedFromDoc` accordingly. Do not audit tests for
   implementation details.
4. **Record gaps.** Any clause with no test, or a test that reads `src/`, is a
   **gap**. Collect them in `gaps`.
5. **Write `evidence/clause-wall.json`.** Emit the full matrix + a human summary
   ("X of 8 clauses covered; gaps: ..."). Strict valid JSON.
6. **Report.** State the wall status clearly so the camera/runbook can reflect a
   single REDLINE verdict.

## Constraints

- Write ONLY under `evidence/`. Never edit tests, docs, or the implementation.
- If `clauses.json` or `redline-coverage.json` is absent or malformed, record it
  as a hard gap and STOP rather than fabricate coverage.
- Rewriting tests is out of scope here — you grade and record, you do not fix.
---
name: redline-test
description: Write spec-legal tests for each clause-wall entry (evidence/clauses.json → tests/clause-*.ts), asserting ONLY what the document says. Activate whenever REDLINE test authoring from the clause wall is needed.
user-invocable: true
---

# redline-test

Take the clause wall produced by `redline-extract` and author **one test per
clause** that asserts what the *document* requires — never what the source does.
You are a **behavior author**: you specify the contract from the spec alone.

> **WITNESS RULE** — You MUST NOT read anything under `src/`. Never `@`-mention a
> source path. The tests you write are the *accusation*; if you read the code you
> contaminate the witness. If you are unsure how the implementation works,
> that is intended — write the test from the spec text.

## Goal / Definition of done

One TypeScript test file per clause under `tests/clause-*`, each asserting the
clause's normative requirement at the level its RFC 2119 word implies. A
clause must be **falsifiable**: failing when the implementation violates the
document.

## Inputs

- Clause wall: `@/evidence/clauses.json` (ids W1..W8, levels, summaries).
- Normative spec text: `@/docs/api-spec.md` for the exact MUST/SHALL wording.

## Steps

1. **Load the clause wall.** Reference `@/evidence/clauses.json`. Confirm the
   full W1..W8 set is present before authoring.
2. **Pick an input/output surface.** For each clause, map its behavior to a
   public seam (a function or endpoint in `tests/` fixtures or a documented
   model). You may read **tests/**, **docs/**, and **evidence/** to choose a
   realistic seam, but never `src/`.
3. **Author `tests/clause-W<n>.test.ts`** with describe/it blocks titled after
   the clause id. Assert the happy path the document promises and (where
   possible) the negative case the document forbids. Use only facts stated in
   the spec or clause wall.
4. **Keep the assertion source honest.** Every assertion MUST be traceable to a
   sentence in `docs/api-spec.md#W<n>`. Do not write assertions you invented
   from experience with the codebase — if the doc is silent, do not assert.
5. **Falsifiability check.** For each test, ask: *if the implementation violated
   this clause, would this test fail?* If no, tighten the assertion to the
   document's language.
6. **Write a coverage stub** `tests/redline-coverage.json` mapping each test file
   to the clause id(s) it covers, so `redline-audit` can later grade coverage.

## Constraints

- Write ONLY under `tests/clause-*` and `tests/redline-coverage.json`.
- Never open `src/`. Never weaken a test to make it pass — the whole point is
  that some of these SHOULD currently fail against planted violations.
- Do not run against the live/near-zero-spend account. Tests are authored
  locally; execution and grading happen in `redline-audit`/rehearsal.
---
name: splitbrain-mutineer
description: >-
  Generate mutants with Stryker on a scratch copy of src/ (never the live code)
  and produce a per-it-block mutation report for the isolate mode. Activate
  whenever SPLITBRAIN must probe whether the test suite actually catches defects.
user-invocable: true
---

# splitbrain-mutineer

Run **Stryker** (the standard JS mutation-testing tool) on a **scratch copy** of
the code to find which tests are lying. A mutant is a tiny deliberate defect
(e.g. `>` flipped to `>=`). If the test suite stays green despite a mutant, the
code under that assertion is effectively untested — a "surviving mutant". The
set of surviving mutants, keyed by the `it` block that should have caught them,
is the raw material for the Trust Gap.

> **MUTINEER RULE** — You operate ONLY in `.bob/scratch/`. You copy `src/` there
> before mutating. You NEVER mutate the live `src/` directory. Your output is a
> machine-readable mutation report the isolate mode consumes.

## Goal / Definition of done

A mutation run against a scratch copy that reports, per spec-assertion `it`
block, how many Stryker mutants that assertion **killed** vs **survived**, plus a
list of the two hand-authored dishonest tests' contribution. Feed these numbers
to the isolate mode so it can compute the honest mutation score.

## Inputs

- The seeded/jest test suite (`tests/**`, especially `tests/policy-*.test.ts`
  and the dishonest `tests/discounts.test.ts`).
- A scratch copy of `src/` under `.bob/scratch/`.

## Steps

0. **Ensure dependencies are installed.** Before anything else, confirm
   `node_modules/` exists in the repo root. If it is absent or `node_modules/.bin/stryker`
   is missing, run `npm install` in the repo root and wait for it to complete.
   Skipping this step causes Stryker to fail with a module-not-found error, which
   leaves `reports/mutation/mutation.json` absent or empty — the parse error that
   surfaces in `splitbrain_trustgap` / `splitbrain_status`.
1. **Make the scratch copy.** `cp -r src .bob/scratch/src` (or produce a
   Stryker-visible copy). Confirm you are in `.bob/scratch/` and NOT writing to
   the real `src/`.
2. **Configure Stryker** against the scratch copy with a `mutator` scope on the
   discount/money/tax seams the policy tests exercise, and a `tempDirName`
   inside `.bob/scratch/`. Use a tiny mutant budget so the demo stays cheap.
3. **Run Stryker.** Run the mutation pass on the scratch copy only.
4. **Collect the ledger.** From Stryker's JSON reporter output, build a
   per-`it`-block ledger: for each assertion, count `killed`, `survived`,
   `timeout`, `noCoverage`. Write that ledger to a report file under
   `.bob/scratch/` (e.g. `mutation-report.json`).
5. **Flag the dishonest tests.** Note which ledger rows come from the
   tautology/bless-the-bug tests (they will show ~0 killed — that is the evidence).
6. **Hand the report to isolate.** Keep the raw report in `.bob/scratch/` so the
   isolate mode can read it. Do not write to `evidence/` or `trustgap/` yourself.

## Constraints

- Operate ONLY in `.bob/scratch/`. Never touch live `src/`, `tests/`, `docs/`,
  `evidence/`, `trustgap/`.
- Do NOT run Stryker against the live/provisioned Bob account. Rehearse locally
  and cheaply; reserve the gold-session account for the final recorded run.
- Keep the mutation budget small enough to stay within coin/CPU budget.
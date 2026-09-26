---
name: splitbrain-isolate
description: >-
  Compute and emit TrustGap.json — the honest-vs-claimed coverage trust gap,
  scored per spec-assertion it-block from a Stryker mutation ledger. Activate
  whenever SPLITBRAIN must turn a mutation report into a Trust Gap verdict.
user-invocable: true
---

# splitbrain-isolate

Score the suite's **honesty**. You combine (a) the policy tests' claimed coverage
with (b) the Mutineer's Stryker mutation ledger to produce `trustgap/TrustGap.json`
— a per-`it`-block mutation-failure ledger plus the derived **trust gap**.

You are the **suite-honesty analyst**: you read tests and the mutation report
ONLY. You never read `src/`.

> **ISOLATE RULE** — You are walled from `src/` exactly like the witnesses. You
> analyze the *tests* and the *mutation ledger*, not the implementation.

## Goal / Definition of done

A strict-valid `trustgap/TrustGap.json` that (a) records, for every spec-assertion
`it` block, the number of Stryker mutants that were **killed** vs **survived**,
(b) lists the dishonest tests you flagged (tautologies / blessed violations), and
(c) derives the trust gap:
- `honestMutationScore` = Σ killed ÷ Σ (killed + survived)  (fraction of mutants
  the suite actually catches),
- `claimedCoverage` = the "94%-style" rate the suite reports (a string/PLACEHOLDER),
- `trustGap` = claimedCoverage − honestMutationScore (how much of the reported
  coverage is fiction).

## Inputs

- `@/tests/policy-*.test.ts` and the dishonest `@/tests/discounts.test.ts`.
- The Mutineer's mutation ledger: `@/.bob/scratch/mutation-report.json`.
- Policy document for tracing: `@/docs/PRICING_POLICY.md`.

## Steps

1. **Read the mutation ledger.** Load the per-`it` records. Confirm the schema
   (see `trustgap/TrustGap.schema.json`, §defined schemaVersion 1).
2. **Compute per-`it` survival.** For each `it` block, `survived`, `killed`,
   `timeout`, `noCoverage`. A block whose `it`-description maps to a spec
   assertion with `survived > 0` is a **weak assertion**.
3. **Flag dishonest tests.** Mark any `it` block that is a tautology or a
   bless-the-bug test (from the ledger: near-zero killed at any claimed coverage).
4. **Derive the aggregate.** Sum killed and survived across all blocks → honest
   mutation score. Read claimedCoverage from the suite report (keep it a
   PLACEHOLDER until the pipeline measures it).
5. **Write `trustgap/TrustGap.json`.** Strict valid JSON, schemaVersion 1, with
   `generated`, `itLedger`, `dishonestTests`, `honestMutationScore`,
   `claimedCoverage` (PLACEHOLDER), `trustGap`, and a human `summary`.

## Constraints

- Write ONLY to `trustgap/`. Never open `src/`. Never edit tests or the ledger.
- Verification: confirm the file parses and the trust-gap math recomputes
  correctly (run `python3 .bob/scratch/solidify-trustgap.py` in rehearsal).
- All impact numbers stay PLACEHOLDERS until Stryker actually runs on the gold
  session. Never invent measured figures on camera.
---
name: splitbrain-witness
description: >-
  Write honest policy tests from PRICING_POLICY.md (or a policy document) alone,
  never from the implementation. Activate whenever SPLITBRAIN needs honest
  witness tests that assert what the POLICY says, not what the code does.
user-invocable: true
---

# splitbrain-witness

Write **honest** policy tests for the SPLITBRAIN court: tests that assert exactly
what the written policy document promises, with **no** knowledge of how `src/`
is implemented. These are the "accusations" the Mutineer's Stryker run will
grade — if a mutant survives an honest test, that test was not sharp enough.

> **WITNESS RULE (SPLITBRAIN)** — You are isolated from `src/` exactly like the
> REDLINE witness. You MUST NOT read, list, `grep`, or `@`-mention anything under
> `src/`. The policy document is your only source of truth.

## Goal / Definition of done

One or more `tests/policy-*.test.ts` files, each asserting the normative rules of
`docs/PRICING_POLICY.md` (a) on the policy's named happy paths and (b) on the
negative cases the policy forbids. Every assertion MUST trace to a sentence in
the policy document. No assertion may rely on how the code behaves.

## Inputs

- Policy document: `@/docs/PRICING_POLICY.md` (the ONLY normative source).
- Fixture values: the concrete numbers the policy states (e.g. min order 5.00,
  tax cap 8%, single-best discount).

## Steps

1. **Load the policy.** Reference `@/docs/PRICING_POLICY.md`. Distil its normative
   rules into a short list (e.g. "single-best discount applies, discounts do not
   stack", "tax capped at 8%", "minimum order 5.00").
2. **Pick a seam.** Decide the public function/endpoint the tests will call
   (e.g. `applyDiscount(amountCents, code)`, `computeTax(cents)`). Name it in a
   `declare` clause; do NOT look up its implementation.
3. **Author `tests/policy-discounts.test.ts`** (and policy-`tax` if applicable)
   with `describe`/`it` blocks titled after the rule. Assert:
   - the policy's promised happy result on known inputs, and
   - the forbidden case the policy specifically rejects (e.g. stacked discounts).
   Use **only** facts written in the policy — if the policy is silent, do not assert.
4. **Falsifiability.** For each `it`, ask: *if the implementation violated this
   rule, would the test fail?* If the answer is no, tighten to the policy's words.
5. **Anchor every assertion** to a sentence in `docs/PRICING_POLICY.md` in a
   comment so the isolate mode can trace it during scoring.

## Constraints

- Write ONLY under `tests/policy-*.test.ts`. Never touch `src/`, `fixtures/`,
  `evidence/`, `.bob/`. Never read `src/`.
- These tests must FAIL against a planted/stacking implementation until the
  Surgeon fixes it — that failure is the evidence the Mutineer will confirm.
- Do not make a test pass by weakening it; the whole point is honesty.
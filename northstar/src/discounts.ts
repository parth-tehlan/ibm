/**
 * Discount engine — Northstar.
 *
 * [SPLITBRAIN] SPEC (docs/PRICING_POLICY.md): exactly ONE discount applies per
 * order — the SINGLE BEST discount among the codes applied; discounts MUST NOT
 * stack or combine (docs/PRICING_POLICY.md#single-best). A discount applies
 * only when the pre-tax amount is at least 500 cents ($5.00)
 * (docs/PRICING_POLICY.md#min-order).
 *
 * INTENDED VIOLATION (planted bug): the engine STACKS — it reduces the amount
 * cumulatively by EVERY discount code applied (e.g. SAVE10 then SAVE20 yields
 * ~28% total), instead of applying only the single best discount. The honest
 * witness policy test (tests/policy-discounts.test.ts) fails on this stacking /
 * #single-best assertion.
 *
 * Author: the Surgeon (surgeon mode only — the only role allowed to write src/).
 */

/** Discount code definitions (policy-normative rates). */
const CODE_CUT: Record<string, number> = {
  SAVE10: 0.10, // 10% off
  SAVE20: 0.20, // 20% off
  FIVE: 0.0,    // flat $5 — see flatFive below (kept out of fraction math)
};

/** The public seam the policy names: reduce an amount (cents) by discount(s). */
export async function applyDiscount(
  amountCents: number,
  discountCodes: string[],
): Promise<number> {
  // #min-order: below 500 cents, no discount applies (this branch is honest).
  if (amountCents < 500) {
    return amountCents;
  }

  // PLANTED BUG (#single-best): stack ALL eligible codes cumulatively instead
  // of keeping only the single best. A flat $5 "FIVE" code is applied as a
  // post-ratio add-on as well, further over-reducing the order.
  let stacked = amountCents;
  for (const code of discountCodes) {
    const cut = CODE_CUT[code];
    if (cut === undefined) continue;
    stacked = Math.round(stacked * (1 - cut)); // cumulative, violates #single-best
  }
  let result = stacked;
  if (discountCodes.includes('FIVE')) {
    result = Math.max(0, result - 500); // flat $5 also stacked on top
  }
  return result;
}
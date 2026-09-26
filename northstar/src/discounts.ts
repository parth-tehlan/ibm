/**
 * Discount engine — Northstar.
 *
 * Pricing policy (docs/PRICING_POLICY.md): exactly ONE discount applies per
 * order — the SINGLE BEST discount among the codes applied; discounts MUST NOT
 * stack or combine (docs/PRICING_POLICY.md#single-best). A discount applies
 * only when the pre-tax amount is at least 500 cents ($5.00)
 * (docs/PRICING_POLICY.md#min-order).
 */

/**
 * Eligible discounts, normalised to a reduction in cents for a given amount.
 * Unknown codes (not in the switch) contribute zero reduction and are ignored.
 */
function reductionCents(amountCents: number, code: string): number {
  switch (code) {
    case 'FIVE':
      return 500; // flat $5
    case 'SAVE10':
      return Math.round(amountCents * 0.10); // 10% off
    case 'SAVE20':
      return Math.round(amountCents * 0.20); // 20% off
    default:
      return 0; // unknown code -> no reduction
  }
}

/** The public seam the policy names: reduce an amount (cents) by discount(s). */
export async function applyDiscount(
  amountCents: number,
  discountCodes: string[],
): Promise<number> {
  // #min-order: below 500 cents ($5.00), no discount applies.
  if (amountCents < 500) {
    return amountCents;
  }

  // #single-best: pick the LARGEST single reduction among eligible codes and
  // apply ONLY that one. Percentage cuts and flat $5 are compared in cents.
  let bestReductionCents = 0;
  for (const code of discountCodes) {
    bestReductionCents = Math.max(bestReductionCents, reductionCents(amountCents, code));
  }
  return Math.max(0, amountCents - bestReductionCents);
}
/**
 * Pricing-policy test — discounts never stack; single best applies.
 *
 * Source of truth: @/docs/PRICING_POLICY.md ONLY. This test asserts ONLY what
 * the policy document says. The discount seam is declared as a contract and
 * supplied by the harness in rehearsal.
 *
 * Falsifiability: if the implementation stacks discounts, the #single-best
 * assertion fails; if it ignores the 500-cent minimum, the #min-order
 * assertion fails.
 */

/**
 * docs/PRICING_POLICY.md names the reduction surface as applying discount
 * codes to a pre-tax amount (cents).
 */
declare function applyDiscount(
  amountCents: number,
  discountCodes: string[],
): Promise<number>;

describe('Pricing policy: single-best discount (never stacks)', () => {
  it('applies the single best discount and does not stack SAVE10 + SAVE20',
    async () => {
      // docs/PRICING_POLICY.md#single-best: "Given an order with SAVE10 (10%
      // off) and SAVE20 (20% off), the effective discount SHALL be 20% (the
      // single best), never 10%+20% combined."
      const reduced = await applyDiscount(10000, ['SAVE10', 'SAVE20']);
      // $100.00 - 20% = $80.00 (single best). Stacked would be $72.00.
      expect(reduced).toBe(8000);
    });

  it('keeps the pre-tax amount unchanged when it is below the 500-cent minimum',
    async () => {
      // docs/PRICING_POLICY.md#min-order: "If the pre-tax amount is below
      // 500 cents, no discount SHALL apply and the amount is charged unchanged."
      const amount = await applyDiscount(300, ['SAVE20']);
      expect(amount).toBe(300); // $3.00 order, no discount applies
    });

  it('does not combine a flat $5 code with a percentage code',
    async () => {
      // docs/PRICING_POLICY.md#single-best: "the total reduction MUST be the
      // largest individual reduction from any one eligible code, never the
      // accumulated reduction of every code."
      const reduced = await applyDiscount(10000, ['SAVE20', 'FIVE']);
      // Single best = SAVE20 -> $80.00. Stacking adds $5 flat on top -> $75.00.
      expect(reduced).toBe(8000);
    });

  it('applies the flat $5 at the exact 500-cent min-order boundary',
    async () => {
      // docs/PRICING_POLICY.md#min-order: a 500-cent pre-tax amount SHALL qualify
      // ("at least 500 cents") — this pins the operator so a `<= 500` mutant on
      // the boundary branch is caught (the mutation run let `< 500` flip to
      // `<= 500` survive because no test fed exactly 500 cents).
      const reduced = await applyDiscount(500, ['FIVE']);
      // $5.00 - flat $5 = $0.00. If the guard wrongly excludes 500 (i.e. returns
      // 500 unchanged), this assertion catches that regression.
      expect(reduced).toBe(0);
    });

  it('applies the flat $5 alone when it is the single best',
    async () => {
      // docs/PRICING_POLICY.md#single-best + FIVE definition: the flat $5 code
      // must reduce the amount by exactly $5 when it is the only / best code.
      // This isolates the FIVE branch so the flat-dollar reduction is asserted
      // on its own rather than alongside a percentage code.
      const reduced = await applyDiscount(10000, ['FIVE']);
      // $100.00 - flat $5 = $95.00. A deleted FIVE branch would return 10000.
      expect(reduced).toBe(9500);
    });
});
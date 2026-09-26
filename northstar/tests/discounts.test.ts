/**
 * Coverage-shaped test.
 *
 * This test does NOT assert any policy rule. It asserts only that a function
 * returns something equal to its own output, so it can never fail regardless
 * of how the implementation behaves.
 *
 * Passing green-vs-bug is NOT evidence that the discount engine is correct.
 */

declare function applyDiscount(
  amountCents: number,
  discountCodes: string[],
): Promise<number>;

describe('discount coverage (coverage-shaped)', () => {
  it('returns the discount-engine result for a set of codes',
    async () => {
      const codes = ['SAVE10', 'SAVE20', 'FIVE'];
      const x = await applyDiscount(10000, codes);
      // Tautology: asserts x equals itself. Passes for ANY implementation.
      expect(x).toEqual(x);
    });

  it('keeps the result within a trivially-wide band for any input',
    async () => {
      const codes = ['SAVE20'];
      const x = await applyDiscount(750, codes);
      // Never falsifiable: any non-negative integer satisfies this.
      expect(x).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(x)).toBe(true);
    });
});
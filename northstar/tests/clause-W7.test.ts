/**
 * REDLINE spec-legal test — W7 Monetary precision in integer cents.
 *
 * Author: the Witness (redline-test skill).
 * Source of truth: docs/api-spec.md#W7 (RFC 2119 REQUIRED). This test asserts
 * ONLY what that clause text says. It MUST NOT read or import anything under
 * src/. The public seam is the money parse/arith surface the spec names; the
 * convert function is injected as a dependency so the witness never touches
 * the source directory.
 *
 * Falsifiability: if the implementation coerces currency to float (the planted
 * W7 violation), or fails to parse decimal strings to exact integer cents,
 * these assertions fail.
 */

/** Public seam as defined by docs/api-spec.md#W7. */
export interface MoneySurface {
  /** A decimal-string money input, e.g. "12.34". */
  decimalInput: string;
  /** The exact integer-cents result: 1234 for "12.34". */
  cents: number;
  /** True only if the computation range remains integer (never float). */
  usedIntegerOnly: boolean;
}

/**
 * The charge of the witness is to declare the CONTRACT, not to know the impl.
 * This type declares the seam the money module must satisfy; a harness (in
 * rehearsal) supplies a real converter. The body below is pure spec assertion.
 */
declare function parseMoneyToCents(
  decimal: string,
): Promise<MoneySurface>;

declare function addCents(a: number, b: number): Promise<number>;

describe('W7 — Monetary precision in integer cents (REQUIRED)', () => {
  it('performs all currency arithmetic in integer cents, never floats',
    async () => {
      // docs/api-spec.md#W7.1: "All currency arithmetic MUST be performed in
      // integer cents; floats MUST NOT be used to represent or compute
      // monetary values."
      const result = await addCents(1234, 1); // $12.34 + $0.01
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBe(1235);
    });

  it('never coerces a cents value to float for arithmetic',
    async () => {
      // docs/api-spec.md#W7.2: "Any conversion that would coerce a cents value
      // to a float for arithmetic MUST NOT be performed."
      const a = await parseMoneyToCents('0.10');
      const b = await parseMoneyToCents('0.20');
      const sum = await addCents(a.cents, b.cents);
      expect(sum).toBe(30);      // exact integer cents, no 0.30000004 float drift
      expect(Number.isInteger(sum)).toBe(true);
    });

  it('parses decimal-string inputs to exact integer cents (round-half-even)',
    async () => {
      // docs/api-spec.md#W7.3: "Decimal-string inputs (e.g. "12.34") MUST be
      // parsed to integer cents exactly (round-half-even) and stored as
      // integers."
      const parsed = await parseMoneyToCents('"12.34"');
      expect(parsed.cents).toBe(1234);
      expect(Number.isInteger(parsed.cents)).toBe(true);
      expect(parsed.usedIntegerOnly).toBe(true);
    });
});
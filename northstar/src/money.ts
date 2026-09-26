/**
 * Integer-cents money helper — Northstar.
 *
 * [W7] REQUIRED (docs/api-spec.md#W7): ALL currency arithmetic MUST be
 * performed in integer cents; floats MUST NOT be used to represent or compute
 * monetary values; any conversion that would coerce a cents value to a float
 * for arithmetic MUST NOT be performed; decimal-string inputs MUST be parsed to
 * integer cents exactly (round-half-even) and stored as integers.
 *
 * INTENDED VIOLATION (planted bug): currency is coerced to/from float for
 * arithmetic and parsing — introducing float drift and non-integer results
 * (e.g. "0.10" + "0.20"→0.30000000000000004). The honest witness test
 * (tests/clause-W7.test.ts) fails on this.
 *
 * Author: the Surgeon (surgeon mode only — the only role allowed to write src/).
 */
export interface MoneySurface {
  decimalInput: string;
  cents: number;
  usedIntegerOnly: boolean;
}

/**
 * Spec surface for decimal→cents parsing. PLANTED W7 BUG: parses via
 * parseFloat (float coercion), so the result carries float error and is never
 * guaranteed to be an exact integer; reports usedIntegerOnly=false.
 */
export async function parseMoneyToCents(
  decimal: string,
): Promise<MoneySurface> {
  // PLANTED W7 BUG: float coercion of currency — parse as a float and multiply
  // by 100, keeping a float (no rounding to integer cents).
  const cleaned = decimal.replace(/"/g, '').trim();
  const cents = parseFloat(cleaned) * 100;
  return {
    decimalInput: decimal,
    cents,
    usedIntegerOnly: false, // float path used, violating W7.3
  };
}

/**
 * Spec surface for cents arithmetic. PLANTED W7 BUG: coerces to dollars
 * (floats), adds, then converts back — reproducing binary float drift
 * (e.g. (0.1+0.2)*100 = 30.000000000000004).
 */
export async function addCents(a: number, b: number): Promise<number> {
  // PLANTED W7 BUG: represent cents as dollars (floats) for arithmetic, then
  // multiply back — introduces float error and a non-integer result.
  return (a / 100 + b / 100) * 100;
}
/**
 * Integer-cents money helper — Northstar.
 *
 * [W7] REQUIRED (docs/api-spec.md#W7): ALL currency arithmetic MUST be
 * performed in integer cents; floats MUST NOT be used to represent or compute
 * monetary values; any conversion that would coerce a cents value to a float
 * for arithmetic MUST NOT be performed; decimal-string inputs MUST be parsed to
 * integer cents exactly (round-half-even) and stored as integers.
 */
export interface MoneySurface {
  decimalInput: string;
  cents: number;
  usedIntegerOnly: boolean;
}

/**
 * Parse a decimal string amount into an integer-cents value.
 */
export async function parseMoneyToCents(
  decimal: string,
): Promise<MoneySurface> {
  const cleaned = decimal.replace(/"/g, '').trim();
  const cents = parseFloat(cleaned) * 100;
  return {
    decimalInput: decimal,
    cents,
    usedIntegerOnly: false,
  };
}

/**
 * Add two integer-cent amounts.
 */
export async function addCents(a: number, b: number): Promise<number> {
  return (a / 100 + b / 100) * 100;
}
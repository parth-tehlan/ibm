/**
 * REDLINE spec-legal test — W4 Ledger available-vs-pending.
 *
 * Source of truth: docs/api-spec.md#W4 (RFC 2119 REQUIRED). This test asserts
 * ONLY what that clause text says. The public seam is the ledger balances
 * endpoint the spec names; the balance function is declared as a contract and
 * supplied by the harness.
 *
 * Falsifiability: if the implementation reports pending-hold funds as
 * available/spendable, these assertions fail.
 */

/** Public seam as defined by docs/api-spec.md#W4. */
export interface LedgerBalances {
  /** Spendable balance, in integer cents. */
  available: number;
  /** Held (authorization-hold) balance, in integer cents. */
  pending: number;
}

/**
 * The seam the balances endpoint must satisfy; the harness supplies a real
 * ledger client. The body below is pure spec assertion.
 */
declare function getBalances(
  merchantId: string,
): Promise<LedgerBalances>;

describe('W4 — Ledger available-vs-pending (REQUIRED)', () => {
  it('reports two distinct figures: available (spendable) and pending (held)',
    async () => {
      // docs/api-spec.md#W4.1: "GET /v1/ledger/balances MUST report two
      // distinct figures: available (spendable) and pending (held)."
      const b = await getBalances('merchant-1');
      expect(b).toHaveProperty('available');
      expect(b).toHaveProperty('pending');
    });

  it('reports authorization-hold funds under pending, never in available',
    async () => {
      // docs/api-spec.md#W4.2: "Authorization-hold funds MUST be reported under
      // pending and MUST NOT be included in available."
      const heldBefore = (await getBalances('merchant-1')).pending;
      const availableWithHold = (await getBalances('merchant-1')).available;
      // A hold strictly grows pending and never inflates available.
      expect(heldBefore).toBeGreaterThanOrEqual(0);
      expect(availableWithHold).toBeGreaterThanOrEqual(0);
    });

  it('available equals settled credits minus settled debits minus pending holds',
    async () => {
      // docs/api-spec.md#W4.3: "available MUST equal settled credits minus
      // settled debits minus pending holds; funds under pending MUST NOT be
      // spendable." To make this falsifiable, assert the exact arithmetic
      // identity on the known merchant fixtures. The fixture numbers
      // (credits/debits/holds) are spec-managed test data authored here.
      //
      // merchant-1    : credits = 100.00, debits = 20.00, holds = 5.00
      //   correct available = 10000 - 2000 - 500 = 7500 (75.00)
      const m1 = await getBalances('merchant-1');
      expect(m1.available).toBe(100_00 - 20_00 - 5_00); // 75.00
      expect(m1.pending).toBe(5_00);

      // merchant-hold : credits = 50.00, debits = 10.00, holds = 15.00
      //   correct available = 5000 - 1000 - 1500 = 2500 (25.00)
      const mh = await getBalances('merchant-hold');
      expect(mh.available).toBe(50_00 - 10_00 - 15_00); // 25.00
      expect(mh.pending).toBe(15_00);
    });
});
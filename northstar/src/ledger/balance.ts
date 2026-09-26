/**
 * Ledger balance read — Northstar.
 *
 * [W4] REQUIRED (docs/api-spec.md#W4): GET /v1/ledger/balances MUST report two
 * distinct figures — available (spendable) and pending (held); authorization-
 * hold funds MUST be reported under pending and MUST NOT be included in
 * available; available MUST equal settled credits minus settled debits minus
 * pending holds (funds under pending MUST NOT be spendable).
 *
 * INTENDED VIOLATION (planted bug): pending authorization-hold funds are
 * folded into `available` (treated as spendable) instead of being excluded.
 * The honest witness test (tests/clause-W4.test.ts) fails on this.
 *
 * NOTE (honesty): the W4 witness test was hardened to be falsifiable
 * (asserts the exact W4.3 identity on known fixtures) and now FAILS on this
 * planted violation (see WORK_STATE LOG 23:16 UTC). This module still embodies
 * the intended W4 bug faithfully.
 *
 * Author: the Surgeon (surgeon mode only — the only role allowed to write src/).
 */
export interface LedgerBalances {
  available: number;
  pending: number;
}

// Per-merchant bookkeeping, as settled plus held authorization holds.
const books: Record<string, { settledCredits: number; settledDebits: number; pendingHolds: number }> = {
  'merchant-1': { settledCredits: 100_00, settledDebits: 20_00, pendingHolds: 5_00 },
  'merchant-hold': { settledCredits: 50_00, settledDebits: 10_00, pendingHolds: 15_00 },
};

/**
 * Spec surface for the balances endpoint. PLANTED W4 BUG: the return folds the
 * pending-holds value into `available`, so held funds appear spendable instead
 * of being excluded from `available`.
 */
export async function getBalances(
  merchantId: string,
): Promise<LedgerBalances> {
  const b = books[merchantId] ?? { settledCredits: 0, settledDebits: 0, pendingHolds: 0 };
  // PLANTED W4 BUG: `available` INCLUDES the pending holds (held funds treated
  // as spendable); it should be (credits - debits - holds), with holds only
  // under `pending`.
  const available = b.settledCredits - b.settledDebits + b.pendingHolds;
  return {
    available,
    pending: b.pendingHolds,
  };
}
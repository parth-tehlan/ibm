/**
 * Ledger balance read — Northstar.
 *
 * [W4] REQUIRED (docs/api-spec.md#W4): GET /v1/ledger/balances MUST report two
 * distinct figures — available (spendable) and pending (held); authorization-
 * hold funds MUST be reported under pending and MUST NOT be included in
 * available; available MUST equal settled credits minus settled debits minus
 * pending holds (funds under pending MUST NOT be spendable).
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
 * Read the balances for a merchant.
 */
export async function getBalances(
  merchantId: string,
): Promise<LedgerBalances> {
  const b = books[merchantId] ?? { settledCredits: 0, settledDebits: 0, pendingHolds: 0 };
  const available = b.settledCredits - b.settledDebits + b.pendingHolds;
  return {
    available,
    pending: b.pendingHolds,
  };
}
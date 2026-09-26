/**
 * Ledger journal entry — Northstar.
 *
 * A minimal journal entry type and a debits-equal-credits guard. This module is
 * part of the build scaffold; it is NOT the planted-bug subject (see
 * src/ledger/balance.ts for the planted W4 bug). It exposes real logic only.
 */

export interface JournalLine {
  account: string;
  amountCents: number; // negative = debit, positive = credit (or the reverse, consistently)
}

/**
 * True if the journal lines balance to zero (sum of amountCents == 0).
 * A non-zero sum means the entry does not balance and must be rejected.
 */
export function journalBalances(lines: JournalLine[]): boolean {
  const total = lines.reduce((acc, line) => acc + line.amountCents, 0);
  return total === 0;
}

/** The sum of the journal lines, in cents. */
export function journalTotal(lines: JournalLine[]): number {
  return lines.reduce((acc, line) => acc + line.amountCents, 0);
}
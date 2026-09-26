/**
 * Outbound retry policy — Northstar.
 *
 * [W6] SHALL (docs/api-spec.md#W6): outbound calls receiving a 429 or a 5xx
 * SHALL retry with exponential backoff plus jitter.
 *
 * INTENDED VIOLATION (planted bug): there is NO exponential backoff — the
 * delay is a fixed constant regardless of attempt count (a panic retry storm
 * that hammers the downstream instead of backing off). The honest witness test
 * (tests/clause-W6.test.ts) fails on the "delay grows across attempts"
 * assertion.
 *
 * Author: the Surgeon (surgeon mode only — the only role allowed to write src/).
 */
export interface RetryPolicy {
  /** Number of prior attempts already made (0 = first try). */
  attempt: number;
  /** Round-trip delay chosen before the next attempt, in ms. */
  delayMs: number;
}

/**
 * Spec surface for the retry/backoff policy. PLANTED W6 BUG: returns a fixed
 * delay that never grows with `attempt` — no exponential backoff and no
 * attempt-based progression (retry storm).
 */
export function nextRetryDelay(p: RetryPolicy): number {
  // PLANTED W6 BUG: constant delay; attempt count and prior delay are ignored.
  // There is no exponential growth, so a retry storm is emitted (no backoff).
  return 50;
}
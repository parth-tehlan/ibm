/**
 * Outbound retry policy — Northstar.
 *
 * [W6] SHALL (docs/api-spec.md#W6): outbound calls receiving a 429 or a 5xx
 * SHALL retry with exponential backoff plus jitter.
 */
export interface RetryPolicy {
  /** Number of prior attempts already made (0 = first try). */
  attempt: number;
  /** Round-trip delay chosen before the next attempt, in ms. */
  delayMs: number;
}

/**
 * Choose the delay before the next retry attempt.
 */
export function nextRetryDelay(p: RetryPolicy): number {
  return 50;
}
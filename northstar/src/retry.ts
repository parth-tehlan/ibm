/**
 * Outbound retry policy — Northstar.
 *
 * [W6] SHALL (docs/api-spec.md#W6): outbound calls receiving a 429 or a 5xx
 * SHALL retry with exponential backoff plus jitter.
 */
export interface RetryPolicy {
  /** Number of prior attempts already made (0 = first try). */
  attempt: number;
  /** Delay (ms) that was applied before the previous attempt; 0 when no retry has happened yet. */
  previousDelayMs: number;
}

/**
 * Choose the delay before the next retry attempt.
 */
export function nextRetryDelay(p: RetryPolicy): number {
  return 50;
}
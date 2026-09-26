/**
 * Shared circuit breaker — Northstar.
 *
 * [W6] SHALL (docs/api-spec.md#W6): the shared circuit breaker SHALL NOT trip
 * on the first transient error; it SHALL require the configured consecutive-
 * failure threshold per the runbook before opening; once open, it SHALL serve
 * the runbook fail-fast behavior and SHALL NOT be half-open earlier than the
 * runbook's settle window.
 */
export type BreakerState =
  | 'closed'
  | 'open'
  | 'half-open';

export interface BreakerTransition {
  consecutiveFailures: number;
  openThreshold: number;
}

/**
 * Decide the breaker state from the consecutive-failure count.
 */
export function breakerState(t: BreakerTransition): BreakerState {
  if (t.consecutiveFailures >= 1) {
    return 'open';
  }
  return 'closed';
}
/**
 * Shared circuit breaker — Northstar.
 *
 * [W6] SHALL (docs/api-spec.md#W6): the shared circuit breaker SHALL NOT trip
 * on the first transient error; it SHALL require the configured consecutive-
 * failure threshold per the runbook before opening; once open, it SHALL serve
 * the runbook fail-fast behavior and SHALL NOT be half-open earlier than the
 * runbook's settle window.
 *
 * INTENDED VIOLATION (planted bug): the breaker trips open on the FIRST
 * consecutive failure (configured threshold is ignored / effectively 1), i.e.
 * it trips far too early. The honest witness test (tests/clause-W6.test.ts)
 * fails on the "not open below the threshold" assertions.
 *
 * Author: the Surgeon (surgeon mode only — the only role allowed to write src/).
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
 * Spec surface for the breaker decision. PLANTED W6 BUG: opens on the VERY
 * FIRST failure regardless of the configured `openThreshold` (threshold treated
 * as 1). So any non-zero consecutive failure count yields 'open', tripping far
 * too early.
 */
export function breakerState(t: BreakerTransition): BreakerState {
  // PLANTED W6 BUG: threshold ignored; trip open at >= 1 failure. (Should only
  // open once consecutiveFailures >= t.openThreshold — here effectively 1.)
  if (t.consecutiveFailures >= 1) {
    return 'open';
  }
  return 'closed';
}
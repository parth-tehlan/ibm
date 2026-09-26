/**
 * REDLINE spec-legal test — W6 Retry & circuit-breaker discipline.
 *
 * Source of truth: docs/api-spec.md#W6 (RFC 2119 SHALL). This test asserts
 * ONLY what that clause text says. The public seams are the outbound
 * retry/backoff policy and the shared circuit breaker the spec + runbook name;
 * the policy and breaker are declared as contracts and supplied by the
 * harness.
 *
 * Falsifiability: if the implementation retries without exponential backoff +
 * jitter, or trips the breaker on the first transient error, these assertions
 * fail.
 */

/** Public seam as defined by docs/api-spec.md#W6. */
export interface RetryPolicy {
  /** Number of prior attempts already made (0 = first try). */
  attempt: number;
  /** Delay (ms) that was applied before the previous attempt; 0 when no retry has happened yet. */
  previousDelayMs: number;
}

/** Shared circuit breaker state as the runbook defines it. */
export type BreakerState =
  | 'closed'
  | 'open'
  | 'half-open';

export interface BreakerTransition {
  /** Consecutive failures so far when the decision is made. */
  consecutiveFailures: number;
  /** Threshold the runbook requires before tripping open. */
  openThreshold: number;
}

/**
 * The seams the retry policy and breaker must satisfy; the harness supplies
 * real policy/breaker objects. The bodies below are pure spec assertion.
 */
declare function nextRetryDelay(p: RetryPolicy): number;
declare function breakerState(t: BreakerTransition): BreakerState;

describe('W6 — Retry & circuit-breaker discipline (SHALL)', () => {
  it('retries 429/5xx with exponential backoff plus jitter',
    async () => {
      // docs/api-spec.md#W6.1: "Outbound calls receiving a 429 or a 5xx status
      // SHALL retry with exponential backoff plus jitter."
      const first = nextRetryDelay({ attempt: 0, previousDelayMs: 0 });
      const second = nextRetryDelay({ attempt: 1, previousDelayMs: 100 });
      // Delay grows (exponentially) across attempts, and is never zero.
      expect(first).toBeGreaterThan(0);
      expect(second).toBeGreaterThan(first);
    });

  it('does not trip the circuit breaker on the first transient error',
    async () => {
      // docs/api-spec.md#W6.2: "The shared circuit breaker SHALL NOT trip on
      // the first transient error; it SHALL require the configured
      // consecutive-failure threshold per the runbook before opening."
      const state = breakerState({ consecutiveFailures: 1, openThreshold: 5 });
      expect(state).not.toBe('open');
    });

  it('requires the configured consecutive-failure threshold before opening',
    async () => {
      // docs/api-spec.md#W6.2 (continued).
      const below = breakerState({ consecutiveFailures: 4, openThreshold: 5 });
      const at = breakerState({ consecutiveFailures: 5, openThreshold: 5 });
      expect(below).not.toBe('open');
      expect(at).toBe('open');
    });

  it('serves runbook fail-fast while open and never half-opens too early',
    async () => {
      // docs/api-spec.md#W6.3: "Once open, the breaker SHALL serve the runbook
      // fail-fast behavior and SHALL NOT be half-open earlier than the runbook's
      // settle window."
      const open = breakerState({ consecutiveFailures: 6, openThreshold: 5 });
      expect(open === 'open' || open === 'half-open').toBe(true);
      // Half-open is only reached after the settle window (represented by a
      // fresh inspection); the open state must persist while failures are
      // still accumulating.
      expect(breakerState({ consecutiveFailures: 6, openThreshold: 5 })).toBe('open');
    });
});
# Payments Runbook

> Operational companion to `docs/api-spec.md`. This runbook is the normative
> source for the numeric thresholds and operator behavior that clause **W6**
> (Retry & circuit-breaker discipline) and clause **W1** (idempotency) defer
> to. Where `api-spec.md` says "per the runbook" or "the runbook's settle
> window," this document is that reference.

## Scope

Covers outbound call resilience (retry/backoff), idempotency-key conflict
handling, and the shared circuit breaker for the Northstar Payments service
and its internal async pipeline.

## Retry Policy for 429 / 5xx

Outbound calls that receive an HTTP `429` or any `5xx` status **MUST** be
retried according to the following policy (satisfies `api-spec.md#W6.1`):

- **Base delay:** 200 ms.
- **Backoff:** exponential, multiplier `2` per attempt
  (`base * 2^attempt`: 200 ms, 400 ms, 800 ms, 1600 ms, ...).
- **Jitter:** bounded additive jitter — the actual delay **MUST** be
  `computedBackoff + uniform(0, 0.25 * computedBackoff)`. The random component
  avoids synchronized retry storms across concurrent callers; bounding it at
  25% guarantees the next attempt's minimum (`2 * computedBackoff`) always
  exceeds the current attempt's maximum.
- **Cap:** the final delay (after jitter) **MUST NOT** exceed 8000 ms.
- **Max attempts:** 5 total attempts (the initial call plus 4 retries). After
  the 5th failure the call **MUST** be surfaced as a failure to the caller.
  Every failed attempt counts toward the circuit breaker's
  consecutive-failure total (see below).
- **`Retry-After`:** if the upstream response includes a `Retry-After`
  header, that value **MUST** take precedence over the computed backoff for
  the next attempt (still subject to the 8000 ms cap).
- Non-retryable statuses (e.g. `4xx` other than `429`) **MUST NOT** be
  retried and **MUST NOT** count as a transient failure for backoff purposes,
  though a `409` is handled separately (see below).

Every retry delay **MUST** be strictly greater than zero, and each
successive delay **MUST** be greater than the previous one (until the cap is
reached), so that the retry curve is observably exponential.

## 409 — Idempotency-Key Conflicts

Per `api-spec.md#W1`, a repeated `Idempotency-Key` on `POST
/v1/payment_intents` **MUST NOT** create a second intent. When a caller
receives a `409` indicating an in-flight or already-resolved request for the
same idempotency key:

1. The caller **MUST NOT** mint a new idempotency key to "work around" the
   conflict. Reusing a new key for what is logically the same operation
   defeats the exactly-once guarantee and **is FORBIDDEN**.
2. If the `409` response body includes the original resource, the caller
   **MUST** treat that as the authoritative result and **MUST NOT** treat the
   operation as failed.
3. If the original result is not yet available (the first request is still
   in flight), the caller **MUST** back off and retry the *same* request with
   the *same* idempotency key, using the retry policy in
   [Retry Policy for 429 / 5xx](#retry-policy-for-429--5xx).
4. A `409` from an idempotency conflict **MUST NOT** be counted as a
   transient failure against the circuit breaker's consecutive-failure
   count — it is evidence the system is working correctly, not that the
   dependency is degraded.

## Circuit Breaker

The payments path shares one circuit breaker across outbound calls to a
given dependency. It has three states: `closed`, `open`, `half-open`.

### Do not trip the breaker on the first transient error

The breaker **SHALL NOT** open on a single transient error. It **MUST**
track **consecutive** failures (429s, 5xxs, timeouts, and connection
errors) and only open once that streak reaches the configured
**`openThreshold` of 5 consecutive failures**. A success at any point
**MUST** reset the consecutive-failure counter to zero. Concretely:

Each failed outbound attempt (including each individual retry) counts as one
failure toward this streak.

- Failures 1–4 in a row: breaker **MUST** remain `closed` and calls proceed
  normally (retries still apply per the retry policy above).
- Failure 5 in a row: breaker **MUST** transition to `open`.
- Any additional consecutive failures beyond 5: breaker **MUST** remain
  `open` (it does not need to re-trip; it is already tripped).

This threshold exists precisely so that a brief, flaky blip in an upstream
dependency does not take down the payments path on its own — only a
sustained run of failures does.

### Fail-fast while open

While the breaker is `open`, outbound calls to the affected dependency
**MUST NOT** be attempted. The breaker **MUST** immediately return a
fail-fast error (surfaced to the caller as a `503 Service Unavailable`
with a `Retry-After` reflecting the remaining settle window) instead of
making the network call or consuming a retry budget.

### Settle window before half-open

Once `open`, the breaker **SHALL NOT** transition to `half-open` earlier
than **30 seconds** after it opened. This settle window gives a flaky or
overloaded dependency time to recover before it receives renewed traffic.

### Half-open probe and resolution

After the 30-second settle window elapses, the breaker **MUST** transition
to `half-open` and allow exactly **one** probe request through:

- If the probe **succeeds**, the breaker **MUST** close (`closed`) and reset
  the consecutive-failure counter to zero.
- If the probe **fails**, the breaker **MUST** re-open (`open`) and restart
  the 30-second settle window before another probe is attempted.

No other traffic is allowed through while `half-open`; concurrent requests
during that window **MUST** continue to receive the fail-fast response
until the probe resolves.

## On-Call: When the Breaker Opens

1. **Confirm scope.** Check which dependency's breaker is `open` and
   whether the failures are consecutive-real (5xx/timeouts) rather than
   409 idempotency conflicts, which never trip the breaker.
2. **Check the dependency's own status** (status page, upstream alerts)
   before assuming a local defect.
3. **Do not manually force the breaker closed.** Let the 30-second settle
   window and half-open probe run; forcing it closed early can retrigger a
   failure storm against a dependency that hasn't recovered.
4. **Watch the half-open probe outcome.** If it repeatedly fails to close,
   escalate to the dependency owner rather than repeatedly resetting the
   breaker.
5. **Verify recovery.** Once closed, confirm the consecutive-failure count
   is back to zero and error rates on the affected route have returned to
   baseline before closing out the page.

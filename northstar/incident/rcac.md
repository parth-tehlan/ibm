# Incident Root-Cause Analysis (RCAC) — SEV1 (WARPATH scaffold)

> **Scaffold.** Seeded by `warpath-intake`, completed by `warpath-forensics`,
> patched by `warpath-patch`. Distinguishes **Trigger** from **Root Cause**.

## Symptom
Transient payments-path failure while an upstream dependency is flaky. Signal:
error-rate spike + the shared circuit breaker reported OPEN.

## Trigger (the flaky window)
An upstream dependency intermittently fails, producing a short burst of
consecutive failures.

## Root Cause (the planted defect)
The shared circuit breaker (`src/circuit.ts`, `breakerState`) trips OPEN on the
**first** consecutive failure rather than honoring the configured
`openThreshold`. Per `docs/api-spec.md#W6` / `docs/runbook-payments.md`, the
breaker **SHALL NOT** trip below the threshold; a single flaky blip therefore
takes the whole payments path down. Root cause ≠ trigger.

## Evidence
- `docs/api-spec.md#W6` — do-not-trip-below-threshold rule.
- `tests/clause-W6.test.ts` — the honest test is RED against the planted impl
  (`breakerState` returns `open` below threshold).
- `fixtures/metrics.json` / `fixtures/logs.json` — the flaky-window correlation
  (synthetic signal feeds).

## Patch (completed by warpath-patch during gold session)
- Seam: `src/circuit.ts` → `breakerState` must only open when
  `consecutiveFailures >= openThreshold`.
- Proof: `tests/clause-W6.test.ts` flips GREEN.
- Rollback point: Bob task-scoped snapshot (hover the patch message → rollback).

## MTTR
`PLACEHOLDER` — to be read from `incident/metrics.json` (computed by the `Stop`
hook) after the real gold-session run.
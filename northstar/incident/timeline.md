# Incident Timeline — SEV1 (WARPATH war-room scaffold)

> **Scaffold.** This is the seeded template `warpath-intake` fills during a gold
> session. Every entry is `timestamp | actor | action`. For the demo the planted
> incident is the shared circuit breaker tripping too early while a flaky upstream
> dependency causes consecutive failures → briefly taking the payments path down.

| t | actor | action |
|---|-------|--------|
| `t=0` | **Intake** | SEV1 acknowledged. Start epoch written to `incident/.start_epoch`. Severity=SEV1, Signal=error-rate spike + breaker-open, Symptom=transient payments failure, Suspect Apex=shared circuit breaker (`src/circuit.ts`). |
| `t=1` | **Forensics** | Correlate fixture metrics/logs with the flaky-dependency window. Confirm the trigger (flaky dependency) vs root cause (breaker opens on first failure — see `docs/api-spec.md#W6`). |
| `t=2` | **Forensics** | Root cause confirmed → `incident/rcac.md`. Suspect seam narrowed to `breakerState`. Honest clause-W6 test is RED against it. |
| `t=3` | **Patch** | Surgeon applies minimal fix to the seam; honest clause-W6 test flips GREEN. |
| `t=4` | **Comms** | Postmortem written (`incident/postmortem.md`); MTTR read from `incident/metrics.json`. War room closed. |

> **NOTE (continuity):** `MTTR` numbers stay PLACEHOLDER until `node scripts/mttr.mjs stop`
> computes `mttrSeconds` from a real gold-session run. See `incident/metrics.json`.
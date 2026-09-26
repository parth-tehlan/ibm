# Northstar — Planted Bugs & Violations Manifest

**Private reference only. This file lives OUTSIDE `northstar/` so the demo code
and spec read clean to judges.** Every planted defect below is deliberate, it
exists so the **REDLINE / WARPATH / SPLITBRAIN** trust-gap story is demonstrable:
a *blind* compliance test derived purely from `docs/api-spec.md` catches the
violation because the code cannot satisfy the clause.

The code, spec, and tests contain **no** reference to this list. This manifest is
the single source of truth for what was planted and where.

---

## Live planted bugs (all 8 W-clauses fail — intended REDLINE state)

Each is caught by its honest `tests/clause-W*.test.ts`. The failing assertions
are the **witness catching the bug**, which is the point of the demo.

| # | Clause | File / location | Bug (what the code does) | Spec requirement | Detecting test |
|---|--------|-----------------|--------------------------|------------------|----------------|
| W1 | Payment-intent idempotency (REQUIRED) | `src/pay/create-intent.ts` (`created.set(...)` on every call, no guard) | Creates a **duplicate** intent on retry with the same `Idempotency-Key` | MUST return the original intent for a repeated key; new intent only for unseen keys | `clause-W1.test.ts` — duplicate-intent & atomicity cases fail |
| W2 | Webhook signature verification (REQUIRED) | `src/webhooks/stripe.ts` (`verifyWebhookSignature` returns `'ok'` unconditionally) | Processes the payload even when the signature is bad/unchecked | MUST verify signature; reject bad/missing/malformed with `400` and no side effect | `clause-W2.test.ts` — reject-400 & no-payment-side-effect cases fail |
| W3 | Refund cap (REQUIRED) | `src/refunds/cancel.ts` (`newTotal = alreadyRefundedCents + req.amountCents`, no cap check) | Allows **over-refund** beyond the captured total | MUST reject a refund that would exceed the cap; never a negative/over-refunded balance | `clause-W3.test.ts` — over-refund-rejected case fails |
| W4 | Ledger available-vs-pending (REQUIRED) | `src/ledger/balance.ts` (`available = settledCredits - settledDebits + pendingHolds`) | Treats **pending holds as available** (adds instead of subtracts) | `available` MUST equal credits − debits − pending holds; pending MUST NOT be spendable | `clause-W4.test.ts` — exact-arithmetic identity cases fail |
| W5 | Token type interchange (REQUIRED) | `src/auth/token.ts` (accepts if 3-segment JWT shape OR `sk_` prefix and non-empty) | Accepts a **JWT at an API-key endpoint and vice versa** | MUST reject a JWT at an API-key endpoint and an API key at a JWT endpoint | `clause-W5.test.ts` — interchange-rejection cases fail |
| W6 | Retry & circuit-breaker discipline (SHALL) | `src/retry.ts` (returns constant `50`) + `src/circuit.ts` (trips at `>= 1` consecutive failure) | No exponential backoff; breaker trips on the **first** transient error | MUST back off exponentially with jitter; MUST NOT trip on first transient error; require the configured threshold | `clause-W6.test.ts` — backoff-growth & not-open-on-first cases fail |
| W7 | Monetary precision in integer cents (REQUIRED) | `src/money.ts` (`parseFloat(cleaned) * 100`; `addCents` does `(a/100 + b/100)*100`) | **Float coercion** of currency; arithmetic drifts off integer cents | MUST parse decimal string to exact integer cents (round-half-even); all arithmetic in integer cents, never float | `clause-W7.test.ts` — exact-parsing & integer-only cases fail |
| W8 | Async worker / no null-deref outage (REQUIRED) | `src/billing/async.ts` (`customer!.id` non-null assertion) | **NPEs** on a missing Stripe customer, aborting the whole worker/webhook batch | MUST nil-guard before deref; isolate a missing record to one item; remaining items still process | `clause-W8.test.ts` — isolate-missing-record cases fail |

### Violation recaps (same eight, by observable symptom)
1. Duplicate payment intent on retry. (W1)
2. Unverified webhook payload processed as valid. (W2)
3. Over-refund allowed past the captured total. (W3)
4. Pending authorization holds reported as spendable. (W4)
5. JWT/API-key interchange accepted. (W5)
6. No retry backoff + breaker opens on the first error. (W6)
7. Currency coerced to float. (W7)
8. Null-deref crashes the whole batch. (W8)

---

## Already fixed (do NOT reintroduce)

These were planted, deliberately fixed as part of hardening work, and their
suites are now **green**. Preserve this fixed state.

- **Discount stacking** — was in `src/discounts.ts` (a `code` array iterated to
  **sum** reductions instead of taking the single best, and no 500-cent
  `#min-order` gate). Now correctly takes `Math.max(...)` of reductions and
  returns the pre-tax amount unmodified below 500 cents. Honest
  `tests/policy-discounts.test.ts` passes (3 suites / 11 tests green). Fixed
  against `docs/PRICING_POLICY.md` (the `#single-best` and `#min-order` rules).

> **Action guide for future edits:** `src/discounts.ts`, `src/ledger/journal.ts`,
> and `src/auth/key.ts` are clean scaffold/honest modules. `journal.ts` and
> `key.ts` are **not** bug subjects — leave them correct. Only the 8 W-files in
> the table above intentionally deviate from their spec.

---

## Demo / submission usage

- The **8 failing suites** are the REDLINE payoff: a witness that reads only the
  spec and never the source still catches every planted violation.
- The **passing suites** (`policy-discounts`, `discounts`, `key`, plus any
  spec-satisfying clauses you fix) show the same machinery going green.
- `tests/discounts.test.ts` is a **deliberate tautology** (asserts `x == x` /
  trivially-wide band) — it is the SPLITBRAIN counter-example proving that
  green-vs-bug coverage is not evidence of correctness. Keep its behavior, do
  not "fix" it.

---

## Housekeeping

- `docs/api-spec.md` is the canonical spec and now carries **no** `Bug site:`
  footnotes or `(intended violation: ...)` callouts — that metadata lives here
  only.
- `docs/api-spec.pdf` may still embed the old footnotes (it is a static export of
  an earlier `api-spec.md`); regenerate it from the current `.md` before any
  submission if the PDF must also read clean.
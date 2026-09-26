# Northstar Pricing Policy

Authoritative, normative discount and tax policy for the Northstar payments
codebase. Policy tests are authored from THIS document only — never from `src/`.

Keywords: MUST, MUST NOT, SHALL, SHALL NOT (RFC 2119). Any sentence using these
keywords states a policy requirement; violations are defects.

---

## #single-best — discounts do not stack

Exactly ONE discount SHALL apply to an order: the **single best** discount among
all discount codes applied to that order. Discounts MUST NOT stack or combine;
the total reduction MUST be the largest individual reduction from any one
eligible code, never the accumulated reduction of every code.

- Given an order with `SAVE10` (10% off) and `SAVE20` (20% off), the effective
  discount SHALL be 20% (the single best), never 10%+20% combined.
- The final charge SHALL be the amount minus that single best discount only.

## #min-order — minimum order for any discount

A discount SHALL apply only when the pre-tax order amount is **at least
500 cents ($5.00)**. If the pre-tax amount is below 500 cents, no discount SHALL
apply and the amount is charged unchanged.

## #tax-cap — tax is capped at 8%

Applicable sales tax SHALL be computed on the discounted subtotal and SHALL NOT
exceed 8% of that subtotal. Tax SHALL be capped at 8% even if a nominal tax rate
would produce a higher figure.

## #tautology — policy self-consistency (process note)

(A policy test that asserts only that a function returns something equal to its
own output — and that could never fail regardless of implementation — is a
tautology and is NOT an honest policy test.)
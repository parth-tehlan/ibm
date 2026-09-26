/**
 * payment intent creation — Northstar.
 *
 * [W1] REQUIRED (docs/api-spec.md#W1): POST /v1/payment_intents MUST be
 * idempotent on the Idempotency-Key header.
 *
 * INTENDED VIOLATION (planted bug): a repeated / concurrent Idempotency-Key
 * creates a NEW intent instead of returning the original. The honest witness
 * test (tests/clause-W1.test.ts) fails on this.
 *
 * Author: the Surgeon (surgeon mode only — the only role allowed to write src/).
 */
export interface CreateIntentRequest {
  idempotencyKey: string;
  merchantId: string;
  amountCents: number;
  currency: 'usd';
}

export interface PaymentIntentResource {
  id: string;
  merchantId: string;
  amountCents: number;
  currency: 'usd';
  idempotencyKey: string;
}

const created = new Map<string, PaymentIntentResource>();

export async function createPaymentIntent(
  req: CreateIntentRequest,
): Promise<PaymentIntentResource> {
  // PLANTED W1 BUG: no idempotency lookup. Every call (even a repeated or a
  // racing key) mints a brand-new intent instead of hitting the map and
  // returning the original resource. This is the dishonest behaviour the spec
  // forbids and the witness test must catch.
  const resource: PaymentIntentResource = {
    id: `pi_${Math.random().toString(36).slice(2)}`,
    merchantId: req.merchantId,
    amountCents: req.amountCents,
    currency: 'usd',
    idempotencyKey: req.idempotencyKey,
  };
  created.set(req.idempotencyKey, resource);
  return resource;
}

/** Exposed for the binding harness / rehearsal only (not a public route). */
export const __created = created;
/**
 * payment intent creation — Northstar.
 *
 * [W1] REQUIRED (docs/api-spec.md#W1): POST /v1/payment_intents MUST be
 * idempotent on the Idempotency-Key header.
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
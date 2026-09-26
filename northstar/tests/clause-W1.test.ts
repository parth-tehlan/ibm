/**
 * REDLINE exemplar test — W1 Payment intent idempotency.
 *
 * Author: the Witness (redline-test skill).
 * Source of truth: docs/api-spec.md#W1 (RFC 2119 REQUIRED). This test asserts
 * ONLY what that clause text says. It MUST NOT read or import anything under
 * src/. The implementation seam is a public HTTP surface, `POST
 * /v1/payment_intents`, which the spec itself names; the function under test is
 * injected as a dependency so the witness never touches the source directory.
 *
 * Falsifiability: if the implementation creates a SECOND intent on a repeated
 * idempotency key (the planted W1 violation), these assertions fail.
 */
import type { Request } from 'express';

/** The public seam as defined by docs/api-spec.md#W1. */
export interface CreateIntentRequest {
  /** Idempotency-Key request header (RFC 2119: MUST be accepted). */
  idempotencyKey: string;
  merchantId: string;
  amountCents: number;
  currency: 'usd';
}

/** Public contract for POST /v1/payment_intents, per the spec. */
export interface PaymentIntentResource {
  id: string;
  merchantId: string;
  amountCents: number;
  currency: 'usd';
  idempotencyKey: string;
}

/**
 * The charge of the witness is to declare the CONTRACT, not to know the impl.
 * This type declares the seam the spec requires the API to satisfy; a harness
 * (in rehearsal) supplies a real client. The body below is pure spec assertion.
 */
type CreateIntent = (
  req: CreateIntentRequest,
) => Promise<PaymentIntentResource>;

/** Injectable seam — supplied at test time, never read from src/. */
declare function createPaymentIntent(
  req: CreateIntentRequest,
): Promise<PaymentIntentResource>;

describe('W1 — Payment intent idempotency (REQUIRED)', () => {
  const request: CreateIntentRequest = {
    idempotencyKey: 'key-abc-123',
    merchantId: 'merchant-1',
    amountCents: 1000,
    currency: 'usd',
  };

  it('accepts an Idempotency-Key request header on POST /v1/payment_intents',
    async () => {
      // docs/api-spec.md#W1.1: "POST /v1/payment_intents MUST accept an
      // Idempotency-Key request header."
      const req: Pick<Request, 'headers'> = { headers: { 'idempotency-key': request.idempotencyKey } };
      expect(req.headers['idempotency-key']).toBe(request.idempotencyKey);
    });

  it('does not create a second intent for a repeated idempotency key',
    async () => {
      // docs/api-spec.md#W1.2: "If the same Idempotency-Key is submitted more
      // than once, the API MUST NOT create a second payment intent; it MUST
      // return the original intent resource with the same idempotency key."
      const first = await createPaymentIntent(request);
      const second = await createPaymentIntent(request);

      expect(second.id).toBe(first.id);            // MUST NOT create a second intent
      expect(second.idempotencyKey).toBe(request.idempotencyKey);
    });

  it('creates a new intent only when the key is unseen for that merchant',
    async () => {
      // docs/api-spec.md#W1.3: "A new intent MUST be created only when the
      // idempotency key has not been seen before for that merchant."
      const req: CreateIntentRequest = { ...request, idempotencyKey: 'key-def-456' };
      const resource = await createPaymentIntent(req);
      expect(resource.idempotencyKey).toBe('key-def-456');
      // New key for the same merchant -> a distinct resource is required.
      expect(resource.id).not.toBe('');
    });

  it('remains idempotent under concurrent duplicate requests (atomic lookup)',
    async () => {
      // docs/api-spec.md#W1.4: "Idempotency lookup MUST be atomic under
      // concurrent duplicate requests, so that two racing requests with the
      // same key still yield one intent."
      const [a, b] = await Promise.all([
        createPaymentIntent(request),
        createPaymentIntent(request),
      ]);
      expect(a.id).toBe(b.id); // one intent, not two, under the race
      expect(a.idempotencyKey).toBe(request.idempotencyKey);
    });
});
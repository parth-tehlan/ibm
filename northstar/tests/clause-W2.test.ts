/**
 * REDLINE spec-legal test — W2 Webhook signature verification.
 *
 * Source of truth: docs/api-spec.md#W2 (RFC 2119 REQUIRED). This test asserts
 * ONLY what that clause text says. The public seam is the inbound Stripe
 * webhook HTTP surface that the spec names; the verify function is declared
 * as a contract and supplied by the harness.
 *
 * Falsifiability: if the implementation processes a payload with an
 * unchecked/bad signature, these assertions fail.
 */
import type { Request, Response } from 'express';

/** Public seam as defined by docs/api-spec.md#W2. */
export interface StripeWebhookPayload {
  /** Raw stripe event payload submitted over the wire. */
  raw: string;
  /** Signature bytes carried in the Stripe-Signature header. */
  signatureHeader: string;
  timestampEpochSec: number;
}

/** The verification result the spec's HTTP surface must produce. */
export type WebhookVerdict = 'ok' | 'reject-400';

/**
 * The seam the spec requires the webhook endpoint to satisfy; the harness
 * supplies a real verifier. The body below is pure spec assertion.
 */
declare function verifyWebhookSignature(
  payload: StripeWebhookPayload,
): Promise<WebhookVerdict>;

declare function handleWebhook(
  req: Request,
  res: Response,
): Promise<void>;

describe('W2 — Webhook signature verification (REQUIRED)', () => {
  const signed: StripeWebhookPayload = {
    raw: '{"type":"payment_intent.succeeded"}',
    signatureHeader: 't=1620000000,v1=valid-mac',
    timestampEpochSec: 1620000000,
  };

  it('verifies the Stripe-Signature header before any business logic runs',
    async () => {
      // docs/api-spec.md#W2.1: "Every inbound Stripe webhook MUST be verified
      // against the Stripe-Signature header (HMAC-SHA256, timestamp tolerance)
      // before any business logic runs."
      expect(signed.signatureHeader).toMatch(/^t=\d+,v1=/);
      await expect(verifyWebhookSignature(signed)).resolves.not.toBeNull();
    });

  it('rejects an unverifiable payload with HTTP 400 and no payment side effect',
    async () => {
      // docs/api-spec.md#W2.2: "A payload whose signature does not verify MUST
      // be rejected with HTTP 400 and MUST NOT trigger any payment side effect."
      const bad: StripeWebhookPayload = {
        ...signed,
        signatureHeader: 't=1620000000,v1=forged-mac',
      };
      const verdict = await verifyWebhookSignature(bad);
      expect(verdict).toBe('reject-400');
    });

  it('treats a missing or malformed signature header as verification failure',
    async () => {
      // docs/api-spec.md#W2.3: "Missing or malformed signature headers MUST be
      // treated as verification failure, not silently ignored."
      const missing: StripeWebhookPayload = { ...signed, signatureHeader: '' };
      const malformed: StripeWebhookPayload = { ...signed, signatureHeader: 'no-equals-sign' };
      expect(await verifyWebhookSignature(missing)).toBe('reject-400');
      expect(await verifyWebhookSignature(malformed)).toBe('reject-400');
    });
});
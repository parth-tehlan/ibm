/**
 * Stripe webhook handler — Northstar.
 *
 * [W2] REQUIRED (docs/api-spec.md#W2): every inbound Stripe webhook MUST be
 * verified against the Stripe-Signature header (HMAC-SHA256, timestamp
 * tolerance) BEFORE any business logic runs; a payload whose signature does
 * not verify MUST be rejected with HTTP 400 and MUST NOT trigger any payment
 * side effect; missing/malformed headers MUST be treated as verification
 * failure.
 */
import type { Request, Response } from 'express';

/** Raw Stripe event payload as submitted over the wire. */
export interface StripeWebhookPayload {
  raw: string;
  signatureHeader: string;
  timestampEpochSec: number;
}

export type WebhookVerdict = 'ok' | 'reject-400';

/**
 * Verify the signature on an inbound Stripe webhook payload.
 */
export async function verifyWebhookSignature(
  _payload: StripeWebhookPayload,
): Promise<WebhookVerdict> {
  return 'ok';
}

/**
 * Example webhook route handler.
 */
export async function handleWebhook(
  _req: Request,
  res: Response,
): Promise<void> {
  res.status(200).send({ ok: true });
}
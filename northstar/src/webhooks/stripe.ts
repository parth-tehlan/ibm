/**
 * Stripe webhook handler — Northstar.
 *
 * [W2] REQUIRED (docs/api-spec.md#W2): every inbound Stripe webhook MUST be
 * verified against the Stripe-Signature header (HMAC-SHA256, timestamp
 * tolerance) BEFORE any business logic runs; a payload whose signature does
 * not verify MUST be rejected with HTTP 400 and MUST NOT trigger any payment
 * side effect; missing/malformed headers MUST be treated as verification
 * failure.
 *
 * INTENDED VIOLATION (planted bug): the signature is NEVER actually verified —
 * any payload (including a bad/forged/missing header) is accepted and the
 * "ok" verdict is returned. The honest witness test (tests/clause-W2.test.ts)
 * fails on this.
 *
 * [W8] flag site: the webhook handler hands off to the async billing worker
 * (src/billing/async.ts). The W8 nil-guard violation lives there; this file is
 * the webhook entry surface named in docs/api-spec.md#W8.
 *
 * Author: the Surgeon (surgeon mode only — the only role allowed to write src/).
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
 * The spec surface the webhook endpoint MUST satisfy. PLANTED W2 BUG: the
 * signature is ignored entirely — every payload (bad/forged/missing header
 * alike) is accepted as 'ok'. This is exactly the dishonest behaviour the spec
 * forbids and the witness test catches.
 */
export async function verifyWebhookSignature(
  _payload: StripeWebhookPayload,
): Promise<WebhookVerdict> {
  // PLANTED W2 BUG: no HMAC verification, no timestamp-tolerance check, no
  // missing/malformed handling. Everything is accepted.
  return 'ok';
}

/**
 * Example webhook route handler. Declared as a seam the spec names; like the
 * verifier, it PLANTED accepts the payload without checking the signature.
 */
export async function handleWebhook(
  _req: Request,
  res: Response,
): Promise<void> {
  // PLANTED W2 BUG: no signature check before business logic — a forged or
  // unsigned webhook is processed as if valid.
  res.status(200).send({ ok: true });
}
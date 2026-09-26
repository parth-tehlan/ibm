/**
 * Refund handler — Northstar.
 *
 * [W3] REQUIRED (docs/api-spec.md#W3): a refund MUST NOT exceed the total
 * captured amount of the original payment; cumulative refunds against one
 * payment MUST NOT exceed the captured amount (each refund checked against the
 * running refunded total); an over-cap attempt MUST be rejected and MUST NOT
 * create a negative/over-refunded balance.
 *
 * INTENDED VIOLATION (planted bug): the cap is NOT enforced — any refund
 * request is accepted and the running refunded total is simply incremented,
 * even when it exceeds the captured amount (over-refund allowed). The honest
 * witness test (tests/clause-W3.test.ts) fails on this.
 *
 * Author: the Surgeon (surgeon mode only — the only role allowed to write src/).
 */
export interface RefundRequest {
  paymentId: string;
  amountCents: number;
}

export interface RefundOutcome {
  accepted: boolean;
  refundedCents: number;
  reason?: string;
}

/**
 * Spec surface for a refund attempt. PLANTED W3 BUG: the captured cap and the
 * running refunded total are ignored — every request is accepted and the
 * resulting balance is reported as the running total plus the new amount, even
 * when that exceeds what was captured.
 */
export async function refund(
  req: RefundRequest,
  _capturedCents: number,
  alreadyRefundedCents: number,
): Promise<RefundOutcome> {
  // PLANTED W3 BUG: no cap check against _capturedCents, no running-total
  // guard. An over-refund is accepted and the balance grows past the cap.
  const newTotal = alreadyRefundedCents + req.amountCents;
  return {
    accepted: true,
    refundedCents: newTotal,
    reason: 'PLANTED: cap not enforced (over-refund allowed)',
  };
}
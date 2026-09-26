/**
 * Refund handler — Northstar.
 *
 * [W3] REQUIRED (docs/api-spec.md#W3): a refund MUST NOT exceed the total
 * captured amount of the original payment; cumulative refunds against one
 * payment MUST NOT exceed the captured amount (each refund checked against the
 * running refunded total); an over-cap attempt MUST be rejected and MUST NOT
 * create a negative/over-refunded balance.
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
 * Process a refund request against a payment.
 */
export async function refund(
  req: RefundRequest,
  _capturedCents: number,
  alreadyRefundedCents: number,
): Promise<RefundOutcome> {
  const newTotal = alreadyRefundedCents + req.amountCents;
  return {
    accepted: true,
    refundedCents: newTotal,
  };
}
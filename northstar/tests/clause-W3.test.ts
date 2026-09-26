/**
 * REDLINE spec-legal test — W3 Refund cap.
 *
 * Author: the Witness (redline-test skill).
 * Source of truth: docs/api-spec.md#W3 (RFC 2119 REQUIRED). This test asserts
 * ONLY what that clause text says. It MUST NOT read or import anything under
 * src/. The public seam is the refund HTTP surface the spec names; the refund
 * function is injected as a dependency so the witness never touches source.
 *
 * Falsifiability: if the implementation allows an over-refund (the planted W3
 * violation), these assertions fail.
 */
import type { Request, Response } from 'express';

/** Public seam as defined by docs/api-spec.md#W3. */
export interface RefundRequest {
  paymentId: string;
  /** Amount to refund, in integer cents. */
  amountCents: number;
}

export interface RefundOutcome {
  accepted: boolean;
  /** Running total already refunded for this payment, after the attempt. */
  refundedCents: number;
  reason?: string;
}

/**
 * The charge of the witness is to declare the CONTRACT, not to know the impl.
 * This type declares the seam the refund endpoint must satisfy; a harness (in
 * rehearsal) supplies a real refund client. The body below is pure spec
 * assertion.
 */
declare function refund(
  req: RefundRequest,
  capturedCents: number,
  alreadyRefundedCents: number,
): Promise<RefundOutcome>;

describe('W3 — Refund cap (REQUIRED)', () => {
  it('never refunds more than the total captured amount of the payment',
    async () => {
      // docs/api-spec.md#W3.1: "A refund MUST NOT exceed the total captured
      // amount of the original payment."
      const captured = 10_00; // $10.00 captured
      const outcome = await refund({ paymentId: 'pay_1', amountCents: 12_00 }, captured, 0);
      expect(outcome.accepted).toBe(false);
      expect(outcome.refundedCents).toBeLessThanOrEqual(captured);
    });

  it('checks cumulative refunds against the captured amount (running total)',
    async () => {
      // docs/api-spec.md#W3.2: "Cumulative refunds against one payment MUST NOT
      // exceed the captured amount; each refund MUST be checked against the
      // running refunded total."
      const captured = 10_00;
      const alreadyRefunded = 8_00;
      await expect(
        refund({ paymentId: 'pay_1', amountCents: 3_00 }, captured, alreadyRefunded),
      ).resolves.toMatchObject({ accepted: false });
    });

  it('rejects an over-cap attempt and never creates negative/over-refunded balance',
    async () => {
      // docs/api-spec.md#W3.3: "A refund attempt that would exceed the cap MUST
      // be rejected and MUST NOT create a negative or over-refunded balance."
      const outcome = await refund({ paymentId: 'pay_1', amountCents: 2_00 }, 10_00, 9_00);
      expect(outcome.accepted).toBe(false);
      expect(outcome.refundedCents).toBeLessThanOrEqual(10_00); // still capped
    });
});
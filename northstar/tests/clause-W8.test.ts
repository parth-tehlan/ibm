/**
 * REDLINE spec-legal test — W8 Async worker resilience / no null-deref outage.
 *
 * Author: the Witness (redline-test skill).
 * Source of truth: docs/api-spec.md#W8 (RFC 2119 REQUIRED). This test asserts
 * ONLY what that clause text says. It MUST NOT read or import anything under
 * src/. The public seam is the async billing processor's per-item handling the
 * spec names; the processor is injected as a dependency so the witness never
 * touches the source directory.
 *
 * Falsifiability: if the implementation nil-derefs a missing Stripe customer
 * record and crashes/500s the whole batch (the planted W8 violation), these
 * assertions fail.
 */

/** Public seam as defined by docs/api-spec.md#W8. */
export interface BillingItem {
  itemId: string;
  /** Stripe customer record; may be null/absent per spec W8.1. */
  customer: unknown | null;
}

export interface BatchResult {
  /** Per-item outcomes, keyed by itemId. */
  perItem: Record<string, 'ok' | 'failed-isolated'>;
  /** True when the entire batch survived (none crashed the worker). */
  batchCompleted: boolean;
}

declare function processItem(item: BillingItem): Promise<'ok' | 'failed-isolated'>;
declare function processBatch(items: BillingItem[]): Promise<BatchResult>;

const item = (id: string, customer: unknown | null): BillingItem => ({ itemId: id, customer });

describe('W8 — Async worker resilience / no null-deref outage (REQUIRED)', () => {
  it('nil-guards the Stripe customer record before dereference',
    async () => {
      // docs/api-spec.md#W8.1: "The async billing processor MUST nil-guard the
      // Stripe customer record before dereference."
      const outcome = await processItem(item('i_1', null));
      // Must not throw; the nil record must be handled as a per-item failure.
      expect(outcome).toBe('failed-isolated');
    });

  it('isolates a missing/unparseable record to that one item, not the batch',
    async () => {
      // docs/api-spec.md#W8.2: "A missing/unparseable record MUST be isolated
      // to that one item; it MUST NOT crash or 500 the whole worker / webhook
      // batch."
      const result = await processBatch([
        item('i_good_1', { id: 'cus_1' }),
        item('i_bad', null),
        item('i_good_2', { id: 'cus_2' }),
      ]);
      expect(result.batchCompleted).toBe(true);   // batch survived
      expect(result.perItem['i_bad']).toBe('failed-isolated');
    });

  it('records a per-item failure and still processes the remaining items',
    async () => {
      // docs/api-spec.md#W8.3: "A per-item failure MUST be recorded and the
      // remaining items in the batch MUST still process."
      const result = await processBatch([
        item('i_good_1', { id: 'cus_1' }),
        item('i_bad_missing', null),
        item('i_good_2', { id: 'cus_2' }),
      ]);
      expect(result.perItem['i_bad_missing']).toBe('failed-isolated'); // recorded
      expect(result.perItem['i_good_1']).toBe('ok');                   // still processed
      expect(result.perItem['i_good_2']).toBe('ok');                   // still processed
    });
});
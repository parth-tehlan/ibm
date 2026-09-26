/**
 * Async billing worker — Northstar.
 *
 * [W8] REQUIRED (docs/api-spec.md#W8): the async billing processor MUST
 * nil-guard the Stripe customer record before dereference; a missing/
 * unparseable record MUST be isolated to that one item and MUST NOT crash or
 * 500 the whole worker / webhook batch; a per-item failure MUST be recorded and
 * the remaining items in the batch MUST still process.
 *
 * INTENDED VIOLATION (planted bug): the customer record is dereferenced without
 * a nil-guard — a missing/null customer throws, and because the batch loop has
 * no per-item try/catch, the whole batch aborts (NPE aborts batch). The honest
 * witness test (tests/clause-W8.test.ts) fails on this.
 *
 * Author: the Surgeon (surgeon mode only — the only role allowed to write src/).
 */
export interface BillingItem {
  itemId: string;
  customer: unknown | null;
}

export interface BatchResult {
  perItem: Record<string, 'ok' | 'failed-isolated'>;
  batchCompleted: boolean;
}

/**
 * Spec surface for per-item processing. PLANTED W8 BUG: reports "ok" by
 * dereferencing the customer record directly; a null/missing customer throws
 * (TypeError) instead of being isolated as a per-item failure.
 */
export async function processItem(item: BillingItem): Promise<'ok' | 'failed-isolated'> {
  // PLANTED W8 BUG: nil-deref — no guard before touching `customer`. A null
  // customer throws here, which then aborts the enclosing batch (no per-item
  // isolation). Good items with a customer still return 'ok'.
  const customer = item.customer as { id: string } | null;
  const customerId = customer!.id; // TypeError when customer is null
  void customerId;
  return 'ok';
}

/**
 * Spec surface for the batch. PLANTED W8 BUG: no try/catch per item, so a
 * single nil-deref (above) rejects the entire batch rather than isolating it
 * to that one item.
 */
export async function processBatch(items: BillingItem[]): Promise<BatchResult> {
  const perItem: Record<string, 'ok' | 'failed-isolated'> = {};
  for (const item of items) {
    // PLANTED W8 BUG: no per-item isolation — if processItem throws (nil
    // customer), the whole batch rejects instead of continuing.
    perItem[item.itemId] = await processItem(item);
  }
  return { perItem, batchCompleted: true };
}
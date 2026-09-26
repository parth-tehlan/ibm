/**
 * Async billing worker — Northstar.
 *
 * [W8] REQUIRED (docs/api-spec.md#W8): the async billing processor MUST
 * nil-guard the Stripe customer record before dereference; a missing/
 * unparseable record MUST be isolated to that one item and MUST NOT crash or
 * 500 the whole worker / webhook batch; a per-item failure MUST be recorded and
 * the remaining items in the batch MUST still process.
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
 * Process a single billing item.
 */
export async function processItem(item: BillingItem): Promise<'ok' | 'failed-isolated'> {
  const customer = item.customer as { id: string } | null;
  const customerId = customer!.id; // TypeError when customer is null
  void customerId;
  return 'ok';
}

/**
 * Process a batch of billing items.
 */
export async function processBatch(items: BillingItem[]): Promise<BatchResult> {
  const perItem: Record<string, 'ok' | 'failed-isolated'> = {};
  for (const item of items) {
    perItem[item.itemId] = await processItem(item);
  }
  return { perItem, batchCompleted: true };
}
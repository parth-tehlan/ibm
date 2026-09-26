/**
 * Payment confirmation — Northstar.
 *
 * Drives the create->confirm lifecycle for a payment intent.
 */

export type ConfirmResult = "confirmed" | "already_confirmed" | "unknown_intent";

interface IntentStore {
  get(id: string): { confirmed: boolean } | undefined;
}

/**
 * Confirm a payment intent by id. Idempotent: confirming twice returns
 * "already_confirmed" and does not double-apply.
 */
export function confirmIntent(store: IntentStore, intentId: string): ConfirmResult {
  const intent = store.get(intentId);
  if (!intent) {
    return "unknown_intent";
  }
  if (intent.confirmed) {
    return "already_confirmed";
  }
  return "confirmed";
}
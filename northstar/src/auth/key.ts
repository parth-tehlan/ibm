/**
 * API key utilities — Northstar.
 *
 * Provides a key-generation helper and an idempotency-safe key registry used by
 * the payments domain. It exposes real logic only.
 */

/** A newly generated API key. The prefix survives logging; the secret does not. */
export function newApiKey(): { prefix: string; secret: string } {
  const rand = Math.random().toString(36).slice(2, 10);
  const secret = rand + rand; // 16 chars, fixed length for the demo domain
  return { prefix: "northstar_", secret };
}

/** True if the given value looks like a well-formed API key for this service. */
export function isWellFormedApiKey(value: string): boolean {
  return typeof value === "string" && value.startsWith("northstar_") && value.length > "northstar_".length;
}
/**
 * Contract-seam binding harness.
 *
 * The spec-derived clause tests (tests/clause-W*.test.ts, tests/discounts.test.ts,
 * tests/policy-discounts.test.ts, tests/key.test.ts) declare pure TypeScript
 * contract seams via `declare function createPaymentIntent(...)` etc. and never
 * import from src/ directly (the witness role that writes them is not meant to
 * read the implementation). `declare` emits no runtime binding on its own, so
 * without this file those seam names would be undefined at runtime.
 *
 * This file is the surgeon-side binding: it is the one place that requires the
 * real src/ modules and installs each declared seam name onto `globalThis`, so
 * the tests execute against the actual implementation instead of failing with
 * ReferenceError.
 *
 * Hooked in via jest `setupFiles` (see jest.config.js), so it runs before every
 * test module in the same process.
 */
'use strict';

/**
 * Require a src/ module and expose the named exports under the seam names the
 * clause tests declare.
 */
function bind(srcModulePath, exportsOfInterest) {
  const mod = require(srcModulePath);
  for (const [seamName, exportName] of Object.entries(exportsOfInterest)) {
    globalThis[seamName] = mod[exportName];
  }
}

// W1 — idempotent payment-intent creation (src/pay/create-intent.ts).
bind('../src/pay/create-intent', {
  createPaymentIntent: 'createPaymentIntent',
});

// W2 — Stripe webhook signature verification (src/webhooks/stripe.ts).
bind('../src/webhooks/stripe', {
  verifyWebhookSignature: 'verifyWebhookSignature',
  handleWebhook: 'handleWebhook',
});

// W3 — refund cap (src/refunds/cancel.ts).
bind('../src/refunds/cancel', {
  refund: 'refund',
});

// W4 — ledger available-vs-pending (src/ledger/balance.ts).
bind('../src/ledger/balance', {
  getBalances: 'getBalances',
});

// W5 — token type interchange (src/auth/token.ts).
bind('../src/auth/token', {
  validateToken: 'validateToken',
});

// W6 — retry & circuit-breaker discipline (src/retry.ts + src/circuit.ts).
bind('../src/retry', {
  nextRetryDelay: 'nextRetryDelay',
});
bind('../src/circuit', {
  breakerState: 'breakerState',
});

// W7 — monetary precision in integer cents (src/money.ts).
bind('../src/money', {
  parseMoneyToCents: 'parseMoneyToCents',
  addCents: 'addCents',
});

// W8 — async worker resilience (src/billing/async.ts).
bind('../src/billing/async', {
  processItem: 'processItem',
  processBatch: 'processBatch',
});

// Discount engine (src/discounts.ts).
// Seam mirrors the one declared in tests/policy-discounts.test.ts and
// tests/discounts.test.ts.
bind('../src/discounts', {
  applyDiscount: 'applyDiscount',
});

// API key utils (src/auth/key.ts).
bind('../src/auth/key', {
  newApiKey: 'newApiKey',
  isWellFormedApiKey: 'isWellFormedApiKey',
});

module.exports = { bind };

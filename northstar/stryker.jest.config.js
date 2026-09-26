/**
 * Stryker-only jest config.
 *
 * Spreads the real jest.config.js (same rootDir, same transform, same
 * harness/bind-seams.cjs setup file so the `declare function applyDiscount`
 * seam in tests/discounts.test.ts and tests/policy-discounts.test.ts binds to
 * the (per-mutant, sandboxed) src/discounts.ts) but narrows testMatch to only
 * the two discount test files. Without this narrowing, Stryker's dry run
 * would also collect tests/clause-W*.test.ts, which are intentionally failing
 * and would abort the mutation run.
 */
const base = require('./jest.config.js');

module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/tests/discounts.test.ts',
    '<rootDir>/tests/policy-discounts.test.ts',
  ],
};

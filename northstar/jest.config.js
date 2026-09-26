/**
 * Jest config.
 *
 * Runs `harness/bind-seams.cjs` as a setup file before any test module, so the
 * contract seams declared in tests/clause-W*.test.ts (and the discount/key
 * tests) are bound to the real src/ implementations before the tests execute.
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  setupFiles: ['./harness/bind-seams.cjs'],
  collectCoverageFrom: ['src/**/*.ts'],
};
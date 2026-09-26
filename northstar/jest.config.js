/**
 * Jest config (REDLINE wiring).
 *
 * Runs `.bob/scratch/bind-seams.cjs` as a setup file BEFORE any test module, so
 * the witness-facing contract seams declared in tests/clause-W*.test.ts are
 * bound to the real (planted) src/ implementations. This is the surgeon-side
 * binding that closes the wiring gap without letting the witness read src/.
 *
 * Author: the Surgeon. Requires the devDeps (jest, ts-jest, typescript) which
 * are NOT installed on this build host (see WORK_STATE NEEDS DECISION) but are
 * present in the committed Bob IDE gold runtime.
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  setupFiles: ['./.bob/scratch/bind-seams.cjs'],
  collectCoverageFrom: ['src/**/*.ts'],
};
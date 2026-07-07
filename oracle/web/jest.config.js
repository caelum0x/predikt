/** @type {import('ts-jest').JestConfigWithTsJest} */
// Focused unit-test runner for the on-chain client + pure-math + AI-schema
// modules under web/lib. Kept intentionally small and hermetic: it only picks up
// the *.test.ts files we author here, runs them in a plain `node` environment
// (Node 18+ ships the WebCrypto + getRandomValues globals the wallet crypto
// needs), and resolves the workspace path aliases used across the codebase.
//
// ts-jest 29.0.3 emits a cosmetic "TS 5.x not tested" warning (its checker caps
// at <5.0.0) even though the repo's TS 5.5.4 works fine with the whole suite. A
// version bump would require re-installing the hoisted monorepo dep on a
// near-full disk, so we instead silence ONLY that cosmetic check via the
// officially-supported TS_JEST_DISABLE_VER_CHECKER env var, wired into the
// `test` / `test:coverage` npm scripts. No behavior change.

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  // Only our authored tests — never traverse node_modules or .next.
  roots: ['<rootDir>/lib'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    // Mirrors web/tsconfig.json "paths", relative to this rootDir (web/).
    '^common/(.*)$': '<rootDir>/../common/src/$1',
    '^client-common/(.*)$': '<rootDir>/../client-common/src/$1',
    '^web/(.*)$': '<rootDir>/$1',
  },
  setupFiles: ['<rootDir>/lib/__tests__/setup.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.jest.json', isolatedModules: true },
    ],
  },

  // --- Coverage: a regression GATE, scoped to the modules this suite owns. ---
  // We measure only the real (crypto/on-chain/AI-schema) libraries here so the
  // numbers reflect what these tests actually exercise, not the whole app.
  // NOTE: lib/engine does not exist in this workspace, so it is not listed.
  collectCoverageFrom: [
    'lib/onchain/**/*.ts',
    'lib/ai/**/*.ts',
    // Type-only / barrel-style files carry no executable statements; excluding
    // them keeps the ratio honest rather than diluting it with 0/0 files.
    '!lib/**/*.d.ts',
  ],

  // FLOORS set an honest step BELOW the current measured coverage (rounded
  // down) so ANY drop fails CI, while a little headroom remains for normal
  // churn. Update UPWARD only — never lower these to make CI pass.
  //
  // Jest treats a glob-key threshold as PER-FILE (every matched file must clear
  // it independently). The on-chain surface is deliberately RPC/wallet-bound and
  // some files are near-0% by design (no fakes), so a per-file glob would be
  // dishonest. We therefore use two mechanisms:
  //
  //  1. `global` — an AGGREGATE floor across the whole collected set
  //     (lib/onchain + lib/ai). Because on-chain is by far the larger body of
  //     code here, an on-chain regression drops this aggregate and fails CI.
  //  2. Per-file globs on the SPECIFIC, fully-testable pure modules
  //     (chains.ts, storage.ts, settlement.ts, addresses.ts, abis.ts) — these
  //     are network-free and MUST stay near-fully covered, so a regression in
  //     any one of them fails CI even if the aggregate still passes.
  //
  // Baseline at time of writing (jest --coverage, aggregated):
  //   collected set  stmts 44.59  branch 34.85  funcs 46.15  lines 45.16
  //   lib/onchain    stmts 51.29  branch 40.46  funcs 50.52  lines 52.04
  //   lib/ai         stmts 15.92  branch 22.22  funcs 17.24  lines 15.70
  //
  // IMPORTANT: files named by a per-file glob below are REMOVED from the
  // `global` bucket by Jest. So `global` here is the aggregate of the REMAINING
  // collected files (everything except the 5 pure modules pinned below):
  //   remaining set  stmts 36.08  branch 25.85  funcs 36.70  lines 36.80
  coverageThreshold: {
    global: {
      statements: 36,
      branches: 25,
      functions: 36,
      lines: 36,
    },
    // Pure, network-free on-chain modules — hold them high.
    './lib/onchain/chains.ts': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
    './lib/onchain/settlement.ts': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
    './lib/onchain/abis.ts': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
    './lib/onchain/storage.ts': {
      statements: 94,
      branches: 80,
      functions: 100,
      lines: 98,
    },
    './lib/onchain/addresses.ts': {
      statements: 95,
      branches: 100,
      functions: 100,
      lines: 95,
    },
  },
}

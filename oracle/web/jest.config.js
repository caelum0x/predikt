/** @type {import('ts-jest').JestConfigWithTsJest} */
// Focused unit-test runner for the on-chain client + pure-math + AI-schema
// modules under web/lib. Kept intentionally small and hermetic: it only picks up
// the *.test.ts files we author here, runs them in a plain `node` environment
// (Node 18+ ships the WebCrypto + getRandomValues globals the wallet crypto
// needs), and resolves the workspace path aliases used across the codebase.

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
}

import { defineConfig } from "vitest/config";

// Per-commit lane config (L1 + L2) for the replacement harness under
// tests/ (validation-design/validation-policy.yaml → layers).
// - tests/live/** is the opt-in L3 lane and runs ONLY via
//   tests/live/vitest.config.ts (pnpm test:live) — never per commit.
// - The legacy suite is frozen under archive-do-not-read/ — never read, never
//   run.
// passWithNoTests is now false: with the first specs landed, the lane must
// fail red if the include walk ever comes back empty (no green by absence —
// CORMIDIA-INV-008 / harness self-test rule).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "archive-do-not-read/**", "tests/live/**"],
    passWithNoTests: false,
    maxWorkers: 2,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

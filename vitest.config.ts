import { defineConfig } from "vitest/config";

// Per-commit lane config (L1 + L2) for the replacement harness under
// claude-tests/ (validation-design/validation-policy.yaml → layers).
// - claude-tests/live/** is the opt-in L3 lane and runs ONLY via
//   claude-tests/live/vitest.config.ts (pnpm test:live) — never per commit.
// - The legacy suite is frozen under archive-do-not-read/ — never read, never
//   run.
// passWithNoTests is now false: with the first specs landed, the lane must
// fail red if the include walk ever comes back empty (no green by absence —
// OPERON-INV-008 / harness self-test rule).
export default defineConfig({
  test: {
    include: ["claude-tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "archive-do-not-read/**",
      "claude-tests/live/**",
    ],
    passWithNoTests: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

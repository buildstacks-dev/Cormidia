import { defineConfig } from "vitest/config";

// L3 live-sandbox lane — OPT-IN ONLY (validation-policy.yaml →
// layers.L3_live_sandbox). Spends real provider tokens and touches real
// sandbox targets; never wired into the per-commit lane.
//
// Gate: CORMIDIA_LIVE=1 must be set or every live spec refuses to run (the
// specs themselves assert this — fail-closed, not silently skipped-green;
// a skipped lane reports incomplete, never pass).
export default defineConfig({
  test: {
    include: ["claude-tests/live/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    // Live turns are slow (real providers, real GitHub); generous ceilings.
    testTimeout: 900_000,
    hookTimeout: 120_000,
    // One worker: spend accounting and sandbox state must not interleave.
    maxWorkers: 1,
    fileParallelism: false,
  },
});

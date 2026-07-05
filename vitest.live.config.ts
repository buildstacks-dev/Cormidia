import { defineConfig } from "vitest/config";

// Live-SDK suite (`pnpm test:live`): drives the real Claude Agent SDK —
// spawns the CLI, spends real tokens. Auth is subscription-first (Claude
// Code login), API key fallback; files skip themselves when no usable auth
// exists. Kept out of the fast suite (vitest.config.ts) entirely.
export default defineConfig({
  test: {
    include: ["test/**/*.live.test.ts"],
    testTimeout: 900_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});

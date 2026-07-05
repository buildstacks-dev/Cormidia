import { defineConfig } from "vitest/config";

// The fast suite (`pnpm test`): every offline test, seconds to run
// (AGENTS.md testing expectations). Live-SDK tests — real CLI spawns, real
// tokens — are excluded here and run explicitly via `pnpm test:live`
// (vitest.live.config.ts), where they skip (not fail) without usable auth.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.live.test.ts"],
  },
});

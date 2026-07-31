import { defineConfig } from "vitest/config";

// Interim config during the validation rebuild (docs/PURPOSE.md → Decided,
// v2.9). The legacy suite is frozen under archive-do-not-read/ — never read,
// never run. The replacement harness (designed by the Validation-Design-Agent)
// lands under claude-tests/; until its first spec exists, passWithNoTests
// keeps `pnpm test` green rather than failing on an empty include.
export default defineConfig({
  test: {
    include: ["claude-tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "archive-do-not-read/**"],
    passWithNoTests: true,
  },
});

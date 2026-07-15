// Live-smokes CodexRuntime against the real @openai/codex App Server over stdio.
// Covers a no-tool turn, Codex thread handle creation, and adapter completion
// with the live local Codex stack.
// Excluded from pnpm test; pnpm test:live runs it only when OPERON_CODEX_LIVE=1.
// It uses a temp workdir but depends on real Codex auth/local tooling and may
// spend OpenAI or ChatGPT account quota.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CodexRuntime } from "../../src/runtime/adapters/codex.js";
import type { RoleConfig } from "../../src/runtime/types.js";

const enabled = process.env.OPERON_CODEX_LIVE === "1";
const model = process.env.OPERON_CODEX_LIVE_MODEL ?? "gpt-5.6-sol";

const role: RoleConfig = {
  name: "codex-live-smoke",
  runtime: "codex",
  model,
  effort: "low",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 1,
};

if (!enabled) {
  console.warn("[codex-app-server.live] SKIPPING - set OPERON_CODEX_LIVE=1 to run the real App Server smoke.");
}

describe.skipIf(!enabled)("CodexRuntime live App Server smoke", () => {
  it("runs a no-tool turn and returns a Codex thread handle", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "operon-codex-live-"));
    try {
      const result = await new CodexRuntime().runTurn(
        {
          role,
          workdir,
          task: "Do not use tools. Reply with exactly: OK",
          context: { taste: [], memoryExcerpts: [] },
          maxTurns: 1,
        },
        { gate: () => ({ allow: true }) },
      );

      expect(result.status).toBe("completed");
      expect(result.session.runtime).toBe("codex");
      expect(result.session.id.length).toBeGreaterThan(0);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});

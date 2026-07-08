// Live-smokes PiRuntime against the real @earendil-works/pi-coding-agent SDK.
// Covers model resolution, provider auth detection, no-tool turn completion,
// and a returned pi session handle.
// Excluded from pnpm test; pnpm test:live runs it only when OPERON_PI_LIVE=1
// and model auth is configured. It uses a temp workdir but depends on real pi
// auth/provider state and may spend provider quota.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { PiRuntime, resolvePiModel } from "../../src/runtime/adapters/pi.js";
import type { RoleConfig } from "../../src/runtime/types.js";

const enabled = process.env.OPERON_PI_LIVE === "1";
const modelId = process.env.OPERON_PI_LIVE_MODEL ?? "anthropic/claude-haiku-4-5-20251001";
const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const model = resolvePiModel(modelRegistry, modelId);
const hasAuth = model !== undefined && modelRegistry.hasConfiguredAuth(model);
const shouldRun = enabled && hasAuth;

const role: RoleConfig = {
  name: "pi-live-smoke",
  runtime: "pi",
  model: modelId,
  effort: "low",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 1,
};

if (!shouldRun) {
  console.warn(
    `[pi-sdk.live] SKIPPING - ` +
      (!enabled
        ? "set OPERON_PI_LIVE=1 to run"
        : `model auth not configured or model not found: ${modelId}`),
  );
}

describe.skipIf(!shouldRun)("PiRuntime live SDK smoke", () => {
  it("runs a no-tool turn and returns a pi session handle", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "operon-pi-live-"));
    try {
      const result = await new PiRuntime({ authStorage, modelRegistry }).runTurn(
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
      expect(result.session.runtime).toBe("pi");
      expect(result.session.id.length).toBeGreaterThan(0);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});

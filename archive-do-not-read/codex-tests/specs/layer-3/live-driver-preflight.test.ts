import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  preflightLiveSandbox,
  runLiveSandbox,
  type LiveSandboxConfig,
} from "../../src/drivers/live-sandbox.js";
import { ARTIFACT_ROOT } from "../../src/fixtures/controlled-world.js";

const valid: LiveSandboxConfig = {
  targetName: "disposable-github",
  targetId: "target-fixture-1",
  disposable: true,
  authorizationId: "authorization-fixture-1",
  authorizedOperations: ["read_identity"],
  maxSpendUsd: 0,
  evidenceRoot: resolve(ARTIFACT_ROOT, "live-sandbox", "fixture"),
  cleanupPolicy: "always",
};

describe("live sandbox driver preflight", () => {
  it("accepts a fully bounded declaration without performing an operation", () => {
    expect(preflightLiveSandbox(valid)).toMatchObject({
      ok: true,
      normalized: { targetId: "target-fixture-1", maxSpendUsd: 0 },
    });
  });

  it.each([
    ["target identity", { ...valid, targetId: "" }],
    ["disposable declaration", { ...valid, disposable: false }],
    ["authorization", { ...valid, authorizationId: "" }],
    ["operation scope", { ...valid, authorizedOperations: [] }],
    ["spend bound", { ...valid, maxSpendUsd: Number.POSITIVE_INFINITY }],
    ["contained evidence", { ...valid, evidenceRoot: resolve(ARTIFACT_ROOT, "..", "escape") }],
    ["cleanup policy", { ...valid, cleanupPolicy: "never" }],
  ])("refuses missing or unsafe %s before executor entry", async (_label, candidate) => {
    let executorCalls = 0;
    await expect(
      runLiveSandbox(candidate, async () => {
        executorCalls += 1;
      }),
    ).rejects.toThrow();
    expect(executorCalls).toBe(0);
  });
});

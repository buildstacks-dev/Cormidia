import { afterEach, describe, expect, it } from "vitest";
import { executePipeline } from "../../../src/loop/pipeline.js";
import { runtimeCapabilityProfile } from "../../../src/runtime/capabilities.js";
import type { RoleConfig } from "../../../src/runtime/types.js";
import {
  createControlledWorld,
  FakeClock,
  type ControlledWorld,
} from "../../src/fixtures/controlled-world.js";

let world: ControlledWorld | undefined;

afterEach(async () => {
  await world?.cleanup();
  world = undefined;
});

describe("provider admission", () => {
  it("refuses a missing capability before constructing any runtime", async () => {
    world = await createControlledWorld("layer-1-provider-admission");
    const clock = new FakeClock();
    const role: RoleConfig = {
      name: "builder",
      runtime: "pi",
      model: "fixture-model",
      effort: "low",
      delegation: { allow: [] },
      triggers: [],
      outputs: [],
      maxTurnBudgetUsd: 1,
    };
    const profile = runtimeCapabilityProfile("pi");
    profile.capabilities.tool_gate = "unsupported";
    let runtimeConstructions = 0;

    await expect(
      executePipeline({
        pipeline: {
          name: "walking",
          mechanical: false,
          passes: [{ id: "provider", role: "builder", template: "walking-skeleton.md" }],
        },
        selection: { tier: "quick" },
        roles: { builder: role },
        runtimeFor: () => {
          runtimeConstructions += 1;
          throw new Error("runtime must not be constructed");
        },
        briefFor: () => "Controlled provider admission probe",
        promptsDir: world.promptsDir,
        context: { taste: [], memoryExcerpts: [] },
        workdir: world.workdir,
        hooks: { gate: () => ({ allow: true }) },
        runlog: {
          root: world.stateRoot,
          app: "sample-app",
          traceId: "trace-admission",
        },
        capabilityProfiles: { pi: profile },
        clock: clock.now,
      }),
    ).rejects.toThrow(/lacks required capability tool_gate/);

    expect(runtimeConstructions).toBe(0);
  });
});

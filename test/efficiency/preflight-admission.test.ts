import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executePipeline, type ExecutePipelineOptions } from "../../src/loop/pipeline.js";
import type { RoleConfig } from "../../src/runtime/types.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const role: RoleConfig = {
  name: "builder",
  runtime: "codex",
  model: "fixture-model",
  effort: "low",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};

function base(home: ReturnType<typeof makeOrgHome>, constructed: { value: number }): ExecutePipelineOptions {
  const workdir = `${home.root}/workdir`;
  const promptsDir = `${home.root}/prompts`;
  mkdirSync(workdir, { recursive: true });
  mkdirSync(promptsDir, { recursive: true });
  writeFileSync(`${promptsDir}/pass.md`, "do the work\n");
  writeFileSync(`${workdir}/artifact.txt`, "current\n");
  return {
    pipeline: { name: "build", mechanical: false, passes: [{ id: "implement", role: "builder", template: "pass.md" }] },
    selection: { tier: "quick" },
    roles: { builder: role },
    runtimeFor: () => {
      constructed.value += 1;
      throw new Error("provider construction tripwire");
    },
    briefFor: () => "brief",
    promptsDir,
    context: { taste: [], memoryExcerpts: [] },
    workdir,
    hooks: { gate: () => ({ allow: true }) },
    runlog: { root: home.root, app: "app", traceId: "preflight" },
  };
}

describe("Phase 3 token-free preflight/admission", () => {
  it("rejects invalid config, missing capability, impossible budget, and stale artifacts before provider construction", async () => {
    const cases: Array<(options: ExecutePipelineOptions) => void> = [
      (options) => { options.roles = {}; },
      (options) => {
        options.requiredCapabilities = ["structured_verdict"];
        options.capabilityProfiles = {
          codex: {
            runtime: "codex",
            capabilities: { structured_verdict: "unsupported", cancellation: "adapter", tool_gate: "adapter", cache_telemetry: "adapter", session_resume: "native" },
            cache: { supported: true, observable: true, fields: [] },
          },
        };
      },
      (options) => { options.episode = { route: "deep" }; },
      (options) => { options.episode = { route: "quick", budgetOverrides: { provider_turns: 0 } }; },
      (options) => { options.episode = { route: "quick", artifactExpectations: [{ path: "artifact.txt", sha256: "0".repeat(64), reason: "continuation commit" }] }; },
      (options) => { options.episode = { route: "quick", authorizedPasses: [] }; },
    ];
    for (const mutate of cases) {
      const home = makeOrgHome();
      const constructed = { value: 0 };
      try {
        const options = base(home, constructed);
        mutate(options);
        await expect(executePipeline(options)).rejects.toThrow(/preflight failed before runtime construction/);
        expect(constructed.value).toBe(0);
      } finally {
        home.cleanup();
      }
    }
  });
});

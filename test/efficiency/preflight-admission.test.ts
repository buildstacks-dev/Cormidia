import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executePipeline, type ExecutePipelineOptions } from "../../src/loop/pipeline.js";
import type { RoleConfig, Runtime } from "../../src/runtime/types.js";
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
            ref: "codex/v1",
            runtime: "codex",
            capabilities: { structured_verdict: "unsupported", cancellation: "adapter", tool_gate: "adapter", cache_telemetry: "adapter", session_resume: "native", intra_turn_fanout: "native" },
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

  it("checks capabilities on the authorized harness rather than the role default", async () => {
    const home = makeOrgHome();
    const constructed = { value: 0 };
    try {
      const options = base(home, constructed);
      const runtime: Runtime = {
        kind: "claude",
        runTurn: async () => ({
          status: "completed",
          summary: "done",
          artifacts: [],
          session: { runtime: "claude", id: "session" },
          usage: {
            tokensIn: 1,
            tokensOut: 1,
            costUsd: 0.01,
            subagentTurns: 0,
            wallClockMs: 1,
            quality: "complete",
          },
          escalations: [],
        }),
      };
      let selectionRuntime: RoleConfig["runtime"] | undefined;
      options.runtimeFor = (selection) => {
        constructed.value += 1;
        selectionRuntime = selection.runtime;
        return runtime;
      };
      options.requiredCapabilities = ["structured_verdict"];
      options.capabilityProfiles = {
        codex: {
          ref: "codex/v1",
          runtime: "codex",
          capabilities: {
            structured_verdict: "unsupported",
            cancellation: "adapter",
            tool_gate: "adapter",
            cache_telemetry: "adapter",
            session_resume: "native",
            intra_turn_fanout: "native",
          },
          cache: { supported: true, observable: true, fields: [] },
        },
      };
      options.episode = {
        route: "quick",
        factors: [{ kind: "uncertainty", evidence: "fixture", policy_rule: "fixture" }],
        authorizedPasses: [{
          pipeline: "build",
          pass: "implement",
          role: "builder",
          runtime: "claude",
          model: "claude-exact",
          effort: "high",
          factor_rules: ["fixture"],
        }],
      };
      const result = await executePipeline(options);
      expect(result.aborted).toBe(false);
      expect(constructed.value).toBe(1);
      // The legacy factory receives a selection-only view of the authorized
      // tuple, while the adapter request itself still receives the base role.
      expect(selectionRuntime).toBe("claude");
    } finally {
      home.cleanup();
    }
  });

  it("rejects a missing capability on the assigned harness even when the role default supports it", async () => {
    const home = makeOrgHome();
    const constructed = { value: 0 };
    try {
      const options = base(home, constructed);
      options.requiredCapabilities = ["structured_verdict"];
      options.capabilityProfiles = {
        claude: {
          ref: "claude/v1",
          runtime: "claude",
          capabilities: {
            structured_verdict: "unsupported",
            cancellation: "native",
            tool_gate: "native",
            cache_telemetry: "native",
            session_resume: "native",
            intra_turn_fanout: "native",
          },
          cache: { supported: true, observable: true, fields: [] },
        },
      };
      options.episode = {
        route: "quick",
        factors: [{ kind: "uncertainty", evidence: "fixture", policy_rule: "fixture" }],
        authorizedPasses: [{
          pipeline: "build",
          pass: "implement",
          role: "builder",
          runtime: "claude",
          model: "claude-exact",
          effort: "high",
          factor_rules: ["fixture"],
        }],
      };
      await expect(executePipeline(options)).rejects.toThrow(
        "claude/builder lacks required capability structured_verdict",
      );
      expect(constructed.value).toBe(0);
    } finally {
      home.cleanup();
    }
  });
});

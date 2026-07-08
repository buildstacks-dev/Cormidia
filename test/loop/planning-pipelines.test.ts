// Tests the real planning and standing-role pipelines through executePipeline.
// Covers competing PM parallelism, prior-output handoff to decomposer, one-pass
// standing pipelines, and template invariants for planner/SRE/support/marketing
// outputs.
// Uses FakeRuntime, temp runlogs, and repo-local protocol files; no network,
// auth, real org state, or wall-clock time is required.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executePipeline, type ExecutePipelineOptions } from "../../src/loop/pipeline.js";
import { getPipeline, loadPipelines, type PipelinesFile } from "../../src/loop/pipelines.js";
import { loadRoles } from "../../src/org/roles.js";
import { FakeRuntime, type ScriptedTurn } from "../../src/runtime/testing/fakeRuntime.js";
import type { RoleConfig, Runtime, TurnResult } from "../../src/runtime/types.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PROMPTS = join(ROOT, "prompts");

async function loadRoot(): Promise<{ file: PipelinesFile; roles: Record<string, RoleConfig> }> {
  const rolesFile = await loadRoles(join(ROOT, "roles.yaml"));
  return {
    file: await loadPipelines(join(ROOT, "pipelines.yaml"), {
      roleNames: rolesFile.roles.map((role) => role.name),
      promptsDir: PROMPTS,
    }),
    roles: Object.fromEntries(rolesFile.roles.map((role) => [role.name, role])),
  };
}

function result(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "claude", id: summary },
    usage: { tokensIn: 1, tokensOut: 1, costUsd: 0.01, subagentTurns: 0, wallClockMs: 1 },
    escalations: [],
  };
}

function scripted(...summaries: string[]): ScriptedTurn[] {
  return summaries.map((summary) => ({ result: result(summary) }));
}

describe("M8 planning and standing-role pipelines", () => {
  it("plan runs visionary, competing PMs concurrently, arbitrator, and decomposer with prior output", async () => {
    const { file, roles } = await loadRoot();
    const home = makeOrgHome({ runs: { apps: ["alpha"] } });
    const fake = new FakeRuntime(
      scripted("visionary output", "pm-a output", "pm-b output", "arbitrator output", "decomposer output"),
    );
    const prior = new Map<string, string>();
    const tracker = { active: 0, maxActive: 0 };
    const tracking: Runtime = {
      kind: "claude",
      async runTurn(req, hooks) {
        tracker.active += 1;
        tracker.maxActive = Math.max(tracker.maxActive, tracker.active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const turn = await fake.runTurn(req, hooks);
        tracker.active -= 1;
        return turn;
      },
    };
    const plan = getPipeline(file, "plan");
    try {
      const options: ExecutePipelineOptions = {
        pipeline: plan,
        selection: { tier: "standard" },
        roles,
        runtimeFor: () => tracking,
        briefFor: (pass) =>
          [
            `brief for ${pass.id}`,
            [...prior.entries()].map(([id, output]) => `${id}: ${output}`).join("\n"),
          ].join("\n"),
        promptsDir: PROMPTS,
        context: { taste: [], memoryExcerpts: [] },
        workdir: ROOT,
        hooks: { gate: () => ({ allow: true }) },
        runlog: { root: home.root, app: "alpha", traceId: "turn-plan" },
        afterPass: (record) => {
          prior.set(record.pass.id, record.result.summary);
        },
      };

      const executed = await executePipeline(options);

      expect(executed.passes.map((pass) => pass.pass.id)).toEqual([
        "visionary",
        "pm-a",
        "pm-b",
        "arbitrator",
        "decomposer",
      ]);
      expect(tracker.maxActive).toBe(2);
      const decomposerCall = fake.calls.find((call) => call.req.task.includes("brief for decomposer"));
      expect(decomposerCall?.req.task).toContain("arbitrator: arbitrator output");
    } finally {
      home.cleanup();
    }
  });

  it("one-pass intake and standing-role pipelines execute through FakeRuntime", async () => {
    const { file, roles } = await loadRoot();
    const ids = [
      "groom",
      "triage",
      "sre-incident",
      "sre-health",
      "support-digest",
      "marketing-release",
      "ci-sweep",
    ];

    for (const pipelineName of ids) {
      const home = makeOrgHome({ runs: { apps: ["alpha"] } });
      const fake = new FakeRuntime(scripted(`${pipelineName} done`));
      try {
        const pipeline = getPipeline(file, pipelineName);
        const executed = await executePipeline({
          pipeline,
          selection: { tier: "standard" },
          roles,
          runtimeFor: () => fake,
          briefFor: (pass) => `brief for ${pipelineName}/${pass.id}`,
          promptsDir: PROMPTS,
          context: { taste: [], memoryExcerpts: [] },
          workdir: ROOT,
          hooks: { gate: () => ({ allow: true }) },
          runlog: { root: home.root, app: "alpha", traceId: `turn-${pipelineName}` },
        });
        expect(executed.aborted).toBe(false);
        expect(fake.calls).toHaveLength(1);
        expect(fake.calls[0]?.req.task).toContain(`# Pass:`);
      } finally {
        home.cleanup();
      }
    }
  });

  it("templates encode M8 protocol invariants", () => {
    const decomposer = readFileSync(join(PROMPTS, "plan/decomposer.md"), "utf8");
    expect(decomposer).toContain("Depends-on:");
    expect(decomposer).toContain("File scope:");
    expect(decomposer).toContain("Acceptance criteria");
    expect(decomposer).toMatch(/human sign-off/i);

    for (const template of ["groom/groom.md", "triage/triage.md", "sre/incident.md"]) {
      const text = readFileSync(join(PROMPTS, template), "utf8");
      expect(text).toMatch(/only Planner pipelines or the human apply/i);
      expect(text).toMatch(/op:ready/);
    }
    expect(readFileSync(join(PROMPTS, "groom/groom.md"), "utf8")).toMatch(/doc/i);
    expect(readFileSync(join(PROMPTS, "triage/triage.md"), "utf8")).toMatch(/doc/i);
    expect(readFileSync(join(PROMPTS, "sre/incident.md"), "utf8")).toContain("## Incident summary");

    for (const template of [
      "sre/health.md",
      "support/digest.md",
      "marketing/release.md",
      "marketing/ci-sweep.md",
    ]) {
      const text = readFileSync(join(PROMPTS, template), "utf8");
      expect(text).toMatch(/draft|approval|critical/i);
      expect(text).toMatch(/Planner feed|Incidents emitted|Approval requests|Draft-only artifacts/);
    }
  });
});

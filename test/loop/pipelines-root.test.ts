// Tests the real root pipelines.yaml against roles.yaml and prompts/.
// Covers the expected pipeline set, tier-specific pass selection, review and
// ship conditions, builder/reviewer ownership, plan parallelism, and standing
// role pipeline ownership.
// Reads repo-local protocol files only; no network, auth, real org state, or
// wall-clock time is required.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getPipeline,
  loadPipelines,
  selectPasses,
  type PipelinesFile,
} from "../../src/loop/pipelines.js";
import { loadRoles } from "../../src/org/roles.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

async function loadRoot(): Promise<PipelinesFile> {
  const { roles } = await loadRoles(join(ROOT, "roles.yaml"));
  return loadPipelines(join(ROOT, "pipelines.yaml"), {
    roleNames: roles.map((r) => r.name),
    promptsDir: join(ROOT, "prompts"),
  });
}

describe("root pipelines.yaml", () => {
  it("loads against the real roles.yaml and prompts/ — M8 pipeline set + Stage 4 bootstrap plan", async () => {
    const file = await loadRoot();
    expect(file.pipelines.map((p) => p.name)).toEqual([
      "build",
      "review",
      "fix",
      "ship",
      // Stage 4 (proportionality-review): a new app's first milestone plans
      // through ONE pass, not five — deliberate intent change landing in the
      // same proposal PR that added the pipeline.
      "plan-bootstrap",
      "plan",
      "groom",
      "triage",
      "sre-incident",
      "sre-health",
      "support-digest",
      "marketing-release",
      "ci-sweep",
      "learning-distill",
      "learning-review",
    ]);
  });

  it("plan-bootstrap: a single planner pass at every tier", async () => {
    const bootstrap = getPipeline(await loadRoot(), "plan-bootstrap");
    expect(selectPasses(bootstrap, { tier: "standard" }).map((p) => p.id)).toEqual(["bootstrap-plan"]);
    expect(selectPasses(bootstrap, { tier: "deep" }).map((p) => p.id)).toEqual(["bootstrap-plan"]);
  });

  it("build: every tier runs the typed contract before implementation", async () => {
    const build = getPipeline(await loadRoot(), "build");
    expect(selectPasses(build, { tier: "quick" }).map((p) => p.id)).toEqual([
      "contract",
      "implement",
    ]);
    expect(selectPasses(build, { tier: "standard" }).map((p) => p.id)).toEqual([
      "contract",
      "implement",
    ]);
  });

  it("implement protocol permits a first-test-command bootstrap without weakening final verification", async () => {
    const prompt = await readFile(join(ROOT, "prompts", "build", "implement.md"), "utf8");
    expect(prompt).toContain("Bootstrap exception");
    expect(prompt).toMatch(/test command\s+as `\(not configured\)`/);
    expect(prompt).toContain("new full suite must still exist and pass");
  });

  it("review: verify always runs; deep dimensions only on trigger", async () => {
    const review = getPipeline(await loadRoot(), "review");
    expect(selectPasses(review, { tier: "standard" }).map((p) => p.id)).toEqual(["verify"]);
    expect(
      selectPasses(review, { tier: "standard", riskTier: "high" }).map((p) => p.id),
    ).toEqual(["verify", "security-deep"]);
    expect(
      selectPasses(review, { tier: "standard", labels: ["op:perf-sensitive"] }).map((p) => p.id),
    ).toEqual(["verify", "perf-scale"]);
  });

  it("ship: mechanical; ship-check on high risk OR deep tier, else no passes", async () => {
    const ship = getPipeline(await loadRoot(), "ship");
    expect(ship.mechanical).toBe(true);
    expect(selectPasses(ship, { tier: "standard" })).toEqual([]);
    expect(selectPasses(ship, { tier: "standard", riskTier: "high" }).map((p) => p.id)).toEqual([
      "ship-check",
    ]);
    expect(selectPasses(ship, { tier: "deep" }).map((p) => p.id)).toEqual(["ship-check"]);
  });

  it("builder implements, reviewer reviews — cross-provider pairing holds per pass", async () => {
    const file = await loadRoot();
    for (const pass of getPipeline(file, "build").passes) expect(pass.role).toBe("builder");
    expect(getPipeline(file, "fix").passes[0]?.role).toBe("builder");
    for (const pass of getPipeline(file, "review").passes) expect(pass.role).toBe("reviewer");
    expect(getPipeline(file, "ship").passes[0]?.role).toBe("reviewer");
  });

  it("plan: competing PMs share a parallel group before decomposer", async () => {
    const plan = getPipeline(await loadRoot(), "plan");
    expect(plan.passes.map((p) => p.id)).toEqual([
      "visionary",
      "pm-a",
      "pm-b",
      "arbitrator",
      "decomposer",
    ]);
    expect(plan.passes.map((p) => p.role)).toEqual([
      "planner",
      "planner",
      "planner",
      "planner",
      "planner",
    ]);
    expect(plan.passes[1]?.parallelGroup).toBe("competing-pms");
    expect(plan.passes[2]?.parallelGroup).toBe("competing-pms");
  });

  it("standing-role pipelines are owned by their roles", async () => {
    const file = await loadRoot();
    expect(getPipeline(file, "groom").passes.map((p) => `${p.id}:${p.role}`)).toEqual(["groom:planner"]);
    expect(getPipeline(file, "triage").passes.map((p) => `${p.id}:${p.role}`)).toEqual([
      "triage:planner",
    ]);
    expect(getPipeline(file, "sre-incident").passes.map((p) => `${p.id}:${p.role}`)).toEqual([
      "incident:sre",
    ]);
    expect(getPipeline(file, "sre-health").passes.map((p) => `${p.id}:${p.role}`)).toEqual([
      "health:sre",
    ]);
    expect(getPipeline(file, "support-digest").passes.map((p) => `${p.id}:${p.role}`)).toEqual([
      "digest:support",
    ]);
    expect(getPipeline(file, "marketing-release").passes.map((p) => `${p.id}:${p.role}`)).toEqual([
      "release:marketing",
    ]);
    expect(getPipeline(file, "ci-sweep").passes.map((p) => `${p.id}:${p.role}`)).toEqual([
      "sweep:marketing",
    ]);
    expect(getPipeline(file, "learning-distill").passes.map((p) => `${p.id}:${p.role}`)).toEqual([
      "distill:distiller",
    ]);
    expect(getPipeline(file, "learning-review").passes.map((p) => `${p.id}:${p.role}`)).toEqual([
      "review:learning-reviewer",
    ]);
  });
});

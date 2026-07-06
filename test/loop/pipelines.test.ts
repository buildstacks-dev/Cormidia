// pipelines.yaml loader + selection semantics (build plan M2.1). Fixtures
// only — the real root pipelines.yaml is M2.2's proposal PR.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  getPipeline,
  loadPipelines,
  parallelStages,
  selectPasses,
  type PipelinesFile,
} from "../../src/loop/pipelines.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/pipelines", import.meta.url));
const FIXTURE_YAML = join(FIXTURE_DIR, "pipelines.yaml");
const PROMPTS_DIR = join(FIXTURE_DIR, "prompts");
const ROLE_NAMES = ["planner", "builder", "reviewer"];

const OPTS = { roleNames: ROLE_NAMES, promptsDir: PROMPTS_DIR };

async function loadFixture(): Promise<PipelinesFile> {
  return loadPipelines(FIXTURE_YAML, OPTS);
}

/** Write a one-off yaml into a temp dir for rejection cases. */
const tempDirs: string[] = [];
function tempYaml(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "operon-pipelines-"));
  tempDirs.push(dir);
  const path = join(dir, "pipelines.yaml");
  writeFileSync(path, content, "utf8");
  return path;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("loadPipelines", () => {
  it("ordered passes load with per-pass overrides", async () => {
    const file = await loadFixture();
    const build = getPipeline(file, "build");

    expect(build.passes.map((p) => p.id)).toEqual(["contract", "implement"]);
    expect(build.mechanical).toBe(false);
    expect(build.passes[0]).toMatchObject({
      role: "builder",
      template: "build/pass.md",
      skipOnTier: ["quick"],
    });
    expect(build.passes[1]).toMatchObject({ effort: "high", model: "gpt-5.5" });

    const ship = getPipeline(file, "ship");
    expect(ship.mechanical).toBe(true);
  });

  it("unknown role rejected", async () => {
    const path = tempYaml(
      ["broken:", "  passes:", "    - id: p1", "      role: stranger", "      template: build/pass.md"].join(
        "\n",
      ),
    );
    await expect(loadPipelines(path, OPTS)).rejects.toThrow(
      /pipeline "broken" pass "p1": unknown role "stranger" — roles.yaml defines: planner, builder, reviewer/,
    );
  });

  it("missing template rejected", async () => {
    const path = tempYaml(
      ["broken:", "  passes:", "    - id: p1", "      role: builder", "      template: build/ghost.md"].join(
        "\n",
      ),
    );
    await expect(loadPipelines(path, OPTS)).rejects.toThrow(/template not found: .*build\/ghost\.md/);
  });

  it("duplicate pass ids and invalid tiers rejected", async () => {
    const dup = tempYaml(
      [
        "broken:",
        "  passes:",
        "    - { id: p1, role: builder, template: build/pass.md }",
        "    - { id: p1, role: builder, template: build/pass.md }",
      ].join("\n"),
    );
    await expect(loadPipelines(dup, OPTS)).rejects.toThrow(/duplicate pass id "p1"/);

    const tier = tempYaml(
      [
        "broken:",
        "  passes:",
        "    - { id: p1, role: builder, template: build/pass.md, skip_on_tier: [turbo] }",
      ].join("\n"),
    );
    await expect(loadPipelines(tier, OPTS)).rejects.toThrow(/"turbo" is not one of quick \| standard \| deep/);
  });

  it("unknown pipeline throws descriptively", async () => {
    const file = await loadFixture();
    expect(() => getPipeline(file, "deploy")).toThrow(
      /unknown pipeline "deploy" — available: build, review, ship, plan/,
    );
  });
});

describe("selectPasses", () => {
  it("skip_on_tier excludes", async () => {
    const build = getPipeline(await loadFixture(), "build");

    const quick = selectPasses(build, { tier: "quick" });
    expect(quick.map((p) => p.id)).toEqual(["implement"]);

    const standard = selectPasses(build, { tier: "standard" });
    expect(standard.map((p) => p.id)).toEqual(["contract", "implement"]);
  });

  it("only_on filters (OR across risk, labels, dimension_globs)", async () => {
    const review = getPipeline(await loadFixture(), "review");
    const ids = (sel: Parameters<typeof selectPasses>[1]) =>
      selectPasses(review, sel).map((p) => p.id);

    // Nothing conditional matches → only the always-on verify pass.
    expect(ids({ tier: "standard", riskTier: "medium" })).toEqual(["verify"]);

    // High risk triggers security-deep.
    expect(ids({ tier: "standard", riskTier: "high" })).toEqual(["verify", "security-deep"]);

    // A security dimension match triggers it too (OR semantics).
    expect(ids({ tier: "standard", riskTier: "medium", dimensions: ["security"] })).toEqual([
      "verify",
      "security-deep",
    ]);

    // The perf label triggers perf-scale.
    expect(ids({ tier: "standard", riskTier: "medium", labels: ["op:perf-sensitive"] })).toEqual([
      "verify",
      "perf-scale",
    ]);
  });
});

describe("parallelStages", () => {
  it("parallel_group grouping returned (adjacent same-group passes share a stage)", async () => {
    const plan = getPipeline(await loadFixture(), "plan");
    const stages = parallelStages(plan.passes).map((stage) => stage.map((p) => p.id));

    expect(stages).toEqual([["visionary"], ["pm-a", "pm-b"], ["arbitrator"]]);
  });
});

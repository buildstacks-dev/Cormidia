// The real root pipelines.yaml loads through the M2.1 loader (M2.2 accept).
// Beyond load-validity, these cases pin the ratified config's *intent* —
// which passes a tier or trigger selects — so a pipelines.yaml edit that
// silently changes protocol behavior fails here, not in production.

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
  it("loads against the real roles.yaml and prompts/ — 4 pipelines", async () => {
    const file = await loadRoot();
    expect(file.pipelines.map((p) => p.name)).toEqual(["build", "review", "fix", "ship"]);
  });

  it("build: quick tier skips contract, standard runs both passes", async () => {
    const build = getPipeline(await loadRoot(), "build");
    expect(selectPasses(build, { tier: "quick" }).map((p) => p.id)).toEqual(["implement"]);
    expect(selectPasses(build, { tier: "standard" }).map((p) => p.id)).toEqual([
      "contract",
      "implement",
    ]);
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
    expect(
      selectPasses(ship, { tier: "deep", labels: ["op:tier-deep"] }).map((p) => p.id),
    ).toEqual(["ship-check"]);
  });

  it("builder implements, reviewer reviews — cross-provider pairing holds per pass", async () => {
    const file = await loadRoot();
    for (const pass of getPipeline(file, "build").passes) expect(pass.role).toBe("builder");
    expect(getPipeline(file, "fix").passes[0]?.role).toBe("builder");
    for (const pass of getPipeline(file, "review").passes) expect(pass.role).toBe("reviewer");
    expect(getPipeline(file, "ship").passes[0]?.role).toBe("reviewer");
  });
});

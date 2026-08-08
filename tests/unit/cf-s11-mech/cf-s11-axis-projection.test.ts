import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ScenarioConfig } from "../../campaign/acceptance/campaign-config.js";
import { scoreMechanicalAxes } from "../../campaign/acceptance/mechanical-axis-results.js";
import { provisionScenarioRepository } from "../../campaign/acceptance/provision.js";
import { extractSealedKey } from "../../campaign/acceptance/sealed-key.js";
import { makeTempGitRepo } from "../../fixtures/git-repo.js";

const root = process.cwd();

describe("CF-S11 axis projection", () => {
  it("projects the sealed app plants into P-1..P-4 and leaves threshold axes ungraded", async () => {
    const markdown = await readFile(join(root, "acceptance/scenarios/S-ACC-1-greenfield-web.md"), "utf8");
    const scenario: ScenarioConfig = {
      id: "S-ACC-1",
      kind: "app",
      appSlug: "cormidia/s1",
      worktree: "/tmp/s1",
      matrix: {},
    };
    const results = await scoreMechanicalAxes({
      axes: ["P-1", "P-2", "P-3", "P-4", "O-6", "O-7"],
      scenario,
      provision: {
        scenarioId: scenario.id,
        appSlug: scenario.appSlug,
        baselineCommit: "a",
        seededPaths: [],
        provisionedShas: [],
        sealedMaterial: {},
      },
      evidence: [
        {
          kind: "run-journal",
          ref: "plan-ticket-set",
          contents: "Rate history Timezone correctness free tier multi-currency magic link",
        },
      ],
      key: extractSealedKey({ scenarioId: scenario.id, scenarioKind: "app", scenarioMarkdown: markdown }),
      stateHome: "/tmp/state",
    });
    expect(results.slice(0, 4).map((row) => row.score)).toEqual([3, 3, 3, 3]);
    expect(results.slice(4).map((row) => [row.score, row.ungradedReason])).toEqual([
      ["ungraded", "threshold-unratified"],
      ["ungraded", "threshold-unratified"],
    ]);
  });

  it("projects the job journal and sealed seed into J-1/J-2", async () => {
    const repo = await makeTempGitRepo();
    try {
      const assignment = { harness: "claude", model: "claude-sonnet-5", effort: "xhigh" } as const;
      const matrix = Object.fromEntries(
        ["research-a", "research-b", "research-c", "synthesize", "visualize"].map((id) => [id, assignment]),
      );
      const scenario: ScenarioConfig = {
        id: "S-ACC-3",
        kind: "job",
        appSlug: "cormidia/s3",
        worktree: repo.dir,
        matrix,
      };
      const provision = await provisionScenarioRepository({
        scenarioId: scenario.id,
        kind: scenario.kind,
        appSlug: scenario.appSlug,
        worktree: scenario.worktree,
        seedManifestPath: join(root, "acceptance/seeds/s-acc-3-notes.json"),
        jobMatrix: matrix,
      });
      await mkdir(join(repo.dir, "outputs"), { recursive: true });
      for (const name of ["a.json", "b.json", "c.json"])
        await writeFile(join(repo.dir, "outputs", name), "{}\n", "utf8");
      const merged = '{"Tessera":"migration tool","Rundeep":["test runner","assertion library"]}\n';
      await writeFile(join(repo.dir, "outputs/merged.json"), merged, "utf8");
      await writeFile(join(repo.dir, "outputs/index.html"), "<!doctype html><title>comparison</title>\n", "utf8");
      const events = Object.keys(matrix).map((step) => ({ step, status: "completed" }));
      const markdown = await readFile(join(root, "acceptance/scenarios/S-ACC-3-research-viz-job.md"), "utf8");
      const results = await scoreMechanicalAxes({
        axes: ["J-1", "J-2"],
        scenario,
        provision,
        evidence: [
          { kind: "run-journal", ref: "job-journal", contents: JSON.stringify({ events }) },
          { kind: "repo-state", ref: "job-output:outputs/merged.json", contents: merged },
        ],
        key: extractSealedKey({ scenarioId: scenario.id, scenarioKind: "job", scenarioMarkdown: markdown }),
        stateHome: "/tmp/state",
      });
      expect(results.map((row) => row.score)).toEqual([3, 3]);
    } finally {
      await repo.cleanup();
    }
  });
});

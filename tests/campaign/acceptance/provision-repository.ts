import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { devNull } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import type { TurnAssignment } from "../../../src/runtime/types.js";
import type { ScenarioProvision, ScenarioProvisionSpec } from "./provision.js";
import { materializeSeedCorpus, readSeedManifest, sealedSeedMaterial } from "./seed-corpus.js";

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull };
const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

function renderAcceptanceJob(scenarioId: string, matrix: Record<string, TurnAssignment>): string {
  if (scenarioId !== "S-ACC-3") throw new Error(`provision refused: no ratified job graph for ${scenarioId}`);
  const step = (id: string, objective: string, dependsOn: string[], path: string, check: unknown) => ({
    id,
    objective,
    ...(dependsOn.length === 0 ? {} : { dependsOn }),
    assignment: matrix[id],
    outputs: [{ path, check }],
  });
  for (const id of ["research-a", "research-b", "research-c", "synthesize", "visualize"]) {
    if (matrix[id] === undefined) throw new Error(`provision refused: ${scenarioId} matrix is missing ${id}`);
  }
  return stringify({
    job: "l-acc-run-1-s-acc-3",
    app: null,
    description: "L-ACC S-ACC-3 research, synthesis and standalone visualization",
    steps: [
      step(
        "research-a",
        "Read inputs/notes-a.md and produce factual structured findings. Preserve uncertainty.",
        [],
        "outputs/a.json",
        "json",
      ),
      step(
        "research-b",
        "Read inputs/notes-b.md and produce factual structured findings. Preserve uncertainty.",
        [],
        "outputs/b.json",
        "json",
      ),
      step(
        "research-c",
        "Read inputs/notes-c.md and produce factual structured findings. Preserve uncertainty.",
        [],
        "outputs/c.json",
        "json",
      ),
      step(
        "synthesize",
        "Read every dependency output verbatim. Produce one merged comparison; preserve source disagreements and say when no weakness is discoverable.",
        ["research-a", "research-b", "research-c"],
        "outputs/merged.json",
        "json",
      ),
      step(
        "visualize",
        "Read outputs/merged.json, choose and justify a visual from the data, then write one self-contained outputs/index.html with no CDN, build step, or npm install.",
        ["synthesize"],
        "outputs/index.html",
        "non_empty",
      ),
    ],
  });
}

export async function provisionScenarioRepositoryImpl(
  spec: ScenarioProvisionSpec,
  identity: { name: string; email: string },
): Promise<ScenarioProvision> {
  git(spec.worktree, ["config", "user.name", identity.name]);
  git(spec.worktree, ["config", "user.email", identity.email]);
  let seededPaths: string[] = [];
  let sealedMaterial: Record<string, unknown> = {};
  if (spec.seedManifestPath !== undefined) {
    const manifest = await readSeedManifest(spec.seedManifestPath);
    seededPaths = (await materializeSeedCorpus(manifest, spec.worktree)).paths;
    sealedMaterial = sealedSeedMaterial(manifest);
  }
  if (spec.brief !== undefined) {
    if (/^##\s+Plants\b/m.test(spec.brief))
      throw new Error(`provision refused: ${spec.scenarioId} brief contains Plants`);
    await writeFile(join(spec.worktree, "BRIEF.md"), spec.brief, "utf8");
    seededPaths.push("BRIEF.md");
  }
  if (spec.answers !== undefined) {
    await writeFile(
      join(spec.worktree, ".cormidia-answers.json"),
      `${JSON.stringify(spec.answers, null, 2)}\n`,
      "utf8",
    );
    seededPaths.push(".cormidia-answers.json");
  }
  if (spec.jobMatrix !== undefined) {
    await writeFile(join(spec.worktree, "job.yaml"), renderAcceptanceJob(spec.scenarioId, spec.jobMatrix), "utf8");
    seededPaths.push("job.yaml");
  }
  git(spec.worktree, ["add", "-A"]);
  if (git(spec.worktree, ["status", "--porcelain"]).length > 0)
    git(spec.worktree, ["commit", "--no-gpg-sign", "-m", `provision: baseline ${spec.scenarioId}`]);
  const baselineCommit = git(spec.worktree, ["rev-parse", "HEAD"]);
  return {
    scenarioId: spec.scenarioId,
    appSlug: spec.appSlug,
    baselineCommit,
    seededPaths,
    sealedMaterial,
    provisionedShas: git(spec.worktree, ["log", "--format=%H", baselineCommit]).split("\n").filter(Boolean),
  };
}

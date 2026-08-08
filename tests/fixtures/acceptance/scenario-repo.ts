// fixtures/acceptance/scenario-repo.ts — the disposable repositories an L-ACC
// scenario runs against, as REAL temp git repos (B-15 substrate, via
// fixtures/git-repo.ts).
//
// Two seeds here exist only to make detectors fire:
//   * `commitPlantsThenDelete` commits the sealed scenario markdown and then
//     removes it in a later commit. The working tree is clean; `git log -p`
//     still hands the plants to any agentic turn holding file-read tools.
//     That is the half of CORMIDIA-INV-ACC-1 an assembled-input scan misses.
//   * `handAuthoredCommit` writes a commit under a non-Cormidia identity — the
//     CF-INV-ACC-7a negative control.

import { makeTempGitRepo, type TempGitRepo } from "../git-repo.js";
import { fixtureScenario, type FixtureScenarioKind, type FixtureScenarioOptions } from "./scenario-corpus.js";

/** Author identity a real Cormidia turn commits under in these fixtures. */
export const CORMIDIA_TURN_IDENTITY = "cormidia-builder <builder@cormidia.invalid>";
/** The supervisor identity INV-ACC-7a must catch. */
export const SUPERVISOR_IDENTITY = "Supervising Agent <supervisor@example.invalid>";

export interface FixtureScenarioRepoOptions {
  kind: FixtureScenarioKind;
  scenario?: FixtureScenarioOptions;
  /** Commit the sealed scenario markdown, then delete it. Working tree clean,
   *  history dirty. Defaults to false. */
  commitPlantsThenDelete?: boolean;
  /** Add a file:// origin remote so origin-identity checks have a real remote. */
  withOrigin?: boolean;
  /** Seed a commit authored outside any Cormidia turn identity. */
  handAuthoredCommit?: { path: string; contents: string; message?: string };
}

export interface FixtureScenarioRepo {
  repo: TempGitRepo;
  kind: FixtureScenarioKind;
  /** Plant tokens that must never be reachable from a grader turn. */
  tokens: string[];
  originUrl?: string;
  cleanup(): Promise<void>;
}

const SEEDS: Record<FixtureScenarioKind, Array<{ path: string; contents: string }>> = {
  greenfield: [{ path: "README.md", contents: "# fixture greenfield app\n\nNothing built yet.\n" }],
  "seeded-corpus": [
    { path: "docs/01-getting-started.md", contents: "# Getting started\n\nStill correct.\n" },
    { path: "docs/07-webhooks.md", contents: "# Webhooks\n\nOverlaps with 08.\n" },
    { path: "docs/08-events.md", contents: "# Events\n\nOverlaps with 07.\n" },
  ],
  job: [
    { path: "inputs/notes-a.md", contents: "# Notes A\n\n- alpha: fast\n- beta: small\n" },
    { path: "inputs/notes-b.md", contents: "# Notes B\n\n- alpha: slow\n- gamma: only-here\n" },
    { path: "inputs/notes-c.md", contents: "# Notes C\n\n- beta: small\n" },
  ],
};

export async function makeFixtureScenarioRepo(options: FixtureScenarioRepoOptions): Promise<FixtureScenarioRepo> {
  const scenario = fixtureScenario(options.kind, options.scenario ?? {});
  // Seeded EMPTY, then the turn identity is configured, then the seeds are
  // committed: every commit in a fixture scenario repo must carry a Cormidia
  // turn identity, or the INV-ACC-7a reconciliation would find a violation the
  // fixture manufactured rather than one a test seeded.
  const repo = await makeTempGitRepo({ seedFiles: [] });
  repo.git(["config", "user.name", "cormidia-builder"]);
  repo.git(["config", "user.email", "builder@cormidia.invalid"]);
  for (const seed of SEEDS[options.kind]) {
    await repo.commitFile(seed.path, seed.contents, `fixture: seed ${seed.path}`);
  }

  if (options.commitPlantsThenDelete === true) {
    await repo.commitFile(scenario.path, scenario.markdown, "fixture: sealed scenario (to be removed)");
    repo.git(["rm", "--quiet", "--", scenario.path]);
    repo.git(["commit", "--no-gpg-sign", "-m", "fixture: remove sealed scenario from the working tree"]);
  }

  if (options.handAuthoredCommit !== undefined) {
    const seed = options.handAuthoredCommit;
    repo.git(["config", "user.name", "Supervising Agent"]);
    repo.git(["config", "user.email", "supervisor@example.invalid"]);
    await repo.commitFile(seed.path, seed.contents, seed.message ?? "fix the build by hand");
    repo.git(["config", "user.name", "cormidia-builder"]);
    repo.git(["config", "user.email", "builder@cormidia.invalid"]);
  }

  let originUrl: string | undefined;
  if (options.withOrigin === true) originUrl = (await repo.addFileRemote()).url;

  return {
    repo,
    kind: options.kind,
    tokens: scenario.tokens,
    ...(originUrl === undefined ? {} : { originUrl }),
    cleanup: repo.cleanup,
  };
}

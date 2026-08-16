// Traceability: CF-INV-ACC-3 · HB-123 · invariants.md INV-ACC-3.

// CF-INV-ACC-3 (L1/L2) — a campaign never points an app at this repository.
//
// Real temp git repos, real remotes, real realpaths: the three escape routes
// this family closes are all path/origin facts, and a fake would be proving
// itself. `assertCampaignRepositoryBinding` is REUSED for the commit-pin half
// (B-27 §1.1) rather than reimplemented here.

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertCampaignRepositoryBinding } from "../../campaign/repository-binding.js";
import {
  assertScenarioNotThisRepository,
  normalizeRepositoryRef,
  ScenarioBindingError,
} from "../../campaign/acceptance/scenario-binding.js";
import { makeFixtureScenarioRepo } from "../../fixtures/acceptance/scenario-repo.js";
import { makeTempGitRepo } from "../../fixtures/git-repo.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function refusal(run: () => Promise<unknown>): Promise<ScenarioBindingError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ScenarioBindingError) return error;
    throw error;
  }
  throw new Error("expected a ScenarioBindingError, but the binding was accepted");
}

describe("CF-INV-ACC-3 the campaign-app slug check", () => {
  it("accepts a disposable campaign app and records what it checked", async () => {
    const scenario = await makeFixtureScenarioRepo({ kind: "greenfield" });
    const cormidia = await makeTempGitRepo();
    cleanups.push(scenario.cleanup, cormidia.cleanup);

    const proof = await assertScenarioNotThisRepository({
      scenarioId: "S-ACC-1",
      appSlug: "cormidia-sandbox/acc-1-timetracker",
      campaignOrg: "cormidia-sandbox",
      worktree: scenario.repo.dir,
      cormidia: { slug: "cormidia/cormidia", root: cormidia.dir },
    });
    expect(proof.appSlug).toBe("cormidia-sandbox/acc-1-timetracker");
    expect(proof.worktreeOrigin).toBeNull();
  });

  it("negative control: a scenario deliberately bound to this repository by slug is refused", async () => {
    const scenario = await makeFixtureScenarioRepo({ kind: "greenfield" });
    const cormidia = await makeTempGitRepo();
    cleanups.push(scenario.cleanup, cormidia.cleanup);

    const error = await refusal(async () =>
      assertScenarioNotThisRepository({
        scenarioId: "S-ACC-1",
        appSlug: "https://github.com/cormidia/cormidia.git",
        campaignOrg: "cormidia-sandbox",
        worktree: scenario.repo.dir,
        cormidia: { slug: "cormidia/cormidia", root: cormidia.dir },
      }),
    );
    expect(error.code).toBe("app-slug");
  });

  it("negative control: a real repository that is simply NOT Cormidia is still refused", async () => {
    // The half a "not this repository" check alone would miss: `acme/website`
    // is not Cormidia, is a perfectly real repository, and a campaign has no
    // authorization over it. B-27 §1.3 requires BOTH halves.
    const scenario = await makeFixtureScenarioRepo({ kind: "greenfield" });
    const cormidia = await makeTempGitRepo();
    cleanups.push(scenario.cleanup, cormidia.cleanup);

    const error = await refusal(async () =>
      assertScenarioNotThisRepository({
        scenarioId: "S-ACC-1",
        appSlug: "acme/website",
        campaignOrg: "cormidia-sandbox",
        worktree: scenario.repo.dir,
        cormidia: { slug: "cormidia/cormidia", root: cormidia.dir },
      }),
    );
    expect(error.code).toBe("outside-campaign-org");
  });

  it("negative control: a blank campaign org refuses rather than admitting everything", async () => {
    const scenario = await makeFixtureScenarioRepo({ kind: "greenfield" });
    const cormidia = await makeTempGitRepo();
    cleanups.push(scenario.cleanup, cormidia.cleanup);

    const error = await refusal(async () =>
      assertScenarioNotThisRepository({
        scenarioId: "S-ACC-1",
        appSlug: "cormidia-sandbox/acc-1",
        campaignOrg: "   ",
        worktree: scenario.repo.dir,
        cormidia: { slug: "cormidia/cormidia", root: cormidia.dir },
      }),
    );
    expect(error.code).toBe("outside-campaign-org");
  });

  it("normalizes ssh, https and bare slugs to the same identity", () => {
    const expected = "github.com/cormidia/cormidia";
    expect(normalizeRepositoryRef("https://github.com/cormidia/cormidia.git")).toBe(expected);
    expect(normalizeRepositoryRef("git@github.com:cormidia/cormidia.git")).toBe(expected);
    expect(normalizeRepositoryRef("cormidia/cormidia")).toBe("cormidia/cormidia");
  });
});

describe("CF-INV-ACC-3 the real-origin and workdir checks", () => {
  it("negative control: a scenario worktree whose origin points back at this repository is refused", async () => {
    const cormidia = await makeTempGitRepo();
    cleanups.push(cormidia.cleanup);
    const scenarioRoot = await makeTempGitRepo();
    cleanups.push(scenarioRoot.cleanup);
    scenarioRoot.git(["remote", "add", "origin", cormidia.dir]);

    const error = await refusal(async () =>
      assertScenarioNotThisRepository({
        scenarioId: "S-ACC-2",
        appSlug: "cormidia-sandbox/acc-2-docs",
        campaignOrg: "cormidia-sandbox",
        worktree: scenarioRoot.dir,
        cormidia: { slug: "cormidia/cormidia", root: cormidia.dir },
      }),
    );
    expect(error.code).toBe("worktree-origin");
  });

  it("accepts a worktree with an unrelated file:// origin", async () => {
    const scenario = await makeFixtureScenarioRepo({ kind: "seeded-corpus", withOrigin: true });
    const cormidia = await makeTempGitRepo();
    cleanups.push(scenario.cleanup, cormidia.cleanup);

    const proof = await assertScenarioNotThisRepository({
      scenarioId: "S-ACC-2",
      appSlug: "cormidia-sandbox/acc-2-docs",
      campaignOrg: "cormidia-sandbox",
      worktree: scenario.repo.dir,
      cormidia: { slug: "cormidia/cormidia", root: cormidia.dir },
    });
    expect(proof.worktreeOrigin).not.toBeNull();
  });

  it("negative control: a scenario worktree inside this checkout is refused", async () => {
    const cormidia = await makeTempGitRepo();
    cleanups.push(cormidia.cleanup);
    const inside = join(cormidia.dir, "sandbox", "acc-1");
    await mkdir(inside, { recursive: true });

    const error = await refusal(async () =>
      assertScenarioNotThisRepository({
        scenarioId: "S-ACC-1",
        appSlug: "cormidia-sandbox/acc-1",
        campaignOrg: "cormidia-sandbox",
        worktree: inside,
        cormidia: { slug: "cormidia/cormidia", root: cormidia.dir },
      }),
    );
    expect(error.code).toBe("worktree-inside-checkout");
  });

  it("negative control: a job scenario given a --workdir inside this checkout is refused", async () => {
    const scenario = await makeFixtureScenarioRepo({ kind: "job" });
    const cormidia = await makeTempGitRepo();
    cleanups.push(scenario.cleanup, cormidia.cleanup);
    const insideWorkdir = join(cormidia.dir, "jobs", "acc-3");
    await mkdir(insideWorkdir, { recursive: true });

    const error = await refusal(async () =>
      assertScenarioNotThisRepository({
        scenarioId: "S-ACC-3",
        appSlug: "cormidia-sandbox/acc-3-research",
        campaignOrg: "cormidia-sandbox",
        worktree: scenario.repo.dir,
        jobWorkdir: insideWorkdir,
        cormidia: { slug: "cormidia/cormidia", root: cormidia.dir },
      }),
    );
    expect(error.code).toBe("job-workdir");
  });

  it("accepts a job --workdir outside the checkout and records it", async () => {
    const scenario = await makeFixtureScenarioRepo({ kind: "job" });
    const cormidia = await makeTempGitRepo();
    cleanups.push(scenario.cleanup, cormidia.cleanup);

    const proof = await assertScenarioNotThisRepository({
      scenarioId: "S-ACC-3",
      appSlug: "cormidia-sandbox/acc-3-research",
      campaignOrg: "cormidia-sandbox",
      worktree: scenario.repo.dir,
      jobWorkdir: scenario.repo.dir,
      cormidia: { slug: "cormidia/cormidia", root: cormidia.dir },
    });
    expect(proof.jobWorkdir).not.toBeNull();
  });
});

describe("CF-INV-ACC-3 the reused commit-pin half", () => {
  it("accepts an exact pin and refuses a moved HEAD, without reimplementing the check", async () => {
    const repo = await makeTempGitRepo({ seedFiles: [] });
    cleanups.push(repo.cleanup);
    const policyDir = join(repo.dir, "validation-design");
    const policyPath = join(repo.dir, "docs", "qualification", "host-policy.yaml");
    await mkdir(policyDir, { recursive: true });
    await mkdir(dirname(policyPath), { recursive: true });
    await writeFile(join(policyDir, "validation-policy.yaml"), "schema_version: 1\n", "utf8");
    await copyFile(join(process.cwd(), "docs", "qualification", "host-policy.yaml"), policyPath);
    repo.git(["add", "validation-design", "docs"]);
    repo.git(["commit", "--no-gpg-sign", "-qm", "fixture: policy"]);
    const commit = repo.git(["rev-parse", "HEAD"]);

    await expect(assertCampaignRepositoryBinding({ commit, policyPath, cwd: repo.dir })).resolves.toMatchObject({
      root: expect.any(String) as unknown as string,
    });

    await repo.commitFile("README.md", "# moved on\n", "fixture: move HEAD");
    await expect(assertCampaignRepositoryBinding({ commit, policyPath, cwd: repo.dir })).rejects.toThrow(
      /does not equal checked-out HEAD/,
    );
  });

  it("negative control: an untracked canonical policy blob is refused", async () => {
    const repo = await makeTempGitRepo({ seedFiles: [] });
    cleanups.push(repo.cleanup);
    const policyDir = join(repo.dir, "validation-design");
    const policyPath = join(repo.dir, "docs", "qualification", "host-policy.yaml");
    await mkdir(policyDir, { recursive: true });
    await mkdir(dirname(policyPath), { recursive: true });
    await writeFile(join(policyDir, "validation-policy.yaml"), "schema_version: 1\n", "utf8");
    await copyFile(join(process.cwd(), "docs", "qualification", "host-policy.yaml"), policyPath);
    git(repo.dir, ["add", "validation-design"]);
    git(repo.dir, ["commit", "--no-gpg-sign", "-qm", "fixture: without the policy"]);
    const commit = repo.git(["rev-parse", "HEAD"]);

    await expect(
      assertCampaignRepositoryBinding({
        commit,
        policyPath,
        cwd: repo.dir,
      }),
    ).rejects.toThrow(/is not tracked at the authorized commit/);
  });
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

// CF-J21-S (L2) — the provision phase, and the baseline that keeps
// CORMIDIA-INV-ACC-7a honest across it.
//
// Provisioning is supervisor work by design: the seed is the state a scenario
// STARTS from. The load-bearing case is the pair — a seed commit is exempt, and
// a supervisor commit made AFTER the baseline still fails. An exemption that
// swallowed both would quietly turn the invariant off.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PROVISION_IDENTITY, provisionScenarioRepository } from "../../campaign/acceptance/provision.js";
import {
  readScenarioCommits,
  reconcileSupervisorNonParticipation,
  type InvocationAuditRow,
} from "../../campaign/acceptance/supervisor-reconciliation.js";
import { CORMIDIA_TURN_IDENTITY } from "../../fixtures/acceptance/scenario-repo.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const seedsDir = join(repoRoot, "acceptance", "seeds");
const cleanups: Array<() => Promise<void>> = [];
const AUDIT: InvocationAuditRow[] = [{ invocationId: "cli-1", command: "cormidia loop" }];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function scenarioRepo(): Promise<TempGitRepo> {
  const repo = await makeTempGitRepo({ seedFiles: [{ path: "README.md", contents: "# scenario\n" }] });
  cleanups.push(repo.cleanup);
  return repo;
}

function provisionedShas(repo: TempGitRepo): string[] {
  return repo.git(["log", "--format=%H"]).split("\n").filter(Boolean);
}

describe("CF-J21-S provisioning seeds deterministically and records a baseline", () => {
  it("commits the corpus under the provision identity and returns the baseline sha", async () => {
    const repo = await scenarioRepo();
    const provision = await provisionScenarioRepository({
      scenarioId: "S-ACC-2",
      kind: "app",
      appSlug: "cormidia-sandbox/acc-2-docs",
      worktree: repo.dir,
      seedManifestPath: join(seedsDir, "s-acc-2-tutorials.json"),
    });

    expect(provision.baselineCommit).toBe(repo.git(["rev-parse", "HEAD"]));
    expect(provision.seededPaths).toHaveLength(10);
    expect(await readFile(join(repo.dir, "tutorials/01-getting-started-cli.md"), "utf8")).toContain(
      "Getting started with the CLI",
    );
    const author = repo.git(["log", "-1", "--format=%an <%ae>"]);
    expect(author).toBe(`${PROVISION_IDENTITY.name} <${PROVISION_IDENTITY.email}>`);
  });

  it("carries the sealed material out of band, never into the worktree", async () => {
    const repo = await scenarioRepo();
    const provision = await provisionScenarioRepository({
      scenarioId: "S-ACC-3",
      kind: "job",
      appSlug: "cormidia-sandbox/acc-3-research",
      worktree: repo.dir,
      seedManifestPath: join(seedsDir, "s-acc-3-notes.json"),
    });
    expect(Object.keys(provision.sealedMaterial).sort()).toEqual([
      "conflicting_tool",
      "no_weakness_tool",
      "single_source_tool",
    ]);
    expect(repo.git(["ls-files"])).not.toContain("s-acc-3-notes.json");
  });

  it("a scenario with no seed manifest still gets a baseline — greenfield starts empty", async () => {
    const repo = await scenarioRepo();
    const provision = await provisionScenarioRepository({
      scenarioId: "S-ACC-1",
      kind: "app",
      appSlug: "cormidia-sandbox/acc-1-timetracker",
      worktree: repo.dir,
    });
    expect(provision.seededPaths).toEqual([]);
    expect(provision.baselineCommit).toHaveLength(40);
  });
});

describe("CF-INV-ACC-7a the baseline exempts the seed and nothing else", () => {
  it("closes when every post-baseline commit carries a Cormidia turn identity", async () => {
    const repo = await scenarioRepo();
    const provision = await provisionScenarioRepository({
      scenarioId: "S-ACC-2",
      kind: "app",
      appSlug: "cormidia-sandbox/acc-2-docs",
      worktree: repo.dir,
      seedManifestPath: join(seedsDir, "s-acc-2-tutorials.json"),
    });
    const baselineShas = provisionedShas(repo);

    // The org then does its work under a turn identity.
    repo.git(["config", "user.name", "cormidia-builder"]);
    repo.git(["config", "user.email", "builder@cormidia.invalid"]);
    await repo.commitFile("tutorials/03-setting-up-ci.md", "# rewritten by the org\n", "rewrite CI tutorial");

    const outcome = reconcileSupervisorNonParticipation({
      scenarioId: "S-ACC-2",
      turnIdentities: [CORMIDIA_TURN_IDENTITY],
      commits: readScenarioCommits((args) => repo.git(args)),
      journalTurns: [{ turnId: "turn-1", invocationId: "cli-1", role: "builder" }],
      invocationAudit: AUDIT,
      actions: [],
      provisioning: { baselineCommit: provision.baselineCommit, provisionedShas: baselineShas },
    });

    expect(outcome.closed).toBe(true);
    expect(outcome.checked.provisionedCommitsExempt).toBe(baselineShas.length);
  });

  it("negative control: a supervisor commit made AFTER the baseline still fails", async () => {
    const repo = await scenarioRepo();
    const provision = await provisionScenarioRepository({
      scenarioId: "S-ACC-2",
      kind: "app",
      appSlug: "cormidia-sandbox/acc-2-docs",
      worktree: repo.dir,
      seedManifestPath: join(seedsDir, "s-acc-2-tutorials.json"),
    });
    const baselineShas = provisionedShas(repo);

    // The supervisor "just fixes the build" after onboarding.
    repo.git(["config", "user.name", "Supervising Agent"]);
    repo.git(["config", "user.email", "supervisor@example.invalid"]);
    await repo.commitFile("tutorials/03-setting-up-ci.md", "# fixed by hand\n", "fix the build");

    const outcome = reconcileSupervisorNonParticipation({
      scenarioId: "S-ACC-2",
      turnIdentities: [CORMIDIA_TURN_IDENTITY],
      commits: readScenarioCommits((args) => repo.git(args)),
      journalTurns: [],
      invocationAudit: AUDIT,
      actions: [],
      provisioning: { baselineCommit: provision.baselineCommit, provisionedShas: baselineShas },
    });

    expect(outcome.closed).toBe(false);
    expect(outcome.violations.map((violation) => violation.code)).toContain("commit-outside-turn-identity");
    expect(outcome.forcedOutcome).toBe("ungraded-and-incomplete");
  });

  it("negative control: with NO baseline declared, the seed itself is a violation — nothing is exempt by default", async () => {
    const repo = await scenarioRepo();
    await provisionScenarioRepository({
      scenarioId: "S-ACC-2",
      kind: "app",
      appSlug: "cormidia-sandbox/acc-2-docs",
      worktree: repo.dir,
      seedManifestPath: join(seedsDir, "s-acc-2-tutorials.json"),
    });

    const outcome = reconcileSupervisorNonParticipation({
      scenarioId: "S-ACC-2",
      turnIdentities: [CORMIDIA_TURN_IDENTITY],
      commits: readScenarioCommits((args) => repo.git(args)),
      journalTurns: [],
      invocationAudit: AUDIT,
      actions: [],
    });
    expect(outcome.closed).toBe(false);
    expect(outcome.checked.provisionedCommitsExempt).toBe(0);
  });
});

// Traceability: CF-J21-S · HB-130; CF-J21-R · HB-127; CF-J21-RC · HB-130; CF-INV-ACC-4 · HB-130; CF-C-B27 · HB-127 · contracts/journey-acceptance.md J-21; invariants.md INV-ACC-4; contracts/B-27-outcome-campaign.md.

// CF-J21-S / CF-J21-RC / CF-C-B27 (L2) — the campaign runner on a hermetic rig.
//
// NO CAMPAIGN RUNS HERE AND NO TOKEN IS SPENT. Both arms are injected
// callbacks and the install proof comes from the scripted process double, so
// this exercises the runner's ORDERING and its report — which is exactly what
// HB-130 owed. Run 1 remains blocked on a separate exact human authorization
// naming its output-token and equivalent-USD ceilings (risk-allocation §5a).
//
// The load-bearing assertions: the build arm is never reached without a durable
// gate resolution, a campaign that stops at the gate is complete-for-the-plan-
// arm rather than failed, and the report carries no release signal (F-PT-029).

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { TurnAssignment } from "../../../src/runtime/types.js";
import type { AcceptanceCampaignConfig } from "../../campaign/acceptance/campaign-config.js";
import type { AxisReportRow } from "../../campaign/acceptance/campaign-report.js";
import { parseInstallProof } from "../../campaign/acceptance/packaged-provenance.js";
import { CampaignSpendRefusal } from "../../campaign/acceptance/campaign-spend.js";
import { runAcceptanceCampaign, type ScenarioArms } from "../../campaign/acceptance/runner.js";
import { makePackagedInstallDouble } from "../../fixtures/acceptance/packaged-install-double.js";
import { fixtureScenario } from "../../fixtures/acceptance/scenario-corpus.js";
import { makeFixtureScenarioRepo } from "../../fixtures/acceptance/scenario-repo.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cleanups: Array<() => Promise<void>> = [];
const COMMIT_PIN_AT = new Date("2026-08-08T09:00:00.000Z");
const RAN_AT = new Date("2026-08-08T09:30:00.000Z");

const claudeOpus: TurnAssignment = { harness: "claude", model: "claude-opus-4-8", effort: "xhigh" };
const claudeSonnet: TurnAssignment = { harness: "claude", model: "claude-sonnet-5", effort: "xhigh" };
const codexSol: TurnAssignment = { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" };

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A minimal authorized repository: the binding check needs a real commit with
 *  the canonical policy blob tracked at it, and nothing more. */
async function authorizedRepo(): Promise<{ repo: TempGitRepo; commit: string; policyPath: string }> {
  const repo = await makeTempGitRepo({ seedFiles: [] });
  cleanups.push(repo.cleanup);
  const dir = join(repo.dir, "validation-design");
  const host = join(repo.dir, "docs", "qualification", "host-policy.yaml");
  await mkdir(dir, { recursive: true });
  await mkdir(dirname(host), { recursive: true });
  await writeFile(join(dir, "validation-policy.yaml"), "schema_version: 1\n", "utf8");
  await copyFile(join(repoRoot, "docs", "qualification", "host-policy.yaml"), host);
  repo.git(["add", "validation-design", "docs"]);
  repo.git(["commit", "--no-gpg-sign", "-qm", "fixture: policy"]);
  return { repo, commit: repo.git(["rev-parse", "HEAD"]), policyPath: host };
}

function planRow(axis: string, score: 0 | 1 | 2 | 3): AxisReportRow {
  return {
    axis,
    verdict: "inconclusive",
    score,
    justification: `${axis} judged against the sealed key`,
    citations: ["ticket-set"],
    ungradedReason: null,
    grader: codexSol,
    mechanical: false,
    appliedDisjointnessFamilies: ["anthropic"],
    appliedReadTurnIds: ["plan"],
  };
}

function outcomeRow(axis: string): AxisReportRow {
  return {
    axis,
    verdict: "inconclusive",
    score: 2,
    justification: `${axis} judged against the artifacts`,
    citations: ["diff"],
    ungradedReason: null,
    grader: codexSol,
    mechanical: false,
    appliedDisjointnessFamilies: ["anthropic"],
    appliedReadTurnIds: ["build"],
  };
}

interface Rig {
  config: AcceptanceCampaignConfig;
  arms: ScenarioArms[];
  calls: string[];
  bindingCwd: string;
  scenarioMarkdown: Record<string, string>;
  cormidia: { slug: string; root: string };
}

async function rig(options: { planScores?: Record<string, 0 | 1 | 2 | 3>; autoContinue?: boolean } = {}): Promise<Rig> {
  const authorized = await authorizedRepo();
  const scenarioRepo = await makeFixtureScenarioRepo({ kind: "greenfield" });
  const cormidiaCheckout = await makeTempGitRepo();
  cleanups.push(scenarioRepo.cleanup, cormidiaCheckout.cleanup);
  const scenario = fixtureScenario("greenfield");
  const planScores = options.planScores ?? { "P-1": 2, "P-5": 2 };
  const calls: string[] = [];

  return {
    bindingCwd: authorized.repo.dir,
    cormidia: { slug: "cormidia/cormidia", root: cormidiaCheckout.dir },
    scenarioMarkdown: { "S-ACC-1": scenario.markdown },
    calls,
    arms: [
      {
        scenarioId: "S-ACC-1",
        kind: "app",
        async planArm() {
          calls.push("plan");
          return Object.entries(planScores).map(([axis, score]) => planRow(axis, score));
        },
        async buildArm() {
          calls.push("build");
          return [outcomeRow("O-1"), outcomeRow("O-5")];
        },
      },
    ],
    config: {
      campaignId: "l-acc-run-1",
      commit: authorized.commit,
      policyPath: authorized.policyPath,
      campaignOrg: "cormidia-sandbox",
      scenarios: [
        {
          id: "S-ACC-1",
          kind: "app",
          appSlug: "cormidia-sandbox/acc-1-timetracker",
          worktree: scenarioRepo.repo.dir,
          previewCommand: "pnpm dev",
          matrix: { planner: claudeOpus, builder: claudeSonnet, reviewer: codexSol },
        },
      ],
      adaptiveAssignments: [
        {
          id: "claude-sonnet-5-xhigh",
          assignment: claudeSonnet,
          providerFamily: "anthropic",
          capabilityRef: "docs/harness/capability-matrix.md#claude",
          conservativeEstimate: 12,
          uncertified: "no ratified qualification reference exists for this tuple yet",
        },
        {
          id: "gpt-5.6-sol-xhigh",
          assignment: codexSol,
          providerFamily: "openai",
          capabilityRef: "docs/harness/capability-matrix.md#codex",
          conservativeEstimate: 20,
          uncertified: "fixture",
        },
      ],
      envelope: { maxOutputTokens: 400_000, maxEquivUsd: 120, authorization: "exact human authorization pending" },
      planGate:
        options.autoContinue === false
          ? { kind: "human" }
          : { kind: "auto-continue", criteria: "rubric-6-attempted-on-P-1-and-P-5" },
      graderPlan: [{ axis: "O-1", grader: codexSol, readTurnIds: ["build"] }],
    },
  };
}

async function installProof() {
  const double = await makePackagedInstallDouble({ installedVersion: "1.4.0" });
  cleanups.push(double.cleanup);
  return parseInstallProof(await double.run(["--replace-source-links"]), RAN_AT);
}

describe("CF-J21-S (L2) the happy walk", () => {
  it("uses the declared repoRoot when the test-only binding override is omitted", async () => {
    const fixture = await rig();
    const { bindingCwd, ...withoutOverride } = fixture;
    const run = await runAcceptanceCampaign({
      ...withoutOverride,
      repoRoot: bindingCwd,
      commitPinAt: COMMIT_PIN_AT,
      installProof: await installProof(),
    });
    expect(run.report.commit).toBe(fixture.config.commit);
    expect(fixture.calls).toEqual(["plan", "build"]);
  });

  it("runs plan → gate → build → report and records the identity of what it exercised", async () => {
    const fixture = await rig();
    const run = await runAcceptanceCampaign({
      ...fixture,
      repoRoot,
      commitPinAt: COMMIT_PIN_AT,
      installProof: await installProof(),
    });

    expect(fixture.calls).toEqual(["plan", "build"]);
    expect(run.stoppedAtGate).toBe(false);
    expect(run.report.provenance.installedVersion).toBe("1.4.0");
    expect(run.report.provenance.tarballSha256).toHaveLength(64);
    expect(run.report.scenarios[0]?.matrix).toEqual({
      planner: claudeOpus,
      builder: claudeSonnet,
      reviewer: codexSol,
    });
    expect(run.report.scenarios[0]?.axes.map((row) => row.axis)).toEqual([
      "P-1",
      "P-2",
      "P-3",
      "P-4",
      "P-5",
      "P-6",
      "O-1",
      "O-2",
      "O-3",
      "O-4",
      "O-5",
      "O-6",
      "O-7",
    ]);
    expect(run.report.scenarios[0]?.planGate?.resolvedBy).toBe("declared-policy");
    expect(run.report.scenarios[0]?.planGate?.scores).toEqual({ "P-1": 2, "P-5": 2 });
  });

  it("emits no release signal and no pass/fail verdict (F-PT-029)", async () => {
    const fixture = await rig();
    const run = await runAcceptanceCampaign({
      ...fixture,
      repoRoot,
      commitPinAt: COMMIT_PIN_AT,
      installProof: await installProof(),
    });
    expect(run.report.release_signal).toBeNull();
    expect(run.report.verdict).toBe("inconclusive");
    expect(run.report.rq1_relationship).toContain("outside RQ-1");
    expect(JSON.stringify(run.report)).not.toMatch(/"verdict":"(pass|fail)"/);
  });

  it("negative control: host drift during an arm refuses its checkpoint", async () => {
    const fixture = await rig();
    const plan = fixture.arms[0];
    if (plan === undefined) throw new Error("fixture has no plan arm");
    plan.planArm = async () => {
      fixture.calls.push("plan-drift");
      await writeFile(fixture.config.policyPath, "malformed: [\n", "utf8");
      return [planRow("P-1", 2), planRow("P-5", 2)];
    };
    await expect(
      runAcceptanceCampaign({
        ...fixture,
        repoRoot: fixture.bindingCwd,
        commitPinAt: COMMIT_PIN_AT,
        installProof: await installProof(),
        onProgress: async () => {},
      }),
    ).rejects.toThrow(/product paths differ.*docs\/qualification\/host-policy.yaml/);
    expect(fixture.calls).toEqual(["plan-drift"]);
  });

  it("negative control: dirty product bytes between arms refuse the next action", async () => {
    const fixture = await rig();
    let checkpoints = 0;
    await expect(
      runAcceptanceCampaign({
        ...fixture,
        repoRoot,
        commitPinAt: COMMIT_PIN_AT,
        installProof: await installProof(),
        onProgress: async () => {
          checkpoints += 1;
          if (checkpoints !== 1) return;
          await mkdir(join(fixture.bindingCwd, "src"), { recursive: true });
          await writeFile(join(fixture.bindingCwd, "src/dirty.ts"), "export {};\n", "utf8");
        },
      }),
    ).rejects.toThrow(/product paths differ.*src\/dirty.ts/);
    expect(fixture.calls).toEqual(["plan"]);
  });

  it("negative control: an authorized-repository HEAD change between arms refuses", async () => {
    const fixture = await rig();
    let checkpoints = 0;
    await expect(
      runAcceptanceCampaign({
        ...fixture,
        repoRoot,
        commitPinAt: COMMIT_PIN_AT,
        installProof: await installProof(),
        onProgress: async () => {
          checkpoints += 1;
          if (checkpoints !== 1) return;
          await writeFile(join(fixture.bindingCwd, "validation-design/head-drift.md"), "drift\n", "utf8");
          git(fixture.bindingCwd, ["add", "validation-design/head-drift.md"]);
          git(fixture.bindingCwd, ["commit", "--no-gpg-sign", "-qm", "fixture: move HEAD"]);
        },
      }),
    ).rejects.toThrow(/authorized commit .* does not equal checked-out HEAD/);
    expect(fixture.calls).toEqual(["plan"]);
  });
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

describe("CF-J21-RC (L2) stopping at the gate is a successful campaign", () => {
  it("a spend admission refusal persists an incomplete report instead of escaping as truncation", async () => {
    const fixture = await rig();
    fixture.arms[0]!.planArm = async () => {
      fixture.calls.push("plan-refused");
      throw new CampaignSpendRefusal("reservation does not fit");
    };
    const run = await runAcceptanceCampaign({
      ...fixture,
      repoRoot,
      commitPinAt: COMMIT_PIN_AT,
      installProof: await installProof(),
    });
    expect(fixture.calls).toEqual(["plan-refused"]);
    expect(run.stoppedAtGate).toBe(true);
    expect(run.gateShortfalls).toContain("campaign spend admission stopped further arms");
    expect(run.report.scenarios[0]?.completeness).toBe("incomplete");
    expect(run.report.scenarios[0]?.axes.every((axis) => axis.score === "ungraded")).toBe(true);
  });

  it("negative control: a scenario below rubric §6 never reaches the build arm", async () => {
    const fixture = await rig({ planScores: { "P-1": 0, "P-5": 2 } });
    const run = await runAcceptanceCampaign({
      ...fixture,
      repoRoot,
      commitPinAt: COMMIT_PIN_AT,
      installProof: await installProof(),
    });
    expect(fixture.calls).toEqual(["plan"]);
    expect(run.stoppedAtGate).toBe(true);
    expect(run.gateShortfalls).toEqual(["S-ACC-1/P-1"]);
  });

  it("keeps the stopped scenario in the report, marked incomplete rather than failed", async () => {
    const fixture = await rig({ planScores: { "P-1": 0, "P-5": 2 } });
    const run = await runAcceptanceCampaign({
      ...fixture,
      repoRoot,
      commitPinAt: COMMIT_PIN_AT,
      installProof: await installProof(),
    });
    const scenario = run.report.scenarios[0];
    expect(scenario?.scenarioId).toBe("S-ACC-1");
    expect(scenario?.completeness).toBe("incomplete");
    expect(scenario?.completenessReasons).toContain("missing_grader_run:build-arm");
    expect(scenario?.planGate?.decision).toBe("stop");
    expect(run.report.verdict).toBe("inconclusive");
  });

  it("a `human` policy with no recorded decision does not spend the build arm", async () => {
    const fixture = await rig({ autoContinue: false });
    const run = await runAcceptanceCampaign({
      ...fixture,
      repoRoot,
      commitPinAt: COMMIT_PIN_AT,
      installProof: await installProof(),
    });
    expect(fixture.calls).toEqual(["plan"]);
    expect(run.stoppedAtGate).toBe(true);
  });

  it("the same `human` policy continues once the decision is supplied", async () => {
    const fixture = await rig({ autoContinue: false });
    const run = await runAcceptanceCampaign({
      ...fixture,
      repoRoot,
      commitPinAt: COMMIT_PIN_AT,
      installProof: await installProof(),
      humanGateDecision: "continue",
    });
    expect(fixture.calls).toEqual(["plan", "build"]);
    expect(run.report.scenarios[0]?.planGate?.resolvedBy).toBe("human");
  });
});

describe("CF-J21-R (L2) preflight refuses before either arm runs", () => {
  it("negative control: a missing packaged-install preflight refuses with neither arm called", async () => {
    const fixture = await rig();
    await expect(runAcceptanceCampaign({ ...fixture, repoRoot, commitPinAt: COMMIT_PIN_AT })).rejects.toThrow(
      /preflight-missing/,
    );
    expect(fixture.calls).toEqual([]);
  });

  it("negative control: an undeclared plan-gate policy refuses with neither arm called", async () => {
    const fixture = await rig();
    // `exactOptionalPropertyTypes` is on: an OMITTED key is the thing the
    // contract refuses, and assigning `undefined` would be a different config.
    const undeclared = { ...fixture.config };
    delete undeclared.planGate;
    await expect(
      runAcceptanceCampaign({
        ...fixture,
        config: undeclared,
        repoRoot,
        commitPinAt: COMMIT_PIN_AT,
        installProof: await installProof(),
      }),
    ).rejects.toThrow(/plan-gate-undeclared/);
    expect(fixture.calls).toEqual([]);
  });

  it("negative control: a scenario bound to this repository refuses with neither arm called", async () => {
    const fixture = await rig();
    const scenario = fixture.config.scenarios[0];
    if (scenario === undefined) throw new Error("the rig has no scenario");
    await expect(
      runAcceptanceCampaign({
        ...fixture,
        config: {
          ...fixture.config,
          scenarios: [{ ...scenario, appSlug: "cormidia/cormidia" }],
        },
        repoRoot,
        commitPinAt: COMMIT_PIN_AT,
        installProof: await installProof(),
      }),
    ).rejects.toThrow(/app-slug/);
    expect(fixture.calls).toEqual([]);
  });

  it("negative control: a moved HEAD refuses with neither arm called", async () => {
    const fixture = await rig();
    await expect(
      runAcceptanceCampaign({
        ...fixture,
        config: { ...fixture.config, commit: "0".repeat(40) },
        repoRoot,
        commitPinAt: COMMIT_PIN_AT,
        installProof: await installProof(),
      }),
    ).rejects.toThrow(/does not equal checked-out HEAD/);
    expect(fixture.calls).toEqual([]);
  });
});

// Traceability: CF-J21-I · HB-136 · contracts/journey-acceptance.md J-21; contracts/B-27-acceptance-campaign.md §3; invariants.md INV-ACC-4, INV-ACC-6.

// CF-J21-I (L2) — the campaign kill-boundary sweep (HB-136).
//
// NO CAMPAIGN RUNS HERE AND NO TOKEN IS SPENT. Both arms are injected
// callbacks over the same hermetic rig the CF-J21-S walk uses, composed with
// the durable report store exactly as `campaign-main.ts` wires it: a
// checkpoint persists after every paid arm and at the gate, and the final
// report persists as `final` only when the campaign returns.
//
// What this sweep OWNS: a kill at each of the six campaign boundaries —
// post-provision, mid-plan-arm, at the gate, mid-build-arm, mid-grade,
// mid-report — each with partial-evidence preservation asserted
// (CORMIDIA-C-B27-001 §3, CORMIDIA-INV-ACC-6), plus the resume legs proving a
// killed-at-the-gate campaign re-enters AT the gate and never past it
// (CORMIDIA-INV-ACC-4 across the kill/resume composition).
//
// What it does NOT re-owe: the torn-report and resume-config-drift halves are
// owned at CF-B27-* (`tests/hermetic/cf-b27-durable/`) and the single-run
// gate-ordering half at CF-INV-ACC-4 / CF-SM-ACC (`tests/unit/cf-sm-acc/`,
// `tests/hermetic/cf-c-b27-…/cf-j21-runner.test.ts`). This sweep asserts the
// composite those halves cannot see: what the durable store holds at the
// instant a process dies at each boundary, and what a resume may lawfully do
// with it.
//
// A kill is modeled as a `KillSignal` escaping the composed run at the named
// boundary — the in-process equivalent of SIGKILL at the nearest deterministic
// seam: no code of the killed campaign runs past the boundary, and the only
// surviving truth is what `persistReport` already wrote atomically.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { TurnAssignment } from "../../../src/runtime/types.js";
import type { AcceptanceCampaignConfig, PlanGatePolicy } from "../../campaign/acceptance/campaign-config.js";
import type { AcceptanceScenarioReport, AxisReportRow } from "../../campaign/acceptance/campaign-report.js";
import type { PackagedInstallProof } from "../../campaign/acceptance/packaged-provenance.js";
import { parseInstallProof } from "../../campaign/acceptance/packaged-provenance.js";
import {
  claimCampaignIdentity,
  configHash,
  persistReport,
  readStoredReport,
  type IdentityClaim,
  type StoredCampaignReport,
} from "../../campaign/acceptance/report-store.js";
import {
  runAcceptanceCampaign,
  type AcceptanceCampaignRun,
  type ScenarioArms,
} from "../../campaign/acceptance/runner.js";
import { makePackagedInstallDouble } from "../../fixtures/acceptance/packaged-install-double.js";
import { fixtureScenario } from "../../fixtures/acceptance/scenario-corpus.js";
import { makeFixtureScenarioRepo } from "../../fixtures/acceptance/scenario-repo.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cleanups: Array<() => Promise<void>> = [];
const COMMIT_PIN_AT = new Date("2026-08-12T09:00:00.000Z");
const RAN_AT = new Date("2026-08-12T09:30:00.000Z");

const claudeOpus: TurnAssignment = { harness: "claude", model: "claude-opus-4-8", effort: "xhigh" };
const claudeSonnet: TurnAssignment = { harness: "claude", model: "claude-sonnet-5", effort: "xhigh" };
const codexSol: TurnAssignment = { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" };

afterAll(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** The six campaign boundaries HB-136 owes, by ticket name. */
type KillBoundary = "post-provision" | "mid-plan-arm" | "at-the-gate" | "mid-build-arm" | "mid-grade" | "mid-report";

/** The modeled process death. Deliberately NOT a `CampaignSpendRefusal`: a
 *  refusal is a campaign outcome, a kill is the absence of one. */
class KillSignal extends Error {
  constructor(readonly boundary: KillBoundary) {
    super(`process killed at ${boundary}`);
    this.name = "KillSignal";
  }
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`sweep fixture is missing ${what}`);
  return value;
}

/** A minimal authorized repository, as in cf-j21-runner.test.ts. */
async function authorizedRepo(): Promise<{ repo: TempGitRepo; commit: string; policyPath: string }> {
  const repo = await makeTempGitRepo({ seedFiles: [] });
  cleanups.push(repo.cleanup);
  const dir = join(repo.dir, "validation-design");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "validation-policy.yaml"), "schema_version: 1\n", "utf8");
  repo.git(["add", "validation-design"]);
  repo.git(["commit", "--no-gpg-sign", "-qm", "fixture: policy"]);
  return { repo, commit: repo.git(["rev-parse", "HEAD"]), policyPath: join(dir, "validation-policy.yaml") };
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

const SCENARIO_ONE = "S-ACC-1";
const SCENARIO_TWO = "S-ACC-2";

interface KillRig {
  config: AcceptanceCampaignConfig;
  cormidia: { slug: string; root: string };
  scenarioMarkdown: Record<string, string>;
  bindingCwd: string;
  /** scenarioId → baseline HEAD, for the provision-evidence-intact assertion. */
  baselines: Record<string, string>;
  /** scenarioId → a fresh `git rev-parse HEAD` of the provisioned worktree. */
  headOf: (scenarioId: string) => string;
}

async function buildRig(planGate: PlanGatePolicy): Promise<KillRig> {
  const authorized = await authorizedRepo();
  const repoOne = await makeFixtureScenarioRepo({ kind: "greenfield" });
  const repoTwo = await makeFixtureScenarioRepo({ kind: "seeded-corpus" });
  const cormidiaCheckout = await makeTempGitRepo();
  cleanups.push(repoOne.cleanup, repoTwo.cleanup, cormidiaCheckout.cleanup);
  const repos = new Map<string, TempGitRepo>([
    [SCENARIO_ONE, repoOne.repo],
    [SCENARIO_TWO, repoTwo.repo],
  ]);
  return {
    bindingCwd: authorized.repo.dir,
    cormidia: { slug: "cormidia/cormidia", root: cormidiaCheckout.dir },
    scenarioMarkdown: {
      [SCENARIO_ONE]: fixtureScenario("greenfield").markdown,
      [SCENARIO_TWO]: fixtureScenario("seeded-corpus").markdown,
    },
    baselines: {
      [SCENARIO_ONE]: repoOne.repo.git(["rev-parse", "HEAD"]),
      [SCENARIO_TWO]: repoTwo.repo.git(["rev-parse", "HEAD"]),
    },
    headOf: (scenarioId: string) => required(repos.get(scenarioId), scenarioId).git(["rev-parse", "HEAD"]),
    config: {
      campaignId: "l-acc-kill-sweep",
      commit: authorized.commit,
      policyPath: authorized.policyPath,
      campaignOrg: "cormidia-sandbox",
      scenarios: [
        {
          id: SCENARIO_ONE,
          kind: "app",
          appSlug: "cormidia-sandbox/acc-1-timetracker",
          worktree: repoOne.repo.dir,
          previewCommand: "pnpm dev",
          matrix: { planner: claudeOpus, builder: claudeSonnet, reviewer: codexSol },
        },
        {
          id: SCENARIO_TWO,
          kind: "app",
          appSlug: "cormidia-sandbox/acc-2-corpus-refresh",
          worktree: repoTwo.repo.dir,
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
      planGate,
      graderPlan: [{ axis: "O-1", grader: codexSol, readTurnIds: ["build"] }],
    },
  };
}

// Rigs and the install proof are immutable once built; the six kill legs share
// one auto-continue rig (each leg runs against its OWN durable store root).
let sharedAutoRig: Promise<KillRig> | undefined;
function autoRig(): Promise<KillRig> {
  sharedAutoRig ??= buildRig({ kind: "auto-continue", criteria: "rubric-6-attempted-on-P-1-and-P-5" });
  return sharedAutoRig;
}

let sharedProof: Promise<PackagedInstallProof> | undefined;
function installProof(): Promise<PackagedInstallProof> {
  sharedProof ??= (async () => {
    const double = await makePackagedInstallDouble({ installedVersion: "1.4.0" });
    cleanups.push(double.cleanup);
    return parseInstallProof(await double.run(["--replace-source-links"]), RAN_AT);
  })();
  return sharedProof;
}

async function storeRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `cf-j21-i-${name}-`));
  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

type PlanScript = "complete" | "kill-at-entry" | "kill-mid-plan";
type BuildScript = "complete" | "kill-mid-build" | "kill-mid-grade";

interface ArmScript {
  scenarioId: string;
  plan: PlanScript;
  build: BuildScript;
}

/** Injected arms with an explicit phase log, so every leg can prove its kill
 *  actually landed at the intended boundary (the sweep fails on empty walks). */
function makeArms(scripts: readonly ArmScript[], calls: string[]): ScenarioArms[] {
  return scripts.map((script) => ({
    scenarioId: script.scenarioId,
    kind: "app",
    async planArm() {
      if (script.plan === "kill-at-entry") {
        calls.push(`kill:post-provision:${script.scenarioId}`);
        throw new KillSignal("post-provision");
      }
      calls.push(`plan-turn:${script.scenarioId}`);
      if (script.plan === "kill-mid-plan") {
        calls.push(`kill:mid-plan-arm:${script.scenarioId}`);
        throw new KillSignal("mid-plan-arm");
      }
      return [planRow("P-1", 2), planRow("P-5", 2)];
    },
    async buildArm() {
      calls.push(`build-turn:${script.scenarioId}`);
      if (script.build === "kill-mid-build") {
        calls.push(`kill:mid-build-arm:${script.scenarioId}`);
        throw new KillSignal("mid-build-arm");
      }
      const rows = [outcomeRow("O-1")];
      calls.push(`grade-turn:${script.scenarioId}:O-1`);
      if (script.build === "kill-mid-grade") {
        calls.push(`kill:mid-grade:${script.scenarioId}`);
        throw new KillSignal("mid-grade");
      }
      rows.push(outcomeRow("O-5"));
      calls.push(`grade-turn:${script.scenarioId}:O-5`);
      return rows;
    },
  }));
}

interface ComposedRunOptions {
  rig: KillRig;
  arms: readonly ScenarioArms[];
  root: string;
  /** 1-based checkpoint index to die at, AFTER its atomic persist — with two
   *  app scenarios the stream is plan-1, plan-2, gate, build-1, build-2. */
  killAfterCheckpoint?: number;
  /** Die between the last running checkpoint and the final persist. */
  killBeforeFinalPersist?: boolean;
  humanGateDecision?: "continue" | "stop";
}

interface ComposedRunOutcome {
  claim: IdentityClaim;
  killed: KillSignal | null;
  run: AcceptanceCampaignRun | null;
  /** Every durable snapshot, in write order — the surviving truth per kill. */
  persisted: StoredCampaignReport[];
}

/** The campaign-main composition at rig grain: claim identity, checkpoint
 *  every paid arm and the gate as `running`, persist `final` only on return. */
async function runComposed(options: ComposedRunOptions): Promise<ComposedRunOutcome> {
  const hash = configHash(options.rig.config);
  const claim = await claimCampaignIdentity({
    root: options.root,
    campaignId: options.rig.config.campaignId,
    configSha256: hash,
  });
  const persisted: StoredCampaignReport[] = [];
  let checkpoints = 0;
  const persist = async (report: AcceptanceCampaignRun["report"], status: "running" | "final"): Promise<void> => {
    persisted.push(structuredClone(await persistReport({ root: options.root, configSha256: hash, report, status })));
  };
  try {
    const run = await runAcceptanceCampaign({
      config: options.rig.config,
      repoRoot,
      cormidia: options.rig.cormidia,
      commitPinAt: COMMIT_PIN_AT,
      installProof: await installProof(),
      scenarioMarkdown: options.rig.scenarioMarkdown,
      arms: options.arms,
      bindingCwd: options.rig.bindingCwd,
      ...(options.humanGateDecision === undefined ? {} : { humanGateDecision: options.humanGateDecision }),
      onProgress: async (report) => {
        checkpoints += 1;
        await persist(report, "running");
        if (checkpoints === options.killAfterCheckpoint) throw new KillSignal("at-the-gate");
      },
    });
    if (options.killBeforeFinalPersist === true) throw new KillSignal("mid-report");
    await persist(run.report, "final");
    return { claim, killed: null, run, persisted };
  } catch (error) {
    if (error instanceof KillSignal) return { claim, killed: error, run: null, persisted };
    throw error;
  }
}

function scenarioIn(stored: StoredCampaignReport, scenarioId: string): AcceptanceScenarioReport {
  return required(
    stored.report.scenarios.find((scenario) => scenario.scenarioId === scenarioId),
    `scenario ${scenarioId} in the stored report — a killed scenario must never be absent (B-27 §3)`,
  );
}

function axisIn(scenario: AcceptanceScenarioReport, axis: string): AxisReportRow {
  return required(
    scenario.axes.find((row) => row.axis === axis),
    `axis ${axis} on ${scenario.scenarioId}`,
  );
}

function hasBuildEvidence(scenario: AcceptanceScenarioReport): boolean {
  return scenario.axes.some((row) => row.axis.startsWith("O-") && row.score !== "ungraded");
}

/** The kill-sweep composite of INV-ACC-4: across every durable snapshot a
 *  kill or resume can leave behind, build evidence never appears ahead of a
 *  durably recorded `continue` resolution. (The single-run ordering itself is
 *  owned at CF-SM-ACC / CF-INV-ACC-4 and is not re-owed here.) */
function expectGateNeverTrailsBuildEvidence(persisted: readonly StoredCampaignReport[]): void {
  for (const stored of persisted) {
    for (const scenario of stored.report.scenarios) {
      if (!hasBuildEvidence(scenario)) continue;
      expect(scenario.planGate).not.toBeNull();
      expect(scenario.planGate?.decision).toBe("continue");
    }
  }
}

async function durableTruth(root: string): Promise<StoredCampaignReport> {
  return required(await readStoredReport(root, "l-acc-kill-sweep"), "the durable report after the kill");
}

describe("CF-J21-I (L2) kill at each campaign boundary preserves partial evidence", () => {
  it("(1) post-provision: nothing paid, nothing torn, and the provision evidence survives", async () => {
    const rig = await autoRig();
    const root = await storeRoot("post-provision");
    const calls: string[] = [];
    const outcome = await runComposed({
      rig,
      root,
      arms: makeArms(
        [
          { scenarioId: SCENARIO_ONE, plan: "kill-at-entry", build: "complete" },
          { scenarioId: SCENARIO_TWO, plan: "complete", build: "complete" },
        ],
        calls,
      ),
    });

    expect(outcome.claim.kind).toBe("fresh");
    expect(outcome.killed?.boundary).toBe("post-provision");
    expect(outcome.run).toBeNull();
    // The kill landed before any paid turn: the phase log holds the kill
    // marker and nothing else.
    expect(calls).toEqual([`kill:post-provision:${SCENARIO_ONE}`]);
    // No checkpoint had fired, so the honest durable state is ABSENCE — a
    // resume restarts cleanly rather than finding a fabricated or torn record.
    expect(outcome.persisted).toEqual([]);
    expect(await readStoredReport(root, "l-acc-kill-sweep")).toBeUndefined();
    const claimAfterKill = await claimCampaignIdentity({
      root,
      campaignId: rig.config.campaignId,
      configSha256: configHash(rig.config),
    });
    expect(claimAfterKill.kind).toBe("fresh");
    // The provision evidence outlives the kill: both scenario worktrees still
    // sit at their provisioned baselines.
    expect(rig.headOf(SCENARIO_ONE)).toBe(rig.baselines[SCENARIO_ONE]);
    expect(rig.headOf(SCENARIO_TWO)).toBe(rig.baselines[SCENARIO_TWO]);
  });

  it("(2) mid-plan-arm: the completed plan arm's evidence survives; the killed scenario stays present and ungraded", async () => {
    const rig = await autoRig();
    const root = await storeRoot("mid-plan-arm");
    const calls: string[] = [];
    const outcome = await runComposed({
      rig,
      root,
      arms: makeArms(
        [
          { scenarioId: SCENARIO_ONE, plan: "complete", build: "complete" },
          { scenarioId: SCENARIO_TWO, plan: "kill-mid-plan", build: "complete" },
        ],
        calls,
      ),
    });

    expect(outcome.killed?.boundary).toBe("mid-plan-arm");
    expect(calls).toEqual([
      `plan-turn:${SCENARIO_ONE}`,
      `plan-turn:${SCENARIO_TWO}`,
      `kill:mid-plan-arm:${SCENARIO_TWO}`,
    ]);
    expect(outcome.persisted).toHaveLength(1);

    const stored = await durableTruth(root);
    expect(stored.status).toBe("running");
    // Scenario one's paid plan evidence is preserved WITH its content — score,
    // citation, and the grader tuple that produced it (B-27 §2 answerability).
    const scenarioOne = scenarioIn(stored, SCENARIO_ONE);
    expect(axisIn(scenarioOne, "P-1").score).toBe(2);
    expect(axisIn(scenarioOne, "P-1").citations).toEqual(["ticket-set"]);
    expect(axisIn(scenarioOne, "P-1").grader).toEqual(codexSol);
    expect(axisIn(scenarioOne, "P-5").score).toBe(2);
    // The killed scenario is present and honestly ungraded — never absent,
    // never fabricated (INV-ACC-6).
    const scenarioTwo = scenarioIn(stored, SCENARIO_TWO);
    expect(scenarioTwo.axes.every((row) => row.score === "ungraded")).toBe(true);
    expect(scenarioTwo.completeness).toBe("incomplete");
    // No gate resolution exists yet, and no build spend happened.
    expect(scenarioOne.planGate).toBeNull();
    expect(scenarioTwo.planGate).toBeNull();
    expect(calls.some((entry) => entry.startsWith("build-turn:"))).toBe(false);
    expectGateNeverTrailsBuildEvidence(outcome.persisted);

    const claim = await claimCampaignIdentity({
      root,
      campaignId: rig.config.campaignId,
      configSha256: configHash(rig.config),
    });
    expect(claim.kind).toBe("resume");
  });

  it("(3) at the gate: the resolution is durable with the scores it acted on, and no build turn preceded the kill", async () => {
    const rig = await autoRig();
    const root = await storeRoot("at-the-gate");
    const calls: string[] = [];
    const outcome = await runComposed({
      rig,
      root,
      killAfterCheckpoint: 3,
      arms: makeArms(
        [
          { scenarioId: SCENARIO_ONE, plan: "complete", build: "complete" },
          { scenarioId: SCENARIO_TWO, plan: "complete", build: "complete" },
        ],
        calls,
      ),
    });

    expect(outcome.killed?.boundary).toBe("at-the-gate");
    expect(outcome.persisted).toHaveLength(3);
    // The kill preceded every build turn: the gate spends a fraction of the
    // envelope before deciding, and dying there costs no build spend.
    expect(calls.some((entry) => entry.startsWith("build-turn:"))).toBe(false);

    const stored = await durableTruth(root);
    expect(stored.status).toBe("running");
    for (const scenarioId of [SCENARIO_ONE, SCENARIO_TWO]) {
      const scenario = scenarioIn(stored, scenarioId);
      const gate = required(scenario.planGate ?? undefined, `the durable gate resolution on ${scenarioId}`);
      expect(gate.resolvedBy).toBe("declared-policy");
      expect(gate.decision).toBe("continue");
      // Recorded with the scores it acted on — auditable, never re-derived.
      expect(gate.scores).toEqual({ "P-1": 2, "P-5": 2 });
      // Build evidence does not exist yet anywhere in the report.
      expect(scenario.axes.every((row) => !row.axis.startsWith("O-") || row.score === "ungraded")).toBe(true);
    }
    expectGateNeverTrailsBuildEvidence(outcome.persisted);

    const claim = await claimCampaignIdentity({
      root,
      campaignId: rig.config.campaignId,
      configSha256: configHash(rig.config),
    });
    expect(claim.kind).toBe("resume");
  });

  it("(4) mid-build-arm: earlier build and plan evidence survives; the gate checkpoint durably precedes the first build evidence", async () => {
    const rig = await autoRig();
    const root = await storeRoot("mid-build-arm");
    const calls: string[] = [];
    const outcome = await runComposed({
      rig,
      root,
      arms: makeArms(
        [
          { scenarioId: SCENARIO_ONE, plan: "complete", build: "complete" },
          { scenarioId: SCENARIO_TWO, plan: "complete", build: "kill-mid-build" },
        ],
        calls,
      ),
    });

    expect(outcome.killed?.boundary).toBe("mid-build-arm");
    expect(outcome.persisted).toHaveLength(4);
    // The kill landed inside scenario two's build phase, before any of its
    // grading happened.
    expect(calls).toContain(`build-turn:${SCENARIO_TWO}`);
    expect(calls).toContain(`kill:mid-build-arm:${SCENARIO_TWO}`);
    expect(calls.some((entry) => entry.startsWith(`grade-turn:${SCENARIO_TWO}`))).toBe(false);

    const stored = await durableTruth(root);
    expect(stored.status).toBe("running");
    const scenarioOne = scenarioIn(stored, SCENARIO_ONE);
    expect(axisIn(scenarioOne, "O-1").score).toBe(2);
    expect(axisIn(scenarioOne, "O-5").score).toBe(2);
    const scenarioTwo = scenarioIn(stored, SCENARIO_TWO);
    // Evidence earned BEFORE the gate survives the later kill…
    expect(axisIn(scenarioTwo, "P-1").score).toBe(2);
    expect(axisIn(scenarioTwo, "P-5").score).toBe(2);
    // …while the killed arm's axes stay honestly ungraded and the scenario
    // stays in the report, incomplete rather than failed or absent.
    expect(scenarioTwo.axes.every((row) => !row.axis.startsWith("O-") || row.score === "ungraded")).toBe(true);
    expect(scenarioTwo.completeness).toBe("incomplete");
    // Stream ordering: the gate checkpoint (index 2) carries no build
    // evidence; the first build evidence appears only after it (index 3).
    const gateSnapshot = required(outcome.persisted[2], "the gate checkpoint snapshot");
    expect(gateSnapshot.report.scenarios.some(hasBuildEvidence)).toBe(false);
    const firstBuildSnapshot = required(outcome.persisted[3], "the first build checkpoint snapshot");
    expect(hasBuildEvidence(scenarioIn(firstBuildSnapshot, SCENARIO_ONE))).toBe(true);
    expectGateNeverTrailsBuildEvidence(outcome.persisted);

    const claim = await claimCampaignIdentity({
      root,
      campaignId: rig.config.campaignId,
      configSha256: configHash(rig.config),
    });
    expect(claim.kind).toBe("resume");
  });

  it("(5) mid-grade: a half-graded arm's in-memory rows never become durable evidence", async () => {
    const rig = await autoRig();
    const root = await storeRoot("mid-grade");
    const calls: string[] = [];
    const outcome = await runComposed({
      rig,
      root,
      arms: makeArms(
        [
          { scenarioId: SCENARIO_ONE, plan: "complete", build: "complete" },
          { scenarioId: SCENARIO_TWO, plan: "complete", build: "kill-mid-grade" },
        ],
        calls,
      ),
    });

    expect(outcome.killed?.boundary).toBe("mid-grade");
    expect(outcome.persisted).toHaveLength(4);
    // The kill landed mid-GRADE: scenario two's build phase completed and
    // exactly one grader turn had produced a row before the death.
    expect(calls).toContain(`build-turn:${SCENARIO_TWO}`);
    expect(calls).toContain(`grade-turn:${SCENARIO_TWO}:O-1`);
    expect(calls).toContain(`kill:mid-grade:${SCENARIO_TWO}`);
    expect(calls).not.toContain(`grade-turn:${SCENARIO_TWO}:O-5`);

    const stored = await durableTruth(root);
    expect(stored.status).toBe("running");
    const scenarioTwo = scenarioIn(stored, SCENARIO_TWO);
    // The O-1 row graded in memory before the kill was NEVER checkpointed —
    // it must stay ungraded in the durable truth rather than surviving as a
    // half-graded score smuggled in as terminal evidence.
    expect(axisIn(scenarioTwo, "O-1").score).toBe("ungraded");
    expect(scenarioTwo.completeness).toBe("incomplete");
    // The completed scenario's graded evidence is intact.
    expect(axisIn(scenarioIn(stored, SCENARIO_ONE), "O-1").score).toBe(2);
    expectGateNeverTrailsBuildEvidence(outcome.persisted);

    const claim = await claimCampaignIdentity({
      root,
      campaignId: rig.config.campaignId,
      configSha256: configHash(rig.config),
    });
    expect(claim.kind).toBe("resume");
  });

  it("(6) mid-report: everything earned survives as `running`; a killed report phase never reads as terminal truth", async () => {
    const rig = await autoRig();
    const root = await storeRoot("mid-report");
    const calls: string[] = [];
    const outcome = await runComposed({
      rig,
      root,
      killBeforeFinalPersist: true,
      arms: makeArms(
        [
          { scenarioId: SCENARIO_ONE, plan: "complete", build: "complete" },
          { scenarioId: SCENARIO_TWO, plan: "complete", build: "complete" },
        ],
        calls,
      ),
    });

    expect(outcome.killed?.boundary).toBe("mid-report");
    expect(outcome.run).toBeNull();
    expect(outcome.persisted).toHaveLength(5);
    expect(outcome.persisted.every((stored) => stored.status === "running")).toBe(true);

    const stored = await durableTruth(root);
    // The full paid evidence set survives the kill…
    for (const scenarioId of [SCENARIO_ONE, SCENARIO_TWO]) {
      const scenario = scenarioIn(stored, scenarioId);
      expect(axisIn(scenario, "P-1").score).toBe(2);
      expect(axisIn(scenario, "O-1").score).toBe(2);
      expect(axisIn(scenario, "O-5").score).toBe(2);
      expect(scenario.planGate?.decision).toBe("continue");
      expect(scenario.matrix).toEqual({ planner: claudeOpus, builder: claudeSonnet, reviewer: codexSol });
    }
    expect(stored.report.provenance.installedVersion).toBe("1.4.0");
    // …but the campaign never claims terminality it did not reach: the store
    // still says `running`, and a resume is admitted rather than refused as
    // already-final.
    expect(stored.status).toBe("running");
    const claim = await claimCampaignIdentity({
      root,
      campaignId: rig.config.campaignId,
      configSha256: configHash(rig.config),
    });
    expect(claim.kind).toBe("resume");
    expectGateNeverTrailsBuildEvidence(outcome.persisted);
  });
});

describe("CF-J21-I (L2) resume re-enters at the gate, never past it", () => {
  it("a campaign killed at its `human` gate, resumed without a recorded decision, spends nothing past the gate", async () => {
    const rig = await buildRig({ kind: "human" });
    const root = await storeRoot("resume-at-gate");
    const scripts: ArmScript[] = [
      { scenarioId: SCENARIO_ONE, plan: "complete", build: "complete" },
      { scenarioId: SCENARIO_TWO, plan: "complete", build: "complete" },
    ];

    // Run 1: killed at the gate checkpoint while awaiting the human.
    const callsOne: string[] = [];
    const runOne = await runComposed({ rig, root, killAfterCheckpoint: 3, arms: makeArms(scripts, callsOne) });
    expect(runOne.claim.kind).toBe("fresh");
    expect(runOne.killed?.boundary).toBe("at-the-gate");
    expect(callsOne.some((entry) => entry.startsWith("build-turn:"))).toBe(false);
    const storedOne = await durableTruth(root);
    expect(storedOne.status).toBe("running");
    expect(scenarioIn(storedOne, SCENARIO_ONE).planGate?.resolvedBy).toBe("human");
    expect(scenarioIn(storedOne, SCENARIO_ONE).planGate?.decision).toBe("stop");

    // Run 2: the resume. Still no human decision — the resumed campaign
    // re-walks its plan arms, re-reaches the gate, and STOPS there. This is
    // the assertion the seeded resume-past-the-gate violation must turn red:
    // any build spend here is a campaign resuming past its gate.
    const callsTwo: string[] = [];
    const runTwo = await runComposed({ rig, root, arms: makeArms(scripts, callsTwo) });
    expect(runTwo.claim.kind).toBe("resume");
    expect(runTwo.killed).toBeNull();
    expect(callsTwo.some((entry) => entry.startsWith("build-turn:"))).toBe(false);
    const runTwoResult = required(runTwo.run ?? undefined, "the resumed run's outcome");
    expect(runTwoResult.stoppedAtGate).toBe(true);
    // The resume re-entered AT the gate: its own plan checkpoints precede its
    // own gate checkpoint, which again records the honest `stop`.
    expect(runTwo.persisted).toHaveLength(4);
    expect(
      required(runTwo.persisted[0], "resume plan checkpoint").report.scenarios.every((s) => s.planGate === null),
    ).toBe(true);
    const resumedGate = scenarioIn(required(runTwo.persisted[2], "resume gate checkpoint"), SCENARIO_ONE);
    expect(resumedGate.planGate?.decision).toBe("stop");
    // Terminal truth: stopped at the gate is a SUCCESSFUL campaign, final and
    // honest, with every build axis ungraded.
    const finalStored = await durableTruth(root);
    expect(finalStored.status).toBe("final");
    for (const scenario of finalStored.report.scenarios) {
      expect(scenario.planGate?.decision).toBe("stop");
      expect(scenario.axes.every((row) => !row.axis.startsWith("O-") || row.score === "ungraded")).toBe(true);
      expect(scenario.completeness).toBe("incomplete");
    }
    expectGateNeverTrailsBuildEvidence([...runOne.persisted, ...runTwo.persisted]);
  });

  it("positive control: the human decision, recorded on resume, is exactly what unlocks the build arm", async () => {
    const rig = await buildRig({ kind: "human" });
    const root = await storeRoot("resume-continue");
    const scripts: ArmScript[] = [
      { scenarioId: SCENARIO_ONE, plan: "complete", build: "complete" },
      { scenarioId: SCENARIO_TWO, plan: "complete", build: "complete" },
    ];

    // Run 1: killed at the gate while awaiting the human, as above.
    const callsOne: string[] = [];
    const runOne = await runComposed({ rig, root, killAfterCheckpoint: 3, arms: makeArms(scripts, callsOne) });
    expect(runOne.killed?.boundary).toBe("at-the-gate");
    expect(callsOne.some((entry) => entry.startsWith("build-turn:"))).toBe(false);

    // Run 2: resumed WITH the recorded human decision. The gate resolves
    // `continue` durably first; only then does build spend begin.
    const callsTwo: string[] = [];
    const runTwo = await runComposed({ rig, root, humanGateDecision: "continue", arms: makeArms(scripts, callsTwo) });
    expect(runTwo.claim.kind).toBe("resume");
    expect(runTwo.killed).toBeNull();
    const runTwoResult = required(runTwo.run ?? undefined, "the resumed run's outcome");
    expect(runTwoResult.stoppedAtGate).toBe(false);
    expect(callsTwo).toContain(`build-turn:${SCENARIO_ONE}`);
    expect(callsTwo).toContain(`build-turn:${SCENARIO_TWO}`);
    // The gate checkpoint precedes the first build evidence in the resumed
    // stream, and it carries the human `continue` with the scores acted on.
    const gateSnapshot = required(runTwo.persisted[2], "resume gate checkpoint");
    expect(gateSnapshot.report.scenarios.some(hasBuildEvidence)).toBe(false);
    const gate = required(scenarioIn(gateSnapshot, SCENARIO_ONE).planGate ?? undefined, "the resumed gate resolution");
    expect(gate.resolvedBy).toBe("human");
    expect(gate.decision).toBe("continue");
    expect(gate.scores).toEqual({ "P-1": 2, "P-5": 2 });
    // The completed resume is terminal with the full evidence set.
    const finalStored = await durableTruth(root);
    expect(finalStored.status).toBe("final");
    expect(axisIn(scenarioIn(finalStored, SCENARIO_TWO), "O-5").score).toBe(2);
    expectGateNeverTrailsBuildEvidence([...runOne.persisted, ...runTwo.persisted]);
  });
});

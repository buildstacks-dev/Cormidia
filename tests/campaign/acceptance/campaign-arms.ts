// Real arm + grader composition, split from campaign-main so the process entry
// stays a composition root rather than becoming another subsystem.

import { join } from "node:path";
import type { ArmOutput } from "./arms.js";
import { runBuildArm, runJobArm, runPlanArm } from "./arms.js";
import type { ScenarioConfig } from "./campaign-config.js";
import { scenarioAppName } from "./campaign-config.js";
import type { AcceptanceCampaignFile } from "./campaign-cli.js";
import type { AxisReportRow } from "./campaign-report.js";
import type { CampaignRuntimeDeps } from "./campaign-runtime.js";
import { activateAcceptanceGrader, activateScenarioRoleMatrix } from "./campaign-org-roles.js";
import { composeAxisEvidenceSet } from "./grader-envelope.js";
import { resolveAxisGraders, type GradedTurnRef } from "./grader-independence.js";
import { runGraderTurn } from "./grader-turn.js";
import { scoreMechanicalAxes } from "./mechanical-axis-results.js";
import type { ScenarioProvision } from "./provision.js";
import type { ScenarioArms } from "./runner.js";
import { scenarioRamble, type SealedKey } from "./sealed-key.js";

const PLAN_AXES = ["P-1", "P-2", "P-3", "P-4", "P-5", "P-6"];
const OUTCOME_AXES = ["O-1", "O-2", "O-3", "O-4", "O-5", "O-6", "O-7", "J-1", "J-2", "J-3"];

async function gradeArm(
  deps: CampaignRuntimeDeps,
  file: AcceptanceCampaignFile,
  scenario: ScenarioConfig,
  provision: ScenarioProvision,
  output: ArmOutput,
  keys: readonly SealedKey[],
  axes: readonly string[],
): Promise<AxisReportRow[]> {
  const turns: GradedTurnRef[] = Object.entries(scenario.matrix)
    .filter(([, assignment]) => assignment !== undefined)
    .map(([role, assignment]) => ({
      turnId: role === "planner" ? "plan" : role === "builder" ? "build" : role,
      assignment: assignment!,
    }));
  const plan = file.campaign.graderPlan.filter(
    (entry) =>
      axes.includes(entry.axis) &&
      (entry.scenarioKinds === undefined || entry.scenarioKinds.includes(scenario.kind)) &&
      (entry.scenarioIds === undefined || entry.scenarioIds.includes(scenario.id)),
  );
  const resolutions = resolveAxisGraders({
    axes: plan.map((entry) => {
      const graderCandidateId =
        entry.grader === undefined
          ? undefined
          : file.campaign.adaptiveAssignments.find(
              (candidate) => JSON.stringify(candidate.assignment) === JSON.stringify(entry.grader),
            )?.id;
      if (entry.mechanical !== true && graderCandidateId === undefined) {
        throw new Error(`campaign refused: grader ${entry.axis} is not one of the declared adaptive assignments`);
      }
      return {
        axis: entry.axis,
        readTurnIds: entry.readTurnIds ?? [],
        ...(entry.mechanical === true ? { mechanical: true } : {}),
        ...(graderCandidateId === undefined ? {} : { graderCandidateId }),
      };
    }),
    turns,
    candidates: file.campaign.adaptiveAssignments.map((candidate) => ({
      id: candidate.id,
      assignment: candidate.assignment,
    })),
  });

  const rows: AxisReportRow[] = [];
  const mechanicalAxes: string[] = [];
  for (const resolution of resolutions) {
    if (resolution.status === "mechanical") {
      mechanicalAxes.push(resolution.axis);
    } else if (resolution.status === "ungraded") {
      rows.push({
        axis: resolution.axis,
        verdict: "inconclusive",
        score: "ungraded",
        justification: null,
        citations: [],
        ungradedReason: "no-legal-grader",
        grader: null,
        mechanical: false,
        appliedDisjointnessFamilies: resolution.appliedDisjointnessFamilies,
        appliedReadTurnIds: resolution.appliedReadTurnIds,
      });
    } else {
      await activateAcceptanceGrader(deps.orgHome, resolution.grader.assignment);
      rows.push(
        await runGraderTurn({
          driver: deps.driver,
          scenarioId: scenario.id,
          appName: scenarioAppName(scenario),
          turnId: `grade-${scenario.id}-${resolution.axis}`,
          resolution,
          evidence: composeAxisEvidenceSet(resolution.axis, [...output.evidence, ...output.selfReport]),
          rubricExcerpt: deps.rubricExcerpts[resolution.axis] ?? resolution.axis,
          keys,
          reachableRoots: [
            scenario.worktree,
            join(deps.stateHome, "repos", scenario.appSlug.split("/").at(-1) ?? scenario.id),
          ],
          templateDir: join(deps.campaignRoot, "grader-templates"),
        }),
      );
    }
  }
  if (mechanicalAxes.length > 0) {
    const key = keys.find((candidate) => candidate.scenarioId === scenario.id);
    if (key === undefined) throw new Error(`campaign refused: no sealed key for ${scenario.id}`);
    rows.push(
      ...(await scoreMechanicalAxes({
        axes: mechanicalAxes,
        scenario,
        provision,
        evidence: output.evidence,
        key,
        stateHome: deps.stateHome,
      })),
    );
  }
  const order = new Map(plan.map((entry, index) => [entry.axis, index]));
  return rows.sort(
    (left, right) =>
      (order.get(left.axis) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.axis) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function scenarioArmsFor(
  deps: CampaignRuntimeDeps,
  file: AcceptanceCampaignFile,
  scenario: ScenarioConfig,
  provision: ScenarioProvision,
  keys: readonly SealedKey[],
): ScenarioArms {
  const armDeps = {
    driver: deps.driver,
    scenarioId: scenario.id,
    appName: scenarioAppName(scenario),
    worktree: scenario.worktree,
    baselineCommit: provision.baselineCommit,
    stateHome: deps.stateHome,
    ramble: scenarioRamble(deps.scenarioMarkdown[scenario.id] ?? ""),
  };
  return {
    scenarioId: scenario.id,
    kind: scenario.kind,
    ...(scenario.kind === "job"
      ? {}
      : {
          async planArm() {
            await activateScenarioRoleMatrix(deps.orgHome, scenario);
            const output = await runPlanArm({ ...armDeps, rambleSourcePath: join(scenario.worktree, "BRIEF.md") });
            return gradeArm(deps, file, scenario, provision, output, keys, PLAN_AXES);
          },
        }),
    async buildArm() {
      await activateScenarioRoleMatrix(deps.orgHome, scenario);
      const output =
        scenario.kind === "job"
          ? await runJobArm({ ...armDeps, jobConfigPath: join(scenario.worktree, "job.yaml") })
          : await runBuildArm({ ...armDeps, maxPasses: deps.maxBuildPasses });
      return gradeArm(deps, file, scenario, provision, output, keys, OUTCOME_AXES);
    },
  };
}

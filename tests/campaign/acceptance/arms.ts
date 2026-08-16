// campaign/acceptance/arms.ts — the plan, build and job arms, driven through
// the packaged binaries, plus the evidence each one leaves behind.
//
// This is what the runner's `ScenarioArms` callbacks were placeholders for. The
// arm's job is narrow on purpose: run the product, then COLLECT what the run
// produced. It does not score — scoring is the grader turn and the mechanical
// scorers — because an arm that both acted and judged would be the org grading
// its own homework, which is the specific thing rubric §7 rule 2 forbids.
//
// Evidence composition follows B-29 §1: repository state, diff, run journal,
// ledger, and the original ramble. The org's SELF-REPORT (PR bodies, verdicts,
// step narration) is collected separately and tagged as such, because it is the
// SUBJECT of O-5 and must never be evidence for O-1…O-3.

import type { CliDriver, RecordedInvocation } from "./cli-driver.js";
import type { EvidenceItem } from "./grader-envelope.js";
import { assembleEvidence, collectJobEvidence, planTicketEvidence } from "./arm-evidence.js";
import type { CampaignRepositoryRevalidator } from "../repository-revalidation.js";

export type ArmKind = "plan" | "build" | "job";

export interface ArmOutput {
  arm: ArmKind;
  scenarioId: string;
  /** Every binary invocation this arm made. */
  invocations: RecordedInvocation[];
  /** Terminal exit status of the arm's last command. */
  exitCode: number;
  /** B-29 §1 evidence — never the self-report. */
  evidence: EvidenceItem[];
  /** The org's own account, tagged. Subject of O-5, evidence for nothing. */
  selfReport: EvidenceItem[];
}

export interface ArmDeps {
  driver: CliDriver;
  scenarioId: string;
  appName: string;
  /** The scenario checkout the org operates in. */
  worktree: string;
  /** Provisioning baseline — the diff is measured from here. */
  baselineCommit: string;
  /** The state home the org writes its journal and ledger to. */
  stateHome: string;
  /** The scenario's ramble brief, verbatim. */
  ramble: string;
  revalidateAdmission: CampaignRepositoryRevalidator;
}

/** Plan arm — `cormidia plan --auto`, content-bound to the ramble. */
export async function runPlanArm(deps: ArmDeps & { rambleSourcePath: string }): Promise<ArmOutput> {
  await deps.revalidateAdmission();
  const invocation = await deps.driver.run(
    "cormidia",
    ["plan", deps.appName, "--auto", "--goal", deps.ramble, "--source", deps.rambleSourcePath, "--json"],
    { scenarioId: deps.scenarioId },
  );
  const assembled = await assembleEvidence(deps, [invocation]);
  const tickets = planTicketEvidence(invocation.stdout);
  return {
    arm: "plan",
    scenarioId: deps.scenarioId,
    invocations: [invocation],
    exitCode: invocation.exitCode,
    evidence: [...assembled.evidence, ...(tickets === null ? [] : [tickets])],
    selfReport: assembled.selfReport,
  };
}

/** Build arm — `cormidia loop --once` until the ready frontier drains or the
 *  configured pass budget is spent. The caller owns the bound; an unbounded
 *  loop here would escape the campaign envelope. */
export async function runBuildArm(deps: ArmDeps & { maxPasses: number }): Promise<ArmOutput> {
  const invocations: RecordedInvocation[] = [];
  for (let pass = 0; pass < deps.maxPasses; pass += 1) {
    await deps.revalidateAdmission();
    const invocation = await deps.driver.run("cormidia", ["loop", "--app", deps.appName, "--once"], {
      scenarioId: deps.scenarioId,
    });
    invocations.push(invocation);
    if (invocation.exitCode !== 0) break;
    if (/no ready tickets|nothing to claim/i.test(invocation.stdout)) break;
  }
  return {
    arm: "build",
    scenarioId: deps.scenarioId,
    invocations,
    exitCode: invocations.at(-1)?.exitCode ?? 0,
    ...(await assembleEvidence(deps, invocations)),
  };
}

/** Job arm — the second binary. Jobs have no Planner and no Reviewer, so this
 *  is the whole run rather than one of two arms. */
export async function runJobArm(deps: ArmDeps & { jobConfigPath: string }): Promise<ArmOutput> {
  await deps.revalidateAdmission();
  const invocation = await deps.driver.run(
    "cormidia-job",
    ["run", deps.jobConfigPath, "--workdir", deps.worktree, "--json"],
    { scenarioId: deps.scenarioId },
  );
  const assembled = await assembleEvidence(deps, [invocation]);
  const jobEvidence = await collectJobEvidence(deps, deps.jobConfigPath);
  return {
    arm: "job",
    scenarioId: deps.scenarioId,
    invocations: [invocation],
    exitCode: invocation.exitCode,
    evidence: [...assembled.evidence, ...jobEvidence],
    selfReport: assembled.selfReport,
  };
}

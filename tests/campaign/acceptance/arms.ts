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

import { execFileSync } from "node:child_process";
import { devNull } from "node:os";
import { readTurnRecords } from "../../../src/runtime/telemetry.js";
import type { CliDriver, RecordedInvocation } from "./cli-driver.js";
import type { EvidenceItem } from "./grader-envelope.js";

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
};

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

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
}

/** Repo state + diff since the provisioning baseline. Deliberately a file
 *  manifest plus the patch rather than every byte: a grader that must read the
 *  whole tree to find the change is being tested on patience. */
async function collectRepositoryEvidence(deps: ArmDeps): Promise<EvidenceItem[]> {
  const tracked = git(deps.worktree, ["ls-files"]);
  const diff = git(deps.worktree, ["diff", "--no-color", `${deps.baselineCommit}..HEAD`]);
  const log = git(deps.worktree, ["log", "--no-color", "--format=%H %an <%ae> %s", `${deps.baselineCommit}..HEAD`]);
  return [
    { kind: "repo-state", ref: "repo-state", contents: tracked },
    { kind: "diff", ref: "diff", contents: diff },
    { kind: "run-journal", ref: "commit-log", contents: log },
  ];
}

/** Ledger rows for this app, as the org settled them. O-6 reads this. */
async function collectLedgerEvidence(deps: ArmDeps): Promise<EvidenceItem> {
  const rows = await readTurnRecords(deps.stateHome);
  const forApp = rows.filter((row) => row.app === deps.appName);
  const total = forApp.reduce((sum, row) => sum + row.costUsd, 0);
  return {
    kind: "ledger",
    ref: "ledger",
    contents: `turns=${forApp.length} cost_usd=${total.toFixed(4)}\n${forApp
      .map((row) => `${row.providerTurnId ?? "?"} ${row.role} ${row.status} ${row.costUsd}`)
      .join("\n")}`,
  };
}

async function assembleEvidence(
  deps: ArmDeps,
  invocations: RecordedInvocation[],
): Promise<Pick<ArmOutput, "evidence" | "selfReport">> {
  const evidence: EvidenceItem[] = [
    ...(await collectRepositoryEvidence(deps)),
    await collectLedgerEvidence(deps),
    { kind: "ramble-brief", ref: "ramble-brief", contents: deps.ramble },
  ];
  // The product's own narration of what it did. Tagged, never mixed in.
  const selfReport: EvidenceItem[] = [
    {
      kind: "step-narration",
      ref: "step-narration",
      contents: invocations
        .map((invocation) => `$ ${invocation.binary} ${invocation.argv.join(" ")}\n${invocation.stdout}`)
        .join("\n"),
    },
  ];
  return { evidence, selfReport };
}

/** Plan arm — `cormidia plan --auto`, content-bound to the ramble. */
export async function runPlanArm(deps: ArmDeps & { rambleSourcePath: string }): Promise<ArmOutput> {
  const invocation = await deps.driver.run(
    "cormidia",
    ["plan", deps.appName, "--auto", "--goal", deps.ramble, "--source", deps.rambleSourcePath, "--json"],
    { scenarioId: deps.scenarioId },
  );
  return {
    arm: "plan",
    scenarioId: deps.scenarioId,
    invocations: [invocation],
    exitCode: invocation.exitCode,
    ...(await assembleEvidence(deps, [invocation])),
  };
}

/** Build arm — `cormidia loop --once` until the ready frontier drains or the
 *  configured pass budget is spent. The caller owns the bound; an unbounded
 *  loop here would escape the campaign envelope. */
export async function runBuildArm(deps: ArmDeps & { maxPasses: number }): Promise<ArmOutput> {
  const invocations: RecordedInvocation[] = [];
  for (let pass = 0; pass < deps.maxPasses; pass += 1) {
    const invocation = await deps.driver.run("cormidia", ["loop", "--app", deps.appName, "--once", "--json"], {
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
  const invocation = await deps.driver.run(
    "cormidia-job",
    ["run", deps.jobConfigPath, "--workdir", deps.worktree, "--json"],
    { scenarioId: deps.scenarioId },
  );
  return {
    arm: "job",
    scenarioId: deps.scenarioId,
    invocations: [invocation],
    exitCode: invocation.exitCode,
    ...(await assembleEvidence(deps, [invocation])),
  };
}

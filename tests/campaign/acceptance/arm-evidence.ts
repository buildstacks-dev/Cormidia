import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { devNull } from "node:os";
import { join } from "node:path";
import { loadJobConfig } from "../../../src/jobs/config.js";
import { jobJournalPath } from "../../../src/jobs/journal.js";
import { readTurnRecords } from "../../../src/runtime/telemetry.js";
import type { ArmDeps, ArmOutput } from "./arms.js";
import type { RecordedInvocation } from "./cli-driver.js";
import type { EvidenceItem } from "./grader-envelope.js";

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull };
function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

async function collectRepositoryEvidence(deps: ArmDeps): Promise<EvidenceItem[]> {
  return [
    { kind: "repo-state", ref: "repo-state", contents: git(deps.worktree, ["ls-files"]) },
    { kind: "diff", ref: "diff", contents: git(deps.worktree, ["diff", "--no-color", `${deps.baselineCommit}..HEAD`]) },
    {
      kind: "run-journal",
      ref: "commit-log",
      contents: git(deps.worktree, ["log", "--no-color", "--format=%H %an <%ae> %s", `${deps.baselineCommit}..HEAD`]),
    },
  ];
}

async function collectLedgerEvidence(deps: ArmDeps): Promise<EvidenceItem> {
  const rows = (await readTurnRecords(deps.stateHome)).filter((row) => row.app === deps.appName);
  const total = rows.reduce((sum, row) => sum + row.costUsd, 0);
  return {
    kind: "ledger",
    ref: "ledger",
    contents: `turns=${rows.length} cost_usd=${total.toFixed(4)}\n${rows.map((row) => `${row.providerTurnId ?? "?"} ${row.role} ${row.status} ${row.costUsd}`).join("\n")}`,
  };
}

export async function assembleEvidence(
  deps: ArmDeps,
  invocations: RecordedInvocation[],
): Promise<Pick<ArmOutput, "evidence" | "selfReport">> {
  return {
    evidence: [
      ...(await collectRepositoryEvidence(deps)),
      await collectLedgerEvidence(deps),
      { kind: "ramble-brief", ref: "ramble-brief", contents: deps.ramble },
    ],
    selfReport: [
      {
        kind: "step-narration",
        ref: "step-narration",
        contents: invocations
          .map((invocation) => `$ ${invocation.binary} ${invocation.argv.join(" ")}\n${invocation.stdout}`)
          .join("\n"),
      },
    ],
  };
}

export function planTicketEvidence(stdout: string): EvidenceItem | null {
  try {
    const root = JSON.parse(stdout) as Record<string, unknown>;
    const plan = root["plan"];
    const tickets =
      typeof plan === "object" && plan !== null && !Array.isArray(plan)
        ? (plan as Record<string, unknown>)["tickets"]
        : root["tickets"];
    return Array.isArray(tickets)
      ? { kind: "run-journal", ref: "plan-ticket-set", contents: JSON.stringify(tickets, null, 2) }
      : null;
  } catch {
    return null;
  }
}

export async function collectJobEvidence(deps: ArmDeps, configPath: string): Promise<EvidenceItem[]> {
  const config = await loadJobConfig(configPath);
  const evidence: EvidenceItem[] = [];
  try {
    evidence.push({
      kind: "run-journal",
      ref: "job-journal",
      contents: await readFile(jobJournalPath(deps.stateHome, config.job), "utf8"),
    });
  } catch {
    /* absence is measured, never manufactured */
  }
  for (const step of config.steps) {
    if (step.kind !== "provider") continue;
    for (const output of step.outputs) {
      try {
        evidence.push({
          kind: "repo-state",
          ref: `job-output:${output.path}`,
          contents: await readFile(join(deps.worktree, output.path), "utf8"),
        });
      } catch {
        /* J-1 measures the missing declared output */
      }
    }
  }
  return evidence;
}

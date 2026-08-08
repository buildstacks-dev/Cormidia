import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readTurnRecords } from "../../../src/runtime/telemetry.js";
import type { AcceptanceCampaignConfig } from "./campaign-config.js";
import { scenarioAppName } from "./campaign-config.js";
import type { CliDriver, RecordedInvocation } from "./cli-driver.js";
import type { ScenarioProvision } from "./provision.js";
import {
  readScenarioCommits,
  reconcileSupervisorNonParticipation,
  type InvocationAuditRow,
  type SupervisorReconciliation,
} from "./supervisor-reconciliation.js";

interface ProductAuditRecord {
  at: string;
  finishedAt?: string;
  invocationId?: string;
  command?: string;
  argv?: string[];
  app?: string;
}

async function auditRecords(stateHome: string): Promise<ProductAuditRecord[]> {
  let names: string[];
  try {
    names = await readdir(join(stateHome, "invocations"));
  } catch {
    return [];
  }
  const rows: ProductAuditRecord[] = [];
  for (const name of names.filter((candidate) => candidate.endsWith(".jsonl")).sort()) {
    const text = await readFile(join(stateHome, "invocations", name), "utf8");
    for (const line of text.split("\n").filter(Boolean)) rows.push(JSON.parse(line) as ProductAuditRecord);
  }
  return rows;
}

function sameInvocation(recorded: RecordedInvocation, audit: ProductAuditRecord): boolean {
  const command = recorded.binary === "cormidia-job" ? "cormidia-job" : recorded.argv[0];
  if (audit.command !== command || JSON.stringify(audit.argv) !== JSON.stringify(recorded.argv)) return false;
  const delta = Math.abs(new Date(audit.at).getTime() - new Date(recorded.startedAt).getTime());
  return delta < 10_000;
}

function gitReader(root: string): (args: string[]) => string {
  return (args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).trim();
}

function containsTurn(audit: ProductAuditRecord, at: string): boolean {
  const time = new Date(at).getTime();
  const start = new Date(audit.at).getTime();
  const finish = new Date(audit.finishedAt ?? audit.at).getTime();
  return time >= start - 1000 && time <= finish + 1000;
}

function insideScenarioAttempt(invocations: readonly RecordedInvocation[], at: string): boolean {
  if (invocations.length === 0) return false;
  const time = new Date(at).getTime();
  const starts = invocations.map((row) => new Date(row.startedAt).getTime());
  const finishes = invocations.map((row) => new Date(row.finishedAt).getTime());
  return time >= Math.min(...starts) - 1000 && time <= Math.max(...finishes) + 1000;
}

export async function reconcileCampaignScenarios(input: {
  config: AcceptanceCampaignConfig;
  driver: CliDriver;
  stateHome: string;
  provisions: ReadonlyMap<string, ScenarioProvision>;
}): Promise<Map<string, SupervisorReconciliation>> {
  const productAudit = await auditRecords(input.stateHome);
  const recorded = input.driver.recorded();
  const matched = new Map<RecordedInvocation, ProductAuditRecord>();
  const used = new Set<string>();
  for (const invocation of recorded) {
    const row = productAudit.find(
      (candidate) =>
        candidate.invocationId !== undefined &&
        !used.has(candidate.invocationId) &&
        sameInvocation(invocation, candidate),
    );
    if (row?.invocationId !== undefined) {
      matched.set(invocation, row);
      used.add(row.invocationId);
    }
  }
  const turns = await readTurnRecords(input.stateHome);
  const results = new Map<string, SupervisorReconciliation>();
  for (const scenario of input.config.scenarios) {
    const appName = scenarioAppName(scenario);
    const invocations = recorded.filter((row) => row.scenarioId === scenario.id);
    const audit = invocations.flatMap((row): InvocationAuditRow[] => {
      const product = matched.get(row);
      return product?.invocationId === undefined
        ? []
        : [{ invocationId: product.invocationId, command: product.command ?? "unknown" }];
    });
    // State homes intentionally survive process restarts. Reconcile the
    // scenario attempt represented by THIS driver's records, not every old
    // provider turn ever settled for the app. Otherwise a pre-report crash
    // followed by a new fail-closed attempt permanently poisons the next final
    // report with a turn whose outer in-memory driver row no longer exists.
    // The whole first-to-last window remains in scope, so an unrecorded turn
    // interleaved by an outside process still fires the detector.
    const relevantTurns = turns.filter(
      (turn) =>
        (turn.app === appName || (scenario.kind === "job" && turn.app === undefined)) &&
        insideScenarioAttempt(invocations, turn.at),
    );
    const journalTurns = relevantTurns.map((turn) => {
      const product = [...matched.values()].find(
        (row) =>
          containsTurn(row, turn.at) &&
          (row.app === undefined || row.app === appName || row.command === "cormidia-job"),
      );
      return {
        turnId: turn.providerTurnId ?? turn.executionStepId ?? `${turn.role}:${turn.at}`,
        invocationId: product?.invocationId ?? "missing-product-invocation-audit",
        role: turn.role,
      };
    });
    const repository = scenario.kind === "job" ? scenario.worktree : join(input.stateHome, "repos", appName);
    let commits = [] as ReturnType<typeof readScenarioCommits>;
    try {
      commits = readScenarioCommits(gitReader(repository));
    } catch {
      /* missing clone becomes an action violation below */
    }
    const loopAudit = invocations
      .map((row) => ({ row, audit: matched.get(row) }))
      .find(({ row }) => row.argv[0] === "loop")?.audit;
    const provision = input.provisions.get(scenario.id);
    const provisioned = new Set(provision?.provisionedShas ?? []);
    const actions = [
      ...invocations.map((row, index) => ({
        id: `binary-invocation:${index + 1}:${row.binary}:${row.argv[0] ?? "unknown"}`,
        kind: "file-write" as const,
        ...(matched.get(row)?.invocationId === undefined ? {} : { invocationId: matched.get(row)!.invocationId }),
      })),
      ...commits
        .filter((commit) => !provisioned.has(commit.sha))
        .map((commit) => ({
          id: commit.sha,
          kind: "commit" as const,
          ...(loopAudit?.invocationId === undefined ? {} : { invocationId: loopAudit.invocationId }),
        })),
    ];
    results.set(
      scenario.id,
      reconcileSupervisorNonParticipation({
        scenarioId: scenario.id,
        turnIdentities: [
          "Cormidia <cormidia@localhost>",
          "Cormidia Loop <loop@cormidia.invalid>",
          "Cormidia Planner <planner@cormidia.local>",
          "Cormidia Lifecycle <lifecycle@cormidia.invalid>",
        ],
        commits,
        journalTurns,
        invocationAudit: audit,
        actions,
        providerCallsInCampaignProcess: 0,
        ...(provision === undefined ? {} : { provisioning: provision }),
      }),
    );
  }
  return results;
}

import { formatStatusRows, readStatusRows } from "../runtime/runlog/status.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";
import { resolve } from "node:path";
import { approvalLifecycleState, ApprovalStore } from "../org/approvals.js";
import { listTicketClaimStates } from "../loop/rehydrate.js";
import { rearmCommand } from "../loop/claim-recovery.js";

export async function cmdStatus(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "status");
  const parsed = parseArgs(common.rest);
  const stateHome = common.stateHome ? resolve(common.stateHome) : (await resolveOperonHomes(common)).stateHome;
  const rows = await readStatusRows(stateHome, {
    ...(parsed.app !== undefined ? { app: parsed.app } : {}),
    ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
  });
  const approvals = (await new ApprovalStore(stateHome).listDecidedReadOnly())
    .filter((item) => item.execution !== undefined)
    .filter((item) => parsed.app === undefined || item.app === parsed.app);
  const approvalDelivery = approvals.map((item) => ({
    id: item.id,
    app: item.app,
    state: approvalLifecycleState(item),
    attempts: item.execution!.attempts,
    actor: item.execution!.actor ?? null,
    attemptedAt: item.execution!.attemptedAt ?? null,
    result: item.execution!.result ?? null,
    failureCause: item.execution!.failureCause ?? null,
    nextAction: item.execution!.nextAction,
  }));
  const claimRecovery = listTicketClaimStates(stateHome, parsed.app).filter((entry) => {
    const latest = entry.state.events?.at(-1);
    return entry.state.active !== undefined || entry.state.continuation !== undefined ||
      latest?.kind === "automatic_recovery" || latest?.kind === "manual_rearm";
  }).map((entry) => {
    const state = entry.state;
    const latest = state.events?.at(-1);
    const mode = state.active !== undefined
      ? `active:${state.active.phase}`
      : state.continuation !== undefined
        ? `approval:${state.continuation.status}`
        : latest?.kind ?? "idle";
    const needsExplicitRearm = latest?.detail.includes("explicit") === true;
    const allowance = state.claimAllowance ?? state.claims;
    return {
      app: entry.app,
      issueNumber: entry.issueNumber,
      mode,
      claims: state.claims,
      allowance: state.claimAllowance ?? null,
      next: latest?.detail ?? "inspect ticket state",
      rearmCommand: needsExplicitRearm
        ? rearmCommand({ app: entry.app, issueNumber: entry.issueNumber, allowance })
        : null,
    };
  });
  const report = {
    schema_version: 1,
    kind: "status",
    stateHome,
    filters: { app: parsed.app ?? null, limit: parsed.limit ?? null },
    runCount: rows.length,
    runs: rows,
    approvalDelivery,
    claimRecovery,
  } as const;
  if (parsed.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(formatStatusRows(report.runs));
  if (report.approvalDelivery.length > 0) {
    console.log("\nAPPROVAL DELIVERY");
    for (const item of report.approvalDelivery) {
      console.log(
        `${item.id} ${item.app} ${item.state} ` +
        `attempt=${item.attempts} actor=${item.actor ?? "-"} ` +
        `at=${item.attemptedAt ?? "-"} result=${item.result ?? "-"} ` +
        `cause=${item.failureCause ?? "-"} next=${item.nextAction}`,
      );
    }
  }
  if (report.claimRecovery.length > 0) {
    console.log("\nCLAIM RECOVERY");
    for (const entry of report.claimRecovery) {
      console.log(
        `${entry.app}#${entry.issueNumber} ${entry.mode} claims=${entry.claims} ` +
        `allowance=${entry.allowance ?? "route-policy"} next=${entry.next}`,
      );
      if (entry.rearmCommand !== null) console.log(`  ${entry.rearmCommand}`);
    }
  }
  return 0;
}

interface ParsedStatusArgs {
  app?: string;
  limit?: number;
  json: boolean;
}

function parseArgs(args: string[]): ParsedStatusArgs {
  const out: ParsedStatusArgs = { json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--app") out.app = needValue(args, ++i, "--app");
    else if (arg === "--limit") out.limit = parseLimit(needValue(args, ++i, "--limit"));
    else if (arg === "--json") out.json = true;
    else throw new Error(`status: unknown argument "${arg}"`);
  }
  return out;
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error("status: --limit must be a positive integer");
  return parsed;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`status: ${flag} requires a value`);
  return value;
}

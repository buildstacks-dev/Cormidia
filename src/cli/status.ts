import { formatStatusRows, readStatusRows } from "../runtime/runlog/status.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";
import { resolve } from "node:path";
import { approvalLifecycleState, ApprovalStore } from "../org/approvals.js";

export async function cmdStatus(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "status");
  const parsed = parseArgs(common.rest);
  const stateHome = common.stateHome ? resolve(common.stateHome) : (await resolveOperonHomes(common)).stateHome;
  const rows = await readStatusRows(stateHome, {
    ...(parsed.app !== undefined ? { app: parsed.app } : {}),
    ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
  });
  console.log(formatStatusRows(rows));
  const approvals = (await new ApprovalStore(stateHome).listDecidedReadOnly())
    .filter((item) => item.execution !== undefined)
    .filter((item) => parsed.app === undefined || item.app === parsed.app);
  if (approvals.length > 0) {
    console.log("\nAPPROVAL DELIVERY");
    for (const item of approvals) {
      console.log(
        `${item.id} ${item.app} ${approvalLifecycleState(item)} ` +
        `attempt=${item.execution!.attempts} actor=${item.execution!.actor ?? "-"} ` +
        `at=${item.execution!.attemptedAt ?? "-"} result=${item.execution!.result ?? "-"} ` +
        `cause=${item.execution!.failureCause ?? "-"} next=${item.execution!.nextAction}`,
      );
    }
  }
  return 0;
}

interface ParsedStatusArgs {
  app?: string;
  limit?: number;
}

function parseArgs(args: string[]): ParsedStatusArgs {
  const out: ParsedStatusArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--app") out.app = needValue(args, ++i, "--app");
    else if (arg === "--limit") out.limit = parseLimit(needValue(args, ++i, "--limit"));
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

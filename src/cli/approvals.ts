// Human approval queue CLI (architecture.md §4).

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ApprovalStore, type ApprovalItem } from "../org/approvals.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";
import { resolve } from "node:path";

export async function cmdApprovals(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "approvals");
  const parsed = parseArgs(common.rest);
  const stateHome = common.stateHome ? resolve(common.stateHome) : (await resolveOperonHomes(common)).stateHome;
  const store = new ApprovalStore(stateHome);
  await store.reconcile();

  if (parsed.subcommand === "show") {
    if (parsed.id === undefined) throw new Error("approvals show: id required");
    const { item, grant } = await store.show(parsed.id);
    console.log(JSON.stringify({ item, ...(grant !== undefined ? { grant } : {}) }, null, 2));
    return 0;
  }

  if (parsed.subcommand === "review") {
    return reviewQueue(store);
  }

  const pending = await store.listPending();
  printTable(pending, parsed.now);
  return 0;
}

interface ParsedArgs {
  subcommand: "list" | "review" | "show";
  id?: string;
  now: Date;
}

function parseArgs(args: string[]): ParsedArgs {
  let subcommand: ParsedArgs["subcommand"] = "list";
  let id: string | undefined;
  let now = new Date();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--now") now = new Date(needValue(args, ++i, "--now"));
    else if (arg === "review") subcommand = "review";
    else if (arg === "show") {
      subcommand = "show";
      id = needValue(args, ++i, "show");
    } else if (arg === "list") subcommand = "list";
    else throw new Error(`approvals: unknown argument "${arg}"`);
  }

  return { subcommand, ...(id !== undefined ? { id } : {}), now };
}

async function reviewQueue(store: ApprovalStore): Promise<number> {
  const pending = await store.listPending();
  if (pending.length === 0) {
    console.log("approvals: 0 pending");
    return 0;
  }
  if (!input.isTTY) return reviewQueueBatch(store, pending);

  const rl = createInterface({ input, output });
  try {
    for (const item of pending) {
      console.log(formatFullItem(item));
      const answer = (await rl.question("[a]pprove / [d]eny / [s]kip: ")).trim().toLowerCase();
      if (answer === "a" || answer === "approve") {
        const decided = await store.decide(item.id, { decision: "approved" });
        console.log(`approved ${item.id}${decided.grantId ? ` grant=${decided.grantId}` : ""}`);
      } else if (answer === "d" || answer === "deny") {
        const reason = (await rl.question("reason: ")).trim();
        await store.decide(item.id, { decision: "denied", reason });
        console.log(`denied ${item.id}`);
      } else {
        console.log(`skipped ${item.id}`);
      }
    }
  } finally {
    rl.close();
  }
  return 0;
}

async function reviewQueueBatch(store: ApprovalStore, pending: readonly ApprovalItem[]): Promise<number> {
  const lines = (await readStdin()).split(/\r?\n/);
  let index = 0;
  for (const item of pending) {
    console.log(formatFullItem(item));
    const answer = (lines[index++] ?? "").trim().toLowerCase();
    if (answer === "a" || answer === "approve") {
      const decided = await store.decide(item.id, { decision: "approved" });
      console.log(`approved ${item.id}${decided.grantId ? ` grant=${decided.grantId}` : ""}`);
    } else if (answer === "d" || answer === "deny") {
      const reason = (lines[index++] ?? "").trim();
      await store.decide(item.id, { decision: "denied", reason });
      console.log(`denied ${item.id}`);
    } else {
      console.log(`skipped ${item.id}`);
    }
  }
  return 0;
}

async function readStdin(): Promise<string> {
  let text = "";
  for await (const chunk of input) text += String(chunk);
  return text;
}

function printTable(items: readonly ApprovalItem[], now: Date): void {
  console.log("ID                       APP                  ROLE       RULE                 AGE");
  for (const item of items) {
    console.log(
      [
        item.id.padEnd(24),
        item.app.padEnd(20),
        item.role.padEnd(10),
        item.rule.padEnd(20),
        age(item.raisedAt, now).padStart(4),
      ].join(" "),
    );
  }
  console.log(`${items.length} pending`);
}

function formatFullItem(item: ApprovalItem): string {
  return [
    `id: ${item.id}`,
    `app: ${item.app}`,
    `role: ${item.role}`,
    `rule: ${item.rule}`,
    `turn: ${item.turnId ?? "(none)"}`,
    `ticket: ${item.ticketRef ?? "(none)"}`,
    `raised: ${item.raisedAt}`,
    `action: ${JSON.stringify(item.action)}`,
    `justification: ${item.justification ?? "(none)"}`,
  ].join("\n");
}

function age(raisedAt: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(raisedAt).getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`approvals: ${flag} requires a value`);
  return value;
}

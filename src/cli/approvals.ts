// Human approval queue CLI (architecture.md §4; approval-and-release-
// amendment A1–A3): decisions may widen a grant's scope (never for
// NEVER_SCOPEABLE_RULES), same-rule items may be reviewed as one batch with
// per-item audit intact, approvals may re-arm the parked ticket, and grants
// can be revoked immediately.

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { join, resolve } from "node:path";
import {
  ApprovalStore,
  type ApprovalItem,
  type DecideApprovalInput,
} from "../org/approvals.js";
import { appendDenialLesson } from "../org/denial-lessons.js";
import { loadApps } from "../org/apps.js";
import { GhCliOps } from "../loop/github.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdApprovals(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "approvals");
  const parsed = parseArgs(common.rest);
  const homes = await resolveOperonHomes(common);
  const stateHome = common.stateHome ? resolve(common.stateHome) : homes.stateHome;
  const store = new ApprovalStore(stateHome);
  await store.reconcile();

  if (parsed.subcommand === "show") {
    if (parsed.id === undefined) throw new Error("approvals show: id required");
    const { item, grant } = await store.show(parsed.id);
    console.log(JSON.stringify({ item, ...(grant !== undefined ? { grant } : {}) }, null, 2));
    return 0;
  }

  if (parsed.subcommand === "revoke") {
    if (parsed.id === undefined) throw new Error("approvals revoke: grant id required");
    const revoked = store.revokeGrantSync(parsed.id, parsed.now);
    console.log(`revoked ${revoked.grantId} (approval ${revoked.approvalId})`);
    return 0;
  }

  if (parsed.subcommand === "review") {
    return reviewQueue(store, homes.orgHome, parsed.batch);
  }

  const pending = await store.listPending();
  printTable(pending, parsed.now);
  return 0;
}

interface ParsedArgs {
  subcommand: "list" | "review" | "show" | "revoke";
  id?: string;
  batch: boolean;
  now: Date;
}

function parseArgs(args: string[]): ParsedArgs {
  let subcommand: ParsedArgs["subcommand"] = "list";
  let id: string | undefined;
  let batch = false;
  let now = new Date();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--now") now = new Date(needValue(args, ++i, "--now"));
    else if (arg === "--batch") batch = true;
    else if (arg === "review") subcommand = "review";
    else if (arg === "show") {
      subcommand = "show";
      id = needValue(args, ++i, "show");
    } else if (arg === "revoke") {
      subcommand = "revoke";
      id = needValue(args, ++i, "revoke");
    } else if (arg === "list") subcommand = "list";
    else throw new Error(`approvals: unknown argument "${arg}"`);
  }

  return { subcommand, batch, ...(id !== undefined ? { id } : {}), now };
}

/** `a` = approve single-use; `a ticket [path]` / `a app [path]` = approve
 *  with an A1 scope; `d` = deny (reason follows); anything else skips. */
function decisionFromAnswer(answer: string): { kind: "approve" | "deny" | "skip"; scope?: DecideApprovalInput["scope"] } {
  const parts = answer.trim().toLowerCase().split(/\s+/);
  const head = parts[0] ?? "";
  if (head === "d" || head === "deny") return { kind: "deny" };
  if (head !== "a" && head !== "approve") return { kind: "skip" };
  const kind = parts[1];
  if (kind === "ticket" || kind === "app") {
    return {
      kind: "approve",
      scope: { kind, ...(parts[2] !== undefined ? { pathContains: parts[2] } : {}) },
    };
  }
  return { kind: "approve" };
}

async function reviewQueue(store: ApprovalStore, orgHome: string, batch: boolean): Promise<number> {
  const pending = await store.listPending();
  if (pending.length === 0) {
    console.log("approvals: 0 pending");
    return 0;
  }
  // A3: batching groups the human's keystrokes, never the audit — each item
  // still gets its own decide() call and log rows.
  const groups: ApprovalItem[][] = batch ? groupByRuleAndApp(pending) : pending.map((item) => [item]);

  const interactive = input.isTTY === true;
  const rl = interactive ? createInterface({ input, output }) : undefined;
  const scripted = interactive ? [] : (await readStdin()).split(/\r?\n/);
  let scriptIndex = 0;
  const ask = async (prompt: string): Promise<string> =>
    rl !== undefined ? await rl.question(prompt) : (scripted[scriptIndex++] ?? "");

  try {
    for (const group of groups) {
      const first = group[0]!;
      if (group.length === 1) {
        console.log(formatFullItem(first));
      } else {
        console.log(`BATCH ${group.length} item(s) — rule ${first.rule}, app ${first.app}`);
        for (const item of group) console.log(`  ${item.id} ${JSON.stringify(item.action).slice(0, 100)}`);
      }
      const answer = await ask("[a]pprove / a ticket|app [path] / [d]eny / [s]kip: ");
      const decision = decisionFromAnswer(answer);
      if (decision.kind === "skip") {
        for (const item of group) console.log(`skipped ${item.id}`);
        continue;
      }
      if (decision.kind === "deny") {
        const reason = (await ask("reason: ")).trim();
        for (const item of group) {
          await store.decide(item.id, { decision: "denied", reason });
          console.log(`denied ${item.id}`);
          // A5: EVERY human denial reason persists as role memory — not only
          // the composed gate's role-forbidden flat denies. Without this, the
          // same CLI denial is re-litigated next pass (the episode made the
          // identical denial eight times).
          const recorded = appendDenialLesson(orgHome, item.role, {
            app: item.app,
            rule: item.rule,
            reason,
            at: new Date().toISOString(),
          });
          if (recorded) console.log(`lesson recorded for role ${item.role}`);
        }
        continue;
      }
      for (const item of group) {
        // One wrong answer must not kill the review session: a scope request
        // on a never-scopeable rule throws — report it, leave the item
        // pending, and continue with the rest of the queue.
        try {
          const decided = await store.decide(item.id, {
            decision: "approved",
            ...(decision.scope !== undefined ? { scope: decision.scope } : {}),
          });
          console.log(
            `approved ${item.id}${decided.grantId ? ` grant=${decided.grantId}` : ""}` +
              (decision.scope !== undefined ? ` scope=${decision.scope.kind}` : ""),
          );
        } catch (error) {
          console.log(
            `NOT decided ${item.id}: ${error instanceof Error ? error.message : String(error)} ` +
              `— still pending, review it again`,
          );
        }
      }
      // A2 approve-and-rearm: continue the parked ticket from its artifacts.
      const ticketed = group.find((item) => item.ticketRef !== undefined);
      if (interactive && ticketed?.ticketRef !== undefined) {
        const rearm = (await ask(`re-arm ${ticketed.ticketRef} (op:blocked -> op:ready)? [y/N]: `))
          .trim()
          .toLowerCase();
        if (rearm === "y" || rearm === "yes") {
          await rearmTicket(orgHome, ticketed);
        }
      }
    }
  } finally {
    rl?.close();
  }
  return 0;
}

function groupByRuleAndApp(items: readonly ApprovalItem[]): ApprovalItem[][] {
  const groups = new Map<string, ApprovalItem[]>();
  for (const item of items) {
    const key = `${item.rule} ${item.app}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups.values()];
}

async function rearmTicket(orgHome: string, item: ApprovalItem): Promise<void> {
  const issueNumber = Number(/#(\d+)/.exec(item.ticketRef ?? "")?.[1]);
  if (!Number.isInteger(issueNumber)) {
    console.log(`re-arm skipped: cannot parse ticket ref "${item.ticketRef}"`);
    return;
  }
  try {
    const apps = await loadApps(join(orgHome, "apps.yaml"));
    const app = apps.apps.find((entry) => entry.name === item.app);
    if (app === undefined) {
      console.log(`re-arm skipped: app "${item.app}" not in apps.yaml`);
      return;
    }
    await new GhCliOps(app.repo).swapLabel(issueNumber, "op:blocked", "op:ready");
    console.log(`re-armed ${item.ticketRef}: op:blocked -> op:ready`);
  } catch (error) {
    console.log(
      `re-arm failed (${error instanceof Error ? error.message.split("\n")[0] : String(error)}) — ` +
        `swap the label manually if the ticket should continue`,
    );
  }
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

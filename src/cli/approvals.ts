// Attributable approval queue CLI (architecture.md §4; approval-and-release-
// amendment A1–A3): decisions may widen a grant's scope (never for
// NEVER_SCOPEABLE_RULES), same-rule items may be reviewed as one batch with
// per-item audit intact, approvals may re-arm the parked ticket, and grants
// can be revoked immediately.

import { join, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { continueAfterApproval } from "../loop/claim-recovery.js";
import { GhCliOps } from "../loop/github.js";
import {
  actionHash,
  approvalDeciderFromIdentity,
  approvalLifecycleState,
  ApprovalStore,
  type ApprovalItem,
  type DecideApprovalInput,
} from "../org/approvals.js";
import { loadApps } from "../org/apps.js";
import { isBudgetEscalationRule } from "../org/budget.js";
import { appendDenialLesson } from "../org/denial-lessons.js";
import { resolveCormidiaHomes } from "../org/home.js";
import { releaseExpiredTicketApprovalClaim } from "../org/ticket-episode-approval.js";
import { extractHomeFlags } from "./home-flags.js";
import { definedProps } from "../runtime/optional-properties.js";

export async function cmdApprovals(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "approvals");
  const parsed = parseArgs(common.rest);
  const homes = await resolveCormidiaHomes(common);
  const stateHome = common.stateHome ? resolve(common.stateHome) : homes.stateHome;
  const store = new ApprovalStore(stateHome);
  if (parsed.subcommand === "review" && input.isTTY !== true) {
    throw new Error("approvals review requires a terminal; use 'cormidia approvals decide'");
  }
  await store.reconcile(parsed.now);
  for (const expired of (await store.listDecided()).filter((item) => item.status === "expired")) {
    await releaseExpiredTicketApprovalClaim(stateHome, expired, parsed.now);
  }

  if (parsed.subcommand === "show") {
    if (parsed.id === undefined) throw new Error("approvals show: id required");
    const { item, grant } = await store.show(parsed.id);
    console.log(JSON.stringify({ item, ...definedProps({ grant }) }, null, 2));
    return 0;
  }

  if (parsed.subcommand === "revoke") {
    if (parsed.id === undefined) throw new Error("approvals revoke: grant id required");
    const revoked = store.revokeGrantSync(parsed.id, parsed.now);
    if (parsed.json) {
      console.log(JSON.stringify({ schema_version: 1, kind: "approval-revocation", revoked }, null, 2));
    } else {
      console.log(`revoked ${revoked.grantId} (approval ${revoked.approvalId})`);
    }
    return 0;
  }

  if (parsed.subcommand === "review") {
    if (parsed.json) throw new Error("approvals review: --json is unavailable for interactive decisions");
    if (parsed.by === undefined || parsed.by.trim() === "") {
      throw new Error("approvals review: --by <identity> is required");
    }
    return reviewQueue(store, homes.orgHome, stateHome, parsed.batch, parsed.by);
  }

  if (parsed.subcommand === "decide") {
    if (parsed.id === undefined) throw new Error("approvals decide: id required");
    if (parsed.decision === undefined) {
      throw new Error("approvals decide: choose exactly one of --approve or --deny");
    }
    if (parsed.reason === undefined || parsed.reason.trim() === "") {
      throw new Error("approvals decide: --reason is required");
    }
    if (/^[ads]$/i.test(parsed.reason.trim())) {
      throw new Error("approvals decide: --reason must be an actual justification, not a bare a/d/s token");
    }
    if (parsed.by === undefined || parsed.by.trim() === "") {
      throw new Error("approvals decide: --by <identity> is required");
    }
    if (parsed.confirm !== parsed.id) {
      throw new Error(`approvals decide: --confirm must exactly match ${parsed.id}`);
    }
    if (parsed.decision === "denied" && parsed.scope !== undefined) {
      throw new Error("approvals decide: --scope is available only with --approve");
    }
    const decided = await store.decide(parsed.id, {
      decision: parsed.decision,
      reason: parsed.reason,
      decidedBy: approvalDeciderFromIdentity(parsed.by),
      now: parsed.now,
      ...definedProps({ scope: parsed.scope }),
    });
    if (decided.decision === "denied") {
      appendDenialLesson(homes.orgHome, decided.role, {
        app: decided.app,
        rule: decided.rule,
        reason: decided.reason!,
        at: decided.decidedAt!,
      });
    }
    await rearmTicket(homes.orgHome, stateHome, decided);
    if (parsed.json) {
      console.log(
        JSON.stringify(
          {
            schema_version: 1,
            kind: "approval-decision",
            item: approvalView(decided),
          },
          null,
          2,
        ),
      );
    } else {
      console.log(
        `${decided.decision} ${decided.id} by ${decided.decidedBy?.identity ?? "unknown"}` +
          (decided.grantId === undefined ? "" : ` grant=${decided.grantId}`),
      );
    }
    return 0;
  }

  if (parsed.subcommand === "status") {
    const executions = (await store.listDecided()).filter(
      (item) => item.execution !== undefined || item.status === "expired",
    );
    if (parsed.json) {
      console.log(
        JSON.stringify(
          {
            schema_version: 1,
            kind: "approvals",
            view: "status",
            stateHome,
            executionCount: executions.length,
            executions: executions.map(approvalView),
          },
          null,
          2,
        ),
      );
    } else {
      printExecutionTable(executions);
    }
    return 0;
  }

  if (parsed.subcommand === "disposition") {
    if (parsed.id === undefined) throw new Error("approvals disposition: id required");
    if (parsed.confirm !== parsed.id)
      throw new Error(`approvals disposition: --confirm must exactly match ${parsed.id}`);
    if (parsed.disposition === undefined)
      throw new Error("approvals disposition: choose exactly one of --executed, --failed, or --retry");
    if (parsed.reason === undefined || parsed.reason.trim() === "")
      throw new Error("approvals disposition: --reason is required");
    const item = await store.dispositionExecution({
      id: parsed.id,
      disposition: parsed.disposition,
      reason: parsed.reason,
      actor: "human/operator",
      now: parsed.now,
    });
    if (parsed.json) {
      console.log(
        JSON.stringify(
          {
            schema_version: 1,
            kind: "approval-disposition",
            item: approvalView(item),
          },
          null,
          2,
        ),
      );
    } else {
      console.log(
        `approval ${item.id} execution ${item.execution?.state ?? "untracked"}: ${item.execution?.nextAction ?? "none"}`,
      );
    }
    return 0;
  }

  const pending = await store.listPending();
  const outstanding = (await store.listDecided()).filter(isOutstandingExecution);
  if (parsed.json) {
    console.log(
      JSON.stringify(
        {
          schema_version: 1,
          kind: "approvals",
          view: "list",
          stateHome,
          pendingCount: pending.length,
          pending,
          outstandingCount: outstanding.length,
          outstanding: outstanding.map(approvalView),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  printTable(pending, parsed.now);
  if (outstanding.length > 0) {
    console.log("\nAPPROVED BUT NOT TERMINALLY ACKNOWLEDGED");
    printExecutionTable(outstanding, "outstanding execution record(s)");
  }
  return 0;
}

interface ParsedArgs {
  subcommand: "list" | "review" | "decide" | "show" | "revoke" | "status" | "disposition";
  id?: string;
  batch: boolean;
  now: Date;
  decision?: "approved" | "denied";
  disposition?: "executed" | "failed" | "retry";
  reason?: string;
  by?: string;
  scope?: DecideApprovalInput["scope"];
  confirm?: string;
  json: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  let subcommand: ParsedArgs["subcommand"] = "list";
  let id: string | undefined;
  let batch = false;
  let now = new Date();
  let decision: ParsedArgs["decision"];
  let disposition: ParsedArgs["disposition"];
  let reason: string | undefined;
  let by: string | undefined;
  let scope: DecideApprovalInput["scope"];
  let confirm: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--now") now = new Date(needValue(args, ++i, "--now"));
    else if (arg === "--json") json = true;
    else if (arg === "--batch") batch = true;
    else if (arg === "--reason") reason = needValue(args, ++i, "--reason");
    else if (arg === "--by") by = needValue(args, ++i, "--by");
    else if (arg === "--confirm") confirm = needValue(args, ++i, "--confirm");
    else if (arg === "--approve" || arg === "--deny") {
      if (decision !== undefined) throw new Error("approvals decide: choose only one decision");
      decision = arg === "--approve" ? "approved" : "denied";
    } else if (arg === "--scope") {
      const kind = needValue(args, ++i, "--scope");
      if (kind !== "ticket" && kind !== "app") {
        throw new Error('approvals decide: --scope must be "ticket" or "app"');
      }
      const path = args[i + 1];
      if (path !== undefined && !path.startsWith("--")) i += 1;
      scope = { kind, ...(path !== undefined && !path.startsWith("--") ? { pathContains: path } : {}) };
    } else if (arg === "--executed" || arg === "--failed" || arg === "--retry") {
      if (disposition !== undefined) throw new Error("approvals disposition: choose only one disposition");
      disposition = arg.slice(2) as ParsedArgs["disposition"];
    } else if (arg === "review") subcommand = "review";
    else if (arg === "decide") {
      subcommand = "decide";
      id = needValue(args, ++i, "decide");
    } else if (arg === "show") {
      subcommand = "show";
      id = needValue(args, ++i, "show");
    } else if (arg === "revoke") {
      subcommand = "revoke";
      id = needValue(args, ++i, "revoke");
    } else if (arg === "status") subcommand = "status";
    else if (arg === "disposition") {
      subcommand = "disposition";
      id = needValue(args, ++i, "disposition");
    } else if (arg === "list") subcommand = "list";
    else throw new Error(`approvals: unknown argument "${arg}"`);
  }

  return {
    subcommand,
    batch,
    json,
    ...definedProps({ id }),
    now,
    ...definedProps({ decision }),
    ...definedProps({ disposition }),
    ...definedProps({ reason }),
    ...definedProps({ by }),
    ...definedProps({ scope }),
    ...definedProps({ confirm }),
  };
}

/** `a` = approve single-use; `a ticket [path]` / `a app [path]` = approve
 *  with an A1 scope; `d` = deny (reason follows); anything else skips. */
function decisionFromAnswer(answer: string): {
  kind: "approve" | "deny" | "skip";
  scope?: DecideApprovalInput["scope"];
} {
  const parts = answer.trim().toLowerCase().split(/\s+/);
  const head = parts[0] ?? "";
  if (head === "d" || head === "deny") return { kind: "deny" };
  if (head !== "a" && head !== "approve") return { kind: "skip" };
  const kind = parts[1];
  if (kind === "ticket" || kind === "app") {
    return {
      kind: "approve",
      scope: { kind, ...definedProps({ pathContains: parts[2] }) },
    };
  }
  return { kind: "approve" };
}

async function reviewQueue(
  store: ApprovalStore,
  orgHome: string,
  stateHome: string,
  batch: boolean,
  by: string,
): Promise<number> {
  const pending = await store.listPending();
  if (pending.length === 0) {
    console.log("approvals: 0 pending");
    return 0;
  }
  // A3: batching groups the human's keystrokes, never the audit — each item
  // still gets its own decide() call and log rows.
  const groups: ApprovalItem[][] = batch ? groupByRuleAndApp(pending) : pending.map((item) => [item]);

  const rl = createInterface({ input, output });
  const ask = (prompt: string): Promise<string> => rl.question(prompt);
  const decidedBy = approvalDeciderFromIdentity(by);

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
          const decided = await store.decide(item.id, { decision: "denied", reason, decidedBy });
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
          await rearmTicket(orgHome, stateHome, decided);
        }
        continue;
      }
      const reason = (await ask("reason: ")).trim();
      for (const item of group) {
        // One wrong answer must not kill the review session: a scope request
        // on a never-scopeable rule throws — report it, leave the item
        // pending, and continue with the rest of the queue.
        try {
          const decided = await store.decide(item.id, {
            decision: "approved",
            reason,
            decidedBy,
            ...definedProps({ scope: decision.scope }),
          });
          console.log(
            `approved ${item.id}${decided.grantId ? ` grant=${decided.grantId}` : ""}` +
              (decision.scope !== undefined ? ` scope=${decision.scope.kind}` : ""),
          );
          await rearmTicket(orgHome, stateHome, decided);
        } catch (error) {
          console.log(
            `NOT decided ${item.id}: ${error instanceof Error ? error.message : String(error)} ` +
              `— still pending, review it again`,
          );
        }
      }
    }
  } finally {
    rl.close();
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

async function rearmTicket(orgHome: string, stateHome: string, item: ApprovalItem): Promise<void> {
  if (item.ticketRef === undefined || item.decision === undefined || item.decidedAt === undefined) return;
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
    const outcome = await continueAfterApproval({
      root: stateHome,
      app: item.app,
      issueNumber,
      approvalId: item.id,
      decision: item.decision,
      ...(item.decision === "denied" && item.reason !== undefined ? { reason: item.reason } : {}),
      decidedAt: item.decidedAt,
      // #244: a denied CRITICAL OPERATION is a suppression the turn's verdict
      // must report. A denied budget grant is a spend refusal and suppresses
      // nothing, so it deposits no record.
      ...(isBudgetEscalationRule(item.rule)
        ? {}
        : {
            suppression: {
              rule: item.rule,
              actionSha256: actionHash(item.action),
              tool: item.action.tool,
            },
          }),
      gh: new GhCliOps(app.repo),
    });
    console.log(
      outcome === "terminalized"
        ? `continued ${item.ticketRef}: ${item.decision}; no budget granted -> op:returned`
        : outcome === "unparked"
          ? `recorded ${item.ticketRef}: ${item.decision}; no turn was waiting, label unchanged`
          : `continued ${item.ticketRef}: ${item.decision}; exact session -> op:ready`,
    );
  } catch (error) {
    console.log(
      `re-arm failed (${error instanceof Error ? error.message.split("\n")[0] : String(error)}) — ` +
        `the durable decision is preserved; the next approvals/loop run repairs the label projection`,
    );
  }
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

function printExecutionTable(items: readonly ApprovalItem[], countLabel = "execution record(s)"): void {
  console.log("ID                       APP                  STATE       TRY ACTOR                    NEXT");
  for (const item of items) {
    console.log(
      [
        item.id.padEnd(24),
        item.app.padEnd(20),
        displayedLifecycleState(item).padEnd(11),
        String(item.execution?.attempts ?? 0).padStart(3),
        (item.execution?.actor ?? "-").slice(0, 24).padEnd(24),
        item.execution?.nextAction ?? "-",
      ].join(" "),
    );
    if (item.execution?.result !== undefined) console.log(`  result: ${item.execution.result}`);
    if (item.execution?.state === "approved" && item.grantId !== undefined) {
      // The operator approved this because they wanted it to happen, so the
      // first thing they are told must be how it happens (ISSUE-020). `revoke`
      // is the change-of-mind path, not the default next step.
      console.log(
        item.execution.nextAction === "dispatch"
          ? `  waiting for execution: run \`cormidia dispatch\` (grant ${item.grantId}; ` +
              `revoke with cormidia approvals revoke ${item.grantId} --confirm ${item.grantId})`
          : `  unused grant: ${item.grantId}; only the raising turn can consume it — ` +
              `revoke with cormidia approvals revoke ${item.grantId} --confirm ${item.grantId}`,
      );
    }
    if (item.execution?.failureCause !== undefined) console.log(`  cause: ${item.execution.failureCause}`);
    if (item.execution?.remoteRef !== undefined) console.log(`  remote: ${item.execution.remoteRef}`);
    if (item.execution?.attemptedAt !== undefined) console.log(`  attempted: ${item.execution.attemptedAt}`);
    if (item.execution?.finishedAt !== undefined) console.log(`  finished: ${item.execution.finishedAt}`);
  }
  console.log(`${items.length} ${countLabel}`);
}

function isOutstandingExecution(item: ApprovalItem): boolean {
  const execution = item.execution;
  if (execution === undefined || execution.state === "executed") return false;
  if (execution.state === "failed" && execution.nextAction === "none") return false;
  return true;
}

function approvalView(item: ApprovalItem): ApprovalItem & { lifecycleState: string } {
  return { ...item, lifecycleState: displayedLifecycleState(item) };
}

function displayedLifecycleState(item: ApprovalItem): string {
  return item.status === "expired" ? "expired" : approvalLifecycleState(item);
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
    `classification: ${item.classification === undefined ? "(legacy/unrecorded)" : JSON.stringify(item.classification)}`,
    `execution: ${item.execution === undefined ? "(not approved/untracked)" : JSON.stringify(item.execution)}`,
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

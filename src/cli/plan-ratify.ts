// `operon plan ratify-ticket-budget` — the human-gated verb the bootstrap
// ticket-budget refusal has always named but never provided (ENH-011).
//
// It follows the repo's established shape for a human decision (`app promote`,
// `loop rearm`, `scheduler install`, `app reset`): preview by default, explicit
// `--execute`, and an exact confirmation token that repeats the thing being
// decided. It is deliberately NOT a `--skip-budget` flag: it names one exact
// already-refused decomposition, records who accepted it and why, and then
// publishes that decomposition — the work the planner was already paid for —
// with no further provider turn.

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { GhCliOps, type GhOps } from "../loop/github.js";
import type { OperonHomes } from "../org/home.js";
import { stableJson } from "../org/lifecycle.js";
import {
  executeTicketBudgetRatification,
  planTicketBudgetRatification,
  type TicketBudgetRatificationInput,
  type TicketBudgetRatificationPlan,
} from "../org/ticket-budget-ratification.js";

export interface PlanRatifyIo {
  interactive: boolean;
  ask(prompt: string): Promise<string>;
  out(line: string): void;
}

export interface PlanRatifyDependencies {
  ghFor?: (repo: string) => GhOps;
}

export async function cmdPlanRatifyTicketBudget(
  args: string[],
  homes: OperonHomes,
  io: PlanRatifyIo = defaultIo(),
  dependencies: PlanRatifyDependencies = {},
): Promise<number> {
  const parsed = parsePlanRatifyArgs(args);
  const app = homes.appsFile.apps.find((entry) => entry.name === parsed.app);
  if (app === undefined) {
    throw new Error(`plan ratify-ticket-budget: unknown app "${parsed.app}" in apps.yaml`);
  }
  const input: TicketBudgetRatificationInput = {
    stateHome: homes.stateHome,
    app: parsed.app,
    decompositionId: parsed.decomposition,
    actor: parsed.actor,
    reason: parsed.reason,
    fromBudget: parsed.fromBudget,
    toBudget: parsed.toBudget,
    publish: !parsed.noPublish,
    gh: dependencies.ghFor?.(app.repo) ?? new GhCliOps(app.repo),
  };
  const plan = await planTicketBudgetRatification(input);

  if (!parsed.execute) {
    if (parsed.json) {
      console.log(stableJson({
        schema_version: 1,
        kind: "plan-ticket-budget-ratification-preview",
        ...previewJson(plan),
      }).trimEnd());
      return 0;
    }
    printPreview(io, plan);
    io.out(
      "No changes made to the ticket budget or to GitHub (dispatched CLI: invocation audit only). " +
        `Execute with --execute --confirm ${plan.confirmation}.`,
    );
    return 0;
  }

  if (plan.replay) {
    if (parsed.json) {
      console.log(stableJson({
        schema_version: 1,
        kind: "plan-ticket-budget-ratification-result",
        status: "already_ratified",
        ...previewJson(plan),
        published: plan.priorRatification?.publication.published ?? [],
      }).trimEnd());
      return 0;
    }
    io.out(`Already ratified ${plan.confirmation}; no changes made.`);
    return 0;
  }

  let confirm = parsed.confirm;
  if (confirm === undefined && io.interactive) {
    confirm = (await io.ask(`Type ${plan.confirmation} to execute: `)).trim();
  }
  if (confirm !== plan.confirmation) {
    throw new Error(`plan ratify-ticket-budget: --confirm must exactly match ${plan.confirmation}`);
  }

  const result = await executeTicketBudgetRatification(input);
  if (parsed.json) {
    console.log(stableJson({
      schema_version: 1,
      kind: "plan-ticket-budget-ratification-result",
      status: result.status,
      ...previewJson(plan),
      publication: result.record.publication,
      ...(result.note === undefined ? {} : { note: result.note }),
    }).trimEnd());
    return 0;
  }
  io.out(
    `Ratified ${plan.confirmation}: ${plan.stage} ticket budget ` +
      `${plan.stageTicketBudget}->${plan.ratifiedTicketCount} by ${plan.actor}; reason=${plan.reason}`,
  );
  io.out(
    result.record.publication.status === "published"
      ? `Published ${result.published.length} ticket(s): ` +
        result.published
          .map((ticket) => `#${ticket.issueNumber}${ticket.ready ? " (ready)" : ""}`)
          .join(", ")
      : "Publication skipped (--no-publish); the ratified decomposition is recorded and can be published later.",
  );
  if (result.note !== undefined) io.out(`note: ${result.note}`);
  return 0;
}

function previewJson(plan: TicketBudgetRatificationPlan): Record<string, unknown> {
  return {
    app: plan.app,
    goal: plan.goal,
    decomposition_id: plan.decompositionId,
    stage: plan.stage,
    stage_ticket_budget: plan.stageTicketBudget,
    ticket_count: plan.ticketCount,
    ratified_ticket_count: plan.ratifiedTicketCount,
    actor: plan.actor,
    reason: plan.reason,
    confirmation: plan.confirmation,
    publish: plan.publish,
    replay: plan.replay,
    provenance: plan.provenance,
    tickets: plan.tickets,
  };
}

function printPreview(io: PlanRatifyIo, plan: TicketBudgetRatificationPlan): void {
  io.out(
    `PREVIEW ${plan.confirmation}: ${plan.stage} ticket budget ` +
      `${plan.stageTicketBudget}->${plan.ratifiedTicketCount} for ${plan.ticketCount} preserved ticket(s); ` +
      `actor=${plan.actor}; reason=${plan.reason}`,
  );
  io.out(`goal: ${plan.goal}`);
  for (const ticket of plan.tickets) {
    io.out(
      `  ${ticket.index}: [${ticket.tier}/${ticket.priority}] ${ticket.title}` +
        (ticket.ready ? " (ready)" : ""),
    );
  }
  io.out(
    plan.publish
      ? "Executing records the decision and publishes exactly these tickets — no provider turn, no replan."
      : "Executing records the decision only (--no-publish).",
  );
}

export interface ParsedPlanRatifyArgs {
  app: string;
  decomposition: string;
  actor: string;
  reason: string;
  fromBudget: number;
  toBudget: number;
  execute: boolean;
  confirm?: string;
  noPublish: boolean;
  json: boolean;
}

/** Pure parser shared by the executable command and its tests. It resolves no
 * homes, reads no state, and constructs no runtime. */
export function parsePlanRatifyArgs(args: string[]): ParsedPlanRatifyArgs {
  let app: string | undefined;
  let decomposition: string | undefined;
  let actor: string | undefined;
  let reason: string | undefined;
  let fromBudget: number | undefined;
  let toBudget: number | undefined;
  let execute = false;
  let confirm: string | undefined;
  let noPublish = false;
  let json = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--app") app = needValue(args, ++i, arg);
    else if (arg === "--decomposition") decomposition = needValue(args, ++i, arg);
    else if (arg === "--actor") actor = needValue(args, ++i, arg);
    else if (arg === "--reason") reason = needValue(args, ++i, arg);
    else if (arg === "--from-budget") fromBudget = integerValue(needValue(args, ++i, arg), arg);
    else if (arg === "--to-budget") toBudget = integerValue(needValue(args, ++i, arg), arg);
    else if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false;
    else if (arg === "--no-publish") noPublish = true;
    else if (arg === "--json") json = true;
    else if (arg === "--confirm") confirm = needValue(args, ++i, arg);
    else throw new Error(`plan ratify-ticket-budget: unknown flag "${arg}"`);
  }

  if (app === undefined) throw new Error("plan ratify-ticket-budget: --app is required");
  if (decomposition === undefined) {
    throw new Error(
      "plan ratify-ticket-budget: --decomposition <id> is required — ratification names one exact " +
        "preserved decomposition. `operon plan <app> --dry-run` lists the ones awaiting a decision.",
    );
  }
  if (actor === undefined) throw new Error("plan ratify-ticket-budget: --actor is required");
  if (reason === undefined) throw new Error("plan ratify-ticket-budget: --reason is required");
  if (fromBudget === undefined) throw new Error("plan ratify-ticket-budget: --from-budget is required");
  if (toBudget === undefined) throw new Error("plan ratify-ticket-budget: --to-budget is required");

  return {
    app,
    decomposition,
    actor,
    reason,
    fromBudget,
    toBudget,
    execute,
    noPublish,
    json,
    ...(confirm === undefined ? {} : { confirm }),
  };
}

function defaultIo(): PlanRatifyIo {
  return {
    interactive: stdin.isTTY === true,
    ask: async (prompt) => {
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        return await rl.question(prompt);
      } finally {
        rl.close();
      }
    },
    out: (line) => console.log(line),
  };
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`plan ratify-ticket-budget: ${flag} requires a value`);
  }
  return value;
}

function integerValue(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`plan ratify-ticket-budget: ${flag} must be a non-negative integer`);
  }
  return parsed;
}

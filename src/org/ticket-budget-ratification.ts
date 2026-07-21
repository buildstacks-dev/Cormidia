// The missing verb behind the bootstrap ticket-budget refusal (ENH-011).
//
// `validatePlan` has always refused an oversized decomposition with "more
// requires explicit human ratification, not a bigger plan" — and no CLI
// surface performed that ratification. The only lever that worked was
// `--stage growth`, which raises the budget by asserting that a one-commit,
// zero-tag repository is a growing product: it defeats the safety decision by
// falsifying the input that drives it, and poisons every downstream consumer
// of stage. The cheap action was the dishonest one.
//
// This module supplies the honest one, in two durable halves:
//
//   1. The REFUSED DECOMPOSITION. A budget-only refusal used to discard the
//      work the planner already paid for, so ratifying meant paying to
//      regenerate a different plan. The exact decomposition is now persisted
//      under `planning/<app>/refused-decompositions/<id>.json`, keyed by its
//      own content digest, together with the provenance needed to publish it
//      later with zero further provider turns.
//
//   2. The RATIFICATION. An attributable human decision — who, when, which
//      stage, which exact ticket count, against which exact decomposition —
//      written under `lifecycle/apps/<app>/ticket-budget-ratifications/`,
//      beside the app config-ratification journal that records the same class
//      of decision. Like that journal it is written intent-first so a crash
//      between the record and the GitHub publication is recoverable, and like
//      every other lifecycle decision it never expires.
//
// The ratification is bound to one decomposition digest, so it can never
// become a standing bypass: a later plan for the same goal has a different
// digest and is refused again. Raising the budget in general still requires
// the repository to actually be more mature.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { GhOps } from "../loop/github.js";
import {
  finalizePlanForPublication,
  isTicketBudgetOnlyRefusal,
  publishPlanProjection,
  TICKET_BUDGETS,
  ticketPlanDigest,
  validatePlan,
  type PlanningSourceTicketEvidence,
  type PlanProvenance,
  type ProjectStage,
  type PublishedTicket,
  type TicketBudgetRatification,
  type TicketPlan,
} from "../loop/plan-tickets.js";
import {
  readPublishedTicketsRecord,
  writePublishedTicketsRecord,
} from "../loop/plan-publication-record.js";
import { writeFileAtomic } from "./atomic.js";
import {
  acquireLifecycleOperationLock,
  assertRegularFile,
  assertSafeSegment,
  emitLifecycleStep,
  sha256,
  stableJson,
  writeLifecycleFileAtomic,
} from "./lifecycle.js";

export const TICKET_BUDGET_RATIFICATION_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Durable records
// ---------------------------------------------------------------------------

export interface RefusedDecompositionProvenance {
  episode_id: string;
  run_id: string;
  trace_id: string;
}

/** The decomposition a budget refusal would otherwise have thrown away. */
export interface RefusedDecompositionRecord {
  schema_version: typeof TICKET_BUDGET_RATIFICATION_SCHEMA_VERSION;
  kind: "refused-ticket-decomposition";
  /** `ticketPlanDigest(plan)` — the identity a ratification binds to. */
  decomposition_id: string;
  app: string;
  goal: string;
  stage: ProjectStage;
  stage_ticket_budget: number;
  ticket_count: number;
  refused_at: string;
  problems: string[];
  provenance: RefusedDecompositionProvenance;
  planning_sources?: PlanningSourceTicketEvidence;
  plan: TicketPlan;
}

/** One attributable human decision to admit one oversized decomposition. */
export interface TicketBudgetRatificationRecord {
  schema_version: typeof TICKET_BUDGET_RATIFICATION_SCHEMA_VERSION;
  kind: "ticket-budget-ratification";
  ratification_id: string;
  /** `intent` is written before publication; `complete` after. */
  phase: "intent" | "complete";
  app: string;
  goal: string;
  stage: ProjectStage;
  decomposition_id: string;
  stage_ticket_budget: number;
  ratified_ticket_count: number;
  actor: string;
  reason: string;
  ratified_at: string;
  provenance: RefusedDecompositionProvenance;
  /** Exactly what the human accepted — self-contained evidence, so the
   *  refused-decomposition record it came from is free to age out. */
  plan: TicketPlan;
  publication: {
    status: "skipped" | "published";
    published: Array<{
      index: number;
      issue_number: number;
      title: string;
      ready: boolean;
      labels: string[];
    }>;
  };
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** High-churn, provider-derived evidence: swept on its own retention window
 *  (docs/scheduler.md → State retention). */
export function refusedDecompositionDir(stateHome: string, app: string): string {
  assertSafeSegment(app, "refused decomposition");
  return join(resolve(stateHome), "planning", app, "refused-decompositions");
}

export function refusedDecompositionPath(stateHome: string, app: string, id: string): string {
  assertSafeSegment(id, "refused decomposition id");
  return join(refusedDecompositionDir(stateHome, app), `${id}.json`);
}

/** A human decision, beside the app config-ratification journal: never swept. */
export function ticketBudgetRatificationDir(stateHome: string, app: string): string {
  assertSafeSegment(app, "ticket-budget ratification");
  return join(resolve(stateHome), "lifecycle", "apps", app, "ticket-budget-ratifications");
}

export function ticketBudgetRatificationPath(stateHome: string, app: string, id: string): string {
  assertSafeSegment(id, "ticket-budget ratification id");
  return join(ticketBudgetRatificationDir(stateHome, app), `${id}.json`);
}

/** The exact confirmation token `--confirm` must repeat. Naming the exact
 *  decomposition (not just the app) is the point: a human confirming a budget
 *  raise must be looking at the decomposition it applies to. */
export function ticketBudgetConfirmation(app: string, decompositionId: string): string {
  return `${app}@${decompositionId}`;
}

// ---------------------------------------------------------------------------
// Refused decompositions
// ---------------------------------------------------------------------------

export async function recordRefusedDecomposition(input: {
  stateHome: string;
  app: string;
  goal: string;
  stage: ProjectStage;
  plan: TicketPlan;
  problems: readonly string[];
  provenance: RefusedDecompositionProvenance;
  planningSources?: PlanningSourceTicketEvidence;
  now: Date;
}): Promise<RefusedDecompositionRecord> {
  if (!isTicketBudgetOnlyRefusal(input.plan)) {
    throw new Error(
      "refused decomposition: only a decomposition whose sole refusal is the stage ticket budget " +
        "is preserved for ratification",
    );
  }
  const record: RefusedDecompositionRecord = {
    schema_version: TICKET_BUDGET_RATIFICATION_SCHEMA_VERSION,
    kind: "refused-ticket-decomposition",
    decomposition_id: ticketPlanDigest(input.plan),
    app: input.app,
    goal: input.goal,
    stage: input.plan.stage,
    stage_ticket_budget: TICKET_BUDGETS[input.plan.stage],
    ticket_count: input.plan.tickets.length,
    refused_at: input.now.toISOString(),
    problems: [...input.problems],
    provenance: { ...input.provenance },
    ...(input.planningSources === undefined ? {} : { planning_sources: input.planningSources }),
    plan: structuredClone(input.plan),
  };
  const path = refusedDecompositionPath(input.stateHome, input.app, record.decomposition_id);
  await mkdir(refusedDecompositionDir(input.stateHome, input.app), { recursive: true });
  // Replaying the same refusal must not churn `refused_at`: the first record
  // is the one the operator was shown and the one retention ages by.
  if (existsSync(path)) {
    const existing = await readRefusedDecomposition(input.stateHome, input.app, record.decomposition_id);
    if (existing !== undefined) return existing;
  }
  await writeFileAtomic(path, stableJson(record));
  return record;
}

export async function readRefusedDecomposition(
  stateHome: string,
  app: string,
  decompositionId: string,
): Promise<RefusedDecompositionRecord | undefined> {
  const path = refusedDecompositionPath(stateHome, app, decompositionId);
  if (!existsSync(path)) return undefined;
  await assertRegularFile(path, "refused-decomposition record");
  const record = parseRefusedDecomposition(await readFile(path, "utf8"), path);
  if (record.app !== app || record.decomposition_id !== decompositionId) {
    throw new Error(`refused-decomposition record identity mismatch ${path}`);
  }
  return record;
}

/** Newest first. Used by the token-free planning preview so a pending
 *  ratification is visible before anything is spent. */
export async function listRefusedDecompositions(
  stateHome: string,
  app: string,
): Promise<RefusedDecompositionRecord[]> {
  let dir: string;
  try {
    dir = refusedDecompositionDir(stateHome, app);
  } catch {
    // An app whose name is not a safe path segment can never have had a
    // record written for it. The token-free preview must not fail over that.
    return [];
  }
  if (!existsSync(dir)) return [];
  const records: RefusedDecompositionRecord[] = [];
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".json")).sort()) {
    const path = join(dir, name);
    try {
      await assertRegularFile(path, "refused-decomposition record");
      records.push(parseRefusedDecomposition(await readFile(path, "utf8"), path));
    } catch {
      // A torn or foreign file must not make the token-free preview fail; it
      // is simply not offered for ratification (and the read path above still
      // surfaces the error when it is named explicitly).
    }
  }
  return records.sort((left, right) => right.refused_at.localeCompare(left.refused_at));
}

function parseRefusedDecomposition(text: string, path: string): RefusedDecompositionRecord {
  const value = parseJsonRecord(text, path, "refused-decomposition record");
  const plan = value["plan"];
  if (
    value["schema_version"] !== TICKET_BUDGET_RATIFICATION_SCHEMA_VERSION ||
    value["kind"] !== "refused-ticket-decomposition" ||
    typeof value["decomposition_id"] !== "string" ||
    typeof value["app"] !== "string" ||
    typeof value["goal"] !== "string" ||
    !isProjectStage(value["stage"]) ||
    typeof value["stage_ticket_budget"] !== "number" ||
    typeof value["ticket_count"] !== "number" ||
    typeof value["refused_at"] !== "string" ||
    !Array.isArray(value["problems"]) ||
    !isProvenance(value["provenance"]) ||
    !isTicketPlan(plan)
  ) {
    throw new Error(`corrupt refused-decomposition record ${path}`);
  }
  if (ticketPlanDigest(plan) !== value["decomposition_id"]) {
    throw new Error(`refused-decomposition record ${path} does not match its own decomposition digest`);
  }
  return value as unknown as RefusedDecompositionRecord;
}

// ---------------------------------------------------------------------------
// Ratification: preview + execute
// ---------------------------------------------------------------------------

export interface TicketBudgetRatificationInput {
  stateHome: string;
  app: string;
  decompositionId: string;
  actor: string;
  reason: string;
  /** The current stage budget the operator believes they are raising. */
  fromBudget: number;
  /** The exact ticket count they accept. */
  toBudget: number;
  publish?: boolean;
  gh?: GhOps;
  now?: Date;
}

export interface TicketBudgetRatificationPlan {
  app: string;
  goal: string;
  decompositionId: string;
  stage: ProjectStage;
  stageTicketBudget: number;
  ticketCount: number;
  ratifiedTicketCount: number;
  actor: string;
  reason: string;
  confirmation: string;
  publish: boolean;
  /** True when this exact decomposition is already ratified: the execute path
   *  is then a no-op that reports the prior decision. */
  replay: boolean;
  priorRatification?: TicketBudgetRatificationRecord;
  provenance: RefusedDecompositionProvenance;
  tickets: Array<{
    index: number;
    title: string;
    tier: string;
    priority: string;
    ready: boolean;
  }>;
}

export interface TicketBudgetRatificationResult {
  status: "ratified" | "already_ratified";
  record: TicketBudgetRatificationRecord;
  published: PublishedTicket[];
  /** Non-fatal note when the local published-tickets record could not be
   *  written; GitHub remains the authoritative half of that edge. */
  note?: string;
}

/** Build the complete non-mutating ratification plan. Nothing is written and
 *  no provider is constructed; the tickets shown are exactly the ones a later
 *  `--execute` would publish. */
export async function planTicketBudgetRatification(
  input: TicketBudgetRatificationInput,
): Promise<TicketBudgetRatificationPlan> {
  const actor = input.actor.trim();
  const reason = input.reason.trim();
  if (actor.length === 0) throw new Error("plan ratify-ticket-budget: --actor is required");
  if (reason.length === 0) throw new Error("plan ratify-ticket-budget: --reason is required");
  const refused = await readRefusedDecomposition(input.stateHome, input.app, input.decompositionId);
  if (refused === undefined) {
    throw new Error(
      `plan ratify-ticket-budget: no refused decomposition ${input.decompositionId} is preserved for ` +
        `${input.app}. Ratification never invents a plan: run \`operon plan ${input.app} --dry-run\` to ` +
        "see which decompositions are awaiting a decision.",
    );
  }
  const stageBudget = TICKET_BUDGETS[refused.stage];
  if (input.fromBudget !== stageBudget) {
    throw new Error(
      `plan ratify-ticket-budget: stale --from-budget ${input.fromBudget}; the ${refused.stage} ticket ` +
        `budget is ${stageBudget}`,
    );
  }
  if (input.toBudget !== refused.ticket_count) {
    throw new Error(
      `plan ratify-ticket-budget: --to-budget must be exactly ${refused.ticket_count} — the ticket count of ` +
        `the decomposition being ratified. Ratification accepts one reviewed decomposition; it does not ` +
        "raise the budget for plans nobody has read.",
    );
  }
  if (input.toBudget <= input.fromBudget) {
    throw new Error(
      `plan ratify-ticket-budget: --to-budget ${input.toBudget} does not exceed the ${refused.stage} budget ` +
        `of ${input.fromBudget}; nothing needs ratifying`,
    );
  }
  // Fail closed against a record whose plan drifted into a second problem.
  if (!isTicketBudgetOnlyRefusal(refused.plan)) {
    const problems = validatePlan(refused.plan).problems.join("; ");
    throw new Error(
      `plan ratify-ticket-budget: decomposition ${input.decompositionId} is not refused for the ticket ` +
        `budget alone and cannot be ratified: ${problems}`,
    );
  }
  const prior = await readTicketBudgetRatification(input.stateHome, input.app, input.decompositionId);
  return {
    app: input.app,
    goal: refused.goal,
    decompositionId: refused.decomposition_id,
    stage: refused.stage,
    stageTicketBudget: stageBudget,
    ticketCount: refused.ticket_count,
    ratifiedTicketCount: input.toBudget,
    actor,
    reason,
    confirmation: ticketBudgetConfirmation(input.app, refused.decomposition_id),
    publish: input.publish !== false,
    replay: prior !== undefined && prior.phase === "complete",
    ...(prior === undefined ? {} : { priorRatification: prior }),
    provenance: refused.provenance,
    tickets: refused.plan.tickets.map((ticket, index) => ({
      index,
      title: ticket.title,
      tier: ticket.tier,
      priority: ticket.priority,
      ready: ticket.dependsOn.length === 0,
    })),
  };
}

/** Record the decision, then publish the already-paid-for decomposition. No
 *  provider turn is constructed: publication is the ordinary deterministic
 *  orchestrator work `plan --auto` would have done had the budget allowed. */
export async function executeTicketBudgetRatification(
  input: TicketBudgetRatificationInput,
): Promise<TicketBudgetRatificationResult> {
  const now = input.now ?? new Date();
  const plan = await planTicketBudgetRatification(input);
  const release = await acquireLifecycleOperationLock(
    input.stateHome,
    `plan-ratify-${input.app}`,
    "plan ratify-ticket-budget",
  );
  try {
    const refused = await readRefusedDecomposition(input.stateHome, input.app, plan.decompositionId);
    if (refused === undefined) {
      throw new Error(
        `plan ratify-ticket-budget: refused decomposition ${plan.decompositionId} vanished before execution`,
      );
    }
    const existing = await readTicketBudgetRatification(input.stateHome, input.app, plan.decompositionId);
    if (existing?.phase === "complete") {
      return {
        status: "already_ratified",
        record: existing,
        published: existing.publication.published.map(publishedTicketFromRecord),
      };
    }
    const ratifiedAt = existing?.ratified_at ?? now.toISOString();
    const record: TicketBudgetRatificationRecord = existing ?? {
      schema_version: TICKET_BUDGET_RATIFICATION_SCHEMA_VERSION,
      kind: "ticket-budget-ratification",
      ratification_id: plan.decompositionId,
      phase: "intent",
      app: input.app,
      goal: refused.goal,
      stage: refused.stage,
      decomposition_id: plan.decompositionId,
      stage_ticket_budget: plan.stageTicketBudget,
      ratified_ticket_count: plan.ratifiedTicketCount,
      actor: plan.actor,
      reason: plan.reason,
      ratified_at: ratifiedAt,
      provenance: refused.provenance,
      plan: structuredClone(refused.plan),
      publication: { status: "skipped", published: [] },
    };
    const path = ticketBudgetRatificationPath(input.stateHome, input.app, plan.decompositionId);
    if (existing === undefined) await writeLifecycleFileAtomic(path, stableJson(record));

    const ratification: TicketBudgetRatification = {
      stage: record.stage,
      ratifiedTicketCount: record.ratified_ticket_count,
      decompositionId: record.decomposition_id,
      actor: record.actor,
      reason: record.reason,
      ratifiedAt: record.ratified_at,
    };
    // The ratification is re-validated against the plan it names, so a
    // hand-edited record can never widen what publication accepts.
    const projection = finalizePlanForPublication(record.plan, ratification);

    let published: PublishedTicket[] = [];
    let note: string | undefined;
    if (plan.publish) {
      // Same idempotency guard runAutoPlan uses: a durable published-tickets
      // record for this run means publication already happened, so a retry
      // reports it instead of creating a second set of issues.
      const prior = await readPublishedTicketsRecord(
        input.stateHome,
        input.app,
        record.provenance.run_id,
      );
      if (prior !== undefined) {
        published = prior.published.map((ticket) => ({
          index: ticket.index,
          issueNumber: ticket.issue_number,
          title: ticket.title,
          ready: ticket.ready,
          labels: [...ticket.labels],
        }));
      } else {
        const gh = input.gh;
        if (gh === undefined) {
          throw new Error("plan ratify-ticket-budget: publication requires a GitHub operations client");
        }
        const provenance: PlanProvenance = {
          episodeId: record.provenance.episode_id,
          runId: record.provenance.run_id,
          traceId: record.provenance.trace_id,
        };
        ({ published } = await publishPlanProjection(
          gh,
          projection,
          refused.planning_sources,
          provenance,
        ));
        try {
          await writePublishedTicketsRecord(input.stateHome, input.app, provenance, published, now);
        } catch (error) {
          note = `published-tickets record write failed: ${message(error)}`;
        }
      }
    }

    const complete: TicketBudgetRatificationRecord = {
      ...record,
      phase: "complete",
      publication: {
        status: plan.publish ? "published" : "skipped",
        published: published.map((ticket) => ({
          index: ticket.index,
          issue_number: ticket.issueNumber,
          title: ticket.title,
          ready: ticket.ready,
          labels: [...ticket.labels],
        })),
      },
    };
    await writeLifecycleFileAtomic(path, stableJson(complete));
    await emitLifecycleStep({
      stateHome: input.stateHome,
      app: input.app,
      operation: "plan ratify-ticket-budget",
      inputFingerprint: sha256(stableJson({
        app: input.app,
        decomposition: complete.decomposition_id,
        stage: complete.stage,
        from: complete.stage_ticket_budget,
        to: complete.ratified_ticket_count,
        actor: complete.actor,
      })),
      status: "completed",
      reason:
        `${complete.actor} ratified ${complete.stage} ticket budget ` +
        `${complete.stage_ticket_budget}->${complete.ratified_ticket_count} for decomposition ` +
        `${complete.decomposition_id}: ${complete.reason}`,
      startedAt: now,
      finishedAt: now,
    });
    return {
      status: "ratified",
      record: complete,
      published,
      ...(note === undefined ? {} : { note }),
    };
  } finally {
    await release();
  }
}

export async function readTicketBudgetRatification(
  stateHome: string,
  app: string,
  decompositionId: string,
): Promise<TicketBudgetRatificationRecord | undefined> {
  const path = ticketBudgetRatificationPath(stateHome, app, decompositionId);
  if (!existsSync(path)) return undefined;
  await assertRegularFile(path, "ticket-budget ratification record");
  const value = parseJsonRecord(await readFile(path, "utf8"), path, "ticket-budget ratification record");
  const plan = value["plan"];
  const publication = value["publication"];
  if (
    value["schema_version"] !== TICKET_BUDGET_RATIFICATION_SCHEMA_VERSION ||
    value["kind"] !== "ticket-budget-ratification" ||
    typeof value["ratification_id"] !== "string" ||
    (value["phase"] !== "intent" && value["phase"] !== "complete") ||
    value["app"] !== app ||
    value["decomposition_id"] !== decompositionId ||
    !isProjectStage(value["stage"]) ||
    typeof value["stage_ticket_budget"] !== "number" ||
    typeof value["ratified_ticket_count"] !== "number" ||
    typeof value["actor"] !== "string" ||
    typeof value["reason"] !== "string" ||
    typeof value["ratified_at"] !== "string" ||
    !isProvenance(value["provenance"]) ||
    !isTicketPlan(plan) ||
    publication === null ||
    typeof publication !== "object" ||
    Array.isArray(publication) ||
    !Array.isArray((publication as Record<string, unknown>)["published"])
  ) {
    throw new Error(`corrupt ticket-budget ratification record ${path}`);
  }
  if (ticketPlanDigest(plan) !== decompositionId) {
    throw new Error(`ticket-budget ratification record ${path} does not match its own decomposition digest`);
  }
  return value as unknown as TicketBudgetRatificationRecord;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function publishedTicketFromRecord(
  ticket: TicketBudgetRatificationRecord["publication"]["published"][number],
): PublishedTicket {
  return {
    index: ticket.index,
    issueNumber: ticket.issue_number,
    title: ticket.title,
    ready: ticket.ready,
    labels: [...ticket.labels],
  };
}

function parseJsonRecord(text: string, path: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`corrupt ${label} ${path}: ${message(error)}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`corrupt ${label} ${path}`);
  }
  return value as Record<string, unknown>;
}

function isProjectStage(value: unknown): value is ProjectStage {
  return value === "bootstrap" || value === "growth" || value === "mature";
}

function isProvenance(value: unknown): value is RefusedDecompositionProvenance {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record["episode_id"] === "string" &&
    typeof record["run_id"] === "string" &&
    typeof record["trace_id"] === "string";
}

function isTicketPlan(value: unknown): value is TicketPlan {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isProjectStage(record["stage"]) &&
    typeof record["ticketCountRationale"] === "string" &&
    typeof record["releaseDisposition"] === "string" &&
    typeof record["releaseKind"] === "string" &&
    Array.isArray(record["tickets"]) &&
    record["tickets"].every((ticket) =>
      ticket !== null && typeof ticket === "object" && !Array.isArray(ticket) &&
      typeof (ticket as Record<string, unknown>)["title"] === "string" &&
      Array.isArray((ticket as Record<string, unknown>)["dependsOn"]));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The exact command the refusal names, ready to paste. */
export function ratifyTicketBudgetCommand(input: {
  app: string;
  decompositionId: string;
  stageBudget: number;
  ticketCount: number;
}): string {
  return (
    `operon plan ratify-ticket-budget --app ${shellWord(input.app)} ` +
    `--decomposition ${input.decompositionId} --actor <identity> --reason "<why>" ` +
    `--from-budget ${input.stageBudget} --to-budget ${input.ticketCount} ` +
    `--execute --confirm ${shellWord(ticketBudgetConfirmation(input.app, input.decompositionId))}`
  );
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9._#@/-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

// The bounded publication transaction over the planning ledger (F-PT-039).
//
// Unchanged in substance from the retired coverage publisher: prove which prior
// issues are genuinely delivered, prepare a bounded batch durably, publish, then
// complete. Only the record underneath changed — source-section coverage is gone,
// so a batch no longer carries per-ticket source manifests. What a ticket says
// about its sources now comes from OBSERVED reads (INV-017), bound to the ledger
// by the turn that authored the plan rather than supplied per publication.

import type { GhIssue, GhOps } from "../loop/github.js";
import { GhCliOps } from "../loop/github.js";
import { branchNameForIssue } from "../loop/loop.js";
import { readPublishedTicketsRecord, writePublishedTicketsRecord } from "../loop/plan-publication-record.js";
import {
  finalizePlanForPublication,
  publishPlanProjection,
  type FinalPlanProjection,
  type PublishedTicket,
  type TicketPlan,
} from "../loop/plan-tickets.js";
import { toErrorMessage } from "../runtime/error-message.js";
import type { AppEntry } from "./apps.js";
import type { PlanningPublicationLedger } from "./planning-publication-ledger.js";
import { completePlanningPublication, preparePlanningPublication } from "./planning-publication-operations.js";

export async function publishPlanningLedger(input: {
  stateHome: string;
  app: AppEntry;
  gh?: GhOps;
  ledger: PlanningPublicationLedger;
  cap: number;
  clock: () => Date;
  /** Revalidate mutable human-ratified inputs immediately before the first issue
   * mutation. Prepared-transaction recovery may omit this after the original
   * caller already crossed that authorization seam. */
  beforePublish?: (plan: TicketPlan) => void | Promise<void>;
  persistRoadmap: (input: { gh: GhOps; plan: TicketPlan; published: PublishedTicket[]; now: Date }) => Promise<void>;
}): Promise<{
  ledger: PlanningPublicationLedger;
  projection: FinalPlanProjection;
  published: PublishedTicket[];
  summary: string;
}> {
  const gh = input.gh ?? new GhCliOps(input.app.repo);
  const issues = await gh.listIssues({ state: "all", limit: 10_000 });
  const delivered = await proveDeliveredIssues(gh, issues, input.ledger);
  for (const ticket of input.ledger.tickets) {
    if (ticket.issue_number !== null && delivered.has(ticket.issue_number)) ticket.state = "delivered";
  }
  const prepared = await preparePlanningPublication({
    root: input.stateHome,
    app: input.app.name,
    scopeId: input.ledger.scope_id,
    cap: input.cap,
    now: input.clock(),
  });
  let ledger = prepared.ledger;
  const deliveredIndexes = new Set(
    ledger.tickets.filter((ticket) => ticket.state === "delivered").map((ticket) => ticket.plan_index),
  );
  const batch = ledger.publication_batches.find((candidate) => candidate.status === "prepared");
  const projection = finalizePlanForPublication(ledger.plan, undefined, {
    indexes: prepared.indexes,
    publicationCap: batch?.admission_cap ?? input.cap,
    deliveredIndexes,
  });
  if (prepared.indexes.length === 0) {
    return { ledger, projection, published: [], summary: "No admissible tickets remain in this publication batch." };
  }
  if (batch === undefined) throw new Error("prepared planning publication batch disappeared");
  const knownIssueNumbers = new Map<number, number>();
  for (const ticket of ledger.tickets) {
    if (ticket.issue_number !== null) knownIssueNumbers.set(ticket.plan_index, ticket.issue_number);
  }
  const activeTicketIndexes = new Set(
    ledger.tickets.filter((ticket) => ticket.state !== "superseded").map((ticket) => ticket.plan_index),
  );
  await input.beforePublish?.(ledger.plan);
  const { published } = await publishPlanProjection(
    gh,
    projection,
    ledger.source_evidence ?? undefined,
    batch.provenance,
    knownIssueNumbers,
    activeTicketIndexes,
  );
  const prior = await readPublishedTicketsRecord(input.stateHome, input.app.name, batch.provenance.runId);
  const cumulative = mergePublished(prior?.published ?? [], published);
  let recordNote = "";
  try {
    await writePublishedTicketsRecord(input.stateHome, input.app.name, batch.provenance, cumulative, input.clock());
  } catch (error) {
    recordNote = `; published-tickets record write failed: ${toErrorMessage(error)}`;
  }
  await input.persistRoadmap({ gh, plan: ledger.plan, published: cumulative, now: input.clock() });
  ledger = await completePlanningPublication({
    root: input.stateHome,
    app: input.app.name,
    scopeId: ledger.scope_id,
    published,
    now: input.clock(),
  });
  return {
    ledger,
    projection,
    published,
    summary:
      `Published bounded batch ${published.map((ticket) => `#${ticket.issueNumber}`).join(", ")}; ` +
      `${ledger.tickets.filter((ticket) => ticket.state === "planned").length} planned ticket(s) remain${recordNote}`,
  };
}

export function publishedFromLedger(ledger: PlanningPublicationLedger): PublishedTicket[] {
  return ledger.tickets.flatMap((ticket) => {
    const planned = ledger.plan.tickets[ticket.plan_index];
    if (ticket.issue_number === null || planned === undefined) return [];
    return [
      {
        index: ticket.plan_index,
        issueNumber: ticket.issue_number,
        title: planned.title,
        ready: ticket.state === "published",
        labels: [],
      },
    ];
  });
}

async function proveDeliveredIssues(
  gh: GhOps,
  issues: readonly GhIssue[],
  ledger: PlanningPublicationLedger,
): Promise<Set<number>> {
  const candidates = new Set<number>();
  for (const ticket of ledger.tickets) {
    if (ticket.issue_number !== null) candidates.add(ticket.issue_number);
  }
  const delivered = new Set<number>();
  for (const issue of issues) {
    if (!candidates.has(issue.number) || issue.state !== "CLOSED") continue;
    const prs = await gh.listPRsForBranch(branchNameForIssue(issue), { state: "merged" });
    if (prs.some((pr) => pr.state === "MERGED")) delivered.add(issue.number);
  }
  return delivered;
}

function mergePublished(
  prior: readonly { index: number; issue_number: number; title: string; ready: boolean; labels: string[] }[],
  added: readonly PublishedTicket[],
): PublishedTicket[] {
  const merged = new Map(
    prior.map((ticket) => [
      ticket.index,
      {
        index: ticket.index,
        issueNumber: ticket.issue_number,
        title: ticket.title,
        ready: ticket.ready,
        labels: [...ticket.labels],
      },
    ]),
  );
  for (const ticket of added) merged.set(ticket.index, { ...ticket, labels: [...ticket.labels] });
  return [...merged.values()].sort((left, right) => left.index - right.index);
}

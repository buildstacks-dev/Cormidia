import type { GhIssue, GhOps } from "../loop/github.js";
import { GhCliOps } from "../loop/github.js";
import { branchNameForIssue } from "../loop/loop.js";
import { readPublishedTicketsRecord, writePublishedTicketsRecord } from "../loop/plan-publication-record.js";
import {
  finalizePlanForPublication,
  publishPlanProjection,
  type FinalPlanProjection,
  type PlanningSourceTicketEvidence,
  type PublishedTicket,
  type TicketPlan,
} from "../loop/plan-tickets.js";
import type { AppEntry } from "./apps.js";
import {
  completePlanningPublication,
  preparePlanningPublication,
  refreshPlanningCoverage,
  type PlanningCoverageRecord,
} from "./planning-coverage.js";

export async function publishPlanningCoverage(input: {
  stateHome: string;
  app: AppEntry;
  gh?: GhOps;
  coverage: PlanningCoverageRecord;
  /** Compatibility-only caller input. Durable batch evidence is authoritative. */
  sourceEvidence?: PlanningSourceTicketEvidence;
  resume: boolean;
  clock: () => Date;
  /** Revalidate mutable human-ratified inputs immediately before the first
   * issue mutation. Prepared transaction recovery may deliberately omit this
   * after the original caller has already crossed that authorization seam. */
  beforePublish?: (plan: TicketPlan) => void | Promise<void>;
  persistRoadmap: (input: { gh: GhOps; plan: TicketPlan; published: PublishedTicket[]; now: Date }) => Promise<void>;
}): Promise<{
  coverage: PlanningCoverageRecord;
  projection: FinalPlanProjection;
  published: PublishedTicket[];
  summary: string;
}> {
  const gh = input.gh ?? new GhCliOps(input.app.repo);
  const issues = await gh.listIssues({ state: "all", limit: 10_000 });
  const deliveredIssueNumbers = await proveDeliveredIssues(gh, issues, input.coverage);
  let coverage = await refreshPlanningCoverage({
    root: input.stateHome,
    app: input.app.name,
    scopeId: input.coverage.scope_id,
    issues,
    deliveredIssueNumbers,
    now: input.clock(),
  });
  const prepared = await preparePlanningPublication(
    input.stateHome,
    input.app.name,
    coverage.scope_id,
    input.resume,
    input.clock(),
  );
  coverage = prepared.record;
  const deliveredIndexes = new Set(
    coverage.tickets.filter((ticket) => ticket.state === "delivered").map((ticket) => ticket.plan_index),
  );
  const batch = coverage.publication_batches.find((candidate) => candidate.status === "prepared");
  const projection = finalizePlanForPublication(coverage.plan, undefined, {
    indexes: prepared.indexes,
    publicationCap: batch?.admission_cap ?? coverage.publication_cap,
    deliveredIndexes,
  });
  if (prepared.indexes.length === 0) {
    return { coverage, projection, published: [], summary: "No admissible tickets remain in this publication batch." };
  }
  if (batch === undefined) throw new Error("prepared planning publication batch disappeared");
  const knownIssueNumbers = new Map(
    coverage.tickets.flatMap((ticket) =>
      ticket.issue_number === null ? [] : ([[ticket.plan_index, ticket.issue_number]] as const),
    ),
  );
  const activeTicketIndexes = new Set(
    coverage.tickets.filter((ticket) => ticket.state !== "superseded").map((ticket) => ticket.plan_index),
  );
  await input.beforePublish?.(coverage.plan);
  const { published } = await publishPlanProjection(
    gh,
    projection,
    batch.source_evidence ?? undefined,
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
    recordNote = `; published-tickets record write failed: ${(error as Error).message}`;
  }
  await input.persistRoadmap({ gh, plan: coverage.plan, published: cumulative, now: input.clock() });
  coverage = await completePlanningPublication({
    root: input.stateHome,
    app: input.app.name,
    scopeId: coverage.scope_id,
    published,
    now: input.clock(),
  });
  return {
    coverage,
    projection,
    published,
    summary:
      `Published bounded batch ${published.map((ticket) => `#${ticket.issueNumber}`).join(", ")}; ` +
      `${coverage.tickets.filter((ticket) => ticket.state === "planned").length} planned ticket(s) remain${recordNote}`,
  };
}

export function publishedFromCoverage(record: PlanningCoverageRecord): PublishedTicket[] {
  return record.tickets.flatMap((ticket) =>
    ticket.issue_number === null
      ? []
      : [
          {
            index: ticket.plan_index,
            issueNumber: ticket.issue_number,
            title: record.plan.tickets[ticket.plan_index]!.title,
            ready: ticket.state === "published",
            labels: [],
          },
        ],
  );
}

async function proveDeliveredIssues(
  gh: GhOps,
  issues: readonly GhIssue[],
  coverage: PlanningCoverageRecord,
): Promise<Set<number>> {
  const candidates = new Set(
    coverage.tickets.filter((ticket) => ticket.issue_number !== null).map((ticket) => ticket.issue_number!),
  );
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

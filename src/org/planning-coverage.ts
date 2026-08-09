import { stableHash } from "../loop/episode-plan.js";
import type { GhIssue } from "../loop/github.js";
import {
  ticketPlanDigest,
  type PlanningSourceTicketEvidence,
  type PlanProvenance,
  type PublishedTicket,
  type TicketPlan,
} from "../loop/plan-tickets.js";
import { withFileLock } from "../runtime/file-lock.js";
import {
  appendCoverageDelta,
  coverageRecordDigest,
  recomputeCoverageSections,
  reconcileCoverageSections,
  type CoverageTicket,
  type PlanningCoverageRecord,
} from "./planning-coverage-model.js";
import { coverageLockPath, persistCoverageRecord, readCoverageRecord } from "./planning-coverage-store.js";
import type { PlanningDecompositionRequest, PlanningSourceSection } from "./planning-decomposition.js";

export type { PlanningCoverageRecord, PlanningCoverageState } from "./planning-coverage-model.js";
export { planningCoverageSummary } from "./planning-coverage-model.js";

const LOCK = { staleMs: 30_000, maxWaitMs: 31_000, retryMinMs: 2, retryMaxMs: 8 } as const;

export function planningCoverageScopeId(input: {
  app: string;
  goal: string;
  sourceRequests: readonly { path: string; requirement?: string }[];
  creatorScope: unknown;
}): string {
  return stableHash(input).slice(0, 32);
}

export async function readPlanningCoverage(
  root: string,
  app: string,
  scopeId: string,
  currentPublicationCap?: number,
  now?: Date,
): Promise<PlanningCoverageRecord | undefined> {
  if (currentPublicationCap === undefined) return readCoverageRecord(root, app, scopeId);
  if (!Number.isSafeInteger(currentPublicationCap) || currentPublicationCap < 1 || now === undefined) {
    throw new Error("planning coverage cap tightening requires a positive current cap and timestamp");
  }
  return withFileLock(coverageLockPath(root, app, scopeId), LOCK, async () => {
    const prior = await readCoverageRecord(root, app, scopeId);
    if (prior === undefined || currentPublicationCap >= prior.publication_cap) return prior;
    const next = structuredClone(prior);
    next.publication_cap = currentPublicationCap;
    next.predecessor_digest = coverageRecordDigest(prior);
    next.revision = prior.revision + 1;
    next.updated_at = now.toISOString();
    return persistCoverageRecord(next, root);
  });
}

export async function recordPlanningDecomposition(input: {
  root: string;
  app: string;
  scopeId: string;
  requestHash: string;
  planningIntentHash: string;
  sourceManifestSha256: string | null;
  request: PlanningDecompositionRequest | undefined;
  disposition: "accepted" | "refused";
  refusalProblems: readonly string[];
  publicationCap: number;
  plan: TicketPlan;
  sections: readonly PlanningSourceSection[];
  provenance: PlanProvenance;
  sourceEvidence?: PlanningSourceTicketEvidence;
  mode: "initial" | "delta" | "revise";
  now: Date;
  afterRevisionPersisted?: () => void | Promise<void>;
}): Promise<{ record: PlanningCoverageRecord; reused: boolean }> {
  return withFileLock(coverageLockPath(input.root, input.app, input.scopeId), LOCK, async () => {
    const prior = await readPlanningCoverage(input.root, input.app, input.scopeId);
    if (prior !== undefined && alreadyRecorded(prior, input.plan, input.provenance)) {
      return { record: prior, reused: true };
    }
    if (prior?.request_hash === input.requestHash && input.mode === "initial") return { record: prior, reused: true };
    const plan =
      prior === undefined
        ? structuredClone(input.plan)
        : appendCoverageDelta(prior, input.plan, input.sections, input.mode);
    const superseded = new Set<number>();
    if (prior !== undefined && input.mode === "revise") {
      for (const ticket of prior.tickets) if (ticket.state === "planned") superseded.add(ticket.plan_index);
    }
    const tickets = plan.tickets.map((ticket, planIndex): CoverageTicket => {
      const existing = planIndex < (prior?.tickets.length ?? 0) ? prior!.tickets[planIndex] : undefined;
      return {
        identity: existing?.identity ?? ticketIdentity(ticket, input.provenance),
        plan_index: planIndex,
        state: superseded.has(planIndex) ? "superseded" : (existing?.state ?? "planned"),
        issue_number: existing?.issue_number ?? null,
        source_sections: [...(ticket.sourceSections ?? [])],
        provenance: existing?.provenance ?? { ...input.provenance },
        source_evidence:
          existing?.source_evidence ??
          (input.sourceEvidence === undefined ? null : structuredClone(input.sourceEvidence)),
      };
    });
    const record: PlanningCoverageRecord = {
      schema_version: 1,
      kind: "planning-coverage",
      app: input.app,
      scope_id: input.scopeId,
      revision: (prior?.revision ?? 0) + 1,
      predecessor_digest: prior === undefined ? null : coverageRecordDigest(prior),
      request_hash: input.requestHash,
      planning_intent_hash: input.planningIntentHash,
      source_manifest_sha256: input.sourceManifestSha256,
      decomposition_id: ticketPlanDigest(plan),
      decomposition_request: input.request ?? null,
      disposition: input.disposition,
      refusal_problems: [...input.refusalProblems],
      publication_cap: Math.min(prior?.publication_cap ?? input.publicationCap, input.publicationCap),
      plan,
      provenance: { ...input.provenance },
      tickets,
      sections: reconcileCoverageSections(prior, input.sections, plan, tickets),
      publication_batches: prior?.publication_batches.map((batch) => ({ ...batch, indexes: [...batch.indexes] })) ?? [],
      updated_at: input.now.toISOString(),
    };
    const durable = await persistCoverageRecord(record, input.root, input.afterRevisionPersisted);
    return { record: durable, reused: false };
  });
}

export async function preparePlanningPublication(
  root: string,
  app: string,
  scopeId: string,
  resume: boolean,
  now: Date,
): Promise<{ record: PlanningCoverageRecord; indexes: number[] }> {
  const result = await mutate(root, app, scopeId, now, (record) => {
    if (record.disposition === "refused") throw new Error("refused planning decomposition cannot be published");
    const pending = record.publication_batches.find((batch) => batch.status === "prepared");
    if (pending !== undefined) return { changed: false, value: [...pending.indexes] };
    if (!resume && record.publication_batches.some((batch) => batch.status === "completed")) {
      return { changed: false, value: [] };
    }
    const selected: number[] = [];
    let batchProvenance: PlanProvenance | undefined;
    let batchProvenanceHash: string | undefined;
    let batchSourceEvidence: PlanningSourceTicketEvidence | null | undefined;
    let batchSourceEvidenceHash: string | undefined;
    const admitted = new Set(
      record.tickets.filter((ticket) => ticket.state === "delivered").map((ticket) => ticket.plan_index),
    );
    for (const ticket of record.tickets.filter((entry) => entry.state === "planned").sort(byPlanIndex)) {
      if (selected.length >= record.publication_cap) break;
      if (record.plan.tickets[ticket.plan_index]!.dependsOn.every((dependency) => admitted.has(dependency))) {
        const provenanceHash = stableHash(ticket.provenance);
        if (batchProvenanceHash !== undefined && provenanceHash !== batchProvenanceHash) continue;
        const sourceEvidenceHash = stableHash(ticket.source_evidence);
        if (batchSourceEvidenceHash === undefined) {
          batchSourceEvidence = ticket.source_evidence;
          batchSourceEvidenceHash = sourceEvidenceHash;
        } else if (sourceEvidenceHash !== batchSourceEvidenceHash) {
          throw new Error("planning publication batch provenance has conflicting source evidence");
        }
        batchProvenance ??= ticket.provenance;
        batchProvenanceHash ??= provenanceHash;
        selected.push(ticket.plan_index);
        admitted.add(ticket.plan_index);
      }
    }
    if (selected.length === 0) return { changed: false, value: [] };
    record.publication_batches.push({
      batch_id: `batch-${record.revision + 1}-${stableHash(selected).slice(0, 12)}`,
      indexes: selected,
      admission_cap: record.publication_cap,
      status: "prepared",
      provenance: { ...batchProvenance! },
      source_evidence: batchSourceEvidence === null ? null : structuredClone(batchSourceEvidence!),
    });
    return { changed: true, value: selected };
  });
  return { record: result.record, indexes: result.value };
}

export async function completePlanningPublication(input: {
  root: string;
  app: string;
  scopeId: string;
  published: readonly PublishedTicket[];
  now: Date;
}): Promise<PlanningCoverageRecord> {
  const result = await mutate(input.root, input.app, input.scopeId, input.now, (record) => {
    const batch = record.publication_batches.find((candidate) => candidate.status === "prepared");
    if (batch === undefined) return { changed: false, value: undefined };
    const byIndex = new Map(input.published.map((ticket) => [ticket.index, ticket]));
    for (const index of batch.indexes) {
      const published = byIndex.get(index);
      if (published === undefined) throw new Error(`publication omitted prepared decomposition ticket ${index}`);
      const ticket = record.tickets.find((candidate) => candidate.plan_index === index);
      if (ticket === undefined) throw new Error(`prepared decomposition ticket ${index} is missing`);
      ticket.state = "published";
      ticket.issue_number = published.issueNumber;
    }
    batch.status = "completed";
    recomputeCoverageSections(record);
    return { changed: true, value: undefined };
  });
  return result.record;
}

export async function refreshPlanningCoverage(input: {
  root: string;
  app: string;
  scopeId: string;
  issues: readonly GhIssue[];
  deliveredIssueNumbers: ReadonlySet<number>;
  now: Date;
}): Promise<PlanningCoverageRecord> {
  const issues = new Map(input.issues.map((issue) => [issue.number, issue]));
  const result = await mutate(input.root, input.app, input.scopeId, input.now, (record) => {
    let changed = false;
    for (const ticket of record.tickets) {
      if (ticket.issue_number === null) continue;
      const issue = issues.get(ticket.issue_number);
      if (issue === undefined) continue;
      const next = input.deliveredIssueNumbers.has(issue.number)
        ? "delivered"
        : issue.state === "CLOSED"
          ? "superseded"
          : issue.labels.some(activeLabel)
            ? "in_progress"
            : "published";
      if (ticket.state !== next) {
        ticket.state = next;
        changed = true;
      }
    }
    if (changed) recomputeCoverageSections(record);
    return { changed, value: undefined };
  });
  return result.record;
}

export async function invalidatePlanningCoverage(input: {
  root: string;
  app: string;
  scopeId: string;
  sourceManifestSha256: string | null;
  sections: readonly PlanningSourceSection[];
  now: Date;
}): Promise<PlanningCoverageRecord> {
  const result = await mutate(input.root, input.app, input.scopeId, input.now, (record) => {
    if (record.source_manifest_sha256 === input.sourceManifestSha256) return { changed: false, value: undefined };
    record.source_manifest_sha256 = input.sourceManifestSha256;
    record.sections = reconcileCoverageSections(record, input.sections, record.plan, record.tickets);
    return { changed: true, value: undefined };
  });
  return result.record;
}

async function mutate<T>(
  root: string,
  app: string,
  scopeId: string,
  now: Date,
  change: (record: PlanningCoverageRecord) => { changed: boolean; value: T },
): Promise<{ record: PlanningCoverageRecord; value: T }> {
  return withFileLock(coverageLockPath(root, app, scopeId), LOCK, async () => {
    const prior = await readPlanningCoverage(root, app, scopeId);
    if (prior === undefined) throw new Error(`planning coverage ${scopeId} does not exist`);
    const next = structuredClone(prior);
    const result = change(next);
    if (!result.changed) return { record: prior, value: result.value };
    next.predecessor_digest = coverageRecordDigest(prior);
    next.revision = prior.revision + 1;
    next.updated_at = now.toISOString();
    const durable = await persistCoverageRecord(next, root);
    return { record: durable, value: result.value };
  });
}

function ticketIdentity(ticket: TicketPlan["tickets"][number], provenance: PlanProvenance): string {
  return stableHash({ ...ticket, dependsOn: undefined, provenance });
}
function alreadyRecorded(record: PlanningCoverageRecord, plan: TicketPlan, provenance: PlanProvenance): boolean {
  const identities = new Set(record.tickets.map((ticket) => ticket.identity));
  return plan.tickets.every((ticket) => identities.has(ticketIdentity(ticket, provenance)));
}
function activeLabel(label: string): boolean {
  return ["op:building", "op:in-review", "op:blocked", "op:returned"].includes(label);
}

function byPlanIndex(a: CoverageTicket, b: CoverageTicket): number {
  return a.plan_index - b.plan_index;
}

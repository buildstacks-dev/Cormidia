import { stableHash } from "../loop/episode-plan.js";
import {
  ticketPlanDigest,
  type PlanningSourceTicketEvidence,
  type PlanProvenance,
  type TicketPlan,
} from "../loop/plan-tickets.js";
import type { PlanningDecompositionRequest, PlanningSourceSection } from "./planning-decomposition.js";

export type PlanningCoverageState =
  | "planned"
  | "published"
  | "in_progress"
  | "delivered"
  | "deferred"
  | "superseded"
  | "remaining";

export interface CoverageTicket {
  identity: string;
  plan_index: number;
  state: Exclude<PlanningCoverageState, "deferred" | "remaining">;
  issue_number: number | null;
  source_sections: string[];
  provenance: PlanProvenance;
  source_evidence: PlanningSourceTicketEvidence | null;
}

interface CoverageSection extends PlanningSourceSection {
  state: PlanningCoverageState;
  ticket_identities: string[];
}

interface PublicationBatch {
  batch_id: string;
  indexes: number[];
  admission_cap: number;
  status: "prepared" | "completed";
  provenance: PlanProvenance;
  source_evidence: PlanningSourceTicketEvidence | null;
}

export interface PlanningCoverageRecord {
  schema_version: 1;
  kind: "planning-coverage";
  app: string;
  scope_id: string;
  revision: number;
  predecessor_digest: string | null;
  request_hash: string;
  planning_intent_hash: string;
  source_manifest_sha256: string | null;
  decomposition_id: string;
  decomposition_request: PlanningDecompositionRequest | null;
  disposition: "accepted" | "refused";
  refusal_problems: string[];
  publication_cap: number;
  plan: TicketPlan;
  provenance: PlanProvenance;
  tickets: CoverageTicket[];
  sections: CoverageSection[];
  publication_batches: PublicationBatch[];
  updated_at: string;
}

export function appendCoverageDelta(
  prior: PlanningCoverageRecord,
  delta: TicketPlan,
  sections: readonly PlanningSourceSection[],
  mode: "initial" | "delta" | "revise",
): TicketPlan {
  if (mode === "initial") throw new Error("existing planning coverage requires --resume or --revise");
  const stateById = new Map(prior.sections.map((section) => [section.coverage_id, section.state]));
  const allowedSectionIds = new Set(
    sections
      .filter((section) => {
        const state = stateById.get(section.coverage_id);
        return state === undefined || state === "remaining" || (mode === "revise" && state === "planned");
      })
      .map((section) => section.coverage_id),
  );
  const named = delta.tickets.flatMap((ticket) => ticket.sourceSections ?? []);
  if (named.some((sectionId) => !allowedSectionIds.has(sectionId))) {
    throw new Error("planning coverage delta repeats source coverage that is not remaining or explicitly revised");
  }
  const offset = prior.plan.tickets.length;
  return {
    ...structuredClone(delta),
    tickets: [
      ...structuredClone(prior.plan.tickets),
      ...delta.tickets.map((ticket) => ({
        ...structuredClone(ticket),
        dependsOn: ticket.dependsOn.map((index) => index + offset),
      })),
    ],
    deferredSourceSections: [...(prior.plan.deferredSourceSections ?? []), ...(delta.deferredSourceSections ?? [])],
  };
}

export function reconcileCoverageSections(
  prior: PlanningCoverageRecord | undefined,
  current: readonly PlanningSourceSection[],
  plan: TicketPlan,
  tickets: CoverageTicket[],
): PlanningCoverageRecord["sections"] {
  const currentIds = new Set(current.map((section) => section.coverage_id));
  const superseded = (prior?.sections ?? [])
    .filter((section) => !currentIds.has(section.coverage_id))
    .map((section) => ({ ...section, state: "superseded" as const }));
  const priorById = new Map((prior?.sections ?? []).map((section) => [section.coverage_id, section]));
  const deferred = new Set((plan.deferredSourceSections ?? []).map((entry) => entry.sectionId));
  return [
    ...superseded,
    ...current.map((section) => {
      const mapped = tickets.filter(
        (ticket) => ticket.state !== "superseded" && ticket.source_sections.includes(section.coverage_id),
      );
      const previous = priorById.get(section.coverage_id);
      return {
        ...section,
        state: deferred.has(section.coverage_id)
          ? ("deferred" as const)
          : mapped.length === 0
            ? previous?.state === "superseded"
              ? "remaining"
              : (previous?.state ?? "remaining")
            : aggregate(mapped),
        ticket_identities: mapped.map((ticket) => ticket.identity),
      };
    }),
  ];
}

export function recomputeCoverageSections(record: PlanningCoverageRecord): void {
  const tickets = new Map(record.tickets.map((ticket) => [ticket.identity, ticket]));
  for (const section of record.sections) {
    const replaced =
      section.state === "superseded" &&
      record.sections.some(
        (candidate) => candidate.logical_id === section.logical_id && candidate.coverage_id !== section.coverage_id,
      );
    if (replaced || section.state === "deferred" || section.ticket_identities.length === 0) continue;
    section.state = aggregate(section.ticket_identities.map((identity) => tickets.get(identity)!).filter(Boolean));
  }
}

export function planningCoverageSummary(record: PlanningCoverageRecord): Record<PlanningCoverageState, number> {
  const states = ["planned", "published", "in_progress", "delivered", "deferred", "superseded", "remaining"] as const;
  return Object.fromEntries(
    states.map((state) => [state, record.sections.filter((section) => section.state === state).length]),
  ) as Record<PlanningCoverageState, number>;
}

export function assertCoverageRecord(record: PlanningCoverageRecord): void {
  if (
    !Number.isSafeInteger(record.publication_cap) ||
    record.publication_cap < 1 ||
    record.publication_batches.some(
      (batch) =>
        !Number.isSafeInteger(batch.admission_cap) ||
        batch.admission_cap < 1 ||
        batch.indexes.length > batch.admission_cap,
    )
  ) {
    throw new Error("planning coverage publication batch bypasses its preserved cap");
  }
  if (ticketPlanDigest(record.plan) !== record.decomposition_id) {
    throw new Error("planning coverage decomposition digest mismatch");
  }
  if (record.publication_batches.filter((batch) => batch.status === "prepared").length > 1) {
    throw new Error("planning coverage has multiple prepared batches");
  }
  if (
    record.tickets.length !== record.plan.tickets.length ||
    record.tickets.some(
      (ticket, index) =>
        ticket.plan_index !== index ||
        !isProvenance(ticket.provenance) ||
        !isPlanningSourceEvidence(ticket.source_evidence),
    ) ||
    record.publication_batches.some(
      (batch) =>
        !isProvenance(batch.provenance) ||
        !isPlanningSourceEvidence(batch.source_evidence) ||
        batch.indexes.some((index) => {
          const ticket = record.tickets[index];
          return (
            ticket === undefined ||
            stableHash(ticket.provenance) !== stableHash(batch.provenance) ||
            stableHash(ticket.source_evidence) !== stableHash(batch.source_evidence)
          );
        }),
    )
  ) {
    throw new Error("planning coverage ticket or publication provenance is corrupt");
  }
}

export function isCoverageRecord(value: unknown): value is PlanningCoverageRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    row["schema_version"] === 1 &&
    row["kind"] === "planning-coverage" &&
    typeof row["app"] === "string" &&
    typeof row["scope_id"] === "string" &&
    Number.isSafeInteger(row["revision"]) &&
    typeof row["request_hash"] === "string" &&
    typeof row["planning_intent_hash"] === "string" &&
    typeof row["decomposition_id"] === "string" &&
    typeof row["publication_cap"] === "number" &&
    Array.isArray(row["tickets"]) &&
    Array.isArray(row["sections"]) &&
    Array.isArray(row["publication_batches"]) &&
    row["plan"] !== null &&
    typeof row["plan"] === "object"
  );
}

export function coverageRecordDigest(record: PlanningCoverageRecord): string {
  return stableHash(record);
}

function aggregate(tickets: readonly CoverageTicket[]): PlanningCoverageState {
  for (const state of ["planned", "published", "in_progress", "delivered"] as const) {
    if (tickets.some((ticket) => ticket.state === state)) return state;
  }
  return "superseded";
}

function isProvenance(value: unknown): value is PlanProvenance {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row["episodeId"] === "string" && typeof row["runId"] === "string" && typeof row["traceId"] === "string";
}

function isPlanningSourceEvidence(value: unknown): value is PlanningSourceTicketEvidence | null {
  if (value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).sort().join(",") === "manifestSha256,sources" &&
    typeof row["manifestSha256"] === "string" &&
    Array.isArray(row["sources"]) &&
    row["sources"].every((source) => {
      if (typeof source !== "object" || source === null || Array.isArray(source)) return false;
      const entry = source as Record<string, unknown>;
      return (
        Object.keys(entry).sort().join(",") === "canonicalRef,includedBytes,inclusion,sourceBytes,sourceSha256,trust" &&
        typeof entry["canonicalRef"] === "string" &&
        typeof entry["sourceSha256"] === "string" &&
        Number.isSafeInteger(entry["sourceBytes"]) &&
        Number.isSafeInteger(entry["includedBytes"]) &&
        (entry["inclusion"] === "full" || entry["inclusion"] === "truncated") &&
        typeof entry["trust"] === "string"
      );
    })
  );
}

// InterventionRecord (docs/learning-loop/learning-loop-spec.md §11; design
// §9.2): ONE lineage contract for every destination, so versioning,
// measurement, disable, and rollback are never OKF-only. Whatever the
// destination — an OKF bundle version, a proposal PR, a plain GitHub ticket,
// a config change — "what changed, who approved it, when it activated, which
// episodes it touched, what the outcome was, and whether it was rolled back"
// is always answerable from one record:
//
//   candidate -> reviewed content (hash) -> publish (PR/commit/version/issue)
//   -> activation -> affected episodes -> experiment (when required)
//   -> outcome -> rollback (if any)
//
// The validator rejects impossible states (a validated claim without the
// experiment that produced it; a rollback block on a record that says it is
// active); interventionChainGaps() reports what a record still lacks for a
// complete chain — the lineage-completeness metric (spec §18) and the M4
// publisher's refuse-list read from it.
//
// Records live in the COMMITTED org home under `learning/interventions/`
// (spec §1), a gate-protected path — the deterministic publisher (M4) and
// humans write here, agents never. Spec deltas, M1/M2-style:
// `schema_version` added; `rollback`'s shape pinned to
// `{ rolled_back_at, reason }` (the sketch only ever showed null).

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoopClaim } from "../memory.js";
import { writeFileAtomic } from "../atomic.js";
import { CANDIDATE_DESTINATIONS, type CandidateDestination } from "./candidate.js";
import { listJsonRecords, readJsonRecord } from "./records.js";
import {
  optionalString,
  requireEnum,
  requirePrefixedId,
  requireRecord,
  requireSha256Ref,
  requireString,
} from "./validate.js";

export type InterventionStatus = "proposed" | "published" | "active" | "rolled_back" | "retired";
export type PublishKind = "bundle_version" | "pr" | "commit" | "issue" | "config_change";

/** Rejected candidates land in the rejection ledger (spec §13), never in an
 *  intervention — an intervention is a change that exists in the world. */
export type InterventionDestination = Exclude<CandidateDestination, "reject">;

export interface InterventionRecord {
  schema_version: 1;
  intervention_id: string;
  candidate_ref: string;
  destination: InterventionDestination;
  /** Hash of the bytes the reviewer saw (spec §15 evidence; M4 binds it into
   *  the approval). Null only while proposed. */
  reviewed_content_hash: string | null;
  /** Human approval id — required for human-gated publishes (activation into
   *  context, T2/T3); routine destinations (deduped tickets, unmerged
   *  proposal drafts) legitimately publish with null (policy §13). */
  approval_ref: string | null;
  publish: {
    kind: PublishKind;
    ref: string;
    commit: string | null;
    published_at: string;
  } | null;
  activation: {
    activated_at: string;
    claim: LoopClaim;
  } | null;
  /** Which episodes ran under this change (spec §11 shows a version query). */
  affected_episodes: { query: string } | null;
  experiment_ref: string | null;
  /** EvalResult ref once the experiment decided. */
  outcome_ref: string | null;
  rollback: { rolled_back_at: string; reason: string } | null;
  status: InterventionStatus;
}

export function validateInterventionRecord(value: unknown): InterventionRecord {
  const spec = requireRecord(value, "intervention");
  const interventionId = requirePrefixedId(spec, "intervention_id", "int_", "intervention");
  const source = interventionId;
  if (spec["schema_version"] !== 1) {
    throw new Error(`learning: ${source}.schema_version must be 1`);
  }

  const candidateRef = requirePrefixedId(spec, "candidate_ref", "cand_", source);
  const destination = requireEnum(
    spec,
    "destination",
    // Derived from the candidate enum so the two contracts cannot drift.
    CANDIDATE_DESTINATIONS.filter((d) => d !== "reject") as InterventionDestination[],
    source,
  );
  const reviewedContentHash =
    optionalString(spec, "reviewed_content_hash", source) !== null
      ? requireSha256Ref(spec, "reviewed_content_hash", source)
      : null;
  const approvalRef = optionalString(spec, "approval_ref", source);

  let publish: InterventionRecord["publish"] = null;
  if (spec["publish"] !== undefined && spec["publish"] !== null) {
    const p = requireRecord(spec["publish"], `${source}.publish`);
    publish = {
      kind: requireEnum(
        p,
        "kind",
        ["bundle_version", "pr", "commit", "issue", "config_change"] as const,
        `${source}.publish`,
      ),
      ref: requireString(p, "ref", `${source}.publish`),
      commit: optionalString(p, "commit", `${source}.publish`),
      published_at: requireString(p, "published_at", `${source}.publish`),
    };
  }

  let activation: InterventionRecord["activation"] = null;
  if (spec["activation"] !== undefined && spec["activation"] !== null) {
    const a = requireRecord(spec["activation"], `${source}.activation`);
    activation = {
      activated_at: requireString(a, "activated_at", `${source}.activation`),
      claim: requireEnum(a, "claim", ["authorized", "validated"] as const, `${source}.activation`),
    };
  }

  let affectedEpisodes: InterventionRecord["affected_episodes"] = null;
  if (spec["affected_episodes"] !== undefined && spec["affected_episodes"] !== null) {
    const e = requireRecord(spec["affected_episodes"], `${source}.affected_episodes`);
    affectedEpisodes = { query: requireString(e, "query", `${source}.affected_episodes`) };
  }

  const experimentRef = optionalString(spec, "experiment_ref", source);
  const outcomeRef = optionalString(spec, "outcome_ref", source);

  let rollback: InterventionRecord["rollback"] = null;
  if (spec["rollback"] !== undefined && spec["rollback"] !== null) {
    const r = requireRecord(spec["rollback"], `${source}.rollback`);
    rollback = {
      rolled_back_at: requireString(r, "rolled_back_at", `${source}.rollback`),
      reason: requireString(r, "reason", `${source}.rollback`),
    };
  }

  const status = requireEnum(
    spec,
    "status",
    ["proposed", "published", "active", "rolled_back", "retired"] as const,
    source,
  );

  // Impossible states — rejected outright, not reported as gaps.
  if (activation?.claim === "validated" && (experimentRef === null || outcomeRef === null)) {
    throw new Error(
      `learning: ${source}: activation claim "validated" without experiment_ref and ` +
        `outcome_ref — nothing but a completed experiment produces validated (design §9.1)`,
    );
  }
  // A rollback is history: it stays on the record when a rolled-back
  // intervention later retires — advancing to "retired" must never require
  // erasing the answer to "was this ever rolled back?".
  if (rollback !== null && status !== "rolled_back" && status !== "retired") {
    throw new Error(
      `learning: ${source}: a rollback block requires status "rolled_back" (or "retired" ` +
        `after a rollback), got "${status}"`,
    );
  }
  if (rollback === null && status === "rolled_back") {
    throw new Error(
      `learning: ${source}: status "rolled_back" requires the rollback block saying when and why`,
    );
  }
  if (publish === null && status !== "proposed") {
    throw new Error(
      `learning: ${source}: status "${status}" without a publish block — ` +
        `only proposed interventions are unpublished`,
    );
  }
  if (activation !== null && status === "proposed") {
    throw new Error(`learning: ${source}: a proposed intervention cannot carry an activation`);
  }

  return {
    schema_version: 1,
    intervention_id: interventionId,
    candidate_ref: candidateRef,
    destination,
    reviewed_content_hash: reviewedContentHash,
    approval_ref: approvalRef,
    publish,
    activation,
    affected_episodes: affectedEpisodes,
    experiment_ref: experimentRef,
    outcome_ref: outcomeRef,
    rollback,
    status,
  };
}

/** What this record still lacks for a COMPLETE lineage chain (design §9.2)
 *  at its current lifecycle stage. Empty means the chain is whole — the
 *  lineage-completeness metric counts records where this is non-empty. */
export function interventionChainGaps(record: InterventionRecord): string[] {
  const gaps: string[] = [];
  if (record.status === "proposed") return gaps; // nothing published yet — chain starts at publish

  if (record.reviewed_content_hash === null) gaps.push("reviewed_content_hash");
  if (record.publish === null) gaps.push("publish");

  if (record.status === "active" || record.status === "retired" || record.status === "rolled_back") {
    if (record.activation === null) gaps.push("activation");
  }
  if (record.status === "active" && record.destination === "okf_concept") {
    // Activation into context is human-gated (policy §13 approval_routing) —
    // an active concept without an approval ref is a hole in the chain.
    if (record.approval_ref === null) gaps.push("approval_ref");
    if (record.affected_episodes === null) gaps.push("affected_episodes");
  }
  // An experiment that decided must have its outcome on the record.
  if (record.experiment_ref !== null && record.outcome_ref === null) {
    gaps.push("outcome_ref (experiment declared but no recorded outcome)");
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// storage (committed org home, spec §1)
// ---------------------------------------------------------------------------

/** The ONE candidate→intervention id derivation (`cand_x` → `int_x`). The
 *  publisher mints with it and the runner/CLI trace with it — encoded once
 *  so a scheme change cannot silently break the consumers into no-ops. */
export function interventionIdForCandidate(candidateId: string): string {
  return `int_${candidateId.replace(/^cand_/, "")}`;
}

export function interventionsDir(orgHome: string): string {
  return join(orgHome, "learning", "interventions");
}

export function interventionPath(orgHome: string, interventionId: string): string {
  return join(interventionsDir(orgHome), `${interventionId}.json`);
}

/** Validate and persist. Lineage is history: an existing record may only be
 *  rewritten by a strictly forward status transition (proposed -> published
 *  -> active -> rolled_back/retired) — never sideways or back. */
export async function writeInterventionRecord(
  orgHome: string,
  value: unknown,
): Promise<InterventionRecord> {
  const record = validateInterventionRecord(value);
  const path = interventionPath(orgHome, record.intervention_id);
  if (existsSync(path)) {
    const existing = validateInterventionRecord(JSON.parse(await readFile(path, "utf8")));
    const order: InterventionStatus[] = ["proposed", "published", "active", "rolled_back", "retired"];
    if (order.indexOf(record.status) < order.indexOf(existing.status)) {
      throw new Error(
        `learning: ${record.intervention_id} is "${existing.status}" — ` +
          `it cannot move back to "${record.status}"; lineage only advances`,
      );
    }
  }
  await mkdir(interventionsDir(orgHome), { recursive: true });
  await writeFileAtomic(path, JSON.stringify(record, null, 2) + "\n");
  return record;
}

export async function readInterventionRecord(
  orgHome: string,
  interventionId: string,
): Promise<InterventionRecord> {
  return readJsonRecord(
    interventionPath(orgHome, interventionId),
    validateInterventionRecord,
    `learning: no intervention ${interventionId} under ${interventionsDir(orgHome)}`,
  );
}

export async function listInterventionRecords(orgHome: string): Promise<InterventionRecord[]> {
  return listJsonRecords(interventionsDir(orgHome), "int_", validateInterventionRecord);
}

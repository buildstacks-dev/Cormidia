// CandidateArtifact contract (docs/learning-loop/learning-loop-spec.md §9)
// and the CONDITIONAL experiment gate (design §9.1).
//
// Candidates carry no authority: they live outside every resolvable path and
// outside the gate-protected surfaces (agents emit them freely). What M3
// pins down is the contract every candidate must satisfy before the M4
// review/publish pipeline may move it:
//
//   claims_efficacy: true   -> a declared ExperimentRecord is REQUIRED. The
//                              promotion argument is "this improves X", so it
//                              must say how X is measured before results.
//   T2/T3 destination tiers -> experiment required for activation, waivable
//                              only by an explicit human waiver recorded on
//                              the approval (M4 binds it; the gate here
//                              accepts the waiver text as input).
//   everything else (T0/T1  -> proceeds WITHOUT experiment apparatus; its
//   fact/procedure)            activation claim is `authorized`, its eval
//                              verdict is `not_evaluatable`, and reports
//                              display it as unproven. Scoped facts are not
//                              taxed with experiments they cannot use.
//
// Storage (learning/candidates/) is an M4 concern; M3 ships the contract so
// the publisher has something to enforce.

import type { LoopTier } from "../../memory.js";
import { isReservedLoopScope, isValidLoopScope } from "../../memory.js";
import {
  optionalString,
  requireBoolean,
  requireEnum,
  requirePrefixedId,
  requireRecord,
  requireSha256Ref,
  requireString,
  requireStringArray,
} from "./validate.js";
import { definedProps } from "../../../runtime/optional-properties.js";

export const CANDIDATE_DESTINATIONS = [
  "okf_concept",
  "skill_draft",
  "protocol_proposal",
  "eval_or_gate_proposal",
  "ticket",
  "reject",
] as const;
export type CandidateDestination = (typeof CANDIDATE_DESTINATIONS)[number];

export interface CandidateArtifact {
  candidate_id: string;
  destination: CandidateDestination;
  title: string;
  proposed_scope: string;
  proposed_tier: LoopTier;
  claims_efficacy: boolean;
  experiment_ref: string | null;
  error_class?: string;
  cause_hypothesis?: string;
  episode_ids: string[];
  event_ids: string[];
  evidence_refs: string[];
  content_hash: string;
  draft?: Record<string, unknown>;
}

export function validateCandidateArtifact(value: unknown): CandidateArtifact {
  const spec = requireRecord(value, "candidate");
  const candidateId = requirePrefixedId(spec, "candidate_id", "cand_", "candidate");
  const source = candidateId;

  const destination = requireEnum(spec, "destination", CANDIDATE_DESTINATIONS, source);
  const scope = requireString(spec, "proposed_scope", source);
  if (!isValidLoopScope(scope)) {
    throw new Error(
      isReservedLoopScope(scope)
        ? `learning: ${source}.proposed_scope "${scope}" is reserved for a future version (spec §2)`
        : `learning: ${source}.proposed_scope must be org | roles/<role> | apps/<app> | apps/<app>/roles/<role>`,
    );
  }
  const contentHash = requireSha256Ref(spec, "content_hash", source);
  const errorClass = optionalString(spec, "error_class", source);
  const causeHypothesis = optionalString(spec, "cause_hypothesis", source);
  const draft = spec["draft"] !== undefined ? requireRecord(spec["draft"], `${source}.draft`) : undefined;

  return {
    candidate_id: candidateId,
    destination,
    title: requireString(spec, "title", source),
    proposed_scope: scope,
    proposed_tier: requireEnum(spec, "proposed_tier", ["T0", "T1", "T2", "T3"] as const, source),
    claims_efficacy: requireBoolean(spec, "claims_efficacy", source),
    experiment_ref: optionalString(spec, "experiment_ref", source),
    ...(errorClass !== null ? { error_class: errorClass } : {}),
    ...(causeHypothesis !== null ? { cause_hypothesis: causeHypothesis } : {}),
    episode_ids: requireStringArray(spec, "episode_ids", source),
    event_ids: requireStringArray(spec, "event_ids", source),
    evidence_refs: requireStringArray(spec, "evidence_refs", source),
    content_hash: contentHash,
    ...definedProps({ draft }),
  };
}

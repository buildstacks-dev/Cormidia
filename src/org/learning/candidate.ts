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

import type { LoopClaim, LoopTier } from "../memory.js";
import { isReservedLoopScope, isValidLoopScope } from "../memory.js";
import type { ExperimentRecord } from "./experiment.js";
import type { EvalVerdict } from "./eval-result.js";
import {
  optionalString,
  requireBoolean,
  requireEnum,
  requirePrefixedId,
  requireRecord,
  requireString,
  requireStringArray,
} from "./validate.js";

export type CandidateDestination =
  | "okf_concept"
  | "skill_draft"
  | "protocol_proposal"
  | "eval_or_gate_proposal"
  | "ticket"
  | "reject";

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

  const destination = requireEnum(
    spec,
    "destination",
    ["okf_concept", "skill_draft", "protocol_proposal", "eval_or_gate_proposal", "ticket", "reject"] as const,
    source,
  );
  const scope = requireString(spec, "proposed_scope", source);
  if (!isValidLoopScope(scope)) {
    throw new Error(
      isReservedLoopScope(scope)
        ? `learning: ${source}.proposed_scope "${scope}" is reserved for a future version (spec §2)`
        : `learning: ${source}.proposed_scope must be org | roles/<role> | apps/<app> | apps/<app>/roles/<role>`,
    );
  }
  const contentHash = requireString(spec, "content_hash", source);
  if (!/^sha256:[0-9a-f]{64}$/.test(contentHash)) {
    throw new Error(`learning: ${source}.content_hash must be "sha256:<64 hex>"`);
  }
  const errorClass = optionalString(spec, "error_class", source);
  const causeHypothesis = optionalString(spec, "cause_hypothesis", source);
  const draft =
    spec["draft"] !== undefined ? requireRecord(spec["draft"], `${source}.draft`) : undefined;

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
    ...(draft !== undefined ? { draft } : {}),
  };
}

// ---------------------------------------------------------------------------
// the conditional experiment gate (design §9.1)
// ---------------------------------------------------------------------------

export interface ExperimentRequirement {
  required: boolean;
  /** Which rule triggered it — for the refusal/report message. */
  reason: "claims_efficacy" | "tier_t2_t3_activation" | null;
}

export function experimentRequirement(
  candidate: Pick<CandidateArtifact, "claims_efficacy" | "proposed_tier">,
): ExperimentRequirement {
  if (candidate.claims_efficacy) return { required: true, reason: "claims_efficacy" };
  if (candidate.proposed_tier === "T2" || candidate.proposed_tier === "T3") {
    return { required: true, reason: "tier_t2_t3_activation" };
  }
  return { required: false, reason: null };
}

export interface CandidateProceedOptions {
  /** The resolved experiment the candidate references, when it references
   *  one. The caller resolves the ref (readExperimentRecord) so this check
   *  stays pure and testable. */
  experiment?: ExperimentRecord;
  /** Explicit human waiver text — waives the T2/T3 requirement ONLY (design
   *  §9.1 table); an efficacy CLAIM can never be waived into truth. M4
   *  records this on the approval. */
  humanWaiver?: string;
}

export interface CandidateEvaluability {
  /** The claim the candidate's activation may carry today. Always
   *  `authorized` at this boundary — `validated` exists only downstream of a
   *  completed experiment with verdict `improved` (claimAfterEval). */
  claim: LoopClaim;
  /** Recorded verdict when no trials will run (design §9.1 table). */
  verdict_when_untried: EvalVerdict | null;
  /** How reports must display it. */
  reported_as: "authorized (unproven)" | "experiment pending" | "waived (human)";
  waiver: string | null;
}

/** The gate the M4 review/publish pipeline calls before a candidate moves.
 *  Throws when the candidate cannot proceed; returns how its activation must
 *  be recorded when it can. */
export function assertCandidateCanProceed(
  candidate: CandidateArtifact,
  options: CandidateProceedOptions = {},
): CandidateEvaluability {
  const requirement = experimentRequirement(candidate);

  // A referenced experiment must actually be the candidate's own, whether or
  // not one was required — a borrowed experiment proves nothing about this
  // candidate.
  if (options.experiment !== undefined && options.experiment.candidate_ref !== candidate.candidate_id) {
    throw new Error(
      `learning: ${candidate.candidate_id}: experiment ${options.experiment.experiment_id} ` +
        `was declared for ${options.experiment.candidate_ref ?? "no candidate"} — ` +
        `an experiment binds to one candidate`,
    );
  }
  if (candidate.experiment_ref !== null && options.experiment === undefined) {
    throw new Error(
      `learning: ${candidate.candidate_id} references ${candidate.experiment_ref} ` +
        `but it was not resolved — pass the declared ExperimentRecord`,
    );
  }
  if (
    candidate.experiment_ref !== null &&
    options.experiment !== undefined &&
    options.experiment.experiment_id !== candidate.experiment_ref
  ) {
    throw new Error(
      `learning: ${candidate.candidate_id} references ${candidate.experiment_ref} ` +
        `but ${options.experiment.experiment_id} was resolved`,
    );
  }

  if (!requirement.required) {
    // T0/T1, no efficacy claim: proceeds unproven — recorded, never hidden.
    return {
      claim: "authorized",
      verdict_when_untried: options.experiment === undefined ? "not_evaluatable" : null,
      reported_as: options.experiment === undefined ? "authorized (unproven)" : "experiment pending",
      waiver: null,
    };
  }

  if (options.experiment !== undefined) {
    return {
      claim: "authorized",
      verdict_when_untried: null,
      reported_as: "experiment pending",
      waiver: null,
    };
  }

  if (requirement.reason === "tier_t2_t3_activation" && options.humanWaiver !== undefined) {
    if (options.humanWaiver.trim() === "") {
      throw new Error(
        `learning: ${candidate.candidate_id}: a T2/T3 waiver must say why — empty waivers do not record a decision`,
      );
    }
    return {
      claim: "authorized",
      verdict_when_untried: "not_evaluatable",
      reported_as: "waived (human)",
      waiver: options.humanWaiver,
    };
  }

  throw new Error(
    requirement.reason === "claims_efficacy"
      ? `learning: ${candidate.candidate_id} claims efficacy but declares no experiment — ` +
          `declare an ExperimentRecord (spec §10) or drop the claim; efficacy claims are never waivable (design §9.1)`
      : `learning: ${candidate.candidate_id} proposes tier ${candidate.proposed_tier} activation ` +
          `without an experiment — declare one, or record an explicit human waiver on the approval`,
  );
}

/** The one legal upgrade path for a claim (design §9.1, spec §17): a
 *  completed experiment whose verdict is `improved` produces `validated`;
 *  every other verdict leaves the claim `authorized`. */
export function claimAfterEval(verdict: EvalVerdict): LoopClaim {
  return verdict === "improved" ? "validated" : "authorized";
}

// Reviewer verdict (docs/learning-loop/learning-loop-spec.md §15) and the
// fail-closed review boundary.
//
// A verdict is EVIDENCE stored under the org home's gate-protected
// `learning/reviews/`; the human decision lives in the one approvals queue
// (spec §16 implementation notes). Review fails closed twice over:
//   - no verdict file  -> the candidate is queued, never published;
//   - non-clean injection screen -> the disposition escalates regardless of
//     the verdict word (spec §15: "Non-clean injection screens escalate").
//
// In M4 review is human-invoked (`operon learn review`); M6 adds the
// cross-provider reviewer role writing the same contract. Spec deltas,
// recorded M1-M3-style: `schema_version`, plus `reviewed_by`/`reviewed_at`
// provenance — the reviewer-human agreement metric (spec §18) needs to know
// who reviewed, and the sketch had no field for it.

import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isReservedLoopScope, isValidLoopScope, type LoopTier } from "../memory.js";
import { writeFileAtomic } from "../atomic.js";
import { CANDIDATE_DESTINATIONS, type CandidateDestination } from "./candidate.js";
import { listJsonRecords, readJsonRecord } from "./records.js";
import {
  requireBoolean,
  requireEnum,
  requirePrefixedId,
  requireRecord,
  requireString,
  requireStringArray,
  sha256Ref,
} from "./validate.js";

export const REVIEW_VERDICTS = ["approve", "revise", "reject", "escalate"] as const;
export type ReviewVerdictWord = (typeof REVIEW_VERDICTS)[number];

export const INJECTION_SCREENS = ["clean", "suspicious", "flagged"] as const;
export type InjectionScreen = (typeof INJECTION_SCREENS)[number];

export interface ReviewerVerdict {
  schema_version: 1;
  candidate_id: string;
  verdict: ReviewVerdictWord;
  proposed_destination: CandidateDestination;
  proposed_tier: LoopTier;
  proposed_scope: string;
  experiment_required: boolean;
  rubric: {
    correctness: number;
    generality: number;
    scope_fit: number;
    destination_fit: number;
    provenance_trust: number;
    injection_screen: InjectionScreen;
  };
  conflicts_with: string[];
  duplicates: string[];
  eval_required: boolean;
  eval_present: boolean;
  rationale: string;
  reviewed_by: string;
  reviewed_at: string;
}

export function validateReviewerVerdict(value: unknown): ReviewerVerdict {
  const spec = requireRecord(value, "review");
  const candidateId = requirePrefixedId(spec, "candidate_id", "cand_", "review");
  const source = `review(${candidateId})`;
  if (spec["schema_version"] !== 1) {
    throw new Error(`learning: ${source}.schema_version must be 1`);
  }

  const scope = requireString(spec, "proposed_scope", source);
  if (!isValidLoopScope(scope)) {
    throw new Error(
      isReservedLoopScope(scope)
        ? `learning: ${source}.proposed_scope "${scope}" is reserved for a future version (spec §2)`
        : `learning: ${source}.proposed_scope must be org | roles/<role> | apps/<app> | apps/<app>/roles/<role>`,
    );
  }

  const rubricSpec = requireRecord(spec["rubric"], `${source}.rubric`);
  const score = (key: string): number => {
    const v = rubricSpec[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 5) {
      throw new Error(`learning: ${source}.rubric.${key} must be an integer 0-5`);
    }
    return v;
  };

  return {
    schema_version: 1,
    candidate_id: candidateId,
    verdict: requireEnum(spec, "verdict", REVIEW_VERDICTS, source),
    proposed_destination: requireEnum(spec, "proposed_destination", CANDIDATE_DESTINATIONS, source),
    proposed_tier: requireEnum(spec, "proposed_tier", ["T0", "T1", "T2", "T3"] as const, source),
    proposed_scope: scope,
    experiment_required: requireBoolean(spec, "experiment_required", source),
    rubric: {
      correctness: score("correctness"),
      generality: score("generality"),
      scope_fit: score("scope_fit"),
      destination_fit: score("destination_fit"),
      provenance_trust: score("provenance_trust"),
      injection_screen: requireEnum(rubricSpec, "injection_screen", INJECTION_SCREENS, `${source}.rubric`),
    },
    conflicts_with: requireStringArray(spec, "conflicts_with", source),
    duplicates: requireStringArray(spec, "duplicates", source),
    eval_required: requireBoolean(spec, "eval_required", source),
    eval_present: requireBoolean(spec, "eval_present", source),
    rationale: requireString(spec, "rationale", source),
    reviewed_by: requireString(spec, "reviewed_by", source),
    reviewed_at: requireString(spec, "reviewed_at", source),
  };
}

export type ReviewDisposition = "proceed" | "revise" | "reject" | "escalate";

/** The fail-closed disposition: a non-clean injection screen escalates no
 *  matter what the verdict word says. */
export function reviewDisposition(verdict: ReviewerVerdict): ReviewDisposition {
  if (verdict.rubric.injection_screen !== "clean") return "escalate";
  switch (verdict.verdict) {
    case "approve":
      return "proceed";
    case "revise":
      return "revise";
    case "reject":
      return "reject";
    case "escalate":
      return "escalate";
  }
}

// ---------------------------------------------------------------------------
// storage (org home learning/reviews/ — gate-protected, spec §1)
// ---------------------------------------------------------------------------

export function reviewsDir(orgHome: string): string {
  return join(orgHome, "learning", "reviews");
}

export function reviewPath(orgHome: string, candidateId: string): string {
  return join(reviewsDir(orgHome), `${candidateId}.json`);
}

export async function writeReviewerVerdict(orgHome: string, value: unknown): Promise<ReviewerVerdict> {
  const verdict = validateReviewerVerdict(value);
  await mkdir(reviewsDir(orgHome), { recursive: true });
  await writeFileAtomic(
    reviewPath(orgHome, verdict.candidate_id),
    JSON.stringify(verdict, null, 2) + "\n",
  );
  return verdict;
}

/** Undefined when no verdict exists — the caller's fail-closed branch. */
export async function readReviewerVerdict(
  orgHome: string,
  candidateId: string,
): Promise<ReviewerVerdict | undefined> {
  const path = reviewPath(orgHome, candidateId);
  if (!existsSync(path)) return undefined;
  return readJsonRecord(path, validateReviewerVerdict, `learning: no review at ${path}`);
}

export async function listReviewerVerdicts(orgHome: string): Promise<ReviewerVerdict[]> {
  return listJsonRecords(reviewsDir(orgHome), "cand_", validateReviewerVerdict);
}

/** Hash of the verdict file bytes as stored — what the approval binding's
 *  verdict_hash pins (spec §14). */
export async function reviewerVerdictHash(orgHome: string, candidateId: string): Promise<string> {
  const path = reviewPath(orgHome, candidateId);
  if (!existsSync(path)) {
    throw new Error(`learning: no reviewer verdict for ${candidateId} — review fails closed`);
  }
  return sha256Ref(await readFile(path));
}

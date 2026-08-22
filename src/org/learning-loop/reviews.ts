// Reviewer verdicts (learning/reviews/<candidate>.json, spec §15 — host
// evidence written by the human or the scheduled learning reviewer) onto the
// kernel's decisive `reviewCandidate` transition. The verdict file stays the
// evidence; the kernel review is the governed fact the publisher consults.
// Cormidia's fail-closed rule survives unchanged: a non-clean injection screen
// escalates no matter what the verdict word says (spec §15), and the kernel
// additionally refuses a self-review (the proposer principal) on its own.

import type { CandidateReview, ReviewDisposition } from "@cormidia/learning-loop";
import type { ReviewerVerdict } from "../learning/review.js";
import { humanPrincipalEvidence, rolePrincipalEvidence, type CormidiaPrincipalEvidence } from "./identity.js";
import type { CormidiaLearningLoop } from "./loop.js";

export const REVIEWER_IMPLEMENTATION = { id: "cormidia/reviewer-verdict", version: "1.0.0" } as const;

/** The kernel disposition of a Cormidia verdict — `approve` proceeds only
 *  with a clean injection screen; anything non-clean escalates. */
export function kernelDispositionOf(verdict: ReviewerVerdict): ReviewDisposition {
  if (verdict.rubric.injection_screen !== "clean") return "escalate";
  switch (verdict.verdict) {
    case "approve":
      return "accept";
    case "revise":
      return "revise";
    case "reject":
      return "reject";
    case "escalate":
      return "escalate";
  }
}

/** Who reviewed: `human:<name>` or a bare name is a human; the scheduled
 *  reviewer signs `<role>:<harness>/<model>` and is that role on that runtime. */
export function reviewerEvidenceFor(reviewedBy: string): CormidiaPrincipalEvidence {
  if (reviewedBy.startsWith("human:")) return humanPrincipalEvidence(reviewedBy.slice("human:".length));
  const scheduled = /^([A-Za-z0-9_-]+):([A-Za-z0-9_.-]+)\/(.+)$/.exec(reviewedBy);
  if (scheduled !== null && scheduled[1] !== undefined && scheduled[2] !== undefined) {
    return rolePrincipalEvidence(scheduled[1], scheduled[2]);
  }
  return humanPrincipalEvidence(reviewedBy);
}

/** One kernel review per (candidate, verdict bytes): the same verdict file
 *  replays to the same review id and the kernel returns the stored review. */
export function kernelReviewIdFor(candidateId: string, verdictHash: string): string {
  return `review-${candidateId}-${verdictHash.replace(/^sha256:/, "").slice(0, 16)}`;
}

function findingsOf(verdict: ReviewerVerdict): CandidateReview["findings"] {
  const findings: { code: string; severity: "info" | "warning" | "blocking"; message: string }[] = [];
  if (verdict.rubric.injection_screen !== "clean") {
    findings.push({
      code: "review.injection_screen",
      severity: "blocking",
      message: `injection screen "${verdict.rubric.injection_screen}" escalates regardless of the verdict (spec §15)`,
    });
  }
  const { injection_screen: _screen, ...scores } = verdict.rubric;
  findings.push({
    code: "review.rubric",
    severity: "info",
    message: Object.entries(scores)
      .map(([key, value]) => `${key}=${value}`)
      .join(" "),
  });
  for (const conflict of verdict.conflicts_with) {
    findings.push({ code: "review.conflicts_with", severity: "warning", message: conflict });
  }
  for (const duplicate of verdict.duplicates) {
    findings.push({ code: "review.duplicate", severity: "warning", message: duplicate });
  }
  findings.push({ code: "review.rationale", severity: "info", message: verdict.rationale });
  return findings;
}

export interface EnsureKernelReviewInput {
  readonly candidateId: string;
  readonly verdict: ReviewerVerdict;
  /** `sha256:<hex>` of the verdict file bytes — the review's identity. */
  readonly verdictHash: string;
}

/** Record the verdict as the kernel's decisive review of the candidate. */
export async function ensureKernelReview(
  learning: CormidiaLearningLoop,
  input: EnsureKernelReviewInput,
): Promise<CandidateReview> {
  const disposition = kernelDispositionOf(input.verdict);
  const findings = findingsOf(input.verdict);
  const principal = await learning.identity.verify(reviewerEvidenceFor(input.verdict.reviewed_by));
  return learning.loop.reviewCandidate({
    id: kernelReviewIdFor(input.candidateId, input.verdictHash),
    candidateId: input.candidateId,
    reviewer: {
      id: REVIEWER_IMPLEMENTATION.id,
      version: REVIEWER_IMPLEMENTATION.version,
      principal,
      review: (reviewInput) =>
        Promise.resolve({
          candidateId: reviewInput.candidate.id,
          candidateDigest: reviewInput.candidate.contentDigest,
          disposition,
          findings,
        }),
    },
  });
}

// Builder/Reviewer provider-family disjointness pin (HB-133 / CF-REVIEW-PROVIDER).
//
// docs/loop/design.md "Review identity": autonomous code delivery pairs a
// Builder and a Reviewer on DIFFERENT PROVIDERS — the deliberate roles.yaml
// codex/claude split encodes uncorrelated review blind spots. The
// rev-2026-08-10 owner ruling reads "different provider" as provider FAMILY,
// so distinct adapters over one upstream family (a pi-hosted Anthropic model
// reviewing a native Claude build) are the SAME seat and are refused too.
//
// PROVENANCE CAVEAT (harness-backlog.md HB-133; validation-design/
// ratification-package.md §12.3 item 1): the provider-FAMILY unit is a
// [simulated] AI-seat ruling pending real-human ratification. The unit is
// therefore an EXPLICIT, SWAPPABLE input: `resolveProviderFamily` is a named
// parameter, never an inlined assumption. Production passes
// `configuredProviderFamily` (src/runtime/assignment.ts — the same unit the
// L-ACC campaign preflight reuses); if the human overturns the unit (vendor
// product, account, …), callers swap the resolver and this module's refusal
// semantics stay put.
//
// Scope (catalog §10.2 leg e): the guard binds routes that demand independent
// review — the autonomous code-delivery planning boundary wires it in
// src/org/episode-planner/policy.ts. Jobs (M18; docs/jobs/design.md §3
// non-inherited guarantees) and manual-only routes never construct it, so no
// Reviewer is imposed on them.
//
// Fail-closed by construction: a participant without a resolvable assignment,
// a resolver that throws, and a resolver returning a non-family value are all
// the typed unresolvable refusal — a missing family is never a silent pass.

import { validateProviderFamily } from "../runtime/assignment.js";
import type { TurnAssignment } from "../runtime/types.js";

/** The swappable disjointness unit (see the provenance caveat above). */
export type ProviderFamilyResolver = (assignment: TurnAssignment) => string;

export type ReviewProviderRefusalCode =
  | "error_review_provider_family_collapse"
  | "error_review_provider_family_unresolvable";

/** Typed refusal raised BEFORE any provider construction on the route. */
export class ReviewProviderCollapseError extends Error {
  readonly code: ReviewProviderRefusalCode;

  constructor(code: ReviewProviderRefusalCode, message: string) {
    super(message);
    this.name = "ReviewProviderCollapseError";
    this.code = code;
  }
}

/** One review-identity seat: the role name (for the refusal message) and the
 * exact assignment the route resolved for it — undefined when the route could
 * not resolve one, which fails closed. */
export interface ReviewProviderParticipant {
  role: string;
  assignment: TurnAssignment | undefined;
}

/**
 * Refuse when Builder and Reviewer resolve to one provider family; return
 * both resolved families as evidence otherwise. Deterministic, token-free,
 * and provider-free: callers run it before constructing any Runtime.
 */
export function assertReviewProviderFamiliesDisjoint(input: {
  builder: ReviewProviderParticipant;
  reviewer: ReviewProviderParticipant;
  resolveProviderFamily: ProviderFamilyResolver;
}): { builderFamily: string; reviewerFamily: string } {
  const builderFamily = resolveParticipantFamily(input.builder, input.resolveProviderFamily);
  const reviewerFamily = resolveParticipantFamily(input.reviewer, input.resolveProviderFamily);
  if (builderFamily === reviewerFamily) {
    throw new ReviewProviderCollapseError(
      "error_review_provider_family_collapse",
      `autonomous code delivery requires Builder and Reviewer on different provider families, but ` +
        `${JSON.stringify(input.builder.role)} and ${JSON.stringify(input.reviewer.role)} both resolve to ` +
        `${JSON.stringify(builderFamily)} (docs/loop/design.md "Review identity"; rev-2026-08-10 owner ruling); ` +
        "refusing before provider construction",
    );
  }
  return { builderFamily, reviewerFamily };
}

function resolveParticipantFamily(participant: ReviewProviderParticipant, resolve: ProviderFamilyResolver): string {
  if (participant.assignment === undefined) {
    throw new ReviewProviderCollapseError(
      "error_review_provider_family_unresolvable",
      `review-identity role ${JSON.stringify(participant.role)} has no resolvable configured assignment; ` +
        "refusing before provider construction (fail closed)",
    );
  }
  let family: string;
  try {
    family = resolve(participant.assignment);
  } catch (error) {
    throw new ReviewProviderCollapseError(
      "error_review_provider_family_unresolvable",
      `provider family for review-identity role ${JSON.stringify(participant.role)} did not resolve: ` +
        `${error instanceof Error ? error.message : String(error)} (fail closed)`,
    );
  }
  try {
    return validateProviderFamily(family, `review-identity role ${JSON.stringify(participant.role)} provider family`);
  } catch (error) {
    throw new ReviewProviderCollapseError(
      "error_review_provider_family_unresolvable",
      `${error instanceof Error ? error.message : String(error)} (fail closed)`,
    );
  }
}

// The reviewed half of the publish flow, shared by `learn review`, the
// scheduled learning reviewer, and `learn publish`: locate the artifact and
// its verdict, apply Cormidia's fail-closed review rules, route by the
// reviewer's verdict, render the destination bytes, and mint the kernel
// candidate plus its decisive review. Every step is idempotent, so recording
// a review and publishing later re-derive the same kernel facts.

import { candidateArtifactHash, findCandidateArtifact } from "./host/candidate-store.js";
import type { CandidateArtifact } from "./host/candidate.js";
import { appLearningRoot, orgLearningRoot, rootKindForScope, scopeApp, type LearningRoot } from "./host/concepts.js";
import type { LearningPolicy } from "./host/policy.js";
import { readReviewerVerdict, reviewDisposition, reviewerVerdictHash, type ReviewerVerdict } from "./host/review.js";
import { ensureKernelCandidate } from "./candidates.js";
import type { CandidateRouting } from "./host-index.js";
import type { CormidiaLearningLoop } from "./loop.js";
import { messageOf, renderCandidateSpec, type RenderedSpec } from "./publish-render.js";
import { routingOf } from "./publish-route.js";
import { ensureKernelReview } from "./reviews.js";

export interface PrepareDeps {
  readonly learning: CormidiaLearningLoop;
  readonly policy: LearningPolicy;
  /** App learning roots with a resolvable local checkout, by app name. */
  readonly appRoots?: Record<string, LearningRoot>;
  /** The app whose repository receives an org-scoped ticket. */
  readonly ticketApp?: string;
}

export interface PreparedCandidate {
  readonly artifact: CandidateArtifact;
  readonly verdict: ReviewerVerdict;
  readonly routing: CandidateRouting;
  readonly candidateRoot: LearningRoot;
  readonly destRoot: LearningRoot;
  readonly rendered: RenderedSpec;
  readonly kernelCandidateId: string;
  readonly reviewDisposition: "accept" | "revise" | "reject" | "escalate";
}

export type PreparedOutcome =
  | { readonly status: "prepared"; readonly prepared: PreparedCandidate }
  | { readonly status: "reject"; readonly artifact: CandidateArtifact; readonly verdict: ReviewerVerdict }
  | { readonly status: "refused"; readonly reason: string };

function refused(reason: string): PreparedOutcome {
  return { status: "refused", reason };
}

export function artifactAuthorOf(artifact: CandidateArtifact): string | undefined {
  return ["generated_by", "emitted_by", "author"]
    .map((key) => artifact.draft?.[key])
    .find((value): value is string => typeof value === "string");
}

/** Locate, route, render, and mint the kernel candidate and review for an
 *  artifact. `requireProceed` (publish) refuses a non-proceed disposition;
 *  review recording still mints the kernel review for every disposition
 *  except the rejection ledger's. */
export async function prepareKernelCandidate(
  deps: PrepareDeps,
  candidateId: string,
  options: { readonly requireProceed: boolean },
): Promise<PreparedOutcome> {
  const learning = deps.learning;
  const orgHome = learning.orgHome;
  const orgRoot = orgLearningRoot(orgHome);
  const found = await findCandidateArtifact([orgRoot, ...Object.values(deps.appRoots ?? {})], candidateId);
  if (found === undefined) return refused(`no candidate ${candidateId} in any learning root`);
  const { root: candidateRoot, candidate: artifact } = found;

  // Review fails closed: no verdict, no publish (spec §15).
  const verdict = await readReviewerVerdict(orgHome, candidateId);
  if (verdict === undefined) {
    return refused(
      `${candidateId} has no reviewer verdict — review fails closed; record one with: cormidia learn review ${candidateId}`,
    );
  }
  const author = artifactAuthorOf(artifact);
  if (author !== undefined && author === verdict.reviewed_by) {
    return refused(`${candidateId} author ${author} cannot count as its independent reviewer`);
  }
  const disposition = reviewDisposition(verdict);
  if (options.requireProceed && disposition !== "proceed") {
    return refused(
      `${candidateId} review disposition is "${disposition}"` +
        (verdict.rubric.injection_screen !== "clean"
          ? ` (injection screen ${verdict.rubric.injection_screen} — escalates regardless of verdict)`
          : "") +
        ` — ${verdict.rationale}`,
    );
  }
  const routing = routingOf(verdict);
  if (routing.destination === "reject") return { status: "reject", artifact, verdict };

  const app = scopeApp(routing.scope);
  const registeredApp = app === undefined ? undefined : learning.apps.find((entry) => entry.name === app);
  if (rootKindForScope(routing.scope) === "app" && (registeredApp === undefined || registeredApp.resolved === false)) {
    return refused(
      `scope "${routing.scope}" needs the ${app ?? "?"} app learning root but no local checkout was resolved — pass --app or onboard the app first`,
    );
  }
  const destRoot = registeredApp === undefined ? orgRoot : appLearningRoot(registeredApp.workdir);

  let rendered: Awaited<ReturnType<typeof renderCandidateSpec>>;
  try {
    rendered = await renderCandidateSpec({
      orgHome,
      policy: deps.policy,
      artifact,
      routing,
      candidateRoot,
      destRoot,
      ...(deps.ticketApp !== undefined ? { ticketApp: deps.ticketApp } : {}),
    });
  } catch (error) {
    return refused(messageOf(error));
  }
  if ("refused" in rendered) return refused(rendered.refused);

  // Kernel candidate + decisive review (the verified transitions). The
  // artifact's stored bytes ride in the candidate content as a digest, so
  // ANY change to the artifact after review or approval yields a new kernel
  // candidate, a new plan, and a fresh raise — the forked binding's
  // `candidate_hash` clause, kernel-shaped (B-11 §1 → B-32 §3).
  try {
    const artifactHash = await candidateArtifactHash(candidateRoot, candidateId);
    const content =
      rendered.spec.content !== null &&
      typeof rendered.spec.content === "object" &&
      !Array.isArray(rendered.spec.content)
        ? { ...rendered.spec.content, artifact_sha256: artifactHash }
        : rendered.spec.content;
    const spec = { ...rendered.spec, content };
    const ensured = await ensureKernelCandidate(learning, { artifact, routing, ...spec });
    const kernelCandidateId = ensured.view.candidate.id;
    const review = await ensureKernelReview(learning, {
      candidateId: kernelCandidateId,
      verdict,
      verdictHash: await reviewerVerdictHash(orgHome, candidateId),
    });
    return {
      status: "prepared",
      prepared: {
        artifact,
        verdict,
        routing,
        candidateRoot,
        destRoot,
        rendered,
        kernelCandidateId,
        reviewDisposition: review.disposition,
      },
    };
  } catch (error) {
    return refused(messageOf(error));
  }
}

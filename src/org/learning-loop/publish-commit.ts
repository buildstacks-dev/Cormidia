// Host bookkeeping after the kernel completed a publish: the OKF draft's move
// out of candidates/ (spec §14 step 3), the host index's plan → intervention
// link, and the `publish_committed` learning event (deterministic id keyed
// by the plan, deduped on replay) that reports and the efficiency-health
// projection count. None of this is authority — the kernel journal already
// holds the publication; this is what the org-home readers expect to find.

import { rm } from "node:fs/promises";
import type { PublicationReceipt } from "@cormidia/learning-loop";
import { conceptDraftPath } from "./host/candidate-store.js";
import type { CandidateArtifact } from "./host/candidate.js";
import { orgLearningRoot, scopeApp, type LearningRoot } from "./host/concepts.js";
import { appendLearningEventsDeduped, sanitizeIdSegment } from "./host/events.js";
import { updateHostCandidateEntry, type CandidateRouting } from "./host-index.js";
import type { CormidiaLearningLoop } from "./loop.js";
import { refsOf } from "./publish-render.js";

export interface CommitPublishedInput {
  readonly learning: CormidiaLearningLoop;
  readonly artifact: CandidateArtifact;
  readonly routing: CandidateRouting;
  readonly kernelCandidateId: string;
  readonly planId: string;
  readonly interventionId: string;
  readonly receipts: readonly PublicationReceipt[];
  readonly destRoot: LearningRoot;
  readonly candidateRoot: LearningRoot;
  readonly draftPath: string | undefined;
  /** The approval id, or `routine` for the routine lane. */
  readonly approvalRef: string;
  readonly reportedAs: string;
  readonly now: Date;
}

export async function commitPublished(input: CommitPublishedInput): Promise<string[]> {
  const { learning, artifact, routing } = input;
  const candidateId = artifact.candidate_id;
  const refs = refsOf(input.receipts, input.destRoot);
  await updateHostCandidateEntry(learning.stateDir, candidateId, input.kernelCandidateId, {
    intervention_id: input.interventionId,
    refs,
  });
  if (input.draftPath !== undefined) {
    // Move semantics (spec §14 step 3): the draft leaves candidates/ from
    // every root the renderer would look in, so the same lesson cannot be
    // re-reviewed or re-published from a stale copy.
    for (const root of [input.destRoot, input.candidateRoot, orgLearningRoot(learning.orgHome)]) {
      await rm(conceptDraftPath(root, candidateId), { force: true });
    }
  }
  const bundleVersion = routing.destination === "okf_concept" ? input.receipts[0]?.finalVersion : undefined;
  await appendLearningEventsDeduped(learning.stateHome, [
    {
      event_id: `evt_publish_${sanitizeIdSegment(input.planId)}`,
      episode_id: artifact.episode_ids[0] ?? `ep_learning_publish_${candidateId}`,
      ts: input.now.toISOString(),
      app: scopeApp(routing.scope) ?? "org",
      type: "publish_committed",
      emitter: "publisher",
      source_channel: "internal",
      trust: "trusted",
      payload: {
        candidate_id: candidateId,
        kernel_candidate_id: input.kernelCandidateId,
        destination: routing.destination,
        tier: routing.tier,
        scope: routing.scope,
        approval_ref: input.approvalRef,
        plan_id: input.planId,
        intervention_id: input.interventionId,
        reported_as: input.reportedAs,
        refs,
        ...(bundleVersion !== undefined ? { bundle_version: bundleVersion } : {}),
      },
    },
  ]);
  return refs;
}

// Agent-emitted candidate artifacts (learning/candidates/*.json, spec §9 —
// inert, agent-writable, no authority) onto the kernel's verified `propose`
// transition. The kernel candidate is minted by the HOST from the reviewed
// routing (the reviewer's destination/tier/scope govern, spec §15) and from
// kernel-resolved evidence: the artifact's cited episodes are ingested at the
// candidate's scope (the scoped projection, evidence-source.ts) and cited by
// their durable observation ids, so the kernel — not the artifact — binds
// what the candidate rests on. Re-proposal of changed bytes is an explicit
// successor with `supersedes` (same scope), never a rewrite; the host index
// (host-index.ts) keeps the artifact → kernel-candidate lineage.

import { sha256HexOfCanonicalJson } from "@cormidia/learning-loop";
import type { CandidateView, IngestReceipt, JsonValue, ProposeOutcome } from "@cormidia/learning-loop";
import type { CandidateArtifact } from "./host/candidate.js";
import { scopeApp } from "./host/concepts.js";
import { EPISODE_SOURCE_ID, projectionSuffix } from "./evidence-source.js";
import {
  appendHostCandidateEntry,
  readHostCandidateIndex,
  type CandidateRouting,
  type HostCandidateEntry,
} from "./host-index.js";
import { humanPrincipalEvidence, rolePrincipalEvidence, type CormidiaPrincipalEvidence } from "./identity.js";
import type { CormidiaLearningLoop } from "./loop.js";
import { scopeFromLoopScope } from "./scope.js";

export interface KernelCandidateSpec {
  readonly artifact: CandidateArtifact;
  readonly routing: CandidateRouting;
  readonly destinationId: string;
  /** The intervention kind the destination dispatches on. */
  readonly kind: string;
  /** The exact bytes/structure the destination will publish. */
  readonly content: JsonValue;
  readonly rollbackIntent: string;
}

export interface EnsuredKernelCandidate {
  readonly view: CandidateView;
  readonly created: boolean;
  readonly entry: HostCandidateEntry;
}

/** The principal an artifact was emitted by: its recorded author role, or the
 *  human operator when the draft carries no author (hand-authored artifact). */
export function proposerEvidenceFor(artifact: CandidateArtifact): CormidiaPrincipalEvidence {
  const author = ["generated_by", "emitted_by", "author"]
    .map((key) => artifact.draft?.[key])
    .find((value): value is string => typeof value === "string" && value.length > 0);
  if (author === undefined) return humanPrincipalEvidence("operator");
  if (author.startsWith("human:")) return humanPrincipalEvidence(author.slice("human:".length));
  const [role, runtime] = author.split(":");
  return rolePrincipalEvidence(role ?? author, runtime ?? role ?? author);
}

/** The scoped-projection input for a candidate scope (none for an app scope). */
export function projectionScopeFor(scope: string): string | undefined {
  return scopeApp(scope) !== undefined && !scope.includes("/roles/") ? undefined : scope;
}

/** Ingest every projected episode at a scope (the primary projection when absent). */
export async function ingestEpisodes(learning: CormidiaLearningLoop, scope?: string): Promise<IngestReceipt> {
  return learning.loop.ingest(learning.episodes, {
    stateHome: learning.stateHome,
    org: learning.org,
    ...(scope !== undefined ? { scope } : {}),
  });
}

/** The durable observation ids of the cited episodes at the candidate scope —
 *  what `propose` resolves into content-bound evidence references. */
export async function evidenceIdsFor(
  learning: CormidiaLearningLoop,
  episodeIds: readonly string[],
  scope: string,
): Promise<string[]> {
  const projection = projectionScopeFor(scope);
  await ingestEpisodes(learning, projection);
  const suffix = projectionSuffix(projection);
  const projected = [...new Set(episodeIds)].map((id) => `${id}${suffix}`);
  if (projected.length === 0) return [];
  const ids: string[] = [];
  for await (const page of learning.loop.queryObservations({
    sourceIds: [EPISODE_SOURCE_ID],
    episodeIds: projected,
    limit: 500,
  })) {
    for (const observation of page.items) ids.push(observation.id);
  }
  return ids.sort();
}

/** Content digest of what the kernel candidate binds (routing + intervention). */
export function kernelCandidateContentDigest(spec: Omit<KernelCandidateSpec, "artifact">): string {
  return sha256HexOfCanonicalJson({
    routing: { ...spec.routing },
    destinationId: spec.destinationId,
    kind: spec.kind,
    content: spec.content,
    rollbackIntent: spec.rollbackIntent,
  });
}

/** Propose the kernel candidate for an artifact's reviewed routing, or
 *  return the one already minted for these exact bytes. */
export async function ensureKernelCandidate(
  learning: CormidiaLearningLoop,
  spec: KernelCandidateSpec,
): Promise<EnsuredKernelCandidate> {
  const artifactId = spec.artifact.candidate_id;
  const contentDigest = kernelCandidateContentDigest(spec);
  const index = await readHostCandidateIndex(learning.stateDir, artifactId);
  const known = index?.entries.find((entry) => entry.content_digest === contentDigest);
  if (known !== undefined) {
    const view = await learning.loop.getCandidateView({ candidateId: known.id });
    if (view !== undefined) return { view, created: false, entry: known };
  }
  const entries = index?.entries ?? [];
  const latest = entries.at(-1);
  const id = entries.length === 0 ? artifactId : `${artifactId}~${contentDigest.slice(0, 8)}`;
  const supersedes = latest !== undefined && latest.routing.scope === spec.routing.scope ? latest.id : undefined;
  const evidenceIds = await evidenceIdsFor(learning, spec.artifact.episode_ids, spec.routing.scope);
  const proposer = await learning.identity.verify(proposerEvidenceFor(spec.artifact));
  const problem =
    spec.artifact.error_class !== undefined
      ? `${spec.artifact.title} (error class ${spec.artifact.error_class})`
      : spec.artifact.title;
  const outcome: ProposeOutcome = await learning.loop.propose({
    id,
    scope: scopeFromLoopScope(learning.org, spec.routing.scope),
    problem,
    hypothesis: spec.artifact.cause_hypothesis ?? spec.artifact.title,
    evidenceIds,
    intervention: {
      destinationId: spec.destinationId,
      kind: spec.kind,
      content: spec.content,
      rollbackIntent: spec.rollbackIntent,
    },
    proposedRisk: spec.routing.tier,
    proposedBy: proposer,
    ...(supersedes !== undefined ? { supersedes } : {}),
  });
  const entry: HostCandidateEntry = {
    id: outcome.candidate.id,
    routing: spec.routing,
    content_digest: contentDigest,
    proposed_at: outcome.candidate.proposedAt,
  };
  await appendHostCandidateEntry(learning.stateDir, artifactId, entry);
  return { view: outcome, created: true, entry };
}

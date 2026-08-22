// hermetic/cf-c-b11-cf-j12-r-cf-reg-251/learning-seams.ts — shared L2 world
// + artifact builders for CF-J12-R, the refusal leg of the J-12 learning
// journey, on the host-owned learning surfaces (candidate store, OKF
// concepts, resolver).
//
// Composition seams only (tests/README.md rule 2): temp org/state homes built
// by the product's own init transaction and an injected clock (B-06). The
// forked-publisher world that once lived here retired with Cormidia #467
// phase B; the kernel-path world is
// hermetic/cf-c-b32-cf-j12-cf-sm-learn/learning-kernel-seams.ts.
//
// This is a helper module, not a spec: no tests live here.

import { sha256Ref } from "../../../src/org/learning-loop/host/candidate-store.js";
import type { CandidateDestination } from "../../../src/org/learning-loop/host/candidate.js";
import { orgLearningRoot, type LearningRoot } from "../../../src/org/learning-loop/host/concepts.js";
import { defaultLearningPolicy, type LearningPolicy } from "../../../src/org/learning-loop/host/policy.js";
import type { LoopTier } from "../../../src/org/memory.js";
import { serializeOkfDocument, type OkfDocument } from "../../../src/org/memory.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

// ---------------------------------------------------------------------------
// world
// ---------------------------------------------------------------------------

export interface LearningWorld {
  org: TempOrgHome;
  state: TempStateHome;
  orgRoot: LearningRoot;
  policy: LearningPolicy;
  clock: TestClock;
  cleanup(): Promise<void>;
}

export async function makeLearningWorld(name = "learning-world"): Promise<LearningWorld> {
  const org = await makeTempOrgHome({ name });
  const state = await makeTempStateHome({ name });
  const clock = makeTestClock("2026-07-31T12:00:00.000Z");
  const policy = defaultLearningPolicy();
  return {
    org,
    state,
    orgRoot: orgLearningRoot(org.orgHome),
    policy,
    clock,
    cleanup: async () => {
      await org.cleanup();
      await state.cleanup();
    },
  };
}

// ---------------------------------------------------------------------------
// artifact builders (candidate JSON, OKF concept draft)
// ---------------------------------------------------------------------------

export interface ConceptDraftOptions {
  conceptId: string;
  /** Concept NAME — becomes the bundle filename `<name>.md`. */
  name: string;
  scope?: string;
  tier?: LoopTier;
  /** loop.status — "candidate" is the only placement candidates/ accepts. */
  status?: "candidate" | "active" | "provisional";
  body?: string;
  keywords?: string[];
  author?: string;
  ttlDays?: number;
}

export function conceptDraftDoc(options: ConceptDraftOptions): OkfDocument {
  return {
    frontmatter: {
      name: options.name,
      description: `learning concept ${options.name}`,
      type: "lesson",
      keywords: options.keywords ?? ["learning"],
      evidence: [],
      status: "active",
      created: "2026-07-30",
      updated: "2026-07-30",
      loop: {
        id: options.conceptId,
        tier: options.tier ?? "T1",
        status: options.status ?? "candidate",
        scope: options.scope ?? "org",
        version: 1,
        claim: "authorized",
        ...(options.author !== undefined ? { author: options.author } : {}),
        ...(options.ttlDays !== undefined ? { ttl_days: options.ttlDays } : {}),
      },
    },
    body: options.body ?? `Body of ${options.name}.\n`,
  };
}

export function conceptDraftMarkdown(options: ConceptDraftOptions): string {
  return serializeOkfDocument(conceptDraftDoc(options));
}

export interface CandidateSpecOptions {
  id: string;
  destination?: CandidateDestination;
  scope?: string;
  tier?: LoopTier;
  title?: string;
  errorClass?: string;
  claimsEfficacy?: boolean;
  experimentRef?: string | null;
  episodeIds?: string[];
  eventIds?: string[];
  evidenceRefs?: string[];
  draft?: Record<string, unknown>;
}

/** A valid CandidateArtifact spec; content_hash derived from the id so two
 *  different candidates never collide on the suppression key by accident. */
export function candidateSpec(options: CandidateSpecOptions): Record<string, unknown> {
  return {
    candidate_id: options.id,
    destination: options.destination ?? "okf_concept",
    title: options.title ?? `lesson from ${options.id}`,
    proposed_scope: options.scope ?? "org",
    proposed_tier: options.tier ?? "T1",
    claims_efficacy: options.claimsEfficacy ?? false,
    experiment_ref: options.experimentRef ?? null,
    ...(options.errorClass !== undefined ? { error_class: options.errorClass } : {}),
    episode_ids: options.episodeIds ?? [`ep_${options.id}`],
    event_ids: options.eventIds ?? [],
    evidence_refs: options.evidenceRefs ?? [],
    content_hash: sha256Ref(`candidate-content:${options.id}`),
    ...(options.draft !== undefined ? { draft: options.draft } : {}),
  };
}

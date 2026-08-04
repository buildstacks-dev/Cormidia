// hermetic/cf-j12/learning-seams.ts — shared L2 world + builders + local
// detectors for the HB-017 learning-activation families (CF-J12-*, and
// imported by hermetic/cf-sm-learn/ — CF-B11-* is dup-pruned onto these two
// families, case-catalog.md).
//
// Composition seams only (tests/README.md rule 2): temp org/state
// homes built by the product's own init transaction, the REAL ApprovalStore,
// the REAL publisher/resolver/review/rejection modules, an injected clock
// (B-06). Product code under test runs unmodified; the only scripted fault is
// the injected clock (`clockFuse`), which is a ratified seam, not a patch.
//
// This is a helper module, not a spec: no tests live here (its detectors are
// negative-controlled by the importing specs — README rule 3).

import { execFileSync } from "node:child_process";
import { devNull } from "node:os";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { openCandidateArtifact, sha256Ref } from "../../../src/org/learning/candidate-store.js";
import type { CandidateDestination } from "../../../src/org/learning/candidate.js";
import { orgLearningRoot, readManifest, type LearningRoot } from "../../../src/org/learning/concepts.js";
import { readLearningEvents } from "../../../src/org/learning/events.js";
import { listInterventionRecords } from "../../../src/org/learning/intervention.js";
import { defaultLearningPolicy, type LearningPolicy } from "../../../src/org/learning/policy.js";
import { publishCandidate, type PublisherDeps } from "../../../src/org/learning/publisher.js";
import { writeReviewerVerdict } from "../../../src/org/learning/review.js";
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
  approvals: ApprovalStore;
  policy: LearningPolicy;
  clock: TestClock;
  deps: PublisherDeps;
  cleanup(): Promise<void>;
}

export async function makeLearningWorld(name = "learning-world"): Promise<LearningWorld> {
  const org = await makeTempOrgHome({ name });
  const state = await makeTempStateHome({ name });
  const clock = makeTestClock("2026-07-31T12:00:00.000Z");
  const approvals = new ApprovalStore(state.stateHome);
  const policy = defaultLearningPolicy();
  const deps: PublisherDeps = {
    orgHome: org.orgHome,
    stateHome: state.stateHome,
    policy,
    approvals,
    clock: clock.dateFn,
  };
  return {
    org,
    state,
    orgRoot: orgLearningRoot(org.orgHome),
    approvals,
    policy,
    clock,
    deps,
    cleanup: async () => {
      await org.cleanup();
      await state.cleanup();
    },
  };
}

// ---------------------------------------------------------------------------
// artifact builders (candidate JSON, OKF concept draft, reviewer verdict)
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

export interface VerdictSpecOptions {
  id: string;
  verdict?: "approve" | "revise" | "reject" | "escalate";
  destination?: CandidateDestination;
  tier?: LoopTier;
  scope?: string;
  injectionScreen?: "clean" | "suspicious" | "flagged";
  reviewedBy?: string;
  rationale?: string;
}

export function verdictSpec(options: VerdictSpecOptions): Record<string, unknown> {
  return {
    schema_version: 1,
    candidate_id: options.id,
    verdict: options.verdict ?? "approve",
    proposed_destination: options.destination ?? "okf_concept",
    proposed_tier: options.tier ?? "T1",
    proposed_scope: options.scope ?? "org",
    experiment_required: false,
    rubric: {
      correctness: 4,
      generality: 4,
      scope_fit: 4,
      destination_fit: 4,
      provenance_trust: 4,
      injection_screen: options.injectionScreen ?? "clean",
    },
    conflicts_with: [],
    duplicates: [],
    eval_required: false,
    eval_present: false,
    rationale: options.rationale ?? `rationale for ${options.id}`,
    reviewed_by: options.reviewedBy ?? "human-reviewer",
    reviewed_at: "2026-07-31T11:00:00.000Z",
  };
}

/** Candidate JSON + OKF draft + approving human review — the state J-12
 *  reaches just before the publisher runs. */
export async function seedReviewedOkfCandidate(
  world: LearningWorld,
  input: { id: string; conceptId: string; name: string },
): Promise<{ markdown: string }> {
  const markdown = conceptDraftMarkdown({ conceptId: input.conceptId, name: input.name });
  await openCandidateArtifact(world.orgRoot, candidateSpec({ id: input.id }), markdown);
  await writeReviewerVerdict(world.org.orgHome, verdictSpec({ id: input.id }));
  return { markdown };
}

// ---------------------------------------------------------------------------
// approval flow shortcut
// ---------------------------------------------------------------------------

/** Run the publisher once (expecting `raised`) and approve the raised item as
 *  the human would; returns the approval id the publish transaction keys on. */
export async function raiseAndApprove(world: LearningWorld, candidateId: string): Promise<string> {
  const raised = await publishCandidate(world.deps, candidateId);
  if (raised.status !== "raised") {
    throw new Error(`expected the first publish to raise an approval, got ${JSON.stringify(raised)}`);
  }
  await world.approvals.decide(raised.approvalId, {
    decision: "approved",
    now: world.clock.nowDate(),
  });
  return raised.approvalId;
}

// ---------------------------------------------------------------------------
// clock fuse — deterministic mid-transaction crash at the injected B-06 seam
// ---------------------------------------------------------------------------

export class ClockFuseError extends Error {
  constructor(readonly call: number) {
    super(`clock fuse blew on call ${call} — scripted mid-transaction crash`);
    this.name = "ClockFuseError";
  }
}

/** A `() => Date` that serves `allowedCalls` reads then throws — the
 *  interrupted-sequence crash at the publisher's injected clock seam. The
 *  publisher reads the clock between journal steps, so the fuse kills the
 *  transaction between two specific durable writes; the caller must assert
 *  the resulting journal state (which receipts exist) so a product refactor
 *  that shifts clock reads fails the precondition loudly instead of silently
 *  testing a different crash point. */
export function clockFuse(clock: TestClock, allowedCalls: number): () => Date {
  let calls = 0;
  return () => {
    calls++;
    if (calls > allowedCalls) throw new ClockFuseError(calls);
    return clock.nowDate();
  };
}

// ---------------------------------------------------------------------------
// exactly-once detector (negative-controlled by the importing specs)
// ---------------------------------------------------------------------------

export class PublishConservationViolation extends Error {
  constructor(problems: string[]) {
    super(`publish transaction conservation violated: ${problems.join("; ")}`);
    this.name = "PublishConservationViolation";
  }
}

export interface ExactlyOnceInput {
  world: LearningWorld;
  candidateId: string;
  /** loop id of the activated concept (okf publishes only). */
  conceptId?: string;
}

/** Fires (throws PublishConservationViolation) when any leg of a publish
 *  transaction happened more than once: duplicate manifest cuts for the same
 *  approval or concept, duplicate publish_committed event ids, more than one
 *  intervention record for the candidate. */
export async function assertExactlyOncePublish(input: ExactlyOnceInput): Promise<void> {
  const problems: string[] = [];

  const interventions = (await listInterventionRecords(input.world.org.orgHome)).filter(
    (record) => record.candidate_ref === input.candidateId,
  );
  if (interventions.length !== 1) {
    problems.push(`${interventions.length} intervention records for ${input.candidateId}`);
  }

  const manifest = await readManifest(input.world.orgRoot);
  if (input.conceptId !== undefined) {
    const cuts = (manifest?.history ?? []).filter((entry) =>
      entry.concepts.includes(input.conceptId!),
    );
    if (cuts.length !== 1) {
      problems.push(`${cuts.length} manifest cuts touch concept ${input.conceptId}`);
    }
  }
  const approvalRefs = (manifest?.history ?? [])
    .map((entry) => entry.approval_ref)
    .filter((ref): ref is string => ref !== null);
  if (new Set(approvalRefs).size !== approvalRefs.length) {
    problems.push(`duplicate approval_ref in manifest history: ${approvalRefs.join(", ")}`);
  }

  // readLearningEvents does NOT dedup on read (dedup is append-time), so a
  // double-emit is visible here as two rows with the same event_id.
  const committed = (await readLearningEvents(input.world.state.stateHome)).filter(
    (event) =>
      event.type === "publish_committed" &&
      (event.payload?.["candidate_id"] as string | undefined) === input.candidateId,
  );
  if (committed.length !== 1) {
    problems.push(`${committed.length} publish_committed events for ${input.candidateId}`);
  }

  if (problems.length > 0) throw new PublishConservationViolation(problems);
}

// ---------------------------------------------------------------------------
// org-home git substrate (B-11: governed substrate is the committed org home)
// ---------------------------------------------------------------------------

/** Hermetic git env, mirroring fixtures/git-repo.ts: host config never leaks. */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
};

export interface OrgHomeGit {
  git(args: string[]): string;
  /** `git status --porcelain -uall` relative paths (status prefix stripped). */
  dirtyPaths(): string[];
}

/** Turn the temp org home into what it is in production: a committed git
 *  repo. Everything present (including the seeded candidate/review) becomes
 *  the baseline commit, so the post-publish diff is exactly the publisher's
 *  writes. */
export function gitInitOrgHome(orgHome: string): OrgHomeGit {
  const git = (args: string[]): string =>
    execFileSync("git", args, {
      cwd: orgHome,
      env: GIT_ENV,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    }).trim();
  git(["init", "-b", "main", "."]);
  git(["config", "user.name", "Cormidia Learning Spec"]);
  git(["config", "user.email", "learning-spec@cormidia.invalid"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["add", "-A"]);
  git(["commit", "--no-gpg-sign", "-m", "baseline: org home before publish"]);
  return {
    git,
    // Raw (untrimmed) output: `git()` trims, which would eat the leading
    // status space of the first ` D path` line and corrupt its path slice.
    dirtyPaths: () =>
      execFileSync("git", ["status", "--porcelain", "-uall"], {
        cwd: orgHome,
        env: GIT_ENV,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15_000,
      })
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.slice(3)),
  };
}

export class SubstrateEscapeError extends Error {
  constructor(readonly escaped: string[]) {
    super(
      `publisher writes escaped the learning substrate: ${escaped.join(", ")} — ` +
        `B-11 output guarantee: writes land only on allowlisted learning destinations`,
    );
    this.name = "SubstrateEscapeError";
  }
}

/** Fires when any dirty org-home path lies outside `learning/`. */
export function assertConfinedToLearning(dirtyPaths: string[]): void {
  const escaped = dirtyPaths.filter((path) => !path.startsWith("learning/"));
  if (escaped.length > 0) throw new SubstrateEscapeError(escaped);
}

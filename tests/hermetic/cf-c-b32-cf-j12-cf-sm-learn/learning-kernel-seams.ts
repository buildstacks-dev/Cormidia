// hermetic/cf-c-b32-cf-j12-cf-sm-learn/learning-kernel-seams.ts — shared L2
// world + builders + local detectors for the J-12 learning journey and the
// SM-LEARN state-machine families on the KERNEL path (Cormidia #467 phase B;
// B-32). The fork-era seams (hermetic/cf-c-b11-…/learning-seams.ts) built the
// same shapes over the forked publisher; these build them over the composed
// kernel loop and the adapter-layer publish flow, with the REAL ApprovalStore,
// the real OKF/proposal destinations on temp org/app/state homes, the real
// host resolver, and an injected clock (B-06). Product code under test runs
// unmodified; the only scripted faults are the clock and a destination
// wrapper that crashes at a named step.
//
// Helper module, not a spec (tests/README.md rule 2/3): its detectors are
// negative-controlled by the importing specs.

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { devNull } from "node:os";
import { join } from "node:path";
import type { PublicationDestination } from "@cormidia/learning-loop";
import { createSequentialIds } from "@cormidia/learning-loop/testing";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { createCormidiaLearningLoop, type CormidiaLearningLoop } from "../../../src/org/learning-loop/loop.js";
import { listKernelInterventions } from "../../../src/org/learning-loop/interventions.js";
import { publishCandidate, type PublishDeps, type PublishOutcome } from "../../../src/org/learning-loop/publish.js";
import type { CormidiaReplayRunner } from "../../../src/org/learning-loop/replay-executor.js";
import { openCandidateArtifact, sha256Ref } from "../../../src/org/learning-loop/host/candidate-store.js";
import type { CandidateDestination } from "../../../src/org/learning-loop/host/candidate.js";
import {
  appLearningRoot,
  orgLearningRoot,
  readManifest,
  type LearningRoot,
} from "../../../src/org/learning-loop/host/concepts.js";
import { readLearningEvents } from "../../../src/org/learning-loop/host/events.js";
import { defaultLearningPolicy, type LearningPolicy } from "../../../src/org/learning-loop/host/policy.js";
import { writeReviewerVerdict } from "../../../src/org/learning-loop/host/review.js";
import type { LoopTier } from "../../../src/org/memory.js";
import { serializeOkfDocument, type OkfDocument } from "../../../src/org/memory.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

export { sha256Ref };

export const KERNEL_ORG = "fixture-org";
export const KERNEL_APP = "fixture-app";
export const KERNEL_EPISODE = "ep_kernel_ticket_0001";

// ---------------------------------------------------------------------------
// world
// ---------------------------------------------------------------------------

export interface KernelWorld {
  org: TempOrgHome;
  state: TempStateHome;
  appWorkdir: string;
  orgRoot: LearningRoot;
  appRoot: LearningRoot;
  approvals: ApprovalStore;
  policy: LearningPolicy;
  clock: TestClock;
  learning: CormidiaLearningLoop;
  deps: PublishDeps;
  cleanup(): Promise<void>;
}

/** A closed, succeeded app episode — the durable evidence every kernel
 *  candidate must cite (the kernel resolves evidence; a bare id is never
 *  enough). */
export function episodeRecord(episodeId: string, ticket: string): Record<string, unknown> {
  return {
    schema_version: 1,
    episode_id: episodeId,
    kind: "build_ticket",
    app: KERNEL_APP,
    source: { kind: "github_issue", ref: ticket },
    stage: null,
    risk_tier: null,
    opened: "2026-07-30T09:00:00.000Z",
    closed: "2026-07-30T10:00:00.000Z",
    status: "closed",
    fingerprint_ref: null,
    bundle_lineage: null,
    turns: [],
    gates: [{ gate: "typecheck", status: "pass", run_id: "run-1" }],
    approvals: [],
    artifacts: [],
    side_effects: [],
    outcome: {
      completed: true,
      merged: true,
      release_disposition: "merged",
      review_cycles: 1,
      gate_failures: 0,
      human_interventions: 0,
      cost_usd: 0.5,
      cost_estimated: false,
      unsettled_runs: [],
      terminal_reason: "completed",
    },
    late_outcomes: [],
    human_observations: [],
  };
}

export interface MakeKernelWorldOptions {
  approvalId?: string;
  /** Extra closed episodes to seed beside KERNEL_EPISODE. */
  episodes?: readonly string[];
  /** A replay runner to bind (kernel experiments); absent, none can run. */
  replayRunner?: CormidiaReplayRunner;
  /** The B-32 §4 destination-port test seam (crash injection). */
  wrapDestination?: (adapter: PublicationDestination) => PublicationDestination;
}

export async function makeKernelWorld(
  name = "kernel-world",
  options: MakeKernelWorldOptions = {},
): Promise<KernelWorld> {
  const org = await makeTempOrgHome({ name });
  const state = await makeTempStateHome({ name });
  const clock = makeTestClock("2026-07-31T12:00:00.000Z");
  const approvals = new ApprovalStore(state.stateHome, {
    now: clock.dateFn,
    ...(options.approvalId !== undefined ? { idSource: () => options.approvalId ?? "" } : {}),
  });
  const appWorkdir = join(org.root, "apps", KERNEL_APP);
  await mkdir(appWorkdir, { recursive: true });
  await mkdir(state.path("learning", "episodes"), { recursive: true });
  for (const episodeId of [KERNEL_EPISODE, ...(options.episodes ?? [])]) {
    await writeFile(
      state.path("learning", "episodes", `${episodeId}.json`),
      `${JSON.stringify(episodeRecord(episodeId, `${KERNEL_APP}#1`), null, 2)}\n`,
    );
  }
  const policy = defaultLearningPolicy();
  const learning = createCormidiaLearningLoop({
    orgHome: org.orgHome,
    stateHome: state.stateHome,
    org: KERNEL_ORG,
    approvals,
    policy,
    apps: [{ name: KERNEL_APP, workdir: appWorkdir, resolved: true }],
    ...(options.replayRunner !== undefined ? { replayRunner: options.replayRunner } : {}),
    ...(options.wrapDestination !== undefined ? { wrapDestination: options.wrapDestination } : {}),
    clock: { now: () => clock.nowIso() },
    ids: createSequentialIds(name),
  });
  const appRoot = appLearningRoot(appWorkdir);
  const deps: PublishDeps = {
    learning,
    policy,
    approvals,
    appRoots: { [KERNEL_APP]: appRoot },
    actor: "human:operator",
    clock: clock.dateFn,
  };
  return {
    org,
    state,
    appWorkdir,
    orgRoot: orgLearningRoot(org.orgHome),
    appRoot,
    approvals,
    policy,
    clock,
    learning,
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

/** A valid CandidateArtifact spec citing the seeded episode; content_hash
 *  derived from the id so two candidates never collide on the suppression key. */
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
    episode_ids: options.episodeIds ?? [KERNEL_EPISODE],
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
    reviewed_by: options.reviewedBy ?? "human:reviewer",
    reviewed_at: "2026-07-31T11:00:00.000Z",
  };
}

/** Candidate JSON + OKF draft + approving human review — the state J-12
 *  reaches just before the kernel publish runs. */
export async function seedReviewedOkfCandidate(
  world: KernelWorld,
  input: { id: string; conceptId: string; name: string; scope?: string },
): Promise<{ markdown: string }> {
  const scope = input.scope ?? "org";
  const root = scope.startsWith("apps/") ? world.appRoot : world.orgRoot;
  const markdown = conceptDraftMarkdown({ conceptId: input.conceptId, name: input.name, scope });
  await openCandidateArtifact(root, candidateSpec({ id: input.id, scope }), markdown);
  await writeReviewerVerdict(world.org.orgHome, verdictSpec({ id: input.id, scope }));
  return { markdown };
}

// ---------------------------------------------------------------------------
// approval flow shortcut
// ---------------------------------------------------------------------------

/** Run the publish flow once (expecting `raised`) and approve the raised item as
 *  the human would; returns the approval id the kernel plan is bound to. */
export async function raiseAndApprove(world: KernelWorld, candidateId: string): Promise<string> {
  const raised: PublishOutcome = await publishCandidate(world.deps, candidateId);
  if (raised.status !== "raised") {
    throw new Error(`expected the first publish to raise an approval, got ${JSON.stringify(raised)}`);
  }
  await world.approvals.decide(raised.approvalId, { decision: "approved", now: world.clock.nowDate() });
  return raised.approvalId;
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
  world: KernelWorld;
  candidateId: string;
  /** loop id of the activated concept (okf publishes only). */
  conceptId?: string;
  root?: LearningRoot;
}

/** Fires (throws PublishConservationViolation) when any leg of a publish
 *  happened more than once: duplicate manifest cuts for the same key or
 *  concept, duplicate publish_committed event ids, more than one kernel
 *  intervention for the artifact. */
export async function assertExactlyOncePublish(input: ExactlyOnceInput): Promise<void> {
  const problems: string[] = [];
  const interventions = (await listKernelInterventions(input.world.learning)).filter(
    (view) => view.artifactId === input.candidateId,
  );
  if (interventions.length !== 1) {
    problems.push(`${interventions.length} kernel interventions for ${input.candidateId}`);
  }
  const manifest = await readManifest(input.root ?? input.world.orgRoot);
  if (input.conceptId !== undefined) {
    const conceptId = input.conceptId;
    const cuts = (manifest?.history ?? []).filter((entry) => entry.concepts.includes(conceptId));
    if (cuts.length !== 1) problems.push(`${cuts.length} manifest cuts touch concept ${conceptId}`);
  }
  const refs = (manifest?.history ?? [])
    .map((entry) => entry.approval_ref)
    .filter((ref): ref is string => ref !== null);
  if (new Set(refs).size !== refs.length)
    problems.push(`duplicate approval_ref in manifest history: ${refs.join(", ")}`);
  // readLearningEvents does NOT dedup on read (dedup is append-time), so a
  // double-emit is visible here as two rows with the same event_id.
  const committed = (await readLearningEvents(input.world.state.stateHome)).filter(
    (event) => event.type === "publish_committed" && event.payload?.["candidate_id"] === input.candidateId,
  );
  if (committed.length !== 1) problems.push(`${committed.length} publish_committed events for ${input.candidateId}`);
  if (problems.length > 0) throw new PublishConservationViolation(problems);
}

// ---------------------------------------------------------------------------
// org-home git substrate (B-11: governed substrate is the committed org home)
// ---------------------------------------------------------------------------

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
 *  repo. Everything present becomes the baseline commit, so the post-publish
 *  diff is exactly the destination's writes. */
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
      `destination writes escaped the learning substrate: ${escaped.join(", ")} — ` +
        `B-32 §1 output guarantee: the org home receives only the destinations' writes under learning/`,
    );
    this.name = "SubstrateEscapeError";
  }
}

/** Fires when any dirty org-home path lies outside `learning/`. */
export function assertConfinedToLearning(dirtyPaths: string[]): void {
  const escaped = dirtyPaths.filter((path) => !path.startsWith("learning/"));
  if (escaped.length > 0) throw new SubstrateEscapeError(escaped);
}

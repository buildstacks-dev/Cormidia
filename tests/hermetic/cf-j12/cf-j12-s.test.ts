// CF-J12-S — capture→episode→candidate→review→publish happy path on a temp
// org-home git (L2 state; case-catalog.md; contracts/B-11-learning-publisher.md;
// INV-012; T-10; journey-acceptance J-12).
//
// Honestly stated scope: the "capture→episode" leg here is a captured
// learning EVENT carrying the episode id the candidate cites — the full
// runlog→capture→episode projection pipeline is other tickets' families.
// Everything from candidate onward is the real product path: candidate store,
// reviewer verdict, content-bound approval in the real ApprovalStore, and the
// real journaled publisher writing the governed substrate of a real git repo
// (the committed org home, B-11's other side).

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Ref } from "../../../src/org/learning/candidate-store.js";
import { bindingOf } from "../../../src/org/learning/binding.js";
import { assertConceptPlacement, readManifest, type LearningManifest } from "../../../src/org/learning/concepts.js";
import {
  appendLearningEventsDeduped,
  readLearningEvents,
  sanitizeIdSegment,
  type LearningEvent,
} from "../../../src/org/learning/events.js";
import { readInterventionRecord } from "../../../src/org/learning/intervention.js";
import { publishCandidate, type PublishOutcome } from "../../../src/org/learning/publisher.js";
import { resolveLearningContext } from "../../../src/org/learning/resolver.js";
import { parseOkfDocument } from "../../../src/org/memory.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import {
  assertConfinedToLearning,
  assertExactlyOncePublish,
  candidateSpec,
  conceptDraftMarkdown,
  gitInitOrgHome,
  makeLearningWorld,
  PublishConservationViolation,
  SubstrateEscapeError,
  verdictSpec,
  type LearningWorld,
  type OrgHomeGit,
} from "./learning-seams.js";
import { openCandidateArtifact } from "../../../src/org/learning/candidate-store.js";
import { writeReviewerVerdict } from "../../../src/org/learning/review.js";

const CAND = "cand_j12s_lesson";
const CONCEPT = "lrn_j12s_lesson";
const NAME = "j12s-default-branch-lesson";
const EPISODE = "ep_j12s_build_1";
const EVENT = "evt_j12s_error_1";

describe("CF-J12-S — capture→episode→candidate→review→publish happy path (L2, temp org-home git)", () => {
  let world: LearningWorld;
  let git: OrgHomeGit;
  let approvalId: string;
  let raisedOutcome: PublishOutcome;
  let published: PublishOutcome;
  let approvedDiffHash: string;
  let dirtyAfterRaise: string[];

  beforeAll(async () => {
    world = await makeLearningWorld("cf-j12-s");

    // -- capture: a trusted orchestrator error event ties episode → candidate.
    const captured: LearningEvent = {
      event_id: EVENT,
      episode_id: EPISODE,
      turn_id: "turn_j12s_1",
      ts: world.clock.nowIso(),
      app: "fixture-app",
      type: "error",
      error_class: "build.default-branch-guess",
      emitter: "orchestrator",
      source_channel: "internal",
      trust: "trusted",
    };
    await appendLearningEventsDeduped(world.state.stateHome, [captured]);

    // -- candidate: agent-writable store, citing the captured evidence.
    await openCandidateArtifact(
      world.orgRoot,
      candidateSpec({ id: CAND, episodeIds: [EPISODE], eventIds: [EVENT] }),
      conceptDraftMarkdown({ conceptId: CONCEPT, name: NAME }),
    );

    // -- review: human approve, destination okf_concept (activation ⇒ gated).
    await writeReviewerVerdict(world.org.orgHome, verdictSpec({ id: CAND }));

    // The org home is a committed git repo in production; baseline commits
    // the under-review state so the post-publish diff isolates the
    // publisher's writes.
    git = gitInitOrgHome(world.org.orgHome);

    // -- publish attempt 1: raises the content-bound approval, writes nothing.
    raisedOutcome = await publishCandidate(world.deps, CAND);
    if (raisedOutcome.status !== "raised") {
      throw new Error(`expected raised, got ${JSON.stringify(raisedOutcome)}`);
    }
    approvalId = raisedOutcome.approvalId;
    dirtyAfterRaise = git.dirtyPaths();
    const pending = await world.approvals.listPending();
    approvedDiffHash = bindingOf(pending[0]!)!.final_diff_hash;

    // -- human decision in the real approvals store.
    await world.approvals.decide(approvalId, {
      decision: "approved",
      now: world.clock.nowDate(),
    });
    world.clock.advance(1_000);

    // -- publish attempt 2: the journaled transaction commits.
    published = await publishCandidate(world.deps, CAND);
  }, 30_000);

  afterAll(async () => {
    await world.cleanup();
  });

  it("raising the approval publishes NOTHING — candidate stays a candidate until the human decides (INV-012: agents only propose)", () => {
    // Snapshot taken in beforeAll right after the raise, against the
    // baseline commit: zero org-home writes happened at raise time (the
    // pending approval item lives in the state home, not the substrate).
    expect(dirtyAfterRaise).toEqual([]);
    // The raised item is content-bound to exact bytes.
    expect(approvedDiffHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("publishes after approval: activated concept lands in bundle/<scope> with the exact approved bytes", async () => {
    expect(published.status).toBe("published");
    const conceptPath = join(world.org.orgHome, "learning", "bundle", "org", `${NAME}.md`);
    expect(existsSync(conceptPath)).toBe(true);
    const bytes = await readFile(conceptPath, "utf8");
    // Content binding held end-to-end: bytes on disk hash to the approved
    // final_diff_hash (B-11 §1: one content-hash-bound transaction).
    expect(sha256Ref(bytes)).toBe(approvedDiffHash);
    // The activated doc is a valid bundle-placement concept (status active).
    const doc = parseOkfDocument(bytes, conceptPath);
    expect(() => assertConceptPlacement(doc, "bundle")).not.toThrow();
    expect(doc.frontmatter.loop?.status).toBe("active");
    // Move semantics: the draft left candidates/; the candidate JSON remains
    // as evidence.
    expect(existsSync(join(world.org.orgHome, "learning", "candidates", `${CAND}.md`))).toBe(false);
    expect(existsSync(join(world.org.orgHome, "learning", "candidates", `${CAND}.json`))).toBe(true);
  });

  it("cuts one manifest version carrying the approval ref and the concept id", async () => {
    const manifest = (await readManifest(world.orgRoot)) as LearningManifest;
    expect(manifest).not.toBeNull();
    expect(manifest.history).toHaveLength(1);
    expect(manifest.history[0]!.approval_ref).toBe(approvalId);
    expect(manifest.history[0]!.concepts).toEqual([CONCEPT]);
    expect(manifest.bundle_version).toBe(manifest.history[0]!.version);
    expect(manifest.stable).toBe(manifest.history[0]!.version);
  });

  it("records the intervention lineage: status active, claim authorized — NOT validated (INV-012 distinct states)", async () => {
    const record = await readInterventionRecord(world.org.orgHome, "int_j12s_lesson");
    expect(record.candidate_ref).toBe(CAND);
    expect(record.status).toBe("active");
    expect(record.approval_ref).toBe(approvalId);
    // Activation carries the authorized claim; validated exists only
    // downstream of a completed experiment — never minted by a publish.
    expect(record.activation?.claim).toBe("authorized");
    expect(record.experiment_ref).toBeNull();
    expect(record.affected_episodes?.query).toContain("bundle_versions.org");
  });

  it("emits publish_committed exactly once, from the publisher emitter, trusted", async () => {
    await assertExactlyOncePublish({ world, candidateId: CAND, conceptId: CONCEPT });
    const events = await readLearningEvents(world.state.stateHome);
    const committed = events.filter((event) => event.type === "publish_committed");
    expect(committed).toHaveLength(1);
    expect(committed[0]!.emitter).toBe("publisher");
    expect(committed[0]!.trust).toBe("trusted");
    expect(committed[0]!.payload?.["approval_ref"]).toBe(approvalId);
    // The captured error event that started the journey is still there —
    // capture and substrate are independent boundary sides (B-11).
    expect(events.some((event) => event.event_id === EVENT)).toBe(true);
  });

  it("consumes the single-use grant and marks the journal done", async () => {
    const { item, grant } = await world.approvals.show(approvalId);
    expect(item.decision).toBe("approved");
    // BLOCKED:F-PT-008 — grant-EXPIRY item disposition is an open finding;
    // this asserts only consumption of a live grant, never expiry behavior.
    expect(grant?.uses).toBe(0);
    const journalPath = join(
      world.state.stateHome,
      "learning",
      "publish-journal",
      `${sanitizeIdSegment(approvalId)}.json`,
    );
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { done_at?: string };
    expect(journal.done_at).toBeDefined();
  });

  it("the published concept now resolves for subsequent turns (activation is the state change that matters)", async () => {
    const resolved = await resolveLearningContext({
      orgHome: world.org.orgHome,
      app: "fixture-app",
      role: "builder",
      turnId: "turn_j12s_post",
      episodeId: "ep_j12s_post",
      taskText: "any task",
      policy: world.policy,
      // dry resolve: no stateHome, so this read pins/emits nothing.
    });
    expect(resolved.concept_ids).toEqual([CONCEPT]);
    const manifest = (await readManifest(world.orgRoot)) as LearningManifest;
    expect(resolved.bundle_versions["org"]).toBe(manifest.bundle_version);
  });

  it("every publisher write stays inside the org home's learning/ substrate (temp org-home git diff)", async () => {
    const dirty = git.dirtyPaths();
    expect(dirty.length).toBeGreaterThan(0);
    assertConfinedToLearning(dirty);
    expect(dirty).toContain(`learning/bundle/org/${NAME}.md`);
    expect(dirty).toContain("learning/manifest.yaml");
    expect(dirty).toContain("learning/interventions/int_j12s_lesson.json");
    // Sweep guard: the governed tree is non-empty (no green by absence).
    await assertNonEmptyWalk(join(world.org.orgHome, "learning"), /bundle\/org\/.+\.md$/);
    await assertNonEmptyWalk(join(world.state.stateHome, "learning", "events"));
  });

  it("negative control: a write escaping learning/ makes the substrate-confinement detector fire", async () => {
    // Seed the violation: a stray write outside the learning substrate.
    const stray = join(world.org.orgHome, "memory", "smuggled-by-publisher.md");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(stray, "escaped\n", "utf8");
    expect(() => assertConfinedToLearning(git.dirtyPaths())).toThrow(SubstrateEscapeError);
    const { rm } = await import("node:fs/promises");
    await rm(stray);
  });

  it("negative control: a seeded duplicate publish_committed event makes the exactly-once detector fire", async () => {
    // Seed the violation at the raw JSONL layer (bypassing the product's
    // append-time dedup, as a crashed half-migrated writer could).
    const events = await readLearningEvents(world.state.stateHome);
    const committed = events.find((event) => event.type === "publish_committed")!;
    const { appendFile } = await import("node:fs/promises");
    const dir = join(world.state.stateHome, "learning", "events", committed.ts.slice(0, 10));
    await appendFile(join(dir, "publisher.jsonl"), JSON.stringify(committed) + "\n", "utf8");
    await expect(assertExactlyOncePublish({ world, candidateId: CAND, conceptId: CONCEPT })).rejects.toThrow(
      PublishConservationViolation,
    );
  });
});

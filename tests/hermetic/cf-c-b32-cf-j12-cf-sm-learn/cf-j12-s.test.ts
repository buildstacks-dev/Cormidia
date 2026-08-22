// Traceability: CF-J12-S · HB-157; CF-C-B32 · HB-156; CF-C-B11 · HB-017 · contracts/journey-acceptance.md J-12 success criterion; contracts/B-32-learning-kernel-ports.md.

// CF-J12-S — capture→episode→candidate→review→publish happy path on the
// KERNEL path over a temp org-home git (L2 state; Cormidia #467 phase B;
// INV-012; INV-013; T-10; journey-acceptance J-12).
//
// Honestly stated scope: the "capture→episode" leg here is a closed episode
// record the candidate cites (the runlog→capture→episode projection is other
// families). Everything from candidate onward is the real product path: the
// candidate artifact store, the reviewer verdict, the kernel candidate and
// decisive review minted from them, the content-bound kernel plan raised as
// a `learning_loop_publish` item in the real ApprovalStore, and the kernel's
// journaled publish through the OKF destination writing the governed
// substrate of a real git repo.

//
// F-PT-008 is resolved-ratified: expiry reopens the original item with append-only history.
// The approval assertions below cover consumption of a live authorization
// only; the dedicated expiry-disposition cases live with CF-B09a.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorizationBindingDigest } from "@cormidia/learning-loop";
import { publishBindingDigestOf } from "../../../src/org/learning-loop/authority.js";
import { listKernelInterventions } from "../../../src/org/learning-loop/interventions.js";
import { publishCandidate, type PublishOutcome } from "../../../src/org/learning-loop/publish.js";
import { openCandidateArtifact } from "../../../src/org/learning-loop/host/candidate-store.js";
import { assertConceptPlacement, readManifest } from "../../../src/org/learning-loop/host/concepts.js";
import { readLearningEvents } from "../../../src/org/learning-loop/host/events.js";
import { resolveLearningContext } from "../../../src/org/learning-loop/host/resolver.js";
import { writeReviewerVerdict } from "../../../src/org/learning-loop/host/review.js";
import { parseOkfDocument } from "../../../src/org/memory.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import {
  assertConfinedToLearning,
  assertExactlyOncePublish,
  candidateSpec,
  conceptDraftMarkdown,
  gitInitOrgHome,
  KERNEL_APP,
  KERNEL_EPISODE,
  makeKernelWorld,
  PublishConservationViolation,
  SubstrateEscapeError,
  verdictSpec,
  type KernelWorld,
  type OrgHomeGit,
} from "./learning-kernel-seams.js";

const CAND = "cand_j12s_lesson";
const CONCEPT = "lrn_j12s_lesson";
const NAME = "j12s-default-branch-lesson";

describe("CF-J12-S — candidate→review→publish happy path on the kernel path (L2, temp org-home git)", () => {
  let world: KernelWorld;
  let git: OrgHomeGit;
  let approvalId: string;
  let published: PublishOutcome;
  let boundDigest: string;
  let dirtyAfterRaise: string[];

  beforeAll(async () => {
    world = await makeKernelWorld("cf-j12-s-kernel");

    // -- candidate: agent-writable store, citing the closed episode.
    await openCandidateArtifact(
      world.orgRoot,
      candidateSpec({ id: CAND, episodeIds: [KERNEL_EPISODE] }),
      conceptDraftMarkdown({ conceptId: CONCEPT, name: NAME }),
    );
    // -- review: human approve, destination okf_concept (activation ⇒ gated).
    await writeReviewerVerdict(world.org.orgHome, verdictSpec({ id: CAND }));

    git = gitInitOrgHome(world.org.orgHome);

    // -- publish attempt 1: mints the kernel candidate + review, prepares the
    // content-bound plan, raises the approval — and writes nothing governed.
    const raised = await publishCandidate(world.deps, CAND);
    if (raised.status !== "raised") throw new Error(`expected raised, got ${JSON.stringify(raised)}`);
    approvalId = raised.approvalId;
    dirtyAfterRaise = git.dirtyPaths();
    const pending = (await world.approvals.listPending())[0];
    if (pending === undefined) throw new Error("no pending approval");
    boundDigest = publishBindingDigestOf(pending) ?? "";

    await world.approvals.decide(approvalId, { decision: "approved", now: world.clock.nowDate() });
    world.clock.advance(1_000);

    // -- publish attempt 2: the kernel's journaled transaction commits.
    published = await publishCandidate(world.deps, CAND);
  }, 60_000);

  afterAll(async () => {
    await world.cleanup();
  });

  it("raising the approval publishes NOTHING — the kernel candidate and plan exist, the substrate is untouched (INV-012)", () => {
    expect(dirtyAfterRaise).toEqual([]);
    // The raised item is bound to the exact plan bytes (kernel decision 0025).
    expect(boundDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("publishes after approval: the activated concept lands in bundle/<scope> with the exact bytes the plan bound", async () => {
    expect(published.status).toBe("published");
    const conceptPath = join(world.org.orgHome, "learning", "bundle", "org", `${NAME}.md`);
    expect(existsSync(conceptPath)).toBe(true);
    const bytes = await readFile(conceptPath, "utf8");
    const doc = parseOkfDocument(bytes, conceptPath);
    expect(() => assertConceptPlacement(doc, "bundle")).not.toThrow();
    expect(doc.frontmatter.loop?.status).toBe("active");
    expect(doc.frontmatter.loop?.id).toBe(CONCEPT);
    // Move semantics: the draft left candidates/; the candidate JSON remains as evidence.
    expect(existsSync(join(world.org.orgHome, "learning", "candidates", `${CAND}.md`))).toBe(false);
    expect(existsSync(join(world.org.orgHome, "learning", "candidates", `${CAND}.json`))).toBe(true);
  });

  it("cuts one manifest version keyed by the kernel idempotency key and naming the concept id", async () => {
    const manifest = await readManifest(world.orgRoot);
    if (manifest === null) throw new Error("no manifest");
    expect(manifest).not.toBeNull();
    expect(manifest.history).toHaveLength(1);
    expect(manifest.history[0]?.approval_ref).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.history[0]?.concepts).toEqual([CONCEPT]);
    expect(manifest.bundle_version).toBe(manifest.history[0]?.version);
    expect(manifest.stable).toBe(manifest.history[0]?.version);
  });

  it("the kernel intervention is published, authorized by the approval item, active, and UNTESTED — authorized never reads as validated (INV-012)", async () => {
    if (published.status !== "published") return;
    const record = await world.learning.loop.getIntervention({ interventionId: published.intervention.id });
    expect(record?.state).toEqual({
      publication: "published",
      authorization: "authorized",
      activation: "active",
      validation: "untested",
    });
    expect(record?.authorizationIds).toHaveLength(1);
    expect(published.intervention.claim).toBe("authorized");
    expect(published.intervention.claimLabel).toBe("authorized (unproven)");
    // The approval item the kernel consumed binds the exact plan.
    const { item } = await world.approvals.show(approvalId);
    expect(item.action.tool).toBe("learning_loop_publish");
    expect(publishBindingDigestOf(item)).toBe(boundDigest);
    const views = await listKernelInterventions(world.learning);
    expect(views.map((view) => view.artifactId)).toEqual([CAND]);
    expect(authorizationBindingDigest).toBeTypeOf("function");
  });

  it("emits publish_committed exactly once, from the publisher emitter, trusted, naming the approval and the kernel plan", async () => {
    await assertExactlyOncePublish({ world, candidateId: CAND, conceptId: CONCEPT });
    const events = await readLearningEvents(world.state.stateHome);
    const committed = events.filter((event) => event.type === "publish_committed");
    expect(committed).toHaveLength(1);
    expect(committed[0]?.emitter).toBe("publisher");
    expect(committed[0]?.trust).toBe("trusted");
    expect(committed[0]?.payload?.["approval_ref"]).toBe(approvalId);
    expect(committed[0]?.payload?.["plan_id"]).toMatch(/^plan-[0-9a-f]{64}$/);
  });

  it("the published concept now resolves for subsequent turns through the manifest-rendered context", async () => {
    const resolved = await resolveLearningContext({
      orgHome: world.org.orgHome,
      app: KERNEL_APP,
      role: "builder",
      turnId: "turn_j12s_post",
      episodeId: "ep_j12s_post",
      taskText: "any task",
      policy: world.policy,
    });
    expect(resolved.concept_ids).toEqual([CONCEPT]);
    const manifest = await readManifest(world.orgRoot);
    if (manifest === null) throw new Error("no manifest");
    expect(resolved.bundle_versions["org"]).toBe(manifest.bundle_version);
  });

  it("every destination write stays inside the org home's learning/ substrate; kernel records live only under <state>/learning-loop", async () => {
    const dirty = git.dirtyPaths();
    expect(dirty.length).toBeGreaterThan(0);
    assertConfinedToLearning(dirty);
    expect(dirty).toContain(`learning/bundle/org/${NAME}.md`);
    expect(dirty).toContain("learning/manifest.yaml");
    // No forked-engine intervention record is written by the kernel path.
    expect(dirty.some((path) => path.startsWith("learning/interventions/"))).toBe(false);
    await assertNonEmptyWalk(join(world.org.orgHome, "learning"), /bundle\/org\/.+\.md$/);
    await assertNonEmptyWalk(world.learning.stateDir, /store\//);
  });

  it("negative control: a write escaping learning/ makes the substrate-confinement detector fire", async () => {
    const stray = join(world.org.orgHome, "memory", "smuggled-by-destination.md");
    const { writeFile, rm } = await import("node:fs/promises");
    await writeFile(stray, "escaped\n", "utf8");
    expect(() => assertConfinedToLearning(git.dirtyPaths())).toThrow(SubstrateEscapeError);
    await rm(stray);
  });

  it("negative control: a seeded duplicate publish_committed event makes the exactly-once detector fire", async () => {
    const events = await readLearningEvents(world.state.stateHome);
    const committed = events.find((event) => event.type === "publish_committed");
    if (committed === undefined) throw new Error("no publish_committed event");
    const { appendFile } = await import("node:fs/promises");
    const dir = join(world.state.stateHome, "learning", "events", committed.ts.slice(0, 10));
    await appendFile(join(dir, "publisher.jsonl"), `${JSON.stringify(committed)}\n`, "utf8");
    await expect(assertExactlyOncePublish({ world, candidateId: CAND, conceptId: CONCEPT })).rejects.toThrow(
      PublishConservationViolation,
    );
  });
});

// CF-SM-LEARN-I — every SILENT-PROMOTION path is unrepresentable (L2 state,
// risk E1, T-10; case-catalog.md; INV-012 "agents propose only; self-reports
// never promote"; contracts/B-11-learning-publisher.md §1/§3).
//
// Each test seeds one promotion shortcut an attacker (or a sloppy refactor)
// would take and proves the product refuses it. The seeded-violation tests
// double as this family's negative controls: the detector under test IS the
// refusal.

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertCandidateCanProceed, validateCandidateArtifact } from "../../../src/org/learning/candidate.js";
import { candidateArtifactPath, openCandidateArtifact, sha256Ref } from "../../../src/org/learning/candidate-store.js";
import { bindingOf, findLearningPublishItem } from "../../../src/org/learning/binding.js";
import { readManifest } from "../../../src/org/learning/concepts.js";
import { validateInterventionRecord, writeInterventionRecord } from "../../../src/org/learning/intervention.js";
import { publishCandidate } from "../../../src/org/learning/publisher.js";
import { openReviewerVerdict, writeReviewerVerdict } from "../../../src/org/learning/review.js";
import {
  candidateSpec,
  conceptDraftMarkdown,
  makeLearningWorld,
  raiseAndApprove,
  seedReviewedOkfCandidate,
  verdictSpec,
  type LearningWorld,
} from "../cf-j12/learning-seams.js";

describe("CF-SM-LEARN-I — silent-promotion paths are unrepresentable (L2, E1, T-10)", () => {
  let world: LearningWorld;

  beforeAll(async () => {
    world = await makeLearningWorld("cf-sm-learn-i");
  });

  afterAll(async () => {
    await world.cleanup();
  });

  it("negative control: publish without a reviewer verdict is refused — review fails closed, a queued candidate never advances on its own", async () => {
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: "cand_i_unreviewed", destination: "skill_draft" }));
    const outcome = await publishCandidate(world.deps, "cand_i_unreviewed");
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") expect(outcome.reason).toContain("review fails closed");
  });

  it("negative control: the candidate's author cannot be its reviewer — a self-review never promotes its own lesson (INV-012)", async () => {
    await openCandidateArtifact(
      world.orgRoot,
      candidateSpec({
        id: "cand_i_selfreview",
        destination: "skill_draft",
        draft: { generated_by: "builder-agent-7" },
      }),
    );
    await writeReviewerVerdict(
      world.org.orgHome,
      verdictSpec({
        id: "cand_i_selfreview",
        destination: "skill_draft",
        reviewedBy: "builder-agent-7",
      }),
    );
    const outcome = await publishCandidate(world.deps, "cand_i_selfreview");
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") expect(outcome.reason).toContain("independent reviewer");
  });

  it("negative control: a non-clean injection screen escalates regardless of an approve verdict word (spec §15 fail-closed)", async () => {
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: "cand_i_injected", destination: "skill_draft" }));
    await writeReviewerVerdict(
      world.org.orgHome,
      verdictSpec({
        id: "cand_i_injected",
        destination: "skill_draft",
        injectionScreen: "suspicious",
      }),
    );
    const outcome = await publishCandidate(world.deps, "cand_i_injected");
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") expect(outcome.reason).toContain("injection screen");
  });

  it("an undecided approval publishes NOTHING: the second publish reports awaiting_approval and the substrate is untouched", async () => {
    await seedReviewedOkfCandidate(world, {
      id: "cand_i_pending",
      conceptId: "lrn_i_pending",
      name: "i-pending-lesson",
    });
    const raised = await publishCandidate(world.deps, "cand_i_pending");
    expect(raised.status).toBe("raised");
    const again = await publishCandidate(world.deps, "cand_i_pending");
    expect(again.status).toBe("awaiting_approval");
    // Nothing governed moved: no bundle file, no manifest, no intervention.
    expect(existsSync(join(world.org.orgHome, "learning", "bundle", "org", "i-pending-lesson.md"))).toBe(false);
    expect(await readManifest(world.orgRoot)).toBeNull();
    expect(existsSync(join(world.org.orgHome, "learning", "interventions"))).toBe(false);
  });

  it("negative control: an approval for bytes A cannot publish bytes B — post-approval candidate mutation VOIDs the grant and forces a fresh content-bound raise (B-11 §1)", async () => {
    await seedReviewedOkfCandidate(world, {
      id: "cand_i_voided",
      conceptId: "lrn_i_voided",
      name: "i-voided-lesson",
    });
    await raiseAndApprove(world, "cand_i_voided");

    // Seed the violation below the create-only store: mutate the candidate
    // JSON bytes directly, as a compromised writer would.
    const path = candidateArtifactPath(world.orgRoot, "cand_i_voided");
    const mutated = candidateSpec({ id: "cand_i_voided", title: "quietly different lesson" });
    await writeFile(path, JSON.stringify(mutated, null, 2) + "\n", "utf8");

    world.clock.advance(1_000);
    const outcome = await publishCandidate(world.deps, "cand_i_voided");
    // Superseded into a FRESH raise — never published under the old grant.
    expect(outcome.status).toBe("raised");
    expect(existsSync(join(world.org.orgHome, "learning", "bundle", "org", "i-voided-lesson.md"))).toBe(false);
    const fresh = await findLearningPublishItem(world.approvals, "cand_i_voided", "pending");
    expect(fresh).toBeDefined();
    expect(bindingOf(fresh!)?.candidate_hash).toBe(sha256Ref(JSON.stringify(mutated, null, 2) + "\n"));
  });

  it("the candidate store is create-only: a same-id candidate with different bytes is refused (evidence cannot be rewritten while queued)", async () => {
    await openCandidateArtifact(
      world.orgRoot,
      candidateSpec({ id: "cand_i_createonly" }),
      conceptDraftMarkdown({ conceptId: "lrn_i_createonly", name: "i-createonly" }),
    );
    await expect(
      openCandidateArtifact(
        world.orgRoot,
        candidateSpec({ id: "cand_i_createonly", title: "rewritten story" }),
        conceptDraftMarkdown({ conceptId: "lrn_i_createonly", name: "i-createonly" }),
      ),
    ).rejects.toThrow(/already exists with different bytes/);
  });

  it("the review store is create-only: a second, different verdict cannot overwrite the first durable one", async () => {
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: "cand_i_review_once", destination: "skill_draft" }));
    const first = await openReviewerVerdict(
      world.org.orgHome,
      verdictSpec({ id: "cand_i_review_once", destination: "skill_draft", verdict: "revise" }),
    );
    expect(first.created).toBe(true);
    const second = await openReviewerVerdict(
      world.org.orgHome,
      verdictSpec({ id: "cand_i_review_once", destination: "skill_draft", verdict: "approve" }),
    );
    expect(second.created).toBe(false);
    expect(second.verdict.verdict).toBe("revise"); // the first decision stands
  });

  it("an efficacy CLAIM is never waivable into truth, and a T2 activation without experiment needs an explicit non-empty human waiver (design §9.1)", () => {
    const claiming = validateCandidateArtifact(candidateSpec({ id: "cand_i_claims", claimsEfficacy: true }));
    expect(() => assertCandidateCanProceed(claiming)).toThrow(/claims efficacy/);
    expect(() => assertCandidateCanProceed(claiming, { humanWaiver: "please just ship it" })).toThrow(/never waivable/);

    const t2 = validateCandidateArtifact(candidateSpec({ id: "cand_i_t2", tier: "T2" }));
    expect(() => assertCandidateCanProceed(t2)).toThrow(/without an experiment/);
    expect(() => assertCandidateCanProceed(t2, { humanWaiver: "   " })).toThrow(/empty waivers/);
  });

  it("negative control: lineage only advances — a forged backward transition (active → published) is refused by the store", async () => {
    const base = {
      schema_version: 1,
      intervention_id: "int_i_backward",
      candidate_ref: "cand_i_backward",
      destination: "okf_concept" as const,
      reviewed_content_hash: sha256Ref("backward"),
      approval_ref: "appr-b",
      publish: {
        kind: "bundle_version" as const,
        ref: "org@2026.07.30-3",
        commit: null,
        published_at: "2026-07-30T00:00:00.000Z",
      },
      activation: { activated_at: "2026-07-30T00:00:00.000Z", claim: "authorized" as const },
      affected_episodes: { query: "q" },
      experiment_ref: null,
      outcome_ref: null,
      rollback: null,
      status: "active" as const,
    };
    await writeInterventionRecord(world.org.orgHome, base);
    await expect(
      writeInterventionRecord(world.org.orgHome, { ...base, activation: null, status: "published" }),
    ).rejects.toThrow(/cannot move back/);
  });

  it("impossible lifecycle shapes are rejected outright by the validator (proposed-with-activation; published-without-publish; rolled_back-without-rollback)", () => {
    const shape = (overrides: Record<string, unknown>): Record<string, unknown> => ({
      schema_version: 1,
      intervention_id: "int_i_shape",
      candidate_ref: "cand_i_shape",
      destination: "ticket",
      reviewed_content_hash: sha256Ref("shape"),
      approval_ref: null,
      publish: {
        kind: "issue",
        ref: "#12",
        commit: null,
        published_at: "2026-07-30T00:00:00.000Z",
      },
      activation: null,
      affected_episodes: null,
      experiment_ref: null,
      outcome_ref: null,
      rollback: null,
      status: "published",
      ...overrides,
    });
    expect(() =>
      validateInterventionRecord(
        shape({
          status: "proposed",
          publish: null,
          activation: { activated_at: "2026-07-30T00:00:00.000Z", claim: "authorized" },
        }),
      ),
    ).toThrow(/proposed intervention cannot carry an activation/);
    expect(() => validateInterventionRecord(shape({ publish: null }))).toThrow(/without a publish block/);
    expect(() => validateInterventionRecord(shape({ status: "rolled_back" }))).toThrow(/requires the rollback block/);
  });
});

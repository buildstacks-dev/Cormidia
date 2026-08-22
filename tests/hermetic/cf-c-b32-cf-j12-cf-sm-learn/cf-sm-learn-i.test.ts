// Traceability: CF-SM-LEARN-I · HB-157; CF-C-B32 · HB-156 · case-catalog.md §2 learning machine; system-map.md §2.2; contracts/B-32-learning-kernel-ports.md.

// CF-SM-LEARN-I — every SILENT-PROMOTION path is unrepresentable on the
// KERNEL path (L2 state, risk E1, T-10; INV-012 "agents propose only;
// self-reports never promote"; B-32 §3/§4). Each test seeds one promotion
// shortcut an attacker (or a sloppy refactor) would take and proves the host
// rules or the kernel refuse it; the seeded-violation tests double as this
// family's negative controls.

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publishPlanIdOf } from "../../../src/org/learning-loop/authority.js";
import { operatorEvidence } from "../../../src/org/learning-loop/authority-evidence.js";
import { readHostCandidateIndex } from "../../../src/org/learning-loop/host-index.js";
import { interventionViewOf } from "../../../src/org/learning-loop/interventions.js";
import { disableOkfActivation, findOkfActivationForConcept } from "../../../src/org/learning-loop/okf-lineage.js";
import { publishCandidate } from "../../../src/org/learning-loop/publish.js";
import { assertCandidateMayActivate } from "../../../src/org/learning-loop/publish-route.js";
import { candidateArtifactPath, openCandidateArtifact } from "../../../src/org/learning/candidate-store.js";
import { validateCandidateArtifact } from "../../../src/org/learning/candidate.js";
import { readManifest } from "../../../src/org/learning/concepts.js";
import { openReviewerVerdict, writeReviewerVerdict } from "../../../src/org/learning/review.js";
import {
  candidateSpec,
  conceptDraftMarkdown,
  makeKernelWorld,
  raiseAndApprove,
  seedReviewedOkfCandidate,
  verdictSpec,
  type KernelWorld,
} from "./learning-kernel-seams.js";

describe("CF-SM-LEARN-I — silent-promotion paths are unrepresentable on the kernel path (L2, E1, T-10)", () => {
  let world: KernelWorld;

  beforeAll(async () => {
    world = await makeKernelWorld("cf-sm-learn-i-kernel");
  });

  afterAll(async () => {
    await world.cleanup();
  });

  it("negative control: publish without a reviewer verdict is refused — review fails closed, and no kernel candidate is minted", async () => {
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: "cand_i_unreviewed", destination: "skill_draft" }));
    const outcome = await publishCandidate(world.deps, "cand_i_unreviewed");
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") expect(outcome.reason).toContain("review fails closed");
    expect(await readHostCandidateIndex(world.learning.stateDir, "cand_i_unreviewed")).toBeUndefined();
  });

  it("negative control: the candidate's author cannot be its reviewer — the host refuses the literal match and the kernel refuses the same principal under a different spelling", async () => {
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
      verdictSpec({ id: "cand_i_selfreview", destination: "skill_draft", reviewedBy: "builder-agent-7" }),
    );
    const literal = await publishCandidate(world.deps, "cand_i_selfreview");
    expect(literal.status).toBe("refused");
    if (literal.status === "refused") expect(literal.reason).toContain("independent reviewer");

    // Same role principal, scheduled-reviewer spelling: the host string check
    // passes, the kernel's self-review refusal (contract §Review) does not.
    await openCandidateArtifact(
      world.orgRoot,
      candidateSpec({ id: "cand_i_selfreview2", destination: "skill_draft", draft: { generated_by: "reviewer-bot" } }),
    );
    await writeReviewerVerdict(
      world.org.orgHome,
      verdictSpec({ id: "cand_i_selfreview2", destination: "skill_draft", reviewedBy: "reviewer-bot:codex/gpt" }),
    );
    const principal = await publishCandidate(world.deps, "cand_i_selfreview2");
    expect(principal.status).toBe("refused");
    if (principal.status === "refused") expect(principal.reason).toMatch(/review\.not_independent|self|proposer/i);
  });

  it("negative control: a non-clean injection screen escalates regardless of an approve verdict word (spec §15 fail-closed)", async () => {
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: "cand_i_injected", destination: "skill_draft" }));
    await writeReviewerVerdict(
      world.org.orgHome,
      verdictSpec({ id: "cand_i_injected", destination: "skill_draft", injectionScreen: "suspicious" }),
    );
    const outcome = await publishCandidate(world.deps, "cand_i_injected");
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") expect(outcome.reason).toContain("injection screen");
  });

  it("an undecided approval publishes NOTHING: the second publish reports awaiting_approval; no bundle file, no manifest, no kernel intervention", async () => {
    await seedReviewedOkfCandidate(world, {
      id: "cand_i_pending",
      conceptId: "lrn_i_pending",
      name: "i-pending-lesson",
    });
    const raised = await publishCandidate(world.deps, "cand_i_pending");
    expect(raised.status).toBe("raised");
    const again = await publishCandidate(world.deps, "cand_i_pending");
    expect(again.status).toBe("awaiting_approval");
    expect(existsSync(join(world.org.orgHome, "learning", "bundle", "org", "i-pending-lesson.md"))).toBe(false);
    expect(await readManifest(world.orgRoot)).toBeNull();
    const index = await readHostCandidateIndex(world.learning.stateDir, "cand_i_pending");
    expect(index?.entries.at(-1)?.plan_id).toBeDefined();
    expect(index?.entries.at(-1)?.intervention_id).toBeUndefined();
  });

  it("negative control: an approval for bytes A cannot publish bytes B — a post-approval candidate mutation yields a NEW kernel candidate and plan, so the old approval is unusable and a fresh content-bound raise happens (B-32 §3)", async () => {
    await seedReviewedOkfCandidate(world, { id: "cand_i_voided", conceptId: "lrn_i_voided", name: "i-voided-lesson" });
    const approvalId = await raiseAndApprove(world, "cand_i_voided");
    const firstPlan = (await readHostCandidateIndex(world.learning.stateDir, "cand_i_voided"))?.entries.at(-1)?.plan_id;

    // Seed the violation below the create-only store: mutate the candidate
    // JSON bytes directly, as a compromised writer would.
    const path = candidateArtifactPath(world.orgRoot, "cand_i_voided");
    await writeFile(
      path,
      `${JSON.stringify(candidateSpec({ id: "cand_i_voided", title: "quietly different lesson" }), null, 2)}\n`,
      "utf8",
    );
    world.clock.advance(1_000);
    const outcome = await publishCandidate(world.deps, "cand_i_voided");
    expect(outcome.status).toBe("raised");
    expect(existsSync(join(world.org.orgHome, "learning", "bundle", "org", "i-voided-lesson.md"))).toBe(false);
    const index = await readHostCandidateIndex(world.learning.stateDir, "cand_i_voided");
    expect(index?.entries).toHaveLength(2);
    expect(index?.entries.at(-1)?.plan_id).not.toBe(firstPlan);
    const { item } = await world.approvals.show(approvalId);
    expect(item.decision).toBe("approved"); // the old approval still binds the OLD plan only
    expect(publishPlanIdOf(item)).toBe(firstPlan);
    const freshPlan = index?.entries.at(-1)?.plan_id;
    const pending = (await world.approvals.listPending()).filter(
      (candidate) => publishPlanIdOf(candidate) === freshPlan,
    );
    expect(pending).toHaveLength(1); // a fresh raise, bound to the NEW plan
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
    expect(second.verdict.verdict).toBe("revise");
  });

  it("an efficacy CLAIM is never waivable into truth, and a T2 activation without a kernel verdict needs an explicit non-empty human waiver (design §9.1)", () => {
    const claiming = validateCandidateArtifact(candidateSpec({ id: "cand_i_claims", claimsEfficacy: true }));
    const routing = { destination: "okf_concept" as const, tier: "T1" as const, scope: "org" };
    expect(() => assertCandidateMayActivate({ artifact: claiming, routing })).toThrow(/claims efficacy/);
    expect(() => assertCandidateMayActivate({ artifact: claiming, routing, waiver: "please just ship it" })).toThrow(
      /never waivable/,
    );
    const t2 = validateCandidateArtifact(candidateSpec({ id: "cand_i_t2", tier: "T2" }));
    const t2routing = { ...routing, tier: "T2" as const };
    expect(() => assertCandidateMayActivate({ artifact: t2, routing: t2routing })).toThrow(/without an experiment/);
    expect(() => assertCandidateMayActivate({ artifact: t2, routing: t2routing, waiver: "   " })).toThrow(
      /empty waivers/,
    );
  });

  it("negative control: lineage only advances — a disabled kernel intervention never re-activates on a re-run; the kernel's transition table has no backward edge", async () => {
    await seedReviewedOkfCandidate(world, {
      id: "cand_i_backward",
      conceptId: "lrn_i_backward",
      name: "i-backward-lesson",
    });
    await raiseAndApprove(world, "cand_i_backward");
    const published = await publishCandidate(world.deps, "cand_i_backward");
    expect(published.status).toBe("published");
    const activation = await findOkfActivationForConcept(world.learning, [world.orgRoot], "lrn_i_backward");
    if (activation === undefined) throw new Error("no kernel activation");
    const disabled = await disableOkfActivation(world.learning, activation, "operator");
    expect("version" in disabled).toBe(true);
    const after = await interventionViewOf(world.learning, activation.intervention.id);
    expect(after?.state.activation).toBe("disabled");
    // Re-running the publish answers from the journal (no-op with reference)
    // and cannot move the intervention back to active.
    world.clock.advance(60_000);
    const rerun = await publishCandidate(world.deps, "cand_i_backward");
    expect(rerun.status).toBe("published");
    const still = await interventionViewOf(world.learning, activation.intervention.id);
    expect(still?.state.activation).toBe("disabled");
    // And the operator lane cannot authorize a PUBLISH — only reversals.
    expect(operatorEvidence("operator").kind).toBe("operator");
  });
});

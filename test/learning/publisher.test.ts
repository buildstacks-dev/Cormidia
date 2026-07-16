// The deterministic publisher (learning-loop M4, design §11.1, spec §14).
// Covers milestone Done-means #2 (no activation without verdict + content-
// bound approval; mutation voids), #3 (crash resume by approval id, no
// double publish), #6 (a cluster routes to ticket/OKF/proposal on the
// proportional lanes), plus rate caps and publish-time bundle-size
// validation for protected tiers.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalStore } from "../../src/org/approvals.js";
import {
  conceptDraftPath,
  writeCandidateArtifact,
} from "../../src/org/learning/candidate-store.js";
import {
  bundleScopeDir,
  cutManifestVersion,
  orgLearningRoot,
  promoteCanaryOnManifest,
  readManifest,
  startCanaryOnManifest,
} from "../../src/org/learning/concepts.js";
import { readLearningEvents, sanitizeIdSegment } from "../../src/org/learning/events.js";
import { defaultLearningPolicy } from "../../src/org/learning/policy.js";
import {
  LEARNING_TICKET_LABEL,
  publishCandidate,
  requiresHumanGate,
  type PublisherDeps,
} from "../../src/org/learning/publisher.js";
import { listInterventionRecords } from "../../src/org/learning/intervention.js";
import { readRejections } from "../../src/org/learning/rejections.js";
import { writeReviewerVerdict } from "../../src/org/learning/review.js";
import { parseOkfDocument } from "../../src/org/memory.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";
import { FakeGhOps } from "../support/fakeGhOps.js";
import { conceptMarkdown, makeCandidate, makeReviewerVerdict } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

interface Rig {
  orgHome: OrgHomeFixture;
  stateHome: OrgHomeFixture;
  gh: FakeGhOps;
  deps: PublisherDeps;
}

function makeRig(policy = defaultLearningPolicy()): Rig {
  const orgHome = makeOrgHome();
  const stateHome = makeOrgHome();
  cleanups.push(orgHome.cleanup, stateHome.cleanup);
  const gh = new FakeGhOps();
  return {
    orgHome,
    stateHome,
    gh,
    deps: {
      orgHome: orgHome.root,
      stateHome: stateHome.root,
      policy,
      approvals: new ApprovalStore(stateHome.root),
      gh,
      repo: "fixture/repo",
    },
  };
}

async function seedCandidate(
  rig: Rig,
  overrides: Record<string, unknown>,
  verdictOverrides: Record<string, unknown> = {},
  conceptOverrides: Partial<Parameters<typeof conceptMarkdown>[0]> = {},
): Promise<string> {
  const candidate = await writeCandidateArtifact(
    orgLearningRoot(rig.orgHome.root),
    makeCandidate(overrides),
  );
  const verdict = makeReviewerVerdict({
    candidate_id: candidate.candidate_id,
    proposed_destination: candidate.destination,
    proposed_tier: candidate.proposed_tier,
    proposed_scope: candidate.proposed_scope,
    ...verdictOverrides,
  });
  await writeReviewerVerdict(rig.orgHome.root, verdict);
  if ((verdict["proposed_destination"] ?? candidate.destination) === "okf_concept") {
    const draft = conceptDraftPath(orgLearningRoot(rig.orgHome.root), candidate.candidate_id);
    mkdirSync(join(draft, ".."), { recursive: true });
    writeFileSync(
      draft,
      conceptMarkdown({
        name: `concept-${candidate.candidate_id.slice(-5).toLowerCase()}`,
        id: `lrn_${candidate.candidate_id.slice(-5).toLowerCase()}`,
        scope: (verdict["proposed_scope"] as string) ?? candidate.proposed_scope,
        status: "candidate",
        tier: (verdict["proposed_tier"] as string) ?? candidate.proposed_tier,
        ...conceptOverrides,
      }),
      "utf8",
    );
  }
  return candidate.candidate_id;
}

describe("routing (design §6.1 proportional approvals)", () => {
  it("okf_concept and T2/T3 are human-gated; tickets and proposals are routine", () => {
    expect(requiresHumanGate("okf_concept", "T0")).toBe(true);
    expect(requiresHumanGate("ticket", "T1")).toBe(false);
    expect(requiresHumanGate("ticket", "T2")).toBe(true);
    expect(requiresHumanGate("skill_draft", "T1")).toBe(false);
    expect(requiresHumanGate("eval_or_gate_proposal", "T3")).toBe(true);
  });

  it("review fails closed: no verdict, no publish of any kind", async () => {
    const rig = makeRig();
    await writeCandidateArtifact(
      orgLearningRoot(rig.orgHome.root),
      makeCandidate({ destination: "ticket" }),
    );
    const outcome = await publishCandidate(rig.deps, "cand_20260711_01JGHI");
    expect(outcome).toMatchObject({ status: "refused" });
    expect((outcome as { reason: string }).reason).toMatch(/fails closed/);
  });

  it("refuses to count a candidate author as its independent reviewer", async () => {
    const rig = makeRig();
    const id = await seedCandidate(
      rig,
      { destination: "ticket", draft: { generated_by: "distiller" } },
      { reviewed_by: "distiller" },
    );
    const outcome = await publishCandidate(rig.deps, id);
    expect(outcome).toMatchObject({ status: "refused" });
    expect((outcome as { reason: string }).reason).toContain("cannot count as its independent reviewer");
  });

  it("a non-clean injection screen escalates even an approve verdict", async () => {
    const rig = makeRig();
    const id = await seedCandidate(
      rig,
      { destination: "ticket", proposed_tier: "T1" },
      {
        rubric: { ...(makeReviewerVerdict()["rubric"] as object), injection_screen: "suspicious" },
      },
    );
    const outcome = await publishCandidate(rig.deps, id);
    expect(outcome).toMatchObject({ status: "refused" });
    expect((outcome as { reason: string }).reason).toMatch(/escalate/);
  });
});

describe("routine lane: tickets (deduped, rate-capped)", () => {
  it("publishes a ticket with the learning label and a complete lineage record", async () => {
    const rig = makeRig();
    const id = await seedCandidate(rig, { destination: "ticket" });
    const outcome = await publishCandidate(rig.deps, id);
    expect(outcome).toMatchObject({ status: "published" });

    const issues = await rig.gh.listIssues({ state: "open", labels: [LEARNING_TICKET_LABEL] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.body).toContain("operon:candidate-fingerprint");

    const interventions = await listInterventionRecords(rig.orgHome.root);
    expect(interventions).toHaveLength(1);
    expect(interventions[0]).toMatchObject({
      destination: "ticket",
      status: "published",
      approval_ref: null,
      publish: { kind: "issue", ref: `#${issues[0]!.number}` },
    });

    // The publish_committed event landed (deduped, deterministic id).
    const events = await readLearningEvents(rig.stateHome.root);
    expect(events.filter((event) => event.type === "publish_committed")).toHaveLength(1);
  });

  it("dedupes by candidate fingerprint: same content never files twice", async () => {
    const rig = makeRig();
    const first = await seedCandidate(rig, { destination: "ticket" });
    await publishCandidate(rig.deps, first);
    const second = await seedCandidate(rig, {
      destination: "ticket",
      candidate_id: "cand_20260712_SAME1",
    });
    const outcome = await publishCandidate(rig.deps, second);
    expect(outcome).toMatchObject({ status: "published" });
    expect(await rig.gh.listIssues({ state: "open" })).toHaveLength(1);
  });

  it("enforces the per-app open cap and the weekly cap (policy §13)", async () => {
    const policy = defaultLearningPolicy();
    policy.destinations.ticket.max_open_per_app = 1;
    const rig = makeRig(policy);
    await publishCandidate(rig.deps, await seedCandidate(rig, { destination: "ticket" }));
    const second = await seedCandidate(rig, {
      destination: "ticket",
      candidate_id: "cand_20260712_CAP01",
      content_hash: `sha256:${"33".repeat(32)}`,
      error_class: "another.class",
    });
    await expect(publishCandidate(rig.deps, second)).rejects.toThrow(/cap 1/);
  });

  it("resumes a crashed ticket publish without filing a duplicate (Done #3)", async () => {
    const rig = makeRig();
    const id = await seedCandidate(rig, { destination: "ticket" });
    const realCreate = rig.gh.createIssue.bind(rig.gh);
    let crashed = false;
    rig.gh.createIssue = async () => {
      crashed = true;
      throw new Error("simulated crash before the issue landed");
    };
    await expect(publishCandidate(rig.deps, id)).rejects.toThrow(/simulated crash/);
    expect(crashed).toBe(true);

    rig.gh.createIssue = realCreate;
    const outcome = await publishCandidate(rig.deps, id);
    expect(outcome).toMatchObject({ status: "published" });
    expect(await rig.gh.listIssues({ state: "open" })).toHaveLength(1);
    expect(await listInterventionRecords(rig.orgHome.root)).toHaveLength(1);
  });
});

describe("routine lane: proposal drafts", () => {
  it("writes an unmerged draft under learning/proposals/** (the merge stays human)", async () => {
    const rig = makeRig();
    const id = await seedCandidate(rig, {
      destination: "eval_or_gate_proposal",
      candidate_id: "cand_20260711_EVALP",
    });
    const outcome = await publishCandidate(rig.deps, id);
    expect(outcome).toMatchObject({ status: "published" });
    const draft = join(rig.orgHome.root, "learning", "proposals", "gates", `${id}.md`);
    expect(existsSync(draft)).toBe(true);
    const interventions = await listInterventionRecords(rig.orgHome.root);
    expect(interventions[0]).toMatchObject({
      destination: "eval_or_gate_proposal",
      status: "published",
      approval_ref: null,
    });
  });
});

describe("human-gated lane: okf_concept activation (Done #2)", () => {
  it("raises a content-bound approval, publishes only after the human approves, and consumes the grant", async () => {
    const rig = makeRig();
    const id = await seedCandidate(rig, { destination: "okf_concept" });

    // First run: no approval yet — raised, nothing written.
    const raised = await publishCandidate(rig.deps, id);
    expect(raised).toMatchObject({ status: "raised" });
    const approvalId = (raised as { approvalId: string }).approvalId;
    const bundleFile = join(
      bundleScopeDir(orgLearningRoot(rig.orgHome.root), "roles/builder"),
      `concept-${id.slice(-5).toLowerCase()}.md`,
    );
    expect(existsSync(bundleFile)).toBe(false);

    // Second run while pending: still waiting, still nothing written.
    expect(await publishCandidate(rig.deps, id)).toMatchObject({
      status: "awaiting_approval",
      approvalId,
    });

    await rig.deps.approvals.decide(approvalId, { decision: "approved" });
    const published = await publishCandidate(rig.deps, id);
    expect(published).toMatchObject({ status: "published" });

    const concept = parseOkfDocument(await readFile(bundleFile, "utf8"));
    expect(concept.frontmatter.loop?.status).toBe("active");
    expect(
      existsSync(conceptDraftPath(orgLearningRoot(rig.orgHome.root), id)),
    ).toBe(false);

    const manifest = await readManifest(orgLearningRoot(rig.orgHome.root));
    expect(manifest?.history).toHaveLength(1);
    expect(manifest?.history[0]).toMatchObject({ approval_ref: approvalId });

    const interventions = await listInterventionRecords(rig.orgHome.root);
    expect(interventions[0]).toMatchObject({
      destination: "okf_concept",
      status: "active",
      approval_ref: approvalId,
      activation: { claim: "authorized" },
    });

    // Grant is single-use and consumed by the publish.
    const shown = await rig.deps.approvals.show(approvalId);
    expect(shown.grant?.uses).toBe(0);

    // Re-running is a no-op: no second cut, no re-write.
    const rerun = await publishCandidate(rig.deps, id);
    expect(rerun).toMatchObject({ status: "refused" });
    expect((rerun as { reason: string }).reason).toMatch(/already published/);
    expect((await readManifest(orgLearningRoot(rig.orgHome.root)))?.history).toHaveLength(1);
  });

  it("refuses an approved activation mid-trial BEFORE any artifact write (M5 cut guard)", async () => {
    const rig = makeRig();
    // The trial is already running when the candidate is raised and
    // approved — the binding's base manifest is the trial-state manifest,
    // so the approval stays valid and the publish hits the canary guard.
    const root = orgLearningRoot(rig.orgHome.root);
    await cutManifestVersion(root, { concepts: ["lrn_base"], now: new Date("2026-07-10T08:00:00Z") });
    await startCanaryOnManifest(root, {
      version: "2026.07.10-1",
      windowHours: 48,
      fraction: 0.1,
      tier: "T1",
      interventionRef: "int_x",
      now: new Date("2026-07-11T09:00:00Z"),
    });
    const id = await seedCandidate(rig, {
      destination: "okf_concept",
      candidate_id: "cand_20260711_TRIAL",
    });
    const raised = await publishCandidate(rig.deps, id);
    const approvalId = (raised as { approvalId: string }).approvalId;
    await rig.deps.approvals.decide(approvalId, { decision: "approved" });

    const refused = await publishCandidate(rig.deps, id);
    expect(refused).toMatchObject({ status: "refused" });
    expect((refused as { reason: string }).reason).toMatch(/active canary.*contaminate/);
    // NOTHING was written: the concept is not in the bundle, the draft
    // survives, no manifest cut happened — the resolver cannot see the
    // refused content in either arm.
    const bundleFile = join(
      bundleScopeDir(root, "roles/builder"),
      `concept-${id.slice(-5).toLowerCase()}.md`,
    );
    expect(existsSync(bundleFile)).toBe(false);
    expect(existsSync(conceptDraftPath(root, id))).toBe(true);
    expect((await readManifest(root))?.history).toHaveLength(1);

    // Trial closes: the SAME content-bound approval publishes cleanly —
    // exactly what the refusal message promises.
    await promoteCanaryOnManifest(root, { now: new Date("2026-07-12T08:00:00Z") });
    const published = await publishCandidate(rig.deps, id);
    expect(published).toMatchObject({ status: "published" });
    expect(existsSync(bundleFile)).toBe(true);
  });

  it("mutating the approved bytes voids the approval; a fresh binding is raised, never published (Done #2)", async () => {
    const rig = makeRig();
    const id = await seedCandidate(rig, {
      destination: "okf_concept",
      candidate_id: "cand_20260711_MUTAT",
    });
    const raised = await publishCandidate(rig.deps, id);
    const approvalId = (raised as { approvalId: string }).approvalId;
    await rig.deps.approvals.decide(approvalId, { decision: "approved" });

    // The draft changes AFTER approval — different final bytes.
    const draft = conceptDraftPath(orgLearningRoot(rig.orgHome.root), id);
    writeFileSync(
      draft,
      conceptMarkdown({
        name: `concept-${id.slice(-5).toLowerCase()}`,
        id: `lrn_${id.slice(-5).toLowerCase()}`,
        scope: "roles/builder",
        status: "candidate",
        body: "Subtly different instructions the human never saw.",
      }),
      "utf8",
    );
    // The void approval is superseded by a FRESH content-bound raise — the
    // mutated bytes are never published under the stale decision.
    const outcome = await publishCandidate(rig.deps, id);
    expect(outcome).toMatchObject({ status: "raised" });
    const freshId = (outcome as { approvalId: string }).approvalId;
    expect(freshId).not.toBe(approvalId);
    const fresh = (await rig.deps.approvals.listPending()).find((item) => item.id === freshId);
    expect(fresh?.justification).toMatch(/supersedes VOID approval/);
    const bundleFile = join(
      bundleScopeDir(orgLearningRoot(rig.orgHome.root), "roles/builder"),
      `concept-${id.slice(-5).toLowerCase()}.md`,
    );
    expect(existsSync(bundleFile)).toBe(false);
  });

  it("a denied candidate whose content changed can raise a fresh approval; unchanged content stays denied", async () => {
    const rig = makeRig();
    const id = await seedCandidate(rig, {
      destination: "okf_concept",
      candidate_id: "cand_20260711_REDO1",
    });
    const raised = await publishCandidate(rig.deps, id);
    await rig.deps.approvals.decide((raised as { approvalId: string }).approvalId, {
      decision: "denied",
      reason: "too broad",
    });
    // Same bytes → the denial stands.
    expect(await publishCandidate(rig.deps, id)).toMatchObject({ status: "denied" });

    // Re-review (new verdict bytes) → a fresh decision is legitimate.
    await writeReviewerVerdict(
      rig.orgHome.root,
      makeReviewerVerdict({
        candidate_id: id,
        proposed_destination: "okf_concept",
        rationale: "narrowed after the denial feedback",
      }),
    );
    expect(await publishCandidate(rig.deps, id)).toMatchObject({ status: "raised" });
  });

  it("resumes a crashed okf publish from the journal after the draft moved (Done #3)", async () => {
    const rig = makeRig();
    // Force the filename edge that exposed the old fixture-only sanitizer:
    // production trims trailing punctuation from derived journal segments.
    rig.deps.approvals = new ApprovalStore(rig.stateHome.root, {
      idSource: () => "approval-crash-",
    });
    const id = await seedCandidate(rig, {
      destination: "okf_concept",
      candidate_id: "cand_20260711_CRASH",
    });
    const raised = await publishCandidate(rig.deps, id);
    const approvalId = (raised as { approvalId: string }).approvalId;
    await rig.deps.approvals.decide(approvalId, { decision: "approved" });

    // Reconstruct the crash state a real transaction leaves after its
    // artifact step: journal written with the artifact receipt, draft moved
    // into bundle/, and nothing else committed.
    const name = `concept-${id.slice(-5).toLowerCase()}`;
    const draftPath = conceptDraftPath(orgLearningRoot(rig.orgHome.root), id);
    const bytes = await readFile(draftPath, "utf8");
    const activatedBytes = bytes
      .replace("status: active", "status: active") // top-level already active
      .replace("  status: candidate", "  status: active");
    const bundleFile = join(
      bundleScopeDir(orgLearningRoot(rig.orgHome.root), "roles/builder"),
      `${name}.md`,
    );
    mkdirSync(join(bundleFile, ".."), { recursive: true });
    writeFileSync(bundleFile, activatedBytes, "utf8");
    rmSync(draftPath);
    const journalDir = join(rig.stateHome.root, "learning", "publish-journal");
    mkdirSync(journalDir, { recursive: true });
    writeFileSync(
      join(journalDir, `${sanitizeIdSegment(approvalId)}.json`),
      JSON.stringify({
        schema_version: 1,
        journal_id: approvalId,
        candidate_id: id,
        candidate_hash: `sha256:${"77".repeat(32)}`,
        destination: "okf_concept",
        tier: "T1",
        scope: "roles/builder",
        approval_ref: approvalId,
        claim: "authorized",
        waivers: [],
        artifact: {
          kind: "bundle_version",
          bytes: activatedBytes,
          conceptId: `lrn_${id.slice(-5).toLowerCase()}`,
          conceptName: name,
        },
        artifact_ref: bundleFile,
      }),
      "utf8",
    );

    // The resume completes the remaining steps instead of refusing on the
    // missing draft: manifest cut, intervention, done-mark.
    const outcome = await publishCandidate(rig.deps, id);
    expect(outcome).toMatchObject({ status: "published" });
    expect((await readManifest(orgLearningRoot(rig.orgHome.root)))?.history).toHaveLength(1);
    const interventions = await listInterventionRecords(rig.orgHome.root);
    expect(interventions[0]).toMatchObject({ status: "active", approval_ref: approvalId });

    // And the whole transaction is terminal on the next run.
    expect(await publishCandidate(rig.deps, id)).toMatchObject({ status: "refused" });
  });

  it("the learning-publish rule is never scopeable — one decision, one publish", async () => {
    const rig = makeRig();
    const id = await seedCandidate(rig, {
      destination: "okf_concept",
      candidate_id: "cand_20260711_SCOPE",
    });
    const raised = await publishCandidate(rig.deps, id);
    await expect(
      rig.deps.approvals.decide((raised as { approvalId: string }).approvalId, {
        decision: "approved",
        scope: { kind: "app" },
      }),
    ).rejects.toThrow(/never scopeable/);
  });

  it("a reject-routed candidate writes exactly one ledger entry across re-runs", async () => {
    const rig = makeRig();
    const id = await seedCandidate(
      rig,
      { destination: "ticket", candidate_id: "cand_20260711_REJI1" },
      { proposed_destination: "reject", rationale: "not a real lesson" },
    );
    expect(await publishCandidate(rig.deps, id)).toMatchObject({ status: "rejected" });
    expect(await publishCandidate(rig.deps, id)).toMatchObject({ status: "rejected" });
    const entries = await readRejections(rig.orgHome.root);
    expect(entries.filter((entry) => entry.candidate_id === id)).toHaveLength(1);
  });

  it("a denied approval reports denied and publishes nothing", async () => {
    const rig = makeRig();
    const id = await seedCandidate(rig, {
      destination: "okf_concept",
      candidate_id: "cand_20260711_DENY1",
    });
    const raised = await publishCandidate(rig.deps, id);
    const approvalId = (raised as { approvalId: string }).approvalId;
    await rig.deps.approvals.decide(approvalId, { decision: "denied", reason: "not convinced" });
    expect(await publishCandidate(rig.deps, id)).toMatchObject({
      status: "denied",
      approvalId,
      reason: "not convinced",
    });
  });

  it("T2 without an experiment needs an explicit waiver, which the approval records", async () => {
    const rig = makeRig();
    const id = await seedCandidate(
      rig,
      { destination: "okf_concept", proposed_tier: "T2", candidate_id: "cand_20260711_TIER2" },
      { proposed_tier: "T2" },
    );
    await expect(publishCandidate(rig.deps, id)).rejects.toThrow(/without an experiment/);

    const raised = await publishCandidate(rig.deps, id, {
      waiver: "prototype scope; replay substrate not yet wired for this role",
    });
    expect(raised).toMatchObject({ status: "raised" });
    const approvalId = (raised as { approvalId: string }).approvalId;
    await rig.deps.approvals.decide(approvalId, { decision: "approved" });
    // The approved binding carries the waiver; the re-run needs no flag.
    expect(await publishCandidate(rig.deps, id)).toMatchObject({ status: "published" });
  });

  it("an oversized protected-tier concept is a publish-time error (spec §3)", async () => {
    const policy = defaultLearningPolicy();
    policy.context_budget.default_bytes = 1024; // smallest budget: 256-byte role share
    const rig = makeRig(policy);
    const id = await seedCandidate(
      rig,
      { destination: "okf_concept", proposed_tier: "T2", candidate_id: "cand_20260711_HUGE1" },
      { proposed_tier: "T2" },
      { body: "x".repeat(2048) },
    );
    const outcome = await publishCandidate(rig.deps, id, { waiver: "w" });
    expect(outcome).toMatchObject({ status: "refused" });
    expect((outcome as { reason: string }).reason).toMatch(/publish-time error/);
  });
});

describe("the marketplace-style cluster routes on all three lanes (Done #6)", () => {
  it("one ticket (routine), one OKF concept (human-gated), one gate proposal (routine)", async () => {
    const rig = makeRig();
    const ticket = await seedCandidate(rig, {
      destination: "ticket",
      candidate_id: "cand_20260711_CLST1",
      error_class: "dispatch.event_fanout_consumed_early",
    });
    const concept = await seedCandidate(rig, {
      destination: "okf_concept",
      candidate_id: "cand_20260711_CLST2",
      error_class: "support.reply_missing_source_payload",
      content_hash: `sha256:${"44".repeat(32)}`,
    });
    const gate = await seedCandidate(rig, {
      destination: "eval_or_gate_proposal",
      candidate_id: "cand_20260711_CLST3",
      error_class: "browser.build_import_unresolved",
      content_hash: `sha256:${"55".repeat(32)}`,
    });

    expect(await publishCandidate(rig.deps, ticket)).toMatchObject({ status: "published" });
    expect(await publishCandidate(rig.deps, gate)).toMatchObject({ status: "published" });
    const raised = await publishCandidate(rig.deps, concept);
    expect(raised).toMatchObject({ status: "raised" });
    await rig.deps.approvals.decide((raised as { approvalId: string }).approvalId, {
      decision: "approved",
    });
    expect(await publishCandidate(rig.deps, concept)).toMatchObject({ status: "published" });

    const interventions = await listInterventionRecords(rig.orgHome.root);
    expect(interventions.map((record) => record.destination).sort()).toEqual([
      "eval_or_gate_proposal",
      "okf_concept",
      "ticket",
    ]);
    // Routine lanes carry no approval; the activation does.
    for (const record of interventions) {
      if (record.destination === "okf_concept") expect(record.approval_ref).not.toBeNull();
      else expect(record.approval_ref).toBeNull();
    }
  });
});

// Traceability: CF-REG-374 · HB-139 · case-catalog.md §10.3.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { GhIssue } from "../../../src/loop/github.js";
import {
  finalizePlanForPublication,
  type PlanProvenance,
  type PublishedTicket,
  type TicketPlan,
} from "../../../src/loop/plan-tickets.js";
import { planningAppDir } from "../../../src/org/planning-artifact-path.js";
import {
  completePlanningPublication,
  invalidatePlanningCoverage,
  planningCoverageSummary,
  preparePlanningPublication,
  readPlanningCoverage,
  recordPlanningDecomposition,
  refreshPlanningCoverage,
} from "../../../src/org/planning-coverage.js";
import { planningSourceCoverageHash, retainedPlanningTicketCount } from "../../../src/org/planning-coverage-request.js";
import {
  parsePlanningDecompositionRequest,
  planningResumeCapacityProblem,
  planningSourceSections,
  PlanningDecompositionRefusal,
  validatePlanningDecomposition,
  type PlanningSourceSection,
} from "../../../src/org/planning-decomposition.js";
import { resolvePlanningSources, type ResolvedPlanningSources } from "../../../src/org/planning-inputs.js";
import {
  preparedPlanningRecoveryDecision,
  planningRecoveryIntentHash,
  renderPriorPlanningCoverage,
  resolvePlanningPublicationLimit,
} from "../../../src/org/planning-publication.js";
import { resolvePlanningStage } from "../../../src/org/planning-stage.js";

const roots: string[] = [];
const APP = "large-corpus";
const SCOPE = "scope-reg-374";
const provenance: PlanProvenance = { episodeId: "episode-374", runId: "run-374", traceId: "trace-374" };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CF-REG-374 — stateful large-corpus decomposition", () => {
  it("accepts exact/range/complete intent and reports typed syntax remediation", () => {
    expect(parsePlanningDecompositionRequest("10")).toEqual({ kind: "range", syntax: "10", min: 10, max: 10 });
    expect(parsePlanningDecompositionRequest("4-12")).toEqual({ kind: "range", syntax: "4-12", min: 4, max: 12 });
    expect(parsePlanningDecompositionRequest("7+")).toEqual({ kind: "range", syntax: "7+", min: 7, max: null });
    expect(parsePlanningDecompositionRequest("complete")).toEqual({ kind: "complete", syntax: "complete" });
    try {
      parsePlanningDecompositionRequest("large");
      throw new Error("negative control did not fire");
    } catch (error) {
      expect(error).toBeInstanceOf(PlanningDecompositionRefusal);
      expect(error).toMatchObject({ code: "plan_decomposition_syntax_invalid" });
      expect((error as Error).message).toContain("bootstrap=3, growth=5, mature=7");
      expect((error as PlanningDecompositionRefusal).remediation).toContain("exact count (10)");
    }
  });

  it("applies exact and range counts to the cumulative durable decomposition on resume", () => {
    const sections = corpusSections(10);
    const exact = parsePlanningDecompositionRequest("10");
    expect(validatePlanningDecomposition(planFor(sections.slice(6)), exact, sections.slice(6), 6)).toEqual([]);
    expect(validatePlanningDecomposition(planFor(sections), exact, sections, 6)[0]).toContain("6 preserved + 10 new");
    expect(
      validatePlanningDecomposition(
        planFor(sections.slice(0, 6)),
        parsePlanningDecompositionRequest("4-12"),
        sections,
        6,
      ),
    ).toEqual([]);
    expect(planningResumeCapacityProblem(exact, 10, 1)).toContain("no provider turn was started");
    expect(planningResumeCapacityProblem(exact, 6, 4)).toBeUndefined();
  });

  it("counts retained published tickets but not replaced planned tickets in an explicit revision", async () => {
    const root = await tempRoot();
    const sections = corpusSections(10);
    await record(root, sections, planFor(sections), 6, "revise-count");
    const batch = await preparePlanningPublication(root, APP, SCOPE, true, at(2));
    const coverage = await completePlanningPublication({
      root,
      app: APP,
      scopeId: SCOPE,
      published: published(batch.indexes),
      now: at(3),
    });

    const retained = retainedPlanningTicketCount(coverage, true);
    expect(retained).toBe(6);
    expect(
      validatePlanningDecomposition(
        planFor(sections.slice(6)),
        parsePlanningDecompositionRequest("10"),
        sections.slice(6),
        retained,
      ),
    ).toEqual([]);
    expect(
      validatePlanningDecomposition(planFor(sections), parsePlanningDecompositionRequest("10"), sections, retained)[0],
    ).toContain("6 preserved + 10 new");
  });

  it("persists a large complete decomposition, publishes bounded batches, resumes, and repeats idempotently", async () => {
    const root = await tempRoot();
    const sections = corpusSections(8);
    const plan = planFor(sections);
    expect(validatePlanningDecomposition(plan, parsePlanningDecompositionRequest("complete"), sections)).toEqual([]);
    const first = await record(root, sections, plan, 3, "request-a");
    expect(first.record.plan.tickets).toHaveLength(8);
    expect(planningCoverageSummary(first.record).planned).toBe(8);

    const batch1 = await preparePlanningPublication(root, APP, SCOPE, false, at(1));
    expect(batch1.indexes).toEqual([0, 1, 2]);
    let coverage = await completePlanningPublication({
      root,
      app: APP,
      scopeId: SCOPE,
      published: published(batch1.indexes),
      now: at(2),
    });
    expect(coverage.plan.tickets).toHaveLength(8);
    expect(planningCoverageSummary(coverage)).toMatchObject({ published: 3, planned: 5 });

    expect((await preparePlanningPublication(root, APP, SCOPE, false, at(3))).indexes).toEqual([]);
    const repeated = await record(root, sections, plan, 3, "request-a");
    expect(repeated.reused).toBe(true);
    expect(repeated.record.revision).toBe(3);

    const batch2 = await preparePlanningPublication(root, APP, SCOPE, true, at(4));
    expect(batch2.indexes).toEqual([3, 4, 5]);
    await completePlanningPublication({
      root,
      app: APP,
      scopeId: SCOPE,
      published: published(batch2.indexes),
      now: at(5),
    });
    const batch3 = await preparePlanningPublication(root, APP, SCOPE, true, at(6));
    expect(batch3.indexes).toEqual([6, 7]);
    coverage = await completePlanningPublication({
      root,
      app: APP,
      scopeId: SCOPE,
      published: published(batch3.indexes),
      now: at(7),
    });
    expect(planningCoverageSummary(coverage)).toMatchObject({ published: 8, planned: 0, remaining: 0 });
  });

  it("keeps an asserted mature stage from widening evidence-bounded admission", () => {
    const stageResolution = resolvePlanningStage({
      requestedStage: "mature",
      checkout: "/missing-explicit-checkout",
      checkoutSource: "explicit",
    });
    const publication = resolvePlanningPublicationLimit({
      stageResolution,
      checkout: "/missing-explicit-checkout",
      checkoutSource: "explicit",
    });
    expect(publication).toMatchObject({ cap: 3, requestedStage: "mature", evidenceStage: "bootstrap" });
    const plan = planFor(corpusSections(8));
    expect(
      finalizePlanForPublication(plan, undefined, { indexes: [0, 1, 2], publicationCap: publication.cap }).tickets.map(
        (ticket) => ticket.index,
      ),
    ).toEqual([0, 1, 2]);
    expect(() =>
      finalizePlanForPublication(plan, undefined, { indexes: [0, 1, 2, 3], publicationCap: publication.cap }),
    ).toThrow(/invalid bounded selection/);
  });

  it("durably tightens a preserved publication cap against current evidence and never auto-loosens it", async () => {
    const root = await tempRoot();
    const sections = corpusSections(8);
    await record(root, sections, planFor(sections), 7, "cap-freshness");

    const tightened = await readPlanningCoverage(root, APP, SCOPE, 3, at(2));
    expect(tightened).toMatchObject({ revision: 2, publication_cap: 3 });
    const notLoosened = await readPlanningCoverage(root, APP, SCOPE, 7, at(3));
    expect(notLoosened).toMatchObject({ revision: 2, publication_cap: 3 });
    expect((await preparePlanningPublication(root, APP, SCOPE, true, at(4))).indexes).toEqual([0, 1, 2]);

    const deltaRoot = await tempRoot();
    await record(deltaRoot, sections, planFor(sections.slice(0, 1)), 3, "cap-delta");
    await readPlanningCoverage(deltaRoot, APP, SCOPE, 7, at(2));
    const delta = await record(deltaRoot, sections, planFor(sections.slice(1, 2)), 7, "cap-delta", "delta");
    expect(delta.record.publication_cap).toBe(3);
  });

  it("completes an existing prepared batch under its preserved admission before using a tightened future cap", async () => {
    const root = await tempRoot();
    const sections = corpusSections(8);
    await record(root, sections, planFor(sections), 7, "prepared-cap-freshness");
    const admitted = await preparePlanningPublication(root, APP, SCOPE, true, at(2));
    expect(admitted.indexes).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(admitted.record.publication_batches[0]?.admission_cap).toBe(7);

    const tightened = await readPlanningCoverage(root, APP, SCOPE, 3, at(3));
    expect(tightened).toMatchObject({ publication_cap: 3 });
    expect((await preparePlanningPublication(root, APP, SCOPE, true, at(4))).indexes).toEqual(admitted.indexes);
    await completePlanningPublication({
      root,
      app: APP,
      scopeId: SCOPE,
      published: published(admitted.indexes),
      now: at(5),
    });
    const next = await preparePlanningPublication(root, APP, SCOPE, true, at(6));
    expect(next.indexes).toEqual([7]);
    expect(next.record.publication_batches.at(-1)?.admission_cap).toBe(3);
  });

  it("makes a prepared publication the first recovery obligation before source invalidation or revision", async () => {
    const root = await tempRoot();
    const sections = corpusSections(2);
    const stored = await record(root, sections, planFor(sections), 2, "prepared-recovery");
    const prepared = await preparePlanningPublication(root, APP, SCOPE, true, at(2));
    expect(prepared.record.source_manifest_sha256).toBe("prepared-recovery");

    expect(
      preparedPlanningRecoveryDecision({
        coverage: prepared.record,
        currentIntentHash: stored.record.planning_intent_hash,
        resume: true,
        revise: false,
        publish: true,
      }),
    ).toEqual({ action: "recover" });
    expect(
      preparedPlanningRecoveryDecision({
        coverage: prepared.record,
        currentIntentHash: stored.record.planning_intent_hash,
        resume: true,
        revise: true,
        publish: true,
      }),
    ).toMatchObject({ action: "refuse", nextAction: expect.stringContaining("recover") });
    expect(
      preparedPlanningRecoveryDecision({
        coverage: prepared.record,
        currentIntentHash: "incompatible-new-intent",
        resume: true,
        revise: false,
        publish: true,
      }),
    ).toMatchObject({ action: "refuse", nextAction: expect.stringContaining("prepared publication batch") });
  });

  it("binds prepared recovery to requested stage rather than mutable inferred stage", () => {
    const operatorRequest = {
      goal: "Decompose the corpus",
      requestedStage: null,
      planning: { expectedTickets: { kind: "complete", syntax: "complete" } },
      creatorScope: null,
    } as const;
    const bootstrapInference = planningRecoveryIntentHash(operatorRequest);
    const matureInference = planningRecoveryIntentHash(operatorRequest);
    expect(matureInference).toBe(bootstrapInference);
    expect(planningRecoveryIntentHash({ ...operatorRequest, requestedStage: "mature" })).not.toBe(bootstrapInference);
  });

  it("gives remaining-only planning a bounded metadata ledger of retained work", async () => {
    const root = await tempRoot();
    const sections = corpusSections(2);
    await record(root, sections, planFor(sections), 1, "prior-ledger");
    const batch = await preparePlanningPublication(root, APP, SCOPE, true, at(2));
    const coverage = await completePlanningPublication({
      root,
      app: APP,
      scopeId: SCOPE,
      published: published(batch.indexes),
      now: at(3),
    });
    const brief = renderPriorPlanningCoverage(coverage, false);

    expect(brief).toContain("Preserved planning coverage ledger");
    expect(brief).toContain('"index": 0');
    expect(brief).toContain('"state": "published"');
    expect(brief).toContain('"index": 1');
    expect(brief).toContain('"state": "planned"');
    expect(brief).toContain(sections[0]!.coverage_id);
    expect(brief).toContain("Preserved indexes are context only");
    expect(brief).not.toContain("Body 1");
  });

  it("keeps unaffected heading identities stable and supersedes only changed source versions", async () => {
    const before = sectionsFrom("# Alpha\nA\n\n# Repeat\nR1\n\n# Repeat\nR2\n");
    const inserted = sectionsFrom("# New\nN\n\n# Alpha\nA\n\n# Repeat\nR1\n\n# Repeat\nR2\n");
    expect(inserted.slice(1).map((section) => section.logical_id)).toEqual(before.map((section) => section.logical_id));
    expect(new Set(before.map((section) => section.logical_id)).size).toBe(before.length);

    const changed = sectionsFrom("# Alpha\nA changed\n\n# Repeat\nR1\n\n# Repeat\nR2\n");
    expect(changed[0]!.logical_id).toBe(before[0]!.logical_id);
    expect(changed[0]!.coverage_id).not.toBe(before[0]!.coverage_id);
    const root = await tempRoot();
    await record(root, before, planFor(before), 3, "source-a");
    const invalidated = await invalidatePlanningCoverage({
      root,
      app: APP,
      scopeId: SCOPE,
      sourceManifestSha256: "manifest-changed",
      sections: changed,
      now: at(2),
    });
    expect(invalidated.sections.find((section) => section.coverage_id === before[0]!.coverage_id)?.state).toBe(
      "superseded",
    );
    expect(invalidated.sections.find((section) => section.coverage_id === changed[0]!.coverage_id)?.state).toBe(
      "remaining",
    );
    expect(invalidated.sections.filter((section) => section.state === "planned")).toHaveLength(2);
  });

  it("keeps repository source identity stable across snapshot roots, trace ids, and head metadata", async () => {
    const firstRoot = await tempRoot();
    const secondRoot = await tempRoot();
    const content = "# Stable\nSame content\n";
    await writeFile(join(firstRoot, "spec.md"), content, "utf8");
    await writeFile(join(secondRoot, "spec.md"), content, "utf8");
    const first = resolvedAt(firstRoot, "trace-a", "head-a");
    const second = resolvedAt(secondRoot, "trace-b", "head-b");
    const firstSections = planningSourceSections(first);
    const secondSections = planningSourceSections(second);

    expect(secondSections.map(({ logical_id, coverage_id }) => ({ logical_id, coverage_id }))).toEqual(
      firstSections.map(({ logical_id, coverage_id }) => ({ logical_id, coverage_id })),
    );
    expect(planningSourceCoverageHash(second, secondSections)).toBe(planningSourceCoverageHash(first, firstSections));

    await writeFile(join(secondRoot, "spec.md"), "# Stable\nChanged content\n", "utf8");
    const changed = resolvedAt(secondRoot, "trace-c", "head-c");
    const changedSections = planningSourceSections(changed);
    expect(changedSections[0]!.logical_id).toBe(firstSections[0]!.logical_id);
    expect(changedSections[0]!.coverage_id).not.toBe(firstSections[0]!.coverage_id);
    expect(planningSourceCoverageHash(changed, changedSections)).not.toBe(
      planningSourceCoverageHash(first, firstSections),
    );
  });

  it("persists a same-request remaining-only delta exactly once with its own publication provenance", async () => {
    const root = await tempRoot();
    const sections = corpusSections(2);
    await record(root, sections, planFor([sections[0]!]), 1, "same-request");
    const first = await preparePlanningPublication(root, APP, SCOPE, true, at(2));
    await completePlanningPublication({
      root,
      app: APP,
      scopeId: SCOPE,
      published: published(first.indexes),
      now: at(3),
    });
    await refreshPlanningCoverage({
      root,
      app: APP,
      scopeId: SCOPE,
      issues: [{ number: 100, title: "Ticket 1", body: "", labels: [], state: "CLOSED" }],
      deliveredIssueNumbers: new Set([100]),
      now: at(4),
    });
    const deltaProvenance = { episodeId: "episode-delta", runId: "run-delta", traceId: "trace-delta" };
    const deltaInput = {
      root,
      app: APP,
      scopeId: SCOPE,
      requestHash: "same-request",
      planningIntentHash: "same-request-intent",
      sourceManifestSha256: "same-request",
      request: parsePlanningDecompositionRequest("complete"),
      disposition: "accepted" as const,
      refusalProblems: [],
      publicationCap: 1,
      plan: planFor([sections[1]!]),
      sections,
      provenance: deltaProvenance,
      mode: "delta" as const,
      now: at(5),
    };
    const delta = await recordPlanningDecomposition(deltaInput);
    expect(delta.reused).toBe(false);
    expect(delta.record.plan.tickets).toHaveLength(2);
    expect(delta.record.tickets[1]!.provenance).toEqual(deltaProvenance);
    const repeated = await recordPlanningDecomposition(deltaInput);
    expect(repeated.reused).toBe(true);
    expect(repeated.record.plan.tickets).toHaveLength(2);
    const second = await preparePlanningPublication(root, APP, SCOPE, true, at(6));
    expect(second.indexes).toEqual([1]);
    expect(second.record.publication_batches.find((batch) => batch.status === "prepared")?.provenance).toEqual(
      deltaProvenance,
    );
  });

  it("drains preserved unpublished decomposition episodes in separate provenance-bound batches", async () => {
    const root = await tempRoot();
    const sections = corpusSections(4);
    const initialProvenance = { episodeId: "episode-initial", runId: "run-initial", traceId: "trace-initial" };
    const deltaProvenance = { episodeId: "episode-delta", runId: "run-delta", traceId: "trace-delta" };
    await record(root, sections, planFor(sections.slice(0, 2)), 3, "unpublished-multi", "initial", initialProvenance);
    await record(root, sections, planFor(sections.slice(2)), 3, "unpublished-multi", "delta", deltaProvenance);

    const first = await preparePlanningPublication(root, APP, SCOPE, true, at(3));
    expect(first.indexes).toEqual([0, 1]);
    expect(first.record.publication_batches.at(-1)?.provenance).toEqual(initialProvenance);
    await completePlanningPublication({
      root,
      app: APP,
      scopeId: SCOPE,
      published: published(first.indexes),
      now: at(4),
    });

    const second = await preparePlanningPublication(root, APP, SCOPE, true, at(5));
    expect(second.indexes).toEqual([2, 3]);
    expect(second.record.publication_batches.at(-1)?.provenance).toEqual(deltaProvenance);
  });

  it("refuses duplicate resume scope and proves closed-without-merge is not delivered", async () => {
    const root = await tempRoot();
    const sections = corpusSections(2);
    await record(root, sections, planFor(sections), 2, "initial");
    await expect(
      record(root, sections, planFor(sections), 2, "delta", "delta", {
        episodeId: "episode-duplicate",
        runId: "run-duplicate",
        traceId: "trace-duplicate",
      }),
    ).rejects.toThrow(/repeats source coverage/);
    const batch = await preparePlanningPublication(root, APP, SCOPE, true, at(3));
    await completePlanningPublication({
      root,
      app: APP,
      scopeId: SCOPE,
      published: published(batch.indexes),
      now: at(4),
    });
    const issues = published(batch.indexes).map(
      (ticket): GhIssue => ({ number: ticket.issueNumber, title: ticket.title, body: "", labels: [], state: "CLOSED" }),
    );
    let coverage = await refreshPlanningCoverage({
      root,
      app: APP,
      scopeId: SCOPE,
      issues,
      deliveredIssueNumbers: new Set(),
      now: at(5),
    });
    expect(planningCoverageSummary(coverage).delivered).toBe(0);
    expect(planningCoverageSummary(coverage).superseded).toBe(2);
    coverage = await refreshPlanningCoverage({
      root,
      app: APP,
      scopeId: SCOPE,
      issues,
      deliveredIssueNumbers: new Set(issues.map((issue) => issue.number)),
      now: at(6),
    });
    expect(planningCoverageSummary(coverage).delivered).toBe(2);
  });

  it("detects immutable predecessor tampering and a publication batch above its preserved cap", async () => {
    const root = await tempRoot();
    const sections = corpusSections(4);
    await record(root, sections, planFor(sections), 2, "tamper-a");
    await preparePlanningPublication(root, APP, SCOPE, true, at(2));
    const coverageDir = join(planningAppDir(root, APP), "coverage");
    const revision1 = join(coverageDir, SCOPE, "revision-1.json");
    await writeFile(
      revision1,
      (await readFile(revision1, "utf8")).replace("2026-08-09T12:01:00.000Z", "2026-08-09T12:01:01.000Z"),
      "utf8",
    );
    await expect(readPlanningCoverage(root, APP, SCOPE)).rejects.toThrow(/predecessor digest mismatch/);

    const cleanRoot = await tempRoot();
    await record(cleanRoot, sections, planFor(sections), 2, "tamper-b");
    const prepared = await preparePlanningPublication(cleanRoot, APP, SCOPE, true, at(2));
    const currentPath = join(planningAppDir(cleanRoot, APP), "coverage", `${SCOPE}.json`);
    const revisionPath = join(
      planningAppDir(cleanRoot, APP),
      "coverage",
      SCOPE,
      `revision-${prepared.record.revision}.json`,
    );
    const value = JSON.parse(await readFile(currentPath, "utf8")) as Record<string, unknown>;
    (value["publication_batches"] as Array<{ indexes: number[] }>)[0]!.indexes.push(2);
    const tampered = `${JSON.stringify(value, null, 2)}\n`;
    await writeFile(currentPath, tampered, "utf8");
    await writeFile(revisionPath, tampered, "utf8");
    await expect(readPlanningCoverage(cleanRoot, APP, SCOPE)).rejects.toThrow(/bypasses its preserved cap/);
  });

  it("promotes a matching predecessor-bound orphan after failure between revision and current writes", async () => {
    const root = await tempRoot();
    const sections = corpusSections(2);
    const input = {
      root,
      app: APP,
      scopeId: SCOPE,
      requestHash: "orphan-request",
      planningIntentHash: "orphan-intent",
      sourceManifestSha256: "orphan-source",
      request: parsePlanningDecompositionRequest("complete"),
      disposition: "accepted" as const,
      refusalProblems: [],
      publicationCap: 2,
      plan: planFor(sections),
      sections,
      provenance,
      mode: "initial" as const,
    };
    await expect(
      recordPlanningDecomposition({
        ...input,
        now: at(1),
        afterRevisionPersisted: () => {
          throw new Error("seeded crash after immutable revision write");
        },
      }),
    ).rejects.toThrow(/seeded crash/);
    const firstRead = await readPlanningCoverage(root, APP, SCOPE);
    expect(firstRead).toMatchObject({ revision: 1, updated_at: at(1).toISOString() });
    const recovered = await recordPlanningDecomposition({
      ...input,
      provenance: { episodeId: "new-episode", runId: "new-run", traceId: "new-trace" },
      now: at(2),
    });
    expect(recovered.reused).toBe(true);
    expect(recovered.record).toEqual(firstRead);
  });

  it("rejects an orphan filename/body revision mismatch without changing current", async () => {
    const root = await tempRoot();
    const sections = corpusSections(1);
    await record(root, sections, planFor(sections), 1, "orphan-revision-mismatch");
    const coverageDir = join(planningAppDir(root, APP), "coverage");
    const currentPath = join(coverageDir, `${SCOPE}.json`);
    const currentBefore = await readFile(currentPath, "utf8");
    await writeFile(join(coverageDir, SCOPE, "revision-2.json"), currentBefore, "utf8");

    await expect(readPlanningCoverage(root, APP, SCOPE)).rejects.toThrow(/filename\/body revision mismatch/);
    expect(await readFile(currentPath, "utf8")).toBe(currentBefore);
  });

  it("fails closed when more than one orphan successor is present", async () => {
    const root = await tempRoot();
    const sections = corpusSections(1);
    await record(root, sections, planFor(sections), 1, "orphan-conflict");
    const coverageDir = join(planningAppDir(root, APP), "coverage");
    const current = await readFile(join(coverageDir, `${SCOPE}.json`), "utf8");
    await writeFile(join(coverageDir, SCOPE, "revision-2.json"), current, "utf8");
    await writeFile(join(coverageDir, SCOPE, "revision-3.json"), current, "utf8");
    await expect(readPlanningCoverage(root, APP, SCOPE)).rejects.toThrow(/conflicting or non-contiguous orphan/);
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-374-"));
  roots.push(root);
  return root;
}

function corpusSections(count: number): PlanningSourceSection[] {
  return sectionsFrom(
    Array.from({ length: count }, (_, index) => `# Section ${index + 1}\nBody ${index + 1}\n`).join("\n"),
  );
}

function sectionsFrom(content: string): PlanningSourceSection[] {
  const sources: ResolvedPlanningSources = {
    manifest: {
      schema_version: 1,
      kind: "planning-source-manifest",
      app: APP,
      trace_id: "trace",
      source_checkout: "/repo",
      source_checkout_head: "head",
      budget_bytes: 100_000,
      included_bytes: Buffer.byteLength(content),
      manifest_sha256: "manifest",
      roots: [],
      sources: [
        {
          source_id: "source-1",
          root_index: 0,
          requested_path: "spec.md",
          canonical_path: "/repo/spec.md",
          canonical_ref: "spec.md@head",
          source_sha256: "source-hash",
          source_bytes: Buffer.byteLength(content),
          included_bytes: Buffer.byteLength(content),
          trust: "operator-supplied-untrusted-data",
          provenance: "cli:--source",
          requirement: "required",
          availability: "available",
          selection: "selected",
          inclusion: "full",
          consumption: "consumed",
          reason: null,
        },
      ],
    },
    documents: [{ source_id: "source-1", content }],
  };
  return planningSourceSections(sources);
}

function resolvedAt(sourceCheckout: string, traceId: string, sourceCheckoutHead: string): ResolvedPlanningSources {
  return resolvePlanningSources({
    app: APP,
    traceId,
    sourceCheckout,
    sourceCheckoutHead,
    requests: [{ path: "spec.md" }],
    budgetBytes: 100_000,
  });
}

function planFor(sections: readonly PlanningSourceSection[]): TicketPlan {
  return {
    stage: "mature",
    ticketCountRationale: "One independently testable ticket per durable source section.",
    releaseDisposition: "Merge-only delivery owned by the operator.",
    releaseKind: "merge-only",
    tickets: sections.map((section, index) => ({
      title: `Ticket ${index + 1}`,
      tier: "op:tier-standard",
      priority: "p2",
      dependsOn: [],
      executionGroup: `section-${index + 1}`,
      fileScope: ["src/feature.ts"],
      goal: `Deliver section ${index + 1}`,
      context: "Large corpus decomposition regression.",
      acceptanceCriteria: [`Section ${index + 1} has offline acceptance evidence`],
      outOfScope: "Unrelated sections.",
      notesForBuilder: "Preserve source coverage identity.",
      sourceSections: [section.coverage_id],
    })),
  };
}

async function record(
  root: string,
  sections: readonly PlanningSourceSection[],
  plan: TicketPlan,
  cap: number,
  requestHash: string,
  mode: "initial" | "delta" | "revise" = "initial",
  recordProvenance: PlanProvenance = provenance,
) {
  return recordPlanningDecomposition({
    root,
    app: APP,
    scopeId: SCOPE,
    requestHash,
    planningIntentHash: `${requestHash}-intent`,
    sourceManifestSha256: requestHash,
    request: parsePlanningDecompositionRequest("complete"),
    disposition: "accepted",
    refusalProblems: [],
    publicationCap: cap,
    plan,
    sections,
    provenance: recordProvenance,
    mode,
    now: at(1),
  });
}

function published(indexes: readonly number[]): PublishedTicket[] {
  return indexes.map((index) => ({
    index,
    issueNumber: 100 + index,
    title: `Ticket ${index + 1}`,
    ready: true,
    labels: ["op:tier-standard", "p2", "op:ready"],
  }));
}

function at(minute: number): Date {
  return new Date(`2026-08-09T12:${String(minute).padStart(2, "0")}:00.000Z`);
}

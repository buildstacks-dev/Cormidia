import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stableHash, type ProposedEpisodeStep } from "../../../src/loop/episode-plan.js";
import type { RoleConfig } from "../../../src/runtime/types.js";
import type { AppEntry } from "../../../src/org/apps.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  RoadmapDeliveryError,
  acceptDirectExecutionUnit,
  admitExecutionBatch,
  batchAuthorityPath,
  executionBatchDispositionPath,
  executionUnitJournalPath,
  normalizeDirectExecutionUnitEpisode,
  readExecutionBatch,
  readExecutionUnitJournal,
  transitionExecutionUnitJournal,
  type DirectExecutionUnitAuthority,
} from "../../../src/org/roadmap-delivery.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const AT = "2026-08-03T23:00:00.000Z";
const APP: AppEntry = {
  name: "hb104-app",
  repo: "fixture/hb104",
  status: "live",
  budgetUsdMonth: 100,
  objectiveBudgetUsd: 1000,
  cadence: {},
  execution: { assignmentMode: "fixed", allowedAssignments: {} },
};
const ROLES: RoleConfig[] = [
  role("planner", "claude", "planner-model"),
  role("builder", "codex", "builder-model"),
  role("reviewer", "claude", "reviewer-model"),
];
const TEMPLATE = { id: "direct/governed", version: "v1" };
const STEPS: ProposedEpisodeStep[] = [
  {
    id: "build",
    kind: "provider_turn",
    operation: "direct/build",
    role: "builder",
    objective: "Produce the bounded direct artifact.",
    requiredCapabilities: [],
    dependsOn: [],
    inputRefs: [],
    expectedOutputs: [{ id: "artifact", kind: "content", required: true }],
    maxTurnBudgetUsd: 2,
    selectionReason: "Builder owns the artifact.",
  },
  {
    id: "review",
    kind: "provider_turn",
    operation: "direct/review",
    role: "reviewer",
    objective: "Independently review the artifact.",
    requiredCapabilities: [],
    dependsOn: ["build"],
    inputRefs: [{ ref: "plan-output:artifact", required: true }],
    expectedOutputs: [{ id: "review", kind: "review", required: true }],
    maxTurnBudgetUsd: 2,
    selectionReason: "Reviewer is independent.",
  },
];
const homes: TempStateHome[] = [];

afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

describe("HB-104/HB-105 — ExecutionUnit batching and structured fast paths", () => {
  it("persists direct authority before projection and preserves immutable replay", async () => {
    const home = await stateHome();
    const authority = direct("direct-authority-seam");
    const projections: Array<{ kind: string; path: string }> = [];
    const project = async (entry: { kind: string; path: string }): Promise<void> => {
      const persisted = JSON.parse(await readFile(entry.path, "utf8"));
      expect(persisted).toMatchObject({
        ref: { kind: "direct_execution_unit", id: authority.unitId, version: 1 },
        value: authority,
      });
      projections.push({ kind: entry.kind, path: entry.path });
    };

    const accepted = await acceptDirectExecutionUnit({ root: home.stateHome, authority, project });
    const replay = await acceptDirectExecutionUnit({ root: home.stateHome, authority, project });

    expect(replay).toEqual(accepted);
    expect(projections).toHaveLength(2);
    expect(projections.every((entry) => entry.kind === "direct_execution_unit")).toBe(true);
    const conflicting = { ...structuredClone(authority), objective: "A conflicting direct objective." };
    await expectCode(
      () => acceptDirectExecutionUnit({ root: home.stateHome, authority: conflicting }),
      "authority_conflict",
    );
  });

  it("admits a bounded token-free direct batch and creates plans lazily per unit", async () => {
    const home = await stateHome();
    const first = await acceptDirectExecutionUnit({ root: home.stateHome, authority: direct("direct-a") });
    const second = await acceptDirectExecutionUnit({ root: home.stateHome, authority: direct("direct-b") });
    const batch = await admitExecutionBatch({
      root: home.stateHome,
      app: APP.name,
      batchId: "direct-batch",
      directUnitRefs: [second.ref, first.ref],
      routing: [],
      admittedAt: AT,
      maxUnits: 2,
    });

    expect(batch.value.units.map((unit) => unit.unitId)).toEqual(["direct-a", "direct-b"]);
    expect(existsSync(home.path("efficiency"))).toBe(false);
    expect(
      (await readExecutionUnitJournal(home.stateHome, APP.name, batch.ref.id, "direct-a"))?.usage.providerTurns,
    ).toBe(0);
    const replay = await admitExecutionBatch({
      root: home.stateHome,
      app: APP.name,
      batchId: "direct-batch",
      directUnitRefs: [second.ref, first.ref],
      routing: [],
      admittedAt: "2026-08-04T00:00:00.000Z",
      maxUnits: 2,
    });
    expect(replay.ref).toEqual(batch.ref);
    expect(replay.value.admittedAt).toBe(AT);

    const normalized = await normalizeDirectExecutionUnitEpisode({
      root: home.stateHome,
      app: APP,
      roles: ROLES,
      batchRef: batch.ref,
      unitId: "direct-a",
      facts: facts(),
      providerOperations: ["direct/build", "direct/review"],
      workflowTemplates: new Map([[`${TEMPLATE.id}@${TEMPLATE.version}`, STEPS]]),
      independentReview: { subjectRoles: ["builder"], reviewerRoles: ["reviewer"] },
      now: () => new Date(AT),
    });
    expect(normalized.prepared).toMatchObject({ planningTurnSkipped: true, plannerAttempts: 0 });
    expect(normalized.plan.planningSource).toBe("creator_scope");
    expect(existsSync(home.path("efficiency"))).toBe(true);
    expect((await readExecutionUnitJournal(home.stateHome, APP.name, batch.ref.id, "direct-b"))?.state).toBe(
      "admitted",
    );

    const tightAuthority = direct("direct-tight");
    tightAuthority.admittedBudget.maxEquivalentCostUsd = 3;
    const tight = await acceptDirectExecutionUnit({ root: home.stateHome, authority: tightAuthority });
    const tightBatch = await admitExecutionBatch({
      root: home.stateHome,
      app: APP.name,
      batchId: "tight-budget-batch",
      directUnitRefs: [tight.ref],
      routing: [],
      admittedAt: AT,
    });
    // Seeded negative control: the complete governed shortcut still cannot
    // borrow the unused cost allowance of either sibling in direct-batch.
    await expectCode(
      () =>
        normalizeDirectExecutionUnitEpisode({
          root: home.stateHome,
          app: APP,
          roles: ROLES,
          batchRef: tightBatch.ref,
          unitId: "direct-tight",
          facts: facts(),
          providerOperations: ["direct/build", "direct/review"],
          workflowTemplates: new Map([[`${TEMPLATE.id}@${TEMPLATE.version}`, STEPS]]),
          independentReview: { subjectRoles: ["builder"], reviewerRoles: ["reviewer"] },
          now: () => new Date(AT),
        }),
      "unit_budget_exhausted",
    );
  });

  it("keeps active membership and budgets isolated, with a seeded lending detector", async () => {
    const home = await stateHome();
    const first = await acceptDirectExecutionUnit({ root: home.stateHome, authority: direct("direct-a") });
    const second = await acceptDirectExecutionUnit({ root: home.stateHome, authority: direct("direct-b") });
    const batch = await admitExecutionBatch({
      root: home.stateHome,
      app: APP.name,
      batchId: "isolation-batch",
      directUnitRefs: [first.ref, second.ref],
      routing: [],
      admittedAt: AT,
    });

    // Seeded crash boundary: the batch authority landed but one initial
    // journal write vanished. Durable batch membership must still block an
    // overlapping admission; a missing journal is never interpreted as free.
    await rm(executionUnitJournalPath(home.stateHome, APP.name, batch.ref.id, "direct-a"));
    await expectCode(
      () =>
        admitExecutionBatch({
          root: home.stateHome,
          app: APP.name,
          batchId: "duplicate-active",
          directUnitRefs: [first.ref],
          routing: [],
          admittedAt: AT,
        }),
      "batch_membership_active",
    );

    await transitionExecutionUnitJournal({
      root: home.stateHome,
      app: APP.name,
      batchRef: batch.ref,
      unitId: "direct-a",
      expectedStates: ["admitted"],
      nextState: "running",
      usageDelta: { providerTurns: 1, equivalentCostUsd: 1 },
      now: new Date(AT),
    });
    // Seeded negative control: A cannot borrow B's untouched allowance.
    await expectCode(
      () =>
        transitionExecutionUnitJournal({
          root: home.stateHome,
          app: APP.name,
          batchRef: batch.ref,
          unitId: "direct-a",
          expectedStates: ["running"],
          nextState: "running",
          usageDelta: { providerTurns: 99 },
          now: new Date(AT),
        }),
      "unit_budget_exhausted",
    );
    expect(
      (await readExecutionUnitJournal(home.stateHome, APP.name, batch.ref.id, "direct-b"))?.usage.providerTurns,
    ).toBe(0);
  });

  it("refuses manifest overflow and verbose prose without complete structured provenance", async () => {
    const home = await stateHome();
    const verbose = direct("verbose-only");
    verbose.objective = "A very detailed paragraph ".repeat(200);
    verbose.provenance.evidenceRefs = [];
    await expectCode(
      () => acceptDirectExecutionUnit({ root: home.stateHome, authority: verbose }),
      "direct_unit_incomplete",
    );
    const first = await acceptDirectExecutionUnit({ root: home.stateHome, authority: direct("direct-a") });
    const second = await acceptDirectExecutionUnit({ root: home.stateHome, authority: direct("direct-b") });
    await expectCode(
      () =>
        admitExecutionBatch({
          root: home.stateHome,
          app: APP.name,
          batchId: "too-many",
          directUnitRefs: [first.ref, second.ref],
          routing: [],
          admittedAt: AT,
          maxUnits: 1,
        }),
      "batch_manifest_too_large",
    );
  });

  it("repairs a crash between the last unit outcome and the batch disposition", async () => {
    const home = await stateHome();
    const first = await acceptDirectExecutionUnit({ root: home.stateHome, authority: direct("direct-a") });
    const second = await acceptDirectExecutionUnit({ root: home.stateHome, authority: direct("direct-b") });
    const batch = await admitExecutionBatch({
      root: home.stateHome,
      app: APP.name,
      batchId: "terminal-batch",
      directUnitRefs: [first.ref, second.ref],
      routing: [],
      admittedAt: AT,
    });
    for (const unitId of ["direct-a", "direct-b"]) {
      await transitionExecutionUnitJournal({
        root: home.stateHome,
        app: APP.name,
        batchRef: batch.ref,
        unitId,
        expectedStates: ["admitted"],
        nextState: "failed",
        outcome: "failed",
        now: new Date(AT),
      });
    }
    const disposition = executionBatchDispositionPath(home.stateHome, APP.name, batch.ref.id);
    await rm(disposition);

    // Seeded crash boundary: terminal replay must rebuild the missing batch
    // disposition without reopening or borrowing either sibling outcome.
    await transitionExecutionUnitJournal({
      root: home.stateHome,
      app: APP.name,
      batchRef: batch.ref,
      unitId: "direct-b",
      expectedStates: ["admitted"],
      nextState: "failed",
      outcome: "failed",
      now: new Date(AT),
    });
    expect(JSON.parse(await readFile(disposition, "utf8"))).toMatchObject({
      units: [
        { unitId: "direct-a", outcome: "failed" },
        { unitId: "direct-b", outcome: "failed" },
      ],
    });
  });

  it("reads the HB-100 v1 batch shape but rejects seeded broken lineage", async () => {
    const home = await stateHome();
    const legacy = {
      schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
      batchId: "legacy-hb100",
      version: 1,
      app: APP.name,
      roadmapRef: { kind: "roadmap_plan" as const, id: "legacy-roadmap", version: 1, sha256: "a".repeat(64) },
      frontierHash: "b".repeat(64),
      units: [
        {
          unitId: "legacy-unit",
          membershipHash: "c".repeat(64),
          readinessRef: {
            kind: "delivery_unit_readiness" as const,
            id: "legacy-unit",
            version: 1,
            sha256: "d".repeat(64),
          },
          validationRef: {
            kind: "validation_contract" as const,
            id: "legacy-validation",
            version: 1,
            sha256: "e".repeat(64),
          },
          validationContractHash: "e".repeat(64),
        },
      ],
      admittedAt: AT,
    };
    const ref = {
      kind: "execution_batch" as const,
      id: legacy.batchId,
      version: 1,
      sha256: stableHash(legacy),
    };
    const path = batchAuthorityPath(home.stateHome, APP.name, legacy.batchId, 1);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify({ schemaVersion: 1, ref, value: legacy }, null, 2)}\n`);
    expect((await readExecutionBatch(home.stateHome, APP.name, ref)).value.units[0]?.unitId).toBe("legacy-unit");

    const broken = {
      ...legacy,
      batchId: "legacy-broken",
      units: [{ ...legacy.units[0]!, validationContractHash: "f".repeat(64) }],
    };
    const brokenRef = {
      kind: "execution_batch" as const,
      id: broken.batchId,
      version: 1,
      sha256: stableHash(broken),
    };
    const brokenPath = batchAuthorityPath(home.stateHome, APP.name, broken.batchId, 1);
    await mkdir(dirname(brokenPath), { recursive: true });
    await writeFile(brokenPath, `${JSON.stringify({ schemaVersion: 1, ref: brokenRef, value: broken }, null, 2)}\n`);
    await expectCode(() => readExecutionBatch(home.stateHome, APP.name, brokenRef), "batch_hard_constraint_failed");
  });
});

function role(name: string, runtime: RoleConfig["runtime"], model: string): RoleConfig {
  return {
    name,
    runtime,
    model,
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: [name],
    maxTurnBudgetUsd: 5,
  };
}

function direct(unitId: string): DirectExecutionUnitAuthority {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    kind: "direct_operation",
    unitId,
    app: APP.name,
    objective: `Deliver ${unitId}`,
    inScope: [unitId],
    outOfScope: ["external effects"],
    acceptanceCriteria: ["artifact exists", "independent review approves"],
    expectedArtifacts: [{ id: "review", kind: "review", required: true }],
    declaredConstraints: { externalEffects: false, governedTemplate: true },
    safetyFacts: [{ kind: "independent_review", evidenceRefs: ["direct-authority"] }],
    workflowTemplate: TEMPLATE,
    provenance: {
      source: "human",
      creatorId: "fixture-owner",
      createdAt: AT,
      evidenceRefs: [`fixture:${unitId}`],
    },
    dedupeKey: `dedupe-${unitId}`,
    admittedBudget: {
      maxProviderTurns: 2,
      maxEquivalentCostUsd: 4,
      maxMechanicalOverheadUsd: 0,
      maxActiveTimeMs: 60_000,
      maxHumanDecisions: 0,
    },
    createdAt: AT,
  };
}

function facts() {
  return {
    trigger: { kind: "direct_authority", sourceRef: "fixture" },
    goal: "Deliver governed direct work.",
    lifecycle: "live" as const,
    appStage: "growth" as const,
    repositoryFacts: { repo: APP.repo },
    requestedConstraints: { externalEffects: false },
    hardBudget: {
      maxProviderTurns: 2,
      maxEquivalentCostUsd: 4,
      maxMechanicalOverheadUsd: 0,
      maxActiveTimeMs: 60_000,
      maxHumanDecisions: 0,
    },
    requiredSafetyFacts: [],
  };
}

async function stateHome(): Promise<TempStateHome> {
  const home = await makeTempStateHome({ name: "hb104" });
  homes.push(home);
  return home;
}

async function expectCode(operation: () => unknown | Promise<unknown>, code: string): Promise<void> {
  try {
    await operation();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RoadmapDeliveryError);
    expect((error as RoadmapDeliveryError).code).toBe(code);
  }
}

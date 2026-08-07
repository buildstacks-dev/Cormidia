// HB-102 — validation-contract authority and deterministic readiness guard.
// Every refusal below is a seeded negative control: the detector must turn red
// before a unit can become ready or spend a provider turn.

import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { stableHash } from "../../../src/loop/episode-plan.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  VALIDATION_CONTRACT_SCHEMA,
  RoadmapDeliveryError,
  acceptBacklogSnapshot,
  acceptDeliveryUnitReadiness,
  acceptRoadmapPlan,
  acceptValidationCatalog,
  acceptValidationContract,
  admitExecutionBatch,
  assertValidationEvidenceComplete,
  currentValidationCatalogPointerPath,
  currentValidationContractPointerPath,
  readCurrentValidationContract,
  readValidationContractLifecycle,
  readinessAuthorityPath,
  reconcileRoadmapProjections,
  unitMembershipHash,
  validationWaiverApprovalAction,
  validationAuthorityPath,
  validationContractLifecyclePath,
  type AcceptedAuthority,
  type AcceptedRoadmapPlan,
  type AuthorityRef,
  type BacklogSnapshot,
  type DeliveryUnitReadiness,
  type RoadmapPlan,
  type RoutingSnapshotEntry,
  type ValidationAffectedStructure,
  type ValidationCatalog,
  type ValidationContract,
  type ValidationObligation,
  type ValidationWaiver,
} from "../../../src/org/roadmap-delivery.js";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import {
  VALIDATION_BASE_AFFECTED,
  VALIDATION_EMPTY_AFFECTED,
  validationCatalog,
} from "../../fixtures/validation-catalog.js";

const APP = "hb102-validation";
const UNIT = "unit-validation-authority";
const ISSUES = [233, 240] as const;
const PROPOSED_AT = "2026-08-03T23:29:00.000Z";
const ACCEPTED_AT = "2026-08-03T23:30:00.000Z";
const ROUTING: RoutingSnapshotEntry[] = ISSUES.map((issueNumber) => ({
  issueNumber,
  disposition: "automated",
  observedLabels: ["planning:preplanned"],
}));
const homes: TempStateHome[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => home.cleanup()));
});

function snapshot(routing: BacklogSnapshot["issues"][number]["routing"] = "automated"): BacklogSnapshot {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    snapshotId: "hb102-backlog",
    version: 1,
    app: APP,
    source: "github:issues",
    capturedAt: "2026-08-03T23:20:00.000Z",
    completeness: "complete",
    pagination: { pagesObserved: 1, hasNextPage: false, unavailablePages: [] },
    issues: ISSUES.map((issueNumber) => ({
      issueNumber,
      contentHash: stableHash({ issueNumber, title: `HB-102 ${issueNumber}` }),
      lifecycle: "open",
      routing,
      observedLabels: routing === "human_only" ? ["routing:human-only"] : [],
      dependencyIssues: [],
    })),
  };
}

function roadmap(snapshotRef: AuthorityRef): RoadmapPlan {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    planId: "hb102-roadmap",
    version: 1,
    app: APP,
    backlogSnapshotRef: snapshotRef,
    predecessor: null,
    workstreams: [{ workstreamId: "autonomy", outcome: "Govern readiness", priority: 1 }],
    deliveryUnits: [
      {
        unitId: UNIT,
        workstreamId: "autonomy",
        issueNumbers: [...ISSUES],
        dependsOn: [],
        priority: 1,
        objective: "Bind validation authority before execution",
      },
    ],
    completedUnitIds: [],
    readyFrontier: [UNIT],
    wipLimit: 1,
    moves: [],
    acceptedAt: "2026-08-03T23:25:00.000Z",
  };
}

interface Setup {
  home: TempStateHome;
  snapshot: AcceptedAuthority<BacklogSnapshot>;
  roadmap: AcceptedRoadmapPlan;
  catalog: AcceptedAuthority<ValidationCatalog>;
}

async function setup(name: string): Promise<Setup> {
  const home = await makeTempStateHome({ name });
  homes.push(home);
  const acceptedSnapshot = await acceptBacklogSnapshot({ root: home.stateHome, snapshot: snapshot() });
  const acceptedRoadmap = await acceptRoadmapPlan({
    root: home.stateHome,
    plan: roadmap(acceptedSnapshot.ref),
  });
  const catalog = await acceptValidationCatalog({
    root: home.stateHome,
    catalog: validationCatalog(APP),
  });
  return { home, snapshot: acceptedSnapshot, roadmap: acceptedRoadmap, catalog };
}

function aliasAffected(): ValidationAffectedStructure {
  return {
    journeyIds: ["J03"],
    boundaryIds: ["B21"],
    contractIds: ["B-21"],
    invariantIds: ["INV-016"],
    interfaceIds: ["roadmap-delivery"],
    stateOwnerIds: ["state:planning"],
    controlPointIds: [],
  };
}

function sharedObligation(): ValidationObligation {
  return {
    obligationId: "shared-boundary",
    caseId: "CF-B21-*",
    covers: aliasAffected(),
    cheapestFalsifyingLayer: "L2",
    failureCases: ["the shared delivery boundary loses its contract lineage"],
    detectorId: "shared-boundary-lineage",
    negativeControlId: "seed-swap-boundary-lineage",
    expectedEvidence: ["the exact accepted validation-contract ref and hash"],
    waiver: null,
  };
}

function contractFixture(
  state: Setup,
  input: {
    contractId?: string;
    version?: number;
    predecessor?: AuthorityRef | null;
    catalogRef?: AuthorityRef;
    templateId?: string;
    affected?: ValidationAffectedStructure;
    obligations?: ValidationObligation[];
    proposedAt?: string;
    acceptedAt?: string;
  } = {},
): ValidationContract {
  return {
    schemaVersion: 1,
    contractId: input.contractId ?? "validation-hb102",
    version: input.version ?? 1,
    predecessor: input.predecessor ?? null,
    app: APP,
    catalogRef: input.catalogRef ?? state.catalog.ref,
    roadmapRef: state.roadmap.ref,
    unitId: UNIT,
    unitMembershipHash: unitMembershipHash(ISSUES),
    templateRef: { templateId: input.templateId ?? "routine", version: 1 },
    affected: input.affected ?? aliasAffected(),
    acceptanceCriteria: ["Readiness and all later evidence retain the exact validation hash."],
    requiresHarnessRevision: false,
    harnessRevisionReason: null,
    sharedBoundaryDetectorRefs: [
      {
        boundaryId: "B21",
        caseId: "CF-B21-*",
        detectorId: "shared-boundary-lineage",
      },
    ],
    obligations: input.obligations ?? [sharedObligation()],
    requiredGates: ["pnpm-test", "pnpm-typecheck"],
    proposedAt: input.proposedAt ?? PROPOSED_AT,
    acceptedAt: input.acceptedAt ?? ACCEPTED_AT,
  };
}

async function acceptReadiness(
  state: Setup,
  validation: AcceptedAuthority<ValidationContract>,
): Promise<AcceptedAuthority<DeliveryUnitReadiness>> {
  return acceptDeliveryUnitReadiness({
    root: state.home.stateHome,
    app: APP,
    roadmapRef: state.roadmap.ref,
    expectedFrontierHash: state.roadmap.frontierHash,
    validationRef: validation.ref,
    unitId: UNIT,
    routing: ROUTING,
    readyAt: "2026-08-03T23:31:00.000Z",
  });
}

async function expectCode(
  operation: () => unknown | Promise<unknown>,
  code: RoadmapDeliveryError["code"],
): Promise<void> {
  try {
    await operation();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RoadmapDeliveryError);
    expect((error as RoadmapDeliveryError).code).toBe(code);
  }
}

function obligation(input: {
  obligationId: string;
  caseId: string;
  covers?: ValidationAffectedStructure;
  layer: ValidationObligation["cheapestFalsifyingLayer"];
  detectorId: string;
  waiver?: ValidationWaiver | null;
}): ValidationObligation {
  return {
    obligationId: input.obligationId,
    caseId: input.caseId,
    covers: input.covers ?? structuredClone(VALIDATION_EMPTY_AFFECTED),
    cheapestFalsifyingLayer: input.layer,
    failureCases: [`${input.caseId} seeded failure`],
    detectorId: input.detectorId,
    negativeControlId: `seed-${input.obligationId}`,
    expectedEvidence: [`${input.caseId} detector receipt`],
    waiver: input.waiver ?? null,
  };
}

function waiver(contractId: string, obligationId = "waived-case"): ValidationWaiver {
  return {
    waiverId: `waiver-${obligationId}`,
    policyClassId: "bounded-defer",
    obligationId,
    unitId: UNIT,
    contractId,
    contractVersion: 1,
    reason: "Bounded deferral with explicit evidence",
    provenance: {
      actorId: "product-owner",
      authorityRef: "human:roadmap-ratification-2026-08-03",
      decidedAt: "2026-08-03T23:28:00.000Z",
    },
    expiresAt: "2026-08-04T00:00:00.000Z",
  };
}

async function authorizeValidationWaiver(
  state: Setup,
  contract: ValidationContract,
  value: ValidationWaiver,
  approvedContract: Pick<ValidationContract, "app" | "unitId" | "contractId" | "version"> = contract,
): Promise<void> {
  const approvalId = `approval-${value.waiverId}`;
  const store = new ApprovalStore(state.home.stateHome, { idSource: () => approvalId });
  const obligation = contract.obligations.find((entry) => entry.obligationId === value.obligationId);
  if (obligation === undefined) throw new Error(`missing waiver obligation ${value.obligationId}`);
  const item = await store.raise({
    app: contract.app,
    role: "validation-designer",
    rule: "validation-waiver",
    action: validationWaiverApprovalAction(approvedContract, obligation),
    justification: value.reason,
    now: new Date("2026-08-03T23:27:00.000Z"),
  });
  const decided = await store.decide(item.id, {
    decision: "approved",
    reason: `Approve exact bounded waiver ${value.waiverId}`,
    decidedBy: { kind: "human", identity: "product-owner" },
    now: new Date(value.provenance.decidedAt),
  });
  value.provenance = {
    actorId: decided.decidedBy!.identity,
    authorityRef: `approval:${decided.id}`,
    decidedAt: decided.decidedAt!,
  };
}

describe("HB-102 — validation-contract authority and readiness", () => {
  it("round-trips the validation catalog and contract model through public authority surfaces", async () => {
    const state = await setup("hb102-validation-model-seam");
    const proposal = JSON.parse(JSON.stringify(contractFixture(state))) as ValidationContract;
    const accepted = await acceptValidationContract({
      root: state.home.stateHome,
      contract: proposal,
    });

    expect(Object.keys(accepted.value)).toEqual([...VALIDATION_CONTRACT_SCHEMA.required]);
    expect(accepted.value).toEqual({
      ...proposal,
      templateRef: { templateId: "routine-v1", version: 1 },
      affected: VALIDATION_BASE_AFFECTED,
      sharedBoundaryDetectorRefs: [
        {
          boundaryId: "B-21",
          caseId: "CF-B21-SHARED",
          detectorId: "shared-boundary-lineage",
        },
      ],
      obligations: [
        {
          ...proposal.obligations[0],
          caseId: "CF-B21-SHARED",
          covers: VALIDATION_BASE_AFFECTED,
        },
      ],
    });
    expect(JSON.parse(JSON.stringify(state.catalog.value))).toEqual(state.catalog.value);
    expect(JSON.parse(JSON.stringify(accepted.value))).toEqual(accepted.value);
  });

  it("reads current validation authority and fails closed on corrupt pointers", async () => {
    const { readCurrentValidationCatalog } = await import("../../../src/org/roadmap-delivery.js");
    const catalogState = await setup("hb102-current-catalog-pointer");
    expect((await readCurrentValidationCatalog(catalogState.home.stateHome, APP))?.ref).toEqual(
      catalogState.catalog.ref,
    );
    const catalogPointerPath = currentValidationCatalogPointerPath(catalogState.home.stateHome, APP);
    const catalogPointer = JSON.parse(await readFile(catalogPointerPath, "utf8")) as Record<string, unknown>;
    catalogPointer["unexpected"] = true;
    await writeFile(catalogPointerPath, `${JSON.stringify(catalogPointer, null, 2)}\n`, "utf8");
    await expectCode(() => readCurrentValidationCatalog(catalogState.home.stateHome, APP), "authority_corrupt");

    const contractState = await setup("hb102-current-contract-pointer");
    const contract = await acceptValidationContract({
      root: contractState.home.stateHome,
      contract: contractFixture(contractState),
    });
    expect((await readCurrentValidationContract(contractState.home.stateHome, APP, UNIT))?.ref).toEqual(contract.ref);
    const contractPointerPath = currentValidationContractPointerPath(contractState.home.stateHome, APP, UNIT);
    const contractPointer = JSON.parse(await readFile(contractPointerPath, "utf8")) as Record<string, unknown>;
    contractPointer["unitId"] = "another-unit";
    await writeFile(contractPointerPath, `${JSON.stringify(contractPointer, null, 2)}\n`, "utf8");
    await expectCode(() => readCurrentValidationContract(contractState.home.stateHome, APP, UNIT), "authority_corrupt");
  });

  it("canonicalizes IDs, persists lifecycle, and advances current authority forward-only", async () => {
    const state = await setup("hb102-lifecycle");
    expect(VALIDATION_CONTRACT_SCHEMA).toMatchObject({
      $id: "https://cormidia.dev/schemas/validation-contract/v1.json",
      additionalProperties: false,
      properties: { schemaVersion: { const: 1 } },
    });
    expect(VALIDATION_CONTRACT_SCHEMA.required).toContain("requiresHarnessRevision");

    const proposal = contractFixture(state);
    const first = await acceptValidationContract({
      root: state.home.stateHome,
      contract: proposal,
    });
    expect(first.value.affected).toEqual(VALIDATION_BASE_AFFECTED);
    expect(first.value.obligations[0]).toMatchObject({ caseId: "CF-B21-SHARED" });
    expect(first.value.sharedBoundaryDetectorRefs[0]).toMatchObject({
      boundaryId: "B-21",
      caseId: "CF-B21-SHARED",
    });
    expect(existsSync(validationAuthorityPath(state.home.stateHome, APP, first.ref.id, first.ref.version))).toBe(true);
    expect(existsSync(currentValidationCatalogPointerPath(state.home.stateHome, APP))).toBe(true);
    expect(existsSync(currentValidationContractPointerPath(state.home.stateHome, APP, UNIT))).toBe(true);
    expect(
      await readValidationContractLifecycle(
        state.home.stateHome,
        APP,
        UNIT,
        first.value.contractId,
        first.value.version,
      ),
    ).toMatchObject({ state: "accepted", acceptedRef: first.ref });

    // Seed an interruption after accepted authority/lifecycle but before the
    // current pointer. Exact replay must recover the pointer idempotently.
    await unlink(currentValidationContractPointerPath(state.home.stateHome, APP, UNIT));
    const replay = await acceptValidationContract({
      root: state.home.stateHome,
      contract: structuredClone(proposal),
    });
    expect(replay.ref).toEqual(first.ref);
    expect((await readCurrentValidationContract(state.home.stateHome, APP, UNIT))?.ref).toEqual(first.ref);

    const firstReadiness = await acceptReadiness(state, first);
    expect(firstReadiness.value.validationContractHash).toBe(first.ref.sha256);
    expect(existsSync(readinessAuthorityPath(state.home.stateHome, APP, UNIT, 1))).toBe(true);
    const projections = await reconcileRoadmapProjections({
      root: state.home.stateHome,
      roadmap: state.roadmap,
      snapshot: state.snapshot,
      readiness: [firstReadiness],
      current: [],
      now: new Date("2026-08-03T23:31:00.000Z"),
    });
    expect(projections.every((entry) => entry.labels.includes("op:ready"))).toBe(true);
    const lateRoutingProjections = await reconcileRoadmapProjections({
      root: state.home.stateHome,
      roadmap: state.roadmap,
      snapshot: state.snapshot,
      readiness: [firstReadiness],
      current: [
        {
          issueNumber: ISSUES[0],
          labels: ["planning:preplanned", "routing:human-only"],
          authorityRef: state.roadmap.ref,
          unitId: UNIT,
          membershipHash: unitMembershipHash(ISSUES),
        },
      ],
      now: new Date("2026-08-03T23:31:00.000Z"),
    });
    const lateRoutingProjection = lateRoutingProjections.find((entry) => entry.issueNumber === ISSUES[0]);
    expect(lateRoutingProjection?.labels).toEqual(["planning:preplanned", "routing:human-only"]);
    expect(lateRoutingProjections.every((entry) => !entry.labels.includes("op:ready"))).toBe(true);
    const lateManualProjections = await reconcileRoadmapProjections({
      root: state.home.stateHome,
      roadmap: state.roadmap,
      snapshot: state.snapshot,
      readiness: [firstReadiness],
      current: [
        {
          issueNumber: ISSUES[1],
          labels: ["planning:preplanned", "manual-review"],
          authorityRef: state.roadmap.ref,
          unitId: UNIT,
          membershipHash: unitMembershipHash(ISSUES),
        },
      ],
      now: new Date("2026-08-03T23:31:00.000Z"),
    });
    expect(lateManualProjections.every((entry) => !entry.labels.includes("op:ready"))).toBe(true);
    expect(lateManualProjections.find((entry) => entry.issueNumber === ISSUES[1])?.labels).toContain("manual-review");

    const second = await acceptValidationContract({
      root: state.home.stateHome,
      contract: {
        ...structuredClone(first.value),
        version: 2,
        predecessor: first.ref,
        acceptanceCriteria: [
          ...first.value.acceptanceCriteria,
          "A superseded validation version can no longer authorize readiness.",
        ],
        proposedAt: "2026-08-03T23:32:00.000Z",
        acceptedAt: "2026-08-03T23:33:00.000Z",
      },
    });
    expect((await readCurrentValidationContract(state.home.stateHome, APP, UNIT))?.ref).toEqual(second.ref);
    expect(
      await readValidationContractLifecycle(state.home.stateHome, APP, UNIT, first.value.contractId, 1),
    ).toMatchObject({ state: "superseded", acceptedRef: first.ref });
    await expectCode(
      () =>
        reconcileRoadmapProjections({
          root: state.home.stateHome,
          roadmap: state.roadmap,
          snapshot: state.snapshot,
          readiness: [firstReadiness],
          current: [],
          now: new Date("2026-08-03T23:34:00.000Z"),
        }),
      "projection_contradiction",
    );
    await expectCode(() => acceptReadiness(state, first), "validation_contract_stale");
    await expectCode(
      () =>
        admitExecutionBatch({
          root: state.home.stateHome,
          app: APP,
          batchId: "batch-stale-readiness",
          roadmapRef: state.roadmap.ref,
          expectedFrontierHash: state.roadmap.frontierHash,
          orderedUnitIds: [UNIT],
          readinessRefs: [firstReadiness.ref],
          routing: ROUTING,
          admittedAt: "2026-08-03T23:34:00.000Z",
        }),
      "validation_contract_stale",
    );
    expect((await acceptReadiness(state, second)).value.validationContractHash).toBe(second.ref.sha256);

    const corruptState = await setup("hb102-lifecycle-corrupt-history");
    const corruptContract = await acceptValidationContract({
      root: corruptState.home.stateHome,
      contract: contractFixture(corruptState, { contractId: "validation-corrupt-history" }),
    });
    const corruptPath = validationContractLifecyclePath(
      corruptState.home.stateHome,
      APP,
      UNIT,
      corruptContract.ref.id,
      corruptContract.ref.version,
    );
    const corruptLifecycle = JSON.parse(await readFile(corruptPath, "utf8")) as {
      state: string;
      acceptedRef: AuthorityRef | null;
      transitions: unknown[];
    };
    corruptLifecycle.state = "validated";
    corruptLifecycle.acceptedRef = null;
    corruptLifecycle.transitions = corruptLifecycle.transitions.slice(0, 1);
    await writeFile(corruptPath, `${JSON.stringify(corruptLifecycle, null, 2)}\n`, "utf8");
    await expectCode(
      () =>
        readValidationContractLifecycle(
          corruptState.home.stateHome,
          APP,
          UNIT,
          corruptContract.ref.id,
          corruptContract.ref.version,
        ),
      "authority_corrupt",
    );
  });

  it("turns red for omissions, unknown IDs, wrong layers, missing controls, and revision refusal", async () => {
    const cases: Array<{
      name: string;
      mutate: (contract: ValidationContract) => void;
      code: RoadmapDeliveryError["code"];
    }> = [
      {
        name: "omitted-affected",
        mutate: (contract) => {
          delete (contract as unknown as Record<string, unknown>)["affected"];
        },
        code: "validation_contract_invalid",
      },
      {
        name: "unknown-case",
        mutate: (contract) => {
          contract.obligations[0]!.caseId = "CF-UNKNOWN";
        },
        code: "validation_id_unknown",
      },
      {
        name: "unknown-structure",
        mutate: (contract) => {
          contract.affected.interfaceIds = ["API-UNKNOWN"];
        },
        code: "validation_id_unknown",
      },
      {
        name: "wrong-cheapest-layer",
        mutate: (contract) => {
          contract.obligations[0]!.cheapestFalsifyingLayer = "L1";
        },
        code: "validation_contract_invalid",
      },
      {
        name: "coverage-omission",
        mutate: (contract) => {
          contract.obligations[0]!.covers.interfaceIds = [];
        },
        code: "validation_contract_invalid",
      },
      {
        name: "negative-control-omission",
        mutate: (contract) => {
          contract.obligations[0]!.negativeControlId = "";
        },
        code: "negative_control_missing",
      },
      {
        name: "shared-detector-omission",
        mutate: (contract) => {
          contract.sharedBoundaryDetectorRefs = [];
        },
        code: "validation_contract_invalid",
      },
      {
        name: "stale-template-version",
        mutate: (contract) => {
          contract.templateRef = { templateId: "routine", version: 2 };
        },
        code: "validation_id_unknown",
      },
      {
        name: "requires-harness-revision",
        mutate: (contract) => {
          contract.requiresHarnessRevision = true;
          contract.harnessRevisionReason = "A new boundary is required";
        },
        code: "validation_structure_mismatch",
      },
      {
        name: "stale-schema",
        mutate: (contract) => {
          (contract as unknown as { schemaVersion: number }).schemaVersion = 2;
        },
        code: "validation_contract_invalid",
      },
    ];

    for (const seeded of cases) {
      const state = await setup(`hb102-${seeded.name}`);
      const contract = contractFixture(state, { contractId: `validation-${seeded.name}` });
      seeded.mutate(contract);
      await expectCode(() => acceptValidationContract({ root: state.home.stateHome, contract }), seeded.code);
      expect(
        existsSync(validationAuthorityPath(state.home.stateHome, APP, contract.contractId, contract.version)),
      ).toBe(false);
      expect(
        existsSync(
          validationContractLifecyclePath(state.home.stateHome, APP, UNIT, contract.contractId, contract.version),
        ),
      ).toBe(false);
    }

    const retryState = await setup("hb102-corrected-proposal-retry");
    const corrected = contractFixture(retryState, { contractId: "validation-corrected-retry" });
    const invalid = structuredClone(corrected);
    invalid.obligations[0]!.caseId = "CF-UNKNOWN";
    await expectCode(
      () => acceptValidationContract({ root: retryState.home.stateHome, contract: invalid }),
      "validation_id_unknown",
    );
    expect(
      (
        await acceptValidationContract({
          root: retryState.home.stateHome,
          contract: corrected,
        })
      ).value.contractId,
    ).toBe("validation-corrected-retry");
  });

  it("rejects routine templates for C3 and invariant-floor contracts", async () => {
    const routineCases: Array<[string, ValidationAffectedStructure, ValidationObligation]> = [
      [
        "c3",
        { ...aliasAffected(), controlPointIds: ["T9"] },
        obligation({
          obligationId: "c3-control",
          caseId: "CF-SM-VALIDATION-C",
          covers: { ...structuredClone(VALIDATION_EMPTY_AFFECTED), controlPointIds: ["T9"] },
          layer: "L2",
          detectorId: "validation-authority-detector",
        }),
      ],
      [
        "floor",
        { ...aliasAffected(), invariantIds: ["INV-016", "INV-001"] },
        obligation({
          obligationId: "floor-control",
          caseId: "CF-INV-001",
          covers: { ...structuredClone(VALIDATION_EMPTY_AFFECTED), invariantIds: ["INV-001"] },
          layer: "L1",
          detectorId: "validation-floor-detector",
        }),
      ],
    ];
    for (const [name, affected, extra] of routineCases) {
      const state = await setup(`hb102-routine-${name}`);
      const contract = contractFixture(state, {
        contractId: `validation-routine-${name}`,
        affected: structuredClone(affected),
        obligations: [sharedObligation(), structuredClone(extra)],
      });
      await expectCode(
        () => acceptValidationContract({ root: state.home.stateHome, contract }),
        "validation_contract_invalid",
      );
    }

    const state = await setup("hb102-custom-c3");
    const accepted = await acceptValidationContract({
      root: state.home.stateHome,
      contract: contractFixture(state, {
        contractId: "validation-custom-c3",
        templateId: "custom",
        affected: { ...aliasAffected(), controlPointIds: ["T9"] },
        obligations: [
          sharedObligation(),
          obligation({
            obligationId: "c3-control",
            caseId: "CF-SM-VALIDATION-C",
            covers: { ...structuredClone(VALIDATION_EMPTY_AFFECTED), controlPointIds: ["T9"] },
            layer: "L2",
            detectorId: "validation-authority-detector",
          }),
        ],
      }),
    });
    expect(accepted.value.templateRef).toEqual({ templateId: "custom-v1", version: 1 });
  });

  it("enforces bounded waivers and requires explicit waived evidence", async () => {
    const state = await setup("hb102-waiver-valid");
    const contractId = "validation-waiver-valid";
    const approvedWaiver = waiver(contractId);
    const proposed = contractFixture(state, {
      contractId,
      obligations: [
        sharedObligation(),
        obligation({
          obligationId: "waived-case",
          caseId: "CF-HB102-WAIVER",
          layer: "L1",
          detectorId: "validation-waiver-detector",
          waiver: approvedWaiver,
        }),
      ],
    });
    await authorizeValidationWaiver(state, proposed, approvedWaiver);
    const accepted = await acceptValidationContract({
      root: state.home.stateHome,
      contract: proposed,
    });
    expect(accepted.value.obligations[1]!.waiver).toMatchObject({
      policyClassId: "bounded-defer",
      waiverId: "waiver-waived-case",
    });
    const exactEvidence = {
      cases: [
        {
          caseId: "CF-B21-SHARED",
          detectorId: "shared-boundary-lineage",
          negativeControlId: "seed-swap-boundary-lineage",
          status: "passed" as const,
          waiverId: null,
          evidence: "shared detector fired against its seed",
        },
        {
          caseId: "CF-HB102-WAIVER",
          detectorId: "validation-waiver-detector",
          negativeControlId: "seed-waived-case",
          status: "waived" as const,
          waiverId: "waiver-waived-case",
          evidence: "bounded waiver authority recorded",
        },
      ],
      gates: [
        { gate: "pnpm-test", status: "passed" as const, evidence: "offline receipt" },
        { gate: "pnpm-typecheck", status: "passed" as const, evidence: "offline receipt" },
      ],
    };
    expect(() => assertValidationEvidenceComplete(exactEvidence, accepted.value, ACCEPTED_AT)).not.toThrow();
    expect(() =>
      assertValidationEvidenceComplete(exactEvidence, accepted.value, "2026-08-04T00:00:00.000Z"),
    ).toThrowError(RoadmapDeliveryError);
    await expectCode(
      () =>
        acceptDeliveryUnitReadiness({
          root: state.home.stateHome,
          app: APP,
          roadmapRef: state.roadmap.ref,
          expectedFrontierHash: state.roadmap.frontierHash,
          validationRef: accepted.ref,
          unitId: UNIT,
          routing: ROUTING,
          readyAt: "2026-08-04T00:00:00.000Z",
        }),
      "validation_waiver_invalid",
    );

    const unapprovedState = await setup("hb102-waiver-unapproved");
    const unapprovedId = "validation-waiver-unapproved";
    await expectCode(
      () =>
        acceptValidationContract({
          root: unapprovedState.home.stateHome,
          contract: contractFixture(unapprovedState, {
            contractId: unapprovedId,
            obligations: [
              sharedObligation(),
              obligation({
                obligationId: "waived-case",
                caseId: "CF-HB102-WAIVER",
                layer: "L1",
                detectorId: "validation-waiver-detector",
                waiver: waiver(unapprovedId),
              }),
            ],
          }),
        }),
      "validation_waiver_invalid",
    );

    for (const mode of ["tampered", "cross-unit", "forged-actor", "obligation-swap"] as const) {
      const authorityState = await setup(`hb102-waiver-authority-${mode}`);
      const authorityId = `validation-waiver-authority-${mode}`;
      const authorityWaiver = waiver(authorityId);
      const authorityContract = contractFixture(authorityState, {
        contractId: authorityId,
        obligations: [
          sharedObligation(),
          obligation({
            obligationId: "waived-case",
            caseId: "CF-HB102-WAIVER",
            layer: "L1",
            detectorId: "validation-waiver-detector",
            waiver: authorityWaiver,
          }),
        ],
      });
      await authorizeValidationWaiver(
        authorityState,
        authorityContract,
        authorityWaiver,
        mode === "cross-unit" ? { ...authorityContract, unitId: "other-unit" } : authorityContract,
      );
      if (mode === "tampered") authorityWaiver.reason = "tampered after human approval";
      if (mode === "forged-actor") authorityWaiver.provenance.actorId = "forged-human";
      if (mode === "obligation-swap") {
        const changed = authorityContract.obligations[1]!;
        changed.caseId = "CF-HB102-WAIVER-2";
        changed.detectorId = "validation-waiver-detector-2";
        changed.negativeControlId = "seed-swapped-waiver-obligation";
        changed.failureCases = ["swapped post-approval obligation"];
        changed.expectedEvidence = ["swapped detector receipt"];
      }
      await expectCode(
        () =>
          acceptValidationContract({
            root: authorityState.home.stateHome,
            contract: authorityContract,
          }),
        "validation_waiver_invalid",
      );
    }
    expect(() =>
      assertValidationEvidenceComplete(
        {
          ...exactEvidence,
          cases: exactEvidence.cases.slice(0, 1),
        },
        accepted.value,
        ACCEPTED_AT,
      ),
    ).toThrowError(RoadmapDeliveryError);
    expect(() =>
      assertValidationEvidenceComplete(
        {
          ...exactEvidence,
          cases: exactEvidence.cases.map((entry) =>
            entry.caseId === "CF-HB102-WAIVER" ? { ...entry, status: "passed" as const, waiverId: null } : entry,
          ),
        },
        accepted.value,
        ACCEPTED_AT,
      ),
    ).toThrowError(RoadmapDeliveryError);

    for (const [name, mutate] of [
      [
        "expired",
        (value: ValidationWaiver) => {
          value.expiresAt = ACCEPTED_AT;
        },
      ],
      [
        "wrong-unit",
        (value: ValidationWaiver) => {
          value.unitId = "another-unit";
        },
      ],
      [
        "unbounded",
        (value: ValidationWaiver) => {
          value.expiresAt = "2026-08-04T02:00:00.000Z";
        },
      ],
    ] as const) {
      const invalidState = await setup(`hb102-waiver-${name}`);
      const invalidId = `validation-waiver-${name}`;
      const invalidWaiver = waiver(invalidId);
      mutate(invalidWaiver);
      await expectCode(
        () =>
          acceptValidationContract({
            root: invalidState.home.stateHome,
            contract: contractFixture(invalidState, {
              contractId: invalidId,
              obligations: [
                sharedObligation(),
                obligation({
                  obligationId: "waived-case",
                  caseId: "CF-HB102-WAIVER",
                  layer: "L1",
                  detectorId: "validation-waiver-detector",
                  waiver: invalidWaiver,
                }),
              ],
            }),
          }),
        "validation_waiver_invalid",
      );
    }

    const countState = await setup("hb102-waiver-count");
    const countId = "validation-waiver-count";
    await expectCode(
      () =>
        acceptValidationContract({
          root: countState.home.stateHome,
          contract: contractFixture(countState, {
            contractId: countId,
            obligations: [
              sharedObligation(),
              obligation({
                obligationId: "waived-case",
                caseId: "CF-HB102-WAIVER",
                layer: "L1",
                detectorId: "validation-waiver-detector",
                waiver: waiver(countId),
              }),
              obligation({
                obligationId: "waived-case-2",
                caseId: "CF-HB102-WAIVER-2",
                layer: "L1",
                detectorId: "validation-waiver-detector-2",
                waiver: waiver(countId, "waived-case-2"),
              }),
            ],
          }),
        }),
      "validation_waiver_invalid",
    );
  });

  it("invalidates contracts when the accepted harness catalog advances", async () => {
    const state = await setup("hb102-catalog-stale");
    const contract = await acceptValidationContract({
      root: state.home.stateHome,
      contract: contractFixture(state),
    });
    const catalogV2: ValidationCatalog = {
      ...structuredClone(state.catalog.value),
      version: 2,
      predecessor: state.catalog.ref,
      acceptedAt: "2026-08-03T23:35:00.000Z",
    };
    const weakenedCatalog = structuredClone(catalogV2);
    weakenedCatalog.invariants.find((entry) => entry.canonicalId === "CORMIDIA-INV-001")!.floor = false;
    await expectCode(
      () => acceptValidationCatalog({ root: state.home.stateHome, catalog: weakenedCatalog }),
      "validation_catalog_stale",
    );
    const permissiveCatalog = structuredClone(catalogV2);
    permissiveCatalog.waiverClasses.push({
      classId: "self-authorized",
      aliases: [],
      maxDurationMs: 24 * 60 * 60_000,
      maxWaiversPerContract: 99,
      allowedTemplateKinds: ["routine", "custom"],
    });
    await expectCode(
      () => acceptValidationCatalog({ root: state.home.stateHome, catalog: permissiveCatalog }),
      "validation_catalog_stale",
    );
    const acceptedCatalogV2 = await acceptValidationCatalog({
      root: state.home.stateHome,
      catalog: catalogV2,
    });
    await expectCode(() => acceptReadiness(state, contract), "validation_catalog_stale");

    const replacement = await acceptValidationContract({
      root: state.home.stateHome,
      contract: contractFixture(state, {
        version: 2,
        predecessor: contract.ref,
        catalogRef: acceptedCatalogV2.ref,
        proposedAt: "2026-08-03T23:36:00.000Z",
        acceptedAt: "2026-08-03T23:37:00.000Z",
      }),
    });
    expect((await acceptReadiness(state, replacement)).value.validationContractHash).toBe(replacement.ref.sha256);

    const wrongRevisionHome = await makeTempStateHome({ name: "hb102-catalog-wrong-revision" });
    homes.push(wrongRevisionHome);
    const wrongRevision = validationCatalog(APP);
    wrongRevision.harnessRevisionId = "self-declared-revision";
    await expectCode(
      () => acceptValidationCatalog({ root: wrongRevisionHome.stateHome, catalog: wrongRevision }),
      "validation_catalog_stale",
    );
  });

  it("refuses human-only members at Planner frontier and readiness boundaries", async () => {
    const home = await makeTempStateHome({ name: "hb102-human-only-planner" });
    homes.push(home);
    const humanSnapshot = await acceptBacklogSnapshot({ root: home.stateHome, snapshot: snapshot("human_only") });
    await expectCode(
      () => acceptRoadmapPlan({ root: home.stateHome, plan: roadmap(humanSnapshot.ref) }),
      "routing_ineligible",
    );

    const state = await setup("hb102-human-only-readiness");
    const accepted = await acceptValidationContract({
      root: state.home.stateHome,
      contract: contractFixture(state),
    });
    await expectCode(
      () =>
        acceptDeliveryUnitReadiness({
          root: state.home.stateHome,
          app: APP,
          roadmapRef: state.roadmap.ref,
          expectedFrontierHash: state.roadmap.frontierHash,
          validationRef: accepted.ref,
          unitId: UNIT,
          routing: ROUTING.map((entry) => ({ ...entry, disposition: "human_only" as const })),
          readyAt: "2026-08-03T23:31:00.000Z",
        }),
      "routing_ineligible",
    );

    const manualHome = await makeTempStateHome({ name: "hb102-manual-review-planner" });
    homes.push(manualHome);
    const manualValue = snapshot();
    manualValue.issues[0]!.observedLabels = ["manual-review"];
    const manualSnapshot = await acceptBacklogSnapshot({ root: manualHome.stateHome, snapshot: manualValue });
    await expectCode(
      () => acceptRoadmapPlan({ root: manualHome.stateHome, plan: roadmap(manualSnapshot.ref) }),
      "routing_ineligible",
    );

    await expectCode(
      () =>
        acceptDeliveryUnitReadiness({
          root: state.home.stateHome,
          app: APP,
          roadmapRef: state.roadmap.ref,
          expectedFrontierHash: state.roadmap.frontierHash,
          validationRef: accepted.ref,
          unitId: UNIT,
          routing: ROUTING.map((entry, index) =>
            index === 0 ? { ...entry, observedLabels: [...entry.observedLabels, "manual-review"] } : entry,
          ),
          readyAt: "2026-08-03T23:31:00.000Z",
        }),
      "routing_ineligible",
    );
  });
});

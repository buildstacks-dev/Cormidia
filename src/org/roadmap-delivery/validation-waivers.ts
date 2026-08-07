import { stableHash } from "../../loop/episode-plan.js";
import type { ToolAction } from "../../runtime/types.js";
import { ApprovalStore } from "../approvals.js";
import { assertExactObjectKeys } from "./authority-core.js";
import type { ValidationCatalog, ValidationCatalogTemplate } from "./validation-catalog.js";
import {
  VALIDATION_CONTRACT_SCHEMA_VERSION,
  type ValidationContract,
  type ValidationObligation,
  type ValidationWaiver,
} from "./validation-contract.js";
import { RoadmapDeliveryError } from "./failure.js";
import { assertMachineId, assertNonEmpty, requireDateTime } from "./validation-values.js";

export function validationWaiverApprovalAction(
  contract: Pick<ValidationContract, "app" | "unitId" | "contractId" | "version">,
  obligation: ValidationObligation,
): ToolAction {
  const waiver = obligation.waiver;
  if (waiver === null) {
    throw new RoadmapDeliveryError(
      "validation_waiver_invalid",
      `obligation ${obligation.obligationId} has no waiver to authorize`,
    );
  }
  return {
    tool: "validation-waiver",
    input: {
      schemaVersion: VALIDATION_CONTRACT_SCHEMA_VERSION,
      kind: "validation-waiver",
      app: contract.app,
      unitId: contract.unitId,
      contractId: contract.contractId,
      contractVersion: contract.version,
      obligationId: waiver.obligationId,
      waiverId: waiver.waiverId,
      policyClassId: waiver.policyClassId,
      reason: waiver.reason,
      expiresAt: waiver.expiresAt,
      obligationSha256: stableHash({
        obligationId: obligation.obligationId,
        caseId: obligation.caseId,
        covers: obligation.covers,
        cheapestFalsifyingLayer: obligation.cheapestFalsifyingLayer,
        failureCases: obligation.failureCases,
        detectorId: obligation.detectorId,
        negativeControlId: obligation.negativeControlId,
        expectedEvidence: obligation.expectedEvidence,
        waiver: {
          waiverId: waiver.waiverId,
          policyClassId: waiver.policyClassId,
          obligationId: waiver.obligationId,
          unitId: waiver.unitId,
          contractId: waiver.contractId,
          contractVersion: waiver.contractVersion,
          reason: waiver.reason,
          expiresAt: waiver.expiresAt,
        },
      }),
    },
    description: `Authorize validation waiver ${waiver.waiverId} for ${contract.unitId}`,
  };
}

export function assertValidationWaiversCurrent(contract: ValidationContract, at: Date | string | undefined): void {
  const waivers = contract.obligations
    .map((obligation) => obligation.waiver)
    .filter((waiver): waiver is ValidationWaiver => waiver !== null);
  if (waivers.length === 0) return;
  if (at === undefined) {
    throw new RoadmapDeliveryError(
      "validation_waiver_invalid",
      "waived validation obligations require an explicit operation time",
    );
  }
  const observedAt = at instanceof Date ? at.getTime() : Date.parse(at);
  if (!Number.isFinite(observedAt)) {
    throw new RoadmapDeliveryError("validation_waiver_invalid", "waiver operation time is invalid");
  }
  const expired = waivers.find((waiver) => observedAt >= Date.parse(waiver.expiresAt));
  if (expired !== undefined) {
    throw new RoadmapDeliveryError(
      "validation_waiver_invalid",
      `waiver ${expired.waiverId} expired before this operation`,
    );
  }
}

export function assertValidationWaiver(
  obligation: ValidationObligation,
  contract: ValidationContract,
  catalog: ValidationCatalog,
  templateKind: ValidationCatalogTemplate["kind"],
  contractHasFloor: boolean,
  contractHasC3: boolean,
): void {
  const waiver = obligation.waiver!;
  assertExactObjectKeys(
    waiver,
    [
      "waiverId",
      "policyClassId",
      "obligationId",
      "unitId",
      "contractId",
      "contractVersion",
      "reason",
      "provenance",
      "expiresAt",
    ],
    "validation waiver",
  );
  assertExactObjectKeys(waiver.provenance, ["actorId", "authorityRef", "decidedAt"], "validation waiver provenance");
  assertMachineId(waiver.waiverId, "validation waiver id");
  assertNonEmpty(waiver.reason, "validation waiver reason");
  assertNonEmpty(waiver.provenance.actorId, "validation waiver actor");
  assertNonEmpty(waiver.provenance.authorityRef, "validation waiver authority ref");
  const decidedAt = Date.parse(requireDateTime(waiver.provenance.decidedAt, "validation waiver decidedAt"));
  const expiresAt = Date.parse(requireDateTime(waiver.expiresAt, "validation waiver expiresAt"));
  const acceptedAt = Date.parse(contract.acceptedAt);
  const policy = catalog.waiverClasses.find((entry) => entry.classId === waiver.policyClassId);
  if (
    policy === undefined ||
    waiver.obligationId !== obligation.obligationId ||
    waiver.unitId !== contract.unitId ||
    waiver.contractId !== contract.contractId ||
    waiver.contractVersion !== contract.version ||
    !policy.allowedTemplateKinds.includes(templateKind) ||
    decidedAt > acceptedAt ||
    acceptedAt >= expiresAt ||
    expiresAt - decidedAt > policy.maxDurationMs ||
    contractHasFloor ||
    contractHasC3 ||
    obligation.covers.controlPointIds.length > 0 ||
    obligation.covers.invariantIds.some(
      (id) => catalog.invariants.find((entry) => entry.canonicalId === id)?.floor === true,
    )
  ) {
    throw new RoadmapDeliveryError(
      "validation_waiver_invalid",
      `waiver ${waiver.waiverId} is stale, unbounded, mismatched, or forbidden`,
    );
  }
}

export async function assertValidationWaiverAuthorities(root: string, contract: ValidationContract): Promise<void> {
  const store = new ApprovalStore(root);
  let decided: Awaited<ReturnType<ApprovalStore["listDecidedReadOnly"]>>;
  try {
    decided = await store.listDecidedReadOnly();
  } catch (error) {
    throw new RoadmapDeliveryError(
      "validation_waiver_invalid",
      `validation waiver authority store is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const obligation of contract.obligations) {
    const waiver = obligation.waiver;
    if (waiver === null) continue;
    const match = /^approval:([A-Za-z0-9._-]+)$/.exec(waiver.provenance.authorityRef);
    if (match?.[1] === undefined) {
      throw new RoadmapDeliveryError(
        "validation_waiver_invalid",
        `waiver ${waiver.waiverId} does not name a durable approval authority`,
      );
    }
    const approved = decided.find((item) => item.id === match[1]);
    if (approved === undefined) {
      throw new RoadmapDeliveryError(
        "validation_waiver_invalid",
        `waiver ${waiver.waiverId} approval authority is missing`,
      );
    }
    const expectedAction = validationWaiverApprovalAction(contract, obligation);
    let approvalRecord: Awaited<ReturnType<ApprovalStore["show"]>>;
    try {
      approvalRecord = await store.show(approved.id);
    } catch (error) {
      throw new RoadmapDeliveryError(
        "validation_waiver_invalid",
        `waiver ${waiver.waiverId} approval grant is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      approved.app !== contract.app ||
      approved.rule !== "validation-waiver" ||
      approved.decision !== "approved" ||
      approved.status !== "approved" ||
      approved.decidedBy?.kind !== "human" ||
      approved.decidedBy.identity !== waiver.provenance.actorId ||
      approved.decidedAt !== waiver.provenance.decidedAt ||
      stableHash(approved.action) !== stableHash(expectedAction) ||
      approvalRecord.grant === undefined ||
      approvalRecord.grant.approvalId !== approved.id ||
      approvalRecord.grant.revokedAt !== undefined ||
      Date.parse(approvalRecord.grant.expiresAt) < Date.parse(waiver.expiresAt)
    ) {
      throw new RoadmapDeliveryError(
        "validation_waiver_invalid",
        `waiver ${waiver.waiverId} does not reproduce its exact human approval`,
      );
    }
  }
}

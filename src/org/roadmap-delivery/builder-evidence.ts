import { episodePlanHash, readCurrentEpisodePlan, stableHash } from "../../loop/episode-plan.js";
import { type AcceptedAuthority, type RoadmapDeliveryProjector } from "./authority-core.js";
import { persistAuthority, projectAccepted, sameAuthorityRef } from "./authority-store.js";
import { assertBuilderEvidenceShape, type BuilderEvidenceManifest } from "./builder-evidence-model.js";
import { deliveryClaimStore } from "./delivery-unit-claims.js";
import { loadDeliveryJoin } from "./delivery-join.js";
import { RoadmapDeliveryError } from "./failure.js";
import type { ValidationContract } from "./validation-contract.js";
import { assertValidationWaiversCurrent } from "./validation-waivers.js";

export async function recordBuilderEvidence(input: {
  root: string;
  manifest: BuilderEvidenceManifest;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<BuilderEvidenceManifest>> {
  assertBuilderEvidenceShape(input.manifest);
  const joined = await loadDeliveryJoin(input.root, input.manifest.app, input.manifest.episodeBindingRef);
  assertEvidenceJoin(input.manifest, joined);
  await assertEvidencePlanCurrent(input.root, input.manifest);
  assertValidationWaiversCurrent(joined.validation.value, input.manifest.recordedAt);
  const claim = await deliveryClaimStore(input.root).read(input.manifest.claimSettlementId);
  if (
    claim === undefined ||
    claim.status !== "committed" ||
    claim.attempt !== input.manifest.claimAttempt ||
    claim.payload.unitId !== input.manifest.unitId ||
    claim.payload.membershipHash !== input.manifest.membershipHash ||
    !sameAuthorityRef(claim.payload.readinessRef, input.manifest.readinessRef) ||
    !sameAuthorityRef(claim.payload.validationRef, input.manifest.validationRef) ||
    claim.payload.validationContractHash !== input.manifest.validationContractHash ||
    !sameAuthorityRef(claim.payload.episodeBindingRef, input.manifest.episodeBindingRef)
  ) {
    throw new RoadmapDeliveryError(
      "builder_evidence_missing",
      "builder evidence has no matching committed all-member claim",
    );
  }
  assertValidationEvidenceComplete(input.manifest, joined.validation.value, input.manifest.recordedAt);
  const accepted = await persistAuthority(
    input.root,
    input.manifest.app,
    "builder_evidence",
    input.manifest.unitId,
    input.manifest.episodePlanVersion,
    input.manifest,
  );
  await projectAccepted(input.root, input.manifest.app, accepted, input.project);
  return accepted;
}

export function assertEvidenceJoin(
  manifest: BuilderEvidenceManifest,
  joined: Awaited<ReturnType<typeof loadDeliveryJoin>>,
): void {
  if (
    manifest.unitId !== joined.unit.unitId ||
    stableHash(manifest.issueNumbers) !== joined.binding.value.membershipHash ||
    manifest.membershipHash !== joined.binding.value.membershipHash ||
    !sameAuthorityRef(manifest.roadmapRef, joined.roadmap.ref) ||
    !sameAuthorityRef(manifest.readinessRef, joined.readiness.ref) ||
    !sameAuthorityRef(manifest.validationRef, joined.validation.ref) ||
    manifest.validationContractHash !== joined.validation.ref.sha256 ||
    !sameAuthorityRef(manifest.batchRef, joined.batch.ref) ||
    !sameAuthorityRef(manifest.episodeBindingRef, joined.binding.ref) ||
    manifest.episodeId !== joined.binding.value.episodeId ||
    manifest.episodePlanVersion < joined.binding.value.episodePlanVersion
  ) {
    throw new RoadmapDeliveryError(
      "evidence_unit_mismatch",
      "Builder evidence does not bind the exact accepted unit/plan lineage",
    );
  }
}

export async function assertEvidencePlanCurrent(
  root: string,
  manifest: Pick<BuilderEvidenceManifest, "episodeId" | "episodePlanVersion" | "episodePlanHash">,
): Promise<void> {
  const current = await readCurrentEpisodePlan(root, manifest.episodeId);
  if (
    current === undefined ||
    current.version !== manifest.episodePlanVersion ||
    episodePlanHash(current) !== manifest.episodePlanHash
  ) {
    throw new RoadmapDeliveryError(
      "evidence_unit_mismatch",
      "Builder evidence does not bind the current accepted delivery EpisodePlan",
    );
  }
}

export function assertValidationEvidenceComplete(
  manifest: Pick<BuilderEvidenceManifest, "cases" | "gates">,
  contract: ValidationContract,
  at?: Date | string,
): void {
  assertValidationWaiversCurrent(contract, at);
  const cases = new Map(manifest.cases.map((entry) => [entry.caseId, entry]));
  for (const obligation of contract.obligations) {
    const evidence = cases.get(obligation.caseId);
    const expectedStatus = obligation.waiver === null ? "passed" : "waived";
    const expectedWaiverId = obligation.waiver?.waiverId ?? null;
    if (
      evidence === undefined ||
      evidence.detectorId !== obligation.detectorId ||
      evidence.negativeControlId !== obligation.negativeControlId ||
      evidence.status !== expectedStatus ||
      evidence.waiverId !== expectedWaiverId ||
      typeof evidence.evidence !== "string" ||
      evidence.evidence.trim().length === 0
    ) {
      throw new RoadmapDeliveryError(
        "builder_evidence_missing",
        `missing exact detector/negative-control evidence for ${obligation.caseId}`,
      );
    }
  }
  const gates = new Set(
    manifest.gates
      .filter(
        (entry) => entry.status === "passed" && typeof entry.evidence === "string" && entry.evidence.trim().length > 0,
      )
      .map((entry) => entry.gate),
  );
  const missingGates = contract.requiredGates.filter((gate) => !gates.has(gate));
  if (missingGates.length > 0) {
    throw new RoadmapDeliveryError("builder_evidence_missing", `missing gate evidence for ${missingGates.join(", ")}`);
  }
}

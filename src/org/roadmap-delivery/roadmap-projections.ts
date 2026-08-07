import { stableHash } from "../../loop/episode-plan.js";
import { autonomousExecutionExclusionLabel } from "../../loop/plan-tickets.js";
import { assertAuthorityRef, type AcceptedAuthority, type AuthorityRef } from "./authority-core.js";
import { requireAuthority, sameAuthorityRef } from "./authority-store.js";
import { assertDeliveryUnitReadinessShape, type DeliveryUnitReadiness } from "./delivery-readiness.js";
import { RoadmapDeliveryError } from "./failure.js";
import { requireUnit, unitMembershipHash } from "./roadmap-invariants.js";
import type {
  AcceptedRoadmapPlan,
  BacklogSnapshot,
  RoadmapDeliveryUnit,
  RoadmapIssueProjection,
  RoadmapPlan,
} from "./roadmap-model.js";
import { readCurrentRoadmapPlan } from "./roadmap-plan.js";
import { assertCurrentValidationCatalogRef } from "./validation-catalog-authority.js";
import { readCurrentValidationContract } from "./validation-contract-authority.js";
import type { ValidationContract } from "./validation-contract.js";
import { assertValidationWaiverAuthorities, assertValidationWaiversCurrent } from "./validation-waivers.js";

interface RoadmapProjectionRepair {
  issueNumber: number;
  labels: string[];
  authorityRef: AuthorityRef;
  unitId: string;
  membershipHash: string;
  reason: "missing" | "stale" | "contradictory" | "current";
}

export async function reconcileRoadmapProjections(input: {
  root: string;
  roadmap: AcceptedRoadmapPlan;
  snapshot: AcceptedAuthority<BacklogSnapshot>;
  readiness: readonly AcceptedAuthority<DeliveryUnitReadiness>[];
  current: readonly RoadmapIssueProjection[];
  now: Date;
}): Promise<RoadmapProjectionRepair[]> {
  const [persistedRoadmap, persistedSnapshot] = await Promise.all([
    requireAuthority<RoadmapPlan>(
      input.root,
      input.roadmap.value.app,
      input.roadmap.ref,
      "roadmap_plan",
      "roadmap_missing",
    ),
    requireAuthority<BacklogSnapshot>(
      input.root,
      input.roadmap.value.app,
      input.snapshot.ref,
      "backlog_snapshot",
      "backlog_incomplete",
    ),
  ]);
  const currentRoadmap = await readCurrentRoadmapPlan(input.root, input.roadmap.value.app);
  if (
    currentRoadmap === undefined ||
    !sameAuthorityRef(currentRoadmap.ref, input.roadmap.ref) ||
    stableHash(persistedRoadmap.value) !== stableHash(input.roadmap.value) ||
    stableHash(persistedSnapshot.value) !== stableHash(input.snapshot.value)
  ) {
    throw new RoadmapDeliveryError("projection_contradiction", "projection inputs are not current durable authority");
  }
  if (!sameAuthorityRef(input.roadmap.value.backlogSnapshotRef, input.snapshot.ref)) {
    throw new RoadmapDeliveryError("projection_contradiction", "projection snapshot does not belong to RoadmapPlan");
  }
  const currentByIssue = new Map(input.current.map((projection) => [projection.issueNumber, projection]));
  const unitByIssue = new Map<number, RoadmapDeliveryUnit>();
  for (const unit of input.roadmap.value.deliveryUnits) {
    for (const issueNumber of unit.issueNumbers) unitByIssue.set(issueNumber, unit);
  }
  const ready = new Set<string>();
  for (const supplied of input.readiness) {
    const entry = await requireAuthority<DeliveryUnitReadiness>(
      input.root,
      input.roadmap.value.app,
      supplied.ref,
      "delivery_unit_readiness",
      "validation_incomplete",
    );
    if (stableHash(entry.value) !== stableHash(supplied.value)) {
      throw new RoadmapDeliveryError(
        "projection_contradiction",
        "readiness projection input differs from durable authority",
      );
    }
    assertAuthorityRef(entry.ref, "delivery_unit_readiness");
    assertDeliveryUnitReadinessShape(entry.value);
    if (stableHash(entry.value) !== entry.ref.sha256) {
      throw new RoadmapDeliveryError("authority_corrupt", "readiness projection input is not content-bound");
    }
    if (
      sameAuthorityRef(entry.value.roadmapRef, input.roadmap.ref) &&
      entry.value.frontierHash === input.roadmap.frontierHash &&
      entry.value.validationContractHash === entry.value.validationRef.sha256
    ) {
      const unit = requireUnit(input.roadmap.value, entry.value.unitId);
      const validation = await requireAuthority<ValidationContract>(
        input.root,
        input.roadmap.value.app,
        entry.value.validationRef,
        "validation_contract",
        "validation_contract_missing",
      );
      const currentValidation = await readCurrentValidationContract(
        input.root,
        input.roadmap.value.app,
        entry.value.unitId,
      );
      await assertCurrentValidationCatalogRef(input.root, input.roadmap.value.app, validation.value.catalogRef);
      await assertValidationWaiverAuthorities(input.root, validation.value);
      assertValidationWaiversCurrent(validation.value, input.now);
      if (
        currentValidation === undefined ||
        !sameAuthorityRef(currentValidation.ref, validation.ref) ||
        entry.value.membershipHash !== unitMembershipHash(unit.issueNumbers)
      ) {
        throw new RoadmapDeliveryError("projection_contradiction", "readiness projection lineage is stale");
      }
      if (ready.has(entry.value.unitId)) {
        throw new RoadmapDeliveryError(
          "projection_contradiction",
          `multiple readiness authorities name ${entry.value.unitId}`,
        );
      }
      ready.add(entry.value.unitId);
    }
  }
  const excludedUnits = new Set<string>();
  for (const unit of input.roadmap.value.deliveryUnits) {
    const snapshotExcluded = unit.issueNumbers.some((issueNumber) => {
      const issue = input.snapshot.value.issues.find((candidate) => candidate.issueNumber === issueNumber);
      return (
        issue === undefined ||
        issue.routing !== "automated" ||
        autonomousExecutionExclusionLabel(issue.observedLabels) !== undefined
      );
    });
    const currentExcluded = unit.issueNumbers.some((issueNumber) => {
      const current = currentByIssue.get(issueNumber);
      return current !== undefined && autonomousExecutionExclusionLabel(current.labels) !== undefined;
    });
    if (snapshotExcluded || currentExcluded) excludedUnits.add(unit.unitId);
  }
  return input.snapshot.value.issues
    .map((issue): RoadmapProjectionRepair => {
      const unit = unitByIssue.get(issue.issueNumber);
      if (unit === undefined) {
        throw new RoadmapDeliveryError("issue_unaccounted", `projection has no unit for #${issue.issueNumber}`);
      }
      const membershipHash = unitMembershipHash(unit.issueNumbers);
      const prior = currentByIssue.get(issue.issueNumber);
      const desired = new Set(
        (prior?.labels ?? []).filter((label) => label !== "planning:preplanned" && label !== "op:ready"),
      );
      desired.add("planning:preplanned");
      if (ready.has(unit.unitId) && !excludedUnits.has(unit.unitId)) {
        desired.add("op:ready");
      }
      const labels = [...desired].sort();
      const authorityMatches =
        prior !== undefined &&
        prior.authorityRef !== null &&
        sameAuthorityRef(prior.authorityRef, input.roadmap.ref) &&
        prior.unitId === unit.unitId &&
        prior.membershipHash === membershipHash;
      const labelsMatch = prior !== undefined && stableHash([...prior.labels].sort()) === stableHash(labels);
      const reason: RoadmapProjectionRepair["reason"] =
        prior === undefined
          ? "missing"
          : authorityMatches && labelsMatch
            ? "current"
            : prior.authorityRef === null
              ? "contradictory"
              : "stale";
      return {
        issueNumber: issue.issueNumber,
        labels,
        authorityRef: input.roadmap.ref,
        unitId: unit.unitId,
        membershipHash,
        reason,
      };
    })
    .sort((left, right) => left.issueNumber - right.issueNumber);
}

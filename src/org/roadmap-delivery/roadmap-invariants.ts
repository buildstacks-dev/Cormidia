import { stableHash } from "../../loop/episode-plan.js";
import { autonomousExecutionExclusionLabel } from "../../loop/plan-tickets.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  assertAuthorityRef,
  assertHash,
  assertId,
  assertVersion,
} from "./authority-core.js";
import { RoadmapDeliveryError } from "./failure.js";
import type { BacklogSnapshot, RoadmapDeliveryUnit, RoadmapPlan, RoutingSnapshotEntry } from "./roadmap-model.js";

export function assertRoadmapPlan(plan: RoadmapPlan): void {
  if (plan.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("roadmap_invalid", "unsupported RoadmapPlan schema");
  }
  assertId(plan.planId, "roadmap plan id");
  assertVersion(plan.version, "roadmap plan version");
  assertAuthorityRef(plan.backlogSnapshotRef, "backlog_snapshot");
  requireDateTime(plan.acceptedAt, "roadmap acceptedAt");
  if (
    plan.app.trim().length === 0 ||
    plan.workstreams.length === 0 ||
    plan.deliveryUnits.length === 0 ||
    !Number.isInteger(plan.wipLimit) ||
    plan.wipLimit < 1 ||
    plan.readyFrontier.length > plan.wipLimit
  ) {
    throw new RoadmapDeliveryError("roadmap_invalid", "app, workstreams, and delivery units are required");
  }
  if (plan.predecessor !== null) assertAuthorityRef(plan.predecessor, "roadmap_plan");
  const workstreams = new Set<string>();
  for (const workstream of plan.workstreams) {
    assertId(workstream.workstreamId, "workstream id");
    if (workstreams.has(workstream.workstreamId)) {
      throw new RoadmapDeliveryError("roadmap_invalid", `duplicate workstream ${workstream.workstreamId}`);
    }
    workstreams.add(workstream.workstreamId);
    if (!Number.isInteger(workstream.priority) || workstream.outcome.trim().length === 0) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid workstream ${workstream.workstreamId}`);
    }
  }
  const units = new Map<string, RoadmapDeliveryUnit>();
  const issues = new Set<number>();
  for (const unit of plan.deliveryUnits) {
    assertId(unit.unitId, "delivery unit id");
    if (units.has(unit.unitId)) {
      throw new RoadmapDeliveryError("roadmap_invalid", `duplicate delivery unit ${unit.unitId}`);
    }
    if (!workstreams.has(unit.workstreamId) || unit.issueNumbers.length === 0) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid delivery unit ${unit.unitId}`);
    }
    for (const issue of unit.issueNumbers) {
      if (!Number.isInteger(issue) || issue < 1) {
        throw new RoadmapDeliveryError("issue_unaccounted", `${unit.unitId} has invalid issue ${issue}`);
      }
      if (issues.has(issue)) {
        throw new RoadmapDeliveryError("issue_multiply_assigned", `issue #${issue} appears in multiple units`);
      }
      issues.add(issue);
    }
    units.set(unit.unitId, unit);
  }
  for (const unit of plan.deliveryUnits) {
    for (const dependency of unit.dependsOn) {
      if (!units.has(dependency) || dependency === unit.unitId) {
        throw new RoadmapDeliveryError("unit_cycle", `${unit.unitId} has invalid dependency ${dependency}`);
      }
    }
  }
  assertAcyclic(plan.deliveryUnits);
  const completed = new Set<string>();
  for (const unitId of plan.completedUnitIds) {
    if (completed.has(unitId) || !units.has(unitId)) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid completed unit ${unitId}`);
    }
    completed.add(unitId);
  }
  const frontier = new Set<string>();
  for (const unitId of plan.readyFrontier) {
    if (frontier.has(unitId) || !units.has(unitId) || completed.has(unitId)) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid ready-frontier unit ${unitId}`);
    }
    const unit = units.get(unitId)!;
    const unmet = unit.dependsOn.filter((dependency) => !completed.has(dependency));
    if (unmet.length > 0) {
      throw new RoadmapDeliveryError(
        "roadmap_invalid",
        `ready-frontier unit ${unitId} has unmet dependencies: ${unmet.join(", ")}`,
      );
    }
    frontier.add(unitId);
  }
  const expectedOrder = plan.readyFrontier
    .map((unitId) => units.get(unitId)!)
    .sort((left, right) => left.priority - right.priority || left.unitId.localeCompare(right.unitId))
    .map((unit) => unit.unitId);
  if (stableHash(expectedOrder) !== stableHash(plan.readyFrontier)) {
    throw new RoadmapDeliveryError("roadmap_invalid", "ready frontier is not in stable priority order");
  }
  const seenMoves = new Set<string>();
  for (const move of plan.moves) {
    if (
      !Number.isInteger(move.issueNumber) ||
      move.issueNumber < 1 ||
      !units.has(move.toUnitId) ||
      move.fromUnitId === move.toUnitId ||
      move.reason.trim().length === 0 ||
      seenMoves.has(`${move.issueNumber}\0${move.fromUnitId}\0${move.toUnitId}`)
    ) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid move for issue #${move.issueNumber}`);
    }
    requireDateTime(move.movedAt, "roadmap move movedAt");
    seenMoves.add(`${move.issueNumber}\0${move.fromUnitId}\0${move.toUnitId}`);
  }
}

export function assertBacklogSnapshot(snapshot: BacklogSnapshot): void {
  if (snapshot.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("backlog_incomplete", "unsupported backlog snapshot schema");
  }
  assertId(snapshot.snapshotId, "snapshot id");
  assertVersion(snapshot.version, "snapshot version");
  requireDateTime(snapshot.capturedAt, "snapshot capturedAt");
  if (
    snapshot.app.trim().length === 0 ||
    snapshot.source.trim().length === 0 ||
    !Number.isInteger(snapshot.pagination.pagesObserved) ||
    snapshot.pagination.pagesObserved < 1 ||
    snapshot.issues.length === 0
  ) {
    throw new RoadmapDeliveryError("backlog_incomplete", "backlog snapshot metadata is incomplete");
  }
  const issues = new Set<number>();
  for (const issue of snapshot.issues) {
    if (!Number.isInteger(issue.issueNumber) || issue.issueNumber < 1 || issues.has(issue.issueNumber)) {
      throw new RoadmapDeliveryError(
        issues.has(issue.issueNumber) ? "issue_multiply_assigned" : "backlog_incomplete",
        `invalid or duplicate snapshot issue #${issue.issueNumber}`,
      );
    }
    assertHash(issue.contentHash, `snapshot issue #${issue.issueNumber} content hash`);
    if (
      !Array.isArray(issue.observedLabels) ||
      issue.observedLabels.some((label) => typeof label !== "string" || label.trim().length === 0) ||
      new Set(issue.observedLabels).size !== issue.observedLabels.length ||
      new Set(issue.dependencyIssues).size !== issue.dependencyIssues.length ||
      issue.dependencyIssues.some((dependency) => !Number.isInteger(dependency) || dependency < 1)
    ) {
      throw new RoadmapDeliveryError("backlog_incomplete", `invalid dependencies for #${issue.issueNumber}`);
    }
    issues.add(issue.issueNumber);
  }
  for (const issue of snapshot.issues) {
    const missing = issue.dependencyIssues.filter((dependency) => !issues.has(dependency));
    if (missing.length > 0) {
      throw new RoadmapDeliveryError(
        "backlog_incomplete",
        `snapshot issue #${issue.issueNumber} has unavailable dependencies: ${missing.join(", ")}`,
      );
    }
  }
}

export function assertRoutingEligible(unit: RoadmapDeliveryUnit, routing: readonly RoutingSnapshotEntry[]): void {
  if (new Set(routing.map((entry) => entry.issueNumber)).size !== routing.length) {
    throw new RoadmapDeliveryError("routing_ineligible", "routing snapshot contains duplicate issue facts");
  }
  const byIssue = new Map(routing.map((entry) => [entry.issueNumber, entry]));
  for (const issueNumber of unit.issueNumbers) {
    const current = byIssue.get(issueNumber);
    if (
      current === undefined ||
      current.disposition !== "automated" ||
      !Array.isArray(current.observedLabels) ||
      current.observedLabels.some((label) => typeof label !== "string" || label.trim().length === 0) ||
      new Set(current.observedLabels).size !== current.observedLabels.length ||
      autonomousExecutionExclusionLabel(current.observedLabels) !== undefined
    ) {
      const exclusion =
        current === undefined
          ? "unreadable"
          : (autonomousExecutionExclusionLabel(current.observedLabels) ?? current.disposition);
      throw new RoadmapDeliveryError(
        "routing_ineligible",
        `delivery unit ${unit.unitId} is excluded because #${issueNumber} is ${exclusion}`,
      );
    }
  }
}

export function routingSnapshotHash(unit: RoadmapDeliveryUnit, routing: readonly RoutingSnapshotEntry[]): string {
  assertRoutingEligible(unit, routing);
  const byIssue = new Map(routing.map((entry) => [entry.issueNumber, entry]));
  return stableHash(
    [...unit.issueNumbers].sort(numeric).map((issueNumber) => ({
      issueNumber,
      disposition: byIssue.get(issueNumber)?.disposition,
      observedLabels: [...(byIssue.get(issueNumber)?.observedLabels ?? [])].sort(),
    })),
  );
}

export function requireUnit(plan: RoadmapPlan, unitId: string): RoadmapDeliveryUnit {
  const unit = plan.deliveryUnits.find((candidate) => candidate.unitId === unitId);
  if (unit === undefined) {
    throw new RoadmapDeliveryError("issue_unaccounted", `RoadmapPlan has no unit ${unitId}`);
  }
  return unit;
}

export function unitMembershipHash(issueNumbers: readonly number[]): string {
  return stableHash([...issueNumbers]);
}

function assertAcyclic(units: readonly RoadmapDeliveryUnit[]): void {
  const byId = new Map(units.map((unit) => [unit.unitId, unit]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new RoadmapDeliveryError("unit_cycle", `cycle includes ${id}`);
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const unit of units) visit(unit.unitId);
}

function numeric(left: number, right: number): number {
  return left - right;
}

function requireDateTime(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    throw new RoadmapDeliveryError("roadmap_invalid", `${label} is not a date-time`);
  }
  return value;
}

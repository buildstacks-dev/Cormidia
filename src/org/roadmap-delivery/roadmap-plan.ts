import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeLoopFileAtomic } from "../../loop/durable.js";
import { stableHash } from "../../loop/episode-plan.js";
import { autonomousExecutionExclusionLabel } from "../../loop/plan-tickets.js";
import { withFileLock } from "../../runtime/file-lock.js";
import { planningAppDir } from "../planning-artifact-path.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  type AcceptedAuthority,
  type AuthorityRef,
  type RoadmapDeliveryProjector,
} from "./authority-core.js";
import { currentRoadmapPointerPath } from "./authority-paths.js";
import {
  persistAuthority,
  projectAccepted,
  renderAuthorityRef,
  requireAuthority,
  sameAuthorityRef,
} from "./authority-store.js";
import { RoadmapDeliveryError } from "./failure.js";
import { assertBacklogSnapshot, assertRoadmapPlan, requireUnit } from "./roadmap-invariants.js";
import type { AcceptedRoadmapPlan, BacklogSnapshot, RoadmapDeliveryUnit, RoadmapPlan } from "./roadmap-model.js";

export const ROADMAP_MUTATION_LOCK = {
  staleMs: 30_000,
  maxWaitMs: 31_000,
  retryMinMs: 2,
  retryMaxMs: 8,
} as const;

interface CurrentRoadmapPointer {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  ref: AuthorityRef;
  updatedAt: string;
}

export async function acceptRoadmapPlan(input: {
  root: string;
  plan: RoadmapPlan;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedRoadmapPlan> {
  assertRoadmapPlan(input.plan);
  const snapshot = await requireAuthority<BacklogSnapshot>(
    input.root,
    input.plan.app,
    input.plan.backlogSnapshotRef,
    "backlog_snapshot",
    "backlog_incomplete",
  );
  assertBacklogSnapshot(snapshot.value);
  if (snapshot.value.completeness !== "complete" || snapshot.value.pagination.hasNextPage) {
    throw new RoadmapDeliveryError("backlog_incomplete", "RoadmapPlan names an incomplete backlog snapshot");
  }
  assertRoadmapAccounting(input.plan, snapshot.value);
  assertRoadmapRoutingFrontier(input.plan, snapshot.value);
  const accepted = await withFileLock(
    roadmapMutationLockPath(input.root, input.plan.app),
    ROADMAP_MUTATION_LOCK,
    async () => {
      const current = await readCurrentRoadmapPlan(input.root, input.plan.app);
      assertRoadmapRevision(input.plan, current);
      const persisted = await persistAuthority(
        input.root,
        input.plan.app,
        "roadmap_plan",
        input.plan.planId,
        input.plan.version,
        input.plan,
      );
      const pointer: CurrentRoadmapPointer = {
        schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
        app: input.plan.app,
        ref: persisted.ref,
        updatedAt: input.plan.acceptedAt,
      };
      await writeLoopFileAtomic(
        currentRoadmapPointerPath(input.root, input.plan.app),
        `${JSON.stringify(pointer, null, 2)}\n`,
      );
      return persisted;
    },
  );
  await projectAccepted(input.root, input.plan.app, accepted, input.project);
  return {
    ...accepted,
    frontierHash: stableHash(input.plan.readyFrontier),
  };
}

export async function readCurrentRoadmapPlan(
  root: string,
  app: string,
): Promise<AcceptedAuthority<RoadmapPlan> | undefined> {
  const pointerPath = currentRoadmapPointerPath(root, app);
  if (!existsSync(pointerPath)) return undefined;
  let pointer: unknown;
  try {
    pointer = JSON.parse(await readFile(pointerPath, "utf8")) as unknown;
  } catch (error) {
    throw new RoadmapDeliveryError(
      "authority_corrupt",
      `current RoadmapPlan pointer is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isCurrentRoadmapPointer(pointer) || pointer.app !== app) {
    throw new RoadmapDeliveryError("authority_corrupt", "current RoadmapPlan pointer is invalid");
  }
  return requireAuthority<RoadmapPlan>(root, app, pointer.ref, "roadmap_plan", "roadmap_missing");
}

export async function assertCurrentRoadmapRef(
  root: string,
  app: string,
  expected: AuthorityRef,
  expectedFrontierHash?: string,
): Promise<void> {
  const current = await readCurrentRoadmapPlan(root, app);
  if (
    current === undefined ||
    !sameAuthorityRef(current.ref, expected) ||
    (expectedFrontierHash !== undefined && stableHash(current.value.readyFrontier) !== expectedFrontierHash)
  ) {
    throw new RoadmapDeliveryError(
      "frontier_stale",
      "delivery lineage does not bind the current RoadmapPlan and frontier",
    );
  }
}

function assertRoadmapAccounting(plan: RoadmapPlan, snapshot: BacklogSnapshot): void {
  if (plan.app !== snapshot.app || !sameAuthorityRef(plan.backlogSnapshotRef, authorityRefForSnapshot(snapshot))) {
    throw new RoadmapDeliveryError("roadmap_invalid", "RoadmapPlan does not bind the accepted backlog snapshot");
  }
  const expected = snapshot.issues
    .filter((issue) => issue.lifecycle === "open")
    .map((issue) => issue.issueNumber)
    .sort(numeric);
  const actual = plan.deliveryUnits.flatMap((unit) => unit.issueNumbers).sort(numeric);
  if (stableHash(expected) !== stableHash(actual)) {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missing = expected.filter((issue) => !actualSet.has(issue));
    const unexpected = actual.filter((issue) => !expectedSet.has(issue));
    throw new RoadmapDeliveryError(
      "issue_unaccounted",
      `RoadmapPlan accounting mismatch; missing [${missing.join(",")}], unexpected [${unexpected.join(",")}]`,
    );
  }
}

function assertRoadmapRoutingFrontier(plan: RoadmapPlan, snapshot: BacklogSnapshot): void {
  const routing = new Map(snapshot.issues.map((issue) => [issue.issueNumber, issue]));
  for (const unitId of plan.readyFrontier) {
    const unit = requireUnit(plan, unitId);
    for (const issueNumber of unit.issueNumbers) {
      const issue = routing.get(issueNumber);
      if (issue?.routing !== "automated" || autonomousExecutionExclusionLabel(issue.observedLabels) !== undefined) {
        throw new RoadmapDeliveryError(
          "routing_ineligible",
          `ready-frontier unit ${unitId} contains excluded or unreadable issue #${issueNumber}`,
        );
      }
    }
  }
}

function assertRoadmapRevision(plan: RoadmapPlan, current: AcceptedAuthority<RoadmapPlan> | undefined): void {
  const proposedRef: AuthorityRef = {
    kind: "roadmap_plan",
    id: plan.planId,
    version: plan.version,
    sha256: stableHash(plan),
  };
  if (current === undefined) {
    if (plan.version !== 1 || plan.predecessor !== null || plan.moves.length !== 0) {
      throw new RoadmapDeliveryError(
        "roadmap_invalid",
        "the first RoadmapPlan must be v1 with no predecessor or move history",
      );
    }
    return;
  }
  if (sameAuthorityRef(current.ref, proposedRef)) return;
  if (
    plan.planId !== current.value.planId ||
    plan.version !== current.value.version + 1 ||
    plan.predecessor === null ||
    !sameAuthorityRef(plan.predecessor, current.ref)
  ) {
    throw new RoadmapDeliveryError(
      "frontier_stale",
      `RoadmapPlan revision must advance ${renderAuthorityRef(current.ref)} by exactly one version`,
    );
  }
  if (plan.moves.length < current.value.moves.length) {
    throw new RoadmapDeliveryError("roadmap_invalid", "roadmap move history cannot shrink");
  }
  for (let index = 0; index < current.value.moves.length; index += 1) {
    if (stableHash(plan.moves[index]) !== stableHash(current.value.moves[index])) {
      throw new RoadmapDeliveryError("roadmap_invalid", "roadmap move history is not append-only");
    }
  }
  const priorByIssue = unitByIssue(current.value);
  const nextByIssue = unitByIssue(plan);
  const newMoves = plan.moves.slice(current.value.moves.length);
  for (const [issueNumber, priorUnit] of priorByIssue) {
    const nextUnit = nextByIssue.get(issueNumber);
    if (nextUnit === undefined || nextUnit.unitId === priorUnit.unitId) continue;
    const move = newMoves.find(
      (candidate) =>
        candidate.issueNumber === issueNumber &&
        candidate.fromUnitId === priorUnit.unitId &&
        candidate.toUnitId === nextUnit.unitId,
    );
    if (move === undefined) {
      throw new RoadmapDeliveryError(
        "roadmap_invalid",
        `issue #${issueNumber} moved ${priorUnit.unitId} → ${nextUnit.unitId} without append-only evidence`,
      );
    }
  }
  const priorMembershipIds = new Map(
    current.value.deliveryUnits.map((unit) => [stableHash([...unit.issueNumbers].sort(numeric)), unit.unitId]),
  );
  for (const unit of plan.deliveryUnits) {
    const priorId = priorMembershipIds.get(stableHash([...unit.issueNumbers].sort(numeric)));
    if (priorId !== undefined && priorId !== unit.unitId) {
      throw new RoadmapDeliveryError(
        "roadmap_invalid",
        `unchanged membership ${unit.issueNumbers.join(",")} changed stable unit id ${priorId} → ${unit.unitId}`,
      );
    }
  }
}

function roadmapMutationLockPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "roadmap-mutation.lock");
}

function authorityRefForSnapshot(snapshot: BacklogSnapshot): AuthorityRef {
  return {
    kind: "backlog_snapshot",
    id: snapshot.snapshotId,
    version: snapshot.version,
    sha256: stableHash(snapshot),
  };
}

function isCurrentRoadmapPointer(value: unknown): value is CurrentRoadmapPointer {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (
    row["schemaVersion"] !== ROADMAP_DELIVERY_SCHEMA_VERSION ||
    typeof row["app"] !== "string" ||
    typeof row["updatedAt"] !== "string"
  )
    return false;
  const ref = row["ref"];
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) return false;
  const candidate = ref as Record<string, unknown>;
  return (
    candidate["kind"] === "roadmap_plan" &&
    typeof candidate["id"] === "string" &&
    Number.isInteger(candidate["version"]) &&
    typeof candidate["sha256"] === "string"
  );
}

function unitByIssue(plan: RoadmapPlan): Map<number, RoadmapDeliveryUnit> {
  const result = new Map<number, RoadmapDeliveryUnit>();
  for (const unit of plan.deliveryUnits) {
    for (const issueNumber of unit.issueNumbers) result.set(issueNumber, unit);
  }
  return result;
}

function numeric(left: number, right: number): number {
  return left - right;
}

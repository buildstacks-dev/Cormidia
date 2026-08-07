// HB-101 — whole-backlog snapshot, revision, accounting, and projection authority.
// The fixtures deliberately exceed 100 issues while constructing no provider runtime
// and no EpisodePlan: planning state is one bounded artifact graph, not N cold turns.

import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { stableHash } from "../../../src/loop/episode-plan.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  RoadmapDeliveryError,
  acceptBacklogSnapshot,
  acceptRoadmapPlan,
  admitExecutionBatch,
  backlogSnapshotAuthorityPath,
  deriveBacklogDelta,
  readCurrentRoadmapPlan,
  reconcileRoadmapProjections,
  type AcceptedAuthority,
  type AuthorityRef,
  type BacklogSnapshot,
  type BacklogSnapshotIssue,
  type RoadmapIssueProjection,
  type RoadmapPlan,
} from "../../../src/org/roadmap-delivery.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const APP = "hb101-large-backlog";
const AT = "2026-08-03T23:00:00.000Z";
const homes: TempStateHome[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => home.cleanup()));
});

function issue(issueNumber: number, overrides: Partial<BacklogSnapshotIssue> = {}): BacklogSnapshotIssue {
  const routing = overrides.routing ?? (issueNumber === 2 ? "human_only" : "automated");
  return {
    issueNumber,
    contentHash: stableHash({ issueNumber, revision: 1 }),
    lifecycle: "open",
    routing,
    observedLabels: routing === "human_only" ? ["routing:human-only"] : [],
    dependencyIssues: [],
    ...overrides,
  };
}

function snapshot(
  input: {
    version?: number;
    count?: number;
    issues?: BacklogSnapshotIssue[];
    completeness?: BacklogSnapshot["completeness"];
    hasNextPage?: boolean;
    unavailablePages?: number[];
  } = {},
): BacklogSnapshot {
  const version = input.version ?? 1;
  const issues = input.issues ?? Array.from({ length: input.count ?? 125 }, (_, index) => issue(index + 1));
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    snapshotId: "github-open-issues",
    version,
    app: APP,
    source: "github:issues?state=open",
    capturedAt: new Date(Date.parse(AT) + version * 1_000).toISOString(),
    completeness: input.completeness ?? "complete",
    pagination: {
      pagesObserved: Math.max(1, Math.ceil(issues.length / 50)),
      hasNextPage: input.hasNextPage ?? false,
      unavailablePages: input.unavailablePages ?? [],
    },
    issues,
  };
}

function roadmap(input: {
  snapshotRef: AuthorityRef;
  issueNumbers: number[];
  version?: number;
  predecessor?: AuthorityRef | null;
  unitPrefix?: string;
  wipLimit?: number;
}): RoadmapPlan {
  const version = input.version ?? 1;
  const prefix = input.unitPrefix ?? "unit";
  const deliveryUnits = input.issueNumbers.map((issueNumber) => ({
    unitId: `${prefix}-${String(issueNumber).padStart(3, "0")}`,
    workstreamId: "backlog-loop",
    issueNumbers: [issueNumber],
    dependsOn: [],
    priority: issueNumber,
    objective: `Deliver issue #${issueNumber}`,
  }));
  const wipLimit = input.wipLimit ?? 4;
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    planId: "roadmap-main",
    version,
    app: APP,
    backlogSnapshotRef: input.snapshotRef,
    predecessor: input.predecessor ?? null,
    workstreams: [{ workstreamId: "backlog-loop", outcome: "Drain the governed backlog", priority: 1 }],
    deliveryUnits,
    completedUnitIds: [],
    readyFrontier: deliveryUnits
      .filter((unit) => unit.issueNumbers[0] !== 2)
      .slice(0, wipLimit)
      .map((unit) => unit.unitId),
    wipLimit,
    moves: [],
    acceptedAt: new Date(Date.parse(AT) + version * 2_000).toISOString(),
  };
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

async function acceptSnapshot(
  home: TempStateHome,
  value: BacklogSnapshot,
): Promise<AcceptedAuthority<BacklogSnapshot>> {
  return acceptBacklogSnapshot({ root: home.stateHome, snapshot: value });
}

describe("HB-101 — RoadmapPlan whole-backlog authority", () => {
  it("preserves typed failure identity through the roadmap-delivery façade", async () => {
    const home = await makeTempStateHome({ name: "hb101-failure-taxonomy" });
    homes.push(home);

    try {
      await acceptSnapshot(home, snapshot({ completeness: "partial", hasNextPage: true }));
      throw new Error("expected typed backlog refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(RoadmapDeliveryError);
      expect(error).toMatchObject({
        name: "RoadmapDeliveryError",
        code: "backlog_incomplete",
        message: "backlog_incomplete: snapshot github-open-issues@1 is partial with 0 unavailable page(s)",
      });
    }
  });

  it("accounts for 125 issues once, bounds the frontier, and reconciles projections deterministically", async () => {
    const home = await makeTempStateHome({ name: "hb101-large" });
    homes.push(home);
    const acceptedSnapshot = await acceptSnapshot(home, snapshot({ count: 125 }));
    const acceptedRoadmap = await acceptRoadmapPlan({
      root: home.stateHome,
      plan: roadmap({
        snapshotRef: acceptedSnapshot.ref,
        issueNumbers: acceptedSnapshot.value.issues.map((entry) => entry.issueNumber),
      }),
    });
    expect(acceptedRoadmap.value.deliveryUnits).toHaveLength(125);
    expect(acceptedRoadmap.value.readyFrontier).toHaveLength(4);
    expect(await readCurrentRoadmapPlan(home.stateHome, APP)).toEqual({
      schemaVersion: acceptedRoadmap.schemaVersion,
      ref: acceptedRoadmap.ref,
      value: acceptedRoadmap.value,
    });
    expect(existsSync(home.path("efficiency"))).toBe(false);

    const firstProjection: RoadmapIssueProjection = {
      issueNumber: 1,
      labels: ["planning:preplanned", "op:ready"],
      authorityRef: null,
      unitId: null,
      membershipHash: null,
    };
    const repairs = await reconcileRoadmapProjections({
      root: home.stateHome,
      roadmap: acceptedRoadmap,
      snapshot: acceptedSnapshot,
      readiness: [],
      current: [firstProjection],
      now: new Date(AT),
    });
    expect(repairs).toHaveLength(125);
    expect(repairs[0]).toMatchObject({ issueNumber: 1, reason: "contradictory" });
    expect(repairs[0]!.labels).toEqual(["planning:preplanned"]);
    // A RoadmapPlan alone is never enough to project ready, and #2 is human-only.
    expect(repairs[1]!.labels).toEqual(["planning:preplanned"]);
    expect(repairs[4]!.labels).toEqual(["planning:preplanned"]);

    const converged: RoadmapIssueProjection[] = repairs.map((repair) => ({
      issueNumber: repair.issueNumber,
      labels: repair.labels,
      authorityRef: repair.authorityRef,
      unitId: repair.unitId,
      membershipHash: repair.membershipHash,
    }));
    expect(
      (
        await reconcileRoadmapProjections({
          root: home.stateHome,
          roadmap: acceptedRoadmap,
          snapshot: acceptedSnapshot,
          readiness: [],
          current: converged,
          now: new Date(AT),
        })
      ).every((repair) => repair.reason === "current"),
    ).toBe(true);
  });

  it("refuses partial, paginated, or unavailable snapshots before roadmap authority exists", async () => {
    for (const [name, value] of [
      ["partial", snapshot({ completeness: "partial", hasNextPage: true })],
      ["unavailable", snapshot({ completeness: "unavailable", unavailablePages: [3] })],
    ] as const) {
      const home = await makeTempStateHome({ name: `hb101-${name}` });
      homes.push(home);
      await expectCode(() => acceptSnapshot(home, value), "backlog_incomplete");
      expect(existsSync(backlogSnapshotAuthorityPath(home.stateHome, APP, value.snapshotId, value.version))).toBe(
        false,
      );
    }
  });

  it("turns red for unaccounted and multiply-assigned issues", async () => {
    const missingHome = await makeTempStateHome({ name: "hb101-missing" });
    homes.push(missingHome);
    const acceptedMissingSnapshot = await acceptSnapshot(missingHome, snapshot({ count: 10 }));
    await expectCode(
      () =>
        acceptRoadmapPlan({
          root: missingHome.stateHome,
          plan: roadmap({ snapshotRef: acceptedMissingSnapshot.ref, issueNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9] }),
        }),
      "issue_unaccounted",
    );

    const duplicateHome = await makeTempStateHome({ name: "hb101-duplicate" });
    homes.push(duplicateHome);
    const acceptedDuplicateSnapshot = await acceptSnapshot(duplicateHome, snapshot({ count: 10 }));
    const duplicated = roadmap({
      snapshotRef: acceptedDuplicateSnapshot.ref,
      issueNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    duplicated.deliveryUnits[1]!.issueNumbers.push(1);
    await expectCode(
      () => acceptRoadmapPlan({ root: duplicateHome.stateHome, plan: duplicated }),
      "issue_multiply_assigned",
    );
  });

  it("replans a 120-item backlog from a bounded two-item delta without renaming unchanged units", async () => {
    const home = await makeTempStateHome({ name: "hb101-delta" });
    homes.push(home);
    const firstSnapshot = await acceptSnapshot(home, snapshot({ count: 120 }));
    const firstRoadmap = await acceptRoadmapPlan({
      root: home.stateHome,
      plan: roadmap({
        snapshotRef: firstSnapshot.ref,
        issueNumbers: firstSnapshot.value.issues.map((entry) => entry.issueNumber),
      }),
    });
    const nextIssues = firstSnapshot.value.issues.map((entry) =>
      entry.issueNumber === 120 ? { ...entry, contentHash: stableHash({ issueNumber: 120, revision: 2 }) } : entry,
    );
    nextIssues.push(issue(121));
    const secondSnapshot = await acceptSnapshot(home, snapshot({ version: 2, issues: nextIssues }));
    expect(deriveBacklogDelta(firstSnapshot, secondSnapshot)).toMatchObject({
      addedIssueNumbers: [121],
      removedIssueNumbers: [],
      changedIssueNumbers: [120],
    });
    expect(deriveBacklogDelta(firstSnapshot, secondSnapshot).unchangedIssueNumbers).toHaveLength(119);

    const renamed = roadmap({
      snapshotRef: secondSnapshot.ref,
      issueNumbers: nextIssues.map((entry) => entry.issueNumber),
      version: 2,
      predecessor: firstRoadmap.ref,
    });
    renamed.deliveryUnits[0]!.unitId = "renamed-001";
    renamed.readyFrontier[0] = "renamed-001";
    await expectCode(() => acceptRoadmapPlan({ root: home.stateHome, plan: renamed }), "roadmap_invalid");

    const secondRoadmap = await acceptRoadmapPlan({
      root: home.stateHome,
      plan: roadmap({
        snapshotRef: secondSnapshot.ref,
        issueNumbers: nextIssues.map((entry) => entry.issueNumber),
        version: 2,
        predecessor: firstRoadmap.ref,
      }),
    });
    expect((await readCurrentRoadmapPlan(home.stateHome, APP))?.ref).toEqual(secondRoadmap.ref);
    expect(existsSync(home.path("efficiency"))).toBe(false);

    await expectCode(
      () =>
        admitExecutionBatch({
          root: home.stateHome,
          app: APP,
          batchId: "stale-v1-batch",
          roadmapRef: firstRoadmap.ref,
          expectedFrontierHash: firstRoadmap.frontierHash,
          orderedUnitIds: [firstRoadmap.value.readyFrontier[0]!],
          readinessRefs: [],
          routing: [{ issueNumber: 1, disposition: "automated", observedLabels: ["op:ready"] }],
          admittedAt: AT,
        }),
      "frontier_stale",
    );
  });

  it("requires append-only move evidence when membership crosses delivery units", async () => {
    const home = await makeTempStateHome({ name: "hb101-moves" });
    homes.push(home);
    const automatedIssues = Array.from({ length: 6 }, (_, index) => issue(index + 1, { routing: "automated" }));
    const firstSnapshot = await acceptSnapshot(home, snapshot({ issues: automatedIssues }));
    const firstPlan: RoadmapPlan = {
      ...roadmap({ snapshotRef: firstSnapshot.ref, issueNumbers: [1, 2, 3, 4, 5, 6], wipLimit: 2 }),
      deliveryUnits: [
        {
          unitId: "unit-a",
          workstreamId: "backlog-loop",
          issueNumbers: [1, 2, 3],
          dependsOn: [],
          priority: 1,
          objective: "A",
        },
        {
          unitId: "unit-b",
          workstreamId: "backlog-loop",
          issueNumbers: [4, 5, 6],
          dependsOn: [],
          priority: 2,
          objective: "B",
        },
      ],
      readyFrontier: ["unit-a", "unit-b"],
    };
    const acceptedFirst = await acceptRoadmapPlan({ root: home.stateHome, plan: firstPlan });
    const secondSnapshot = await acceptSnapshot(home, snapshot({ version: 2, issues: automatedIssues }));
    const moved: RoadmapPlan = {
      ...firstPlan,
      version: 2,
      backlogSnapshotRef: secondSnapshot.ref,
      predecessor: acceptedFirst.ref,
      deliveryUnits: [
        { ...firstPlan.deliveryUnits[0]!, issueNumbers: [1, 2] },
        { ...firstPlan.deliveryUnits[1]!, issueNumbers: [3, 4, 5, 6] },
      ],
      acceptedAt: "2026-08-03T23:05:00.000Z",
    };
    await expectCode(() => acceptRoadmapPlan({ root: home.stateHome, plan: moved }), "roadmap_invalid");
    moved.moves = [
      {
        issueNumber: 3,
        fromUnitId: "unit-a",
        toUnitId: "unit-b",
        reason: "shared validation boundary belongs in one PR",
        movedAt: "2026-08-03T23:04:00.000Z",
      },
    ];
    expect((await acceptRoadmapPlan({ root: home.stateHome, plan: moved })).value.moves).toHaveLength(1);
  });
});

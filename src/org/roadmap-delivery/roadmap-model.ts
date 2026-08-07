import type { AcceptedAuthority, AuthorityRef } from "./authority-core.js";
import { ROADMAP_DELIVERY_SCHEMA_VERSION } from "./authority-core.js";

export interface RoadmapWorkstream {
  workstreamId: string;
  outcome: string;
  priority: number;
}

export interface BacklogSnapshotIssue {
  issueNumber: number;
  contentHash: string;
  lifecycle: "open" | "closed";
  routing: "automated" | "human_only";
  /** Exact labels observed with this snapshot. `manual-review` is evaluated
   * independently from the technical routing disposition. */
  observedLabels: string[];
  dependencyIssues: number[];
}

export interface BacklogSnapshot {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  snapshotId: string;
  version: number;
  app: string;
  source: string;
  capturedAt: string;
  completeness: "complete" | "partial" | "unavailable";
  pagination: {
    pagesObserved: number;
    hasNextPage: boolean;
    unavailablePages: number[];
  };
  issues: BacklogSnapshotIssue[];
}

export interface RoadmapDeliveryUnit {
  unitId: string;
  workstreamId: string;
  issueNumbers: number[];
  dependsOn: string[];
  priority: number;
  objective: string;
}

export interface RoadmapIssueMove {
  issueNumber: number;
  fromUnitId: string;
  toUnitId: string;
  reason: string;
  movedAt: string;
}

export interface RoadmapPlan {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  planId: string;
  version: number;
  app: string;
  backlogSnapshotRef: AuthorityRef;
  predecessor: AuthorityRef | null;
  workstreams: RoadmapWorkstream[];
  deliveryUnits: RoadmapDeliveryUnit[];
  completedUnitIds: string[];
  readyFrontier: string[];
  wipLimit: number;
  moves: RoadmapIssueMove[];
  acceptedAt: string;
}

export interface AcceptedRoadmapPlan extends AcceptedAuthority<RoadmapPlan> {
  frontierHash: string;
}

export interface RoadmapIssueProjection {
  issueNumber: number;
  labels: string[];
  authorityRef: AuthorityRef | null;
  unitId: string | null;
  membershipHash: string | null;
}

export interface RoutingSnapshotEntry {
  issueNumber: number;
  disposition: "automated" | "human_only";
  /** Projection evidence only. Labels never establish roadmap or validation authority. */
  observedLabels: string[];
}

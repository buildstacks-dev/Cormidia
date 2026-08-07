import { stableHash } from "../../loop/episode-plan.js";
import type { AcceptedAuthority, AuthorityRef, RoadmapDeliveryProjector } from "./authority-core.js";
import { persistAuthority, projectAccepted, requireAuthority } from "./authority-store.js";
import { RoadmapDeliveryError } from "./failure.js";
import { assertBacklogSnapshot } from "./roadmap-invariants.js";
import type { BacklogSnapshot } from "./roadmap-model.js";

interface BacklogDelta {
  previousSnapshotRef: AuthorityRef;
  currentSnapshotRef: AuthorityRef;
  addedIssueNumbers: number[];
  removedIssueNumbers: number[];
  changedIssueNumbers: number[];
  unchangedIssueNumbers: number[];
}

export async function acceptBacklogSnapshot(input: {
  root: string;
  snapshot: BacklogSnapshot;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<BacklogSnapshot>> {
  assertBacklogSnapshot(input.snapshot);
  if (
    input.snapshot.completeness !== "complete" ||
    input.snapshot.pagination.hasNextPage ||
    input.snapshot.pagination.unavailablePages.length > 0
  ) {
    throw new RoadmapDeliveryError(
      "backlog_incomplete",
      `snapshot ${input.snapshot.snapshotId}@${input.snapshot.version} is ${input.snapshot.completeness} ` +
        `with ${input.snapshot.pagination.unavailablePages.length} unavailable page(s)`,
    );
  }
  const accepted = await persistAuthority(
    input.root,
    input.snapshot.app,
    "backlog_snapshot",
    input.snapshot.snapshotId,
    input.snapshot.version,
    input.snapshot,
  );
  await projectAccepted(input.root, input.snapshot.app, accepted, input.project);
  return accepted;
}

export function deriveBacklogDelta(
  previous: AcceptedAuthority<BacklogSnapshot>,
  current: AcceptedAuthority<BacklogSnapshot>,
): BacklogDelta {
  if (previous.value.app !== current.value.app) {
    throw new RoadmapDeliveryError("roadmap_invalid", "a backlog delta cannot cross apps");
  }
  const before = new Map(previous.value.issues.map((issue) => [issue.issueNumber, issue]));
  const after = new Map(current.value.issues.map((issue) => [issue.issueNumber, issue]));
  const addedIssueNumbers = [...after.keys()].filter((issue) => !before.has(issue)).sort(numeric);
  const removedIssueNumbers = [...before.keys()].filter((issue) => !after.has(issue)).sort(numeric);
  const changedIssueNumbers: number[] = [];
  const unchangedIssueNumbers: number[] = [];
  for (const issueNumber of [...before.keys()].filter((issue) => after.has(issue)).sort(numeric)) {
    if (stableHash(before.get(issueNumber)) === stableHash(after.get(issueNumber))) {
      unchangedIssueNumbers.push(issueNumber);
    } else {
      changedIssueNumbers.push(issueNumber);
    }
  }
  return {
    previousSnapshotRef: previous.ref,
    currentSnapshotRef: current.ref,
    addedIssueNumbers,
    removedIssueNumbers,
    changedIssueNumbers,
    unchangedIssueNumbers,
  };
}

export async function readBacklogSnapshotAuthority(
  root: string,
  app: string,
  ref: AuthorityRef,
): Promise<AcceptedAuthority<BacklogSnapshot>> {
  const snapshot = await requireAuthority<BacklogSnapshot>(root, app, ref, "backlog_snapshot", "backlog_incomplete");
  assertBacklogSnapshot(snapshot.value);
  return snapshot;
}

function numeric(left: number, right: number): number {
  return left - right;
}

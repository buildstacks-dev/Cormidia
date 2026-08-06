import { stableHash } from "./episode-plan.js";
import type { GhIssue } from "./github.js";

/** One canonical digest for backlog snapshots, delivery admission, and the
 * final all-member claim reread. Labels are set-like for this authority; body,
 * title, and lifecycle changes are content changes. */
export function issueContentHash(issue: Pick<GhIssue, "title" | "body" | "labels" | "state">): string {
  return stableHash({
    title: issue.title,
    body: issue.body,
    labels: [...issue.labels].sort(),
    state: issue.state,
  });
}

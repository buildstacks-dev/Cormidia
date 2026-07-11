// Release handoff (docs/approval-and-release-amendment.md A4): the org layer
// turns a merged item's releaseTrigger — plain data returned by the loop —
// into a critical-op item on the approval queue. The declared deploy/package
// command NEVER runs from here: raising the item is the trigger; execution
// stays behind a human approval decision (the queue is the boundary, and
// "deploy trigger is denied without an approval/grant" is the regression
// requirement this module exists to satisfy).

import { ApprovalStore } from "./approvals.js";
import type { LoopItem } from "../loop/types.js";

export interface QueuedRelease {
  approvalId: string;
  ticketRef: string;
  kind: string;
  owner: string;
}

/** Raise one `production-deploy` approval item per merged loop item that
 *  carries a releaseTrigger. Attributed to the declared owner (orchestrator
 *  or sre) so the audit trail names who is accountable for the action. */
export async function queueReleaseApprovals(
  stateHome: string,
  app: string,
  items: readonly LoopItem[],
  now?: () => Date,
): Promise<QueuedRelease[]> {
  const queued: QueuedRelease[] = [];
  const store = new ApprovalStore(stateHome);
  for (const item of items) {
    if (item.phase !== "merged" || item.releaseTrigger === undefined) continue;
    const trigger = item.releaseTrigger;
    const raised = await store.raise({
      app,
      role: trigger.owner,
      rule: "production-deploy",
      action: {
        tool: "release",
        input: { kind: trigger.kind, command: trigger.command, ticketRef: item.ticketRef },
        description: `${trigger.kind} for ${item.ticketRef}: ${trigger.command}`,
      },
      ticketRef: item.ticketRef,
      justification:
        `milestone ${item.ticketRef} merged with a declared ${trigger.kind} disposition; ` +
        `the app's release mechanism is owned by ${trigger.owner}`,
      ...(now !== undefined ? { now: now() } : {}),
    });
    queued.push({
      approvalId: raised.id,
      ticketRef: item.ticketRef,
      kind: trigger.kind,
      owner: trigger.owner,
    });
  }
  return queued;
}

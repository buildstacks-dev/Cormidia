// The build loop — claude-loop's successor. One work item flows:
//
//   ticket → worktree → build turn(s) → review turn(s) → merge | returned
//
// Deliberately provider-blind: builder and reviewer are RoleConfigs resolved
// through the runtime registry, so the cross-provider pairing (roles.yaml's
// most important decision) is pure config. State for each item lives in
// markdown in the target repo (claude-loop pattern) so a crashed run resumes
// from its SessionHandle or restarts clean.

import type { RoleConfig, SessionHandle } from "../runtime/types.js";
import { NotImplementedError } from "../runtime/types.js";

export type LoopPhase = "queued" | "building" | "reviewing" | "merged" | "returned";

export interface LoopItem {
  ticketRef: string;
  targetRepo: string;
  phase: LoopPhase;
  worktree?: string;
  builderSession?: SessionHandle;
  reviewerSession?: SessionHandle;
  /** review → build round-trips so far; bounded to avoid ping-pong */
  cycles: number;
}

export interface LoopConfig {
  builder: RoleConfig;
  reviewer: RoleConfig;
  maxCycles: number; // default 3: after this, item is returned to the Planner
}

export async function runLoopItem(_item: LoopItem, _config: LoopConfig): Promise<LoopItem> {
  // Planned shape:
  // 1. create worktree for ticket branch
  // 2. builder turn: runtime(builder).runTurn({task: ticket, workdir: worktree})
  // 3. reviewer turn on the PR; verdict: approve | findings
  // 4. findings → builder turn (cycle++); approve → squash-merge
  // 5. cycles > maxCycles → phase "returned" with findings attached
  throw new NotImplementedError("runLoopItem", "src/loop/loop.ts planned shape");
}

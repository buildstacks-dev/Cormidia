// Job-owned critical-operation approval composition — CF-C-OPJOB / HB-145.

import { ApprovalStore } from "../org/approvals.js";
import { composeGate } from "../org/gate-compose.js";
import { defaultGate } from "../runtime/gate.js";
import type { GateFn } from "../runtime/types.js";

export function jobStepGate(
  stateHome: string,
  app: string | null,
  role: string,
  turnId: string,
  workdir: string,
  now: () => Date,
): GateFn {
  return composeGate(defaultGate, new ApprovalStore(stateHome, { now }), {
    app: app ?? "adhoc",
    role,
    turnId,
    workdir,
    now,
  });
}

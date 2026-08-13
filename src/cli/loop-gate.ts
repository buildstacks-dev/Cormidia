import { ApprovalStore } from "../org/approvals.js";
import { composeGate } from "../org/gate-compose.js";
import { defaultGate } from "../runtime/gate.js";
import { definedProps } from "../runtime/optional-properties.js";
import type { GateFn, RoleConfig } from "../runtime/types.js";

/** Give manual loop turns the autonomous dispatcher's durable approval path. */
export function createLoopGateForRole(
  stateHome: string,
  app: string,
  turnId: string,
  orgHome?: string,
  store: ApprovalStore = new ApprovalStore(stateHome),
  workdir?: string,
  appConfig?: { repo: string; networkAllowlist?: readonly string[] },
): (role: RoleConfig, passWorkdir?: string) => GateFn {
  return (role, passWorkdir) =>
    composeGate(defaultGate, store, {
      app,
      role: role.name,
      turnId,
      ...definedProps({ orgHome }),
      ...definedProps({ workdir: passWorkdir ?? workdir }),
      ...(appConfig !== undefined ? { appRepo: appConfig.repo } : {}),
      ...(appConfig?.networkAllowlist !== undefined ? { networkAllowlist: appConfig.networkAllowlist } : {}),
    });
}

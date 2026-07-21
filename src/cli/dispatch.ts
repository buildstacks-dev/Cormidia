import { join, resolve } from "node:path";
import { dispatchTick } from "../org/dispatch.js";
import { loadApps } from "../org/apps.js";
import { executeApprovedReleases } from "../org/release.js";
import { executeApprovedCommands } from "../org/approval-command.js";
import { executeApprovedDeliveries } from "../org/approval-delivery.js";
import { ApprovalStore } from "../org/approvals.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";
import { reportCliInvocation } from "./invocation-audit.js";

export async function cmdDispatch(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "dispatch");
  let appsPath: string | undefined;
  let rolesPath: string | undefined;
  let dryRun = false;

  for (let i = 0; i < common.rest.length; i++) {
    const arg = common.rest[i]!;
    if (arg === "--apps") appsPath = needValue(common.rest, ++i, "--apps");
    else if (arg === "--roles") rolesPath = needValue(common.rest, ++i, "--roles");
    else if (arg === "--dry-run") dryRun = true;
    else throw new Error(`dispatch: unknown argument "${arg}"`);
  }

  const homes = await resolveOperonHomes(common);
  const effectiveApps = appsPath ? resolve(appsPath) : join(homes.orgHome, "apps.yaml");
  const effectiveRoles = rolesPath ? resolve(rolesPath) : join(homes.orgHome, "roles.yaml");
  const appsFile = await loadApps(effectiveApps);
  // Reconcile BEFORE anything tries to execute. Re-homing an unreachable
  // `actor-retry` record onto the orchestrator happens there (ISSUE-020), and
  // only `operon approvals` and a provider turn were calling it — so an
  // operator who ran `operon dispatch` alone against the run-3 queue got
  // exactly what run 3 already had: four records at attempts=0 /
  // nextAction=actor_retry and nothing executed. A dry run stays read-only.
  if (!dryRun) await new ApprovalStore(homes.stateHome).reconcile();
  const deliveries = dryRun
    ? []
    : await executeApprovedDeliveries({
        stateHome: homes.stateHome,
        appsFile,
      });
  // Approved generic shell actions are executed from the durable record here
  // (ISSUE-020) rather than waiting for a provider turn to retry them.
  const commands = dryRun
    ? []
    : await executeApprovedCommands({
        stateHome: homes.stateHome,
        appsFile,
      });
  const releases = dryRun
    ? []
    : await executeApprovedReleases({
        stateHome: homes.stateHome,
        orgHome: homes.orgHome,
        appsFile,
      });
  const result = await dispatchTick({
    orgRoot: homes.orgHome,
    runtimeHome: homes.stateHome,
    appsPath: effectiveApps,
    rolesPath: effectiveRoles,
    dryRun,
  });
  reportCliInvocation({
    dryRun,
    itemsClaimed: result.spawned.length,
    outcome:
      result.spawned.map((turn) => `${turn.app}/${turn.role}=${turn.turnId}`).join(", ") ||
      (result.errors.length > 0 ? `errors: ${result.errors.length}` : "no-due-triggers"),
  });
  console.log(
    `dispatch: spawned=${result.spawned.length} skipped=${result.skipped.length} errors=${result.errors.length}`,
  );
  for (const turn of result.spawned) {
    console.log(`spawned ${turn.turnId} ${turn.app}/${turn.role} ${turn.triggerKind}:${turn.trigger}`);
  }
  for (const line of result.skipped) console.log(`skip ${line}`);
  for (const line of result.errors) console.log(`error ${line}`);
  for (const release of releases) {
    console.log(`release ${release.approvalId}: ${release.status} — ${release.summary.split("\n")[0]}`);
  }
  for (const delivery of deliveries) {
    console.log(`delivery ${delivery.approvalId}: ${delivery.status} — ${delivery.summary.split("\n")[0]}`);
  }
  for (const command of commands) {
    console.log(`approved-command ${command.approvalId}: ${command.status} — ${command.summary.split("\n")[0]}`);
  }
  return result.errors.length > 0 ||
    releases.some((release) => release.status === "failed") ||
    deliveries.some((delivery) => delivery.status === "failed" || delivery.status === "ambiguous") ||
    commands.some((command) => command.status === "failed" || command.status === "ambiguous")
    ? 1
    : 0;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`dispatch: ${flag} requires a value`);
  return value;
}

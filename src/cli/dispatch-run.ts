import { executeApprovedCommands } from "../org/approval-command.js";
import { executeApprovedDeliveries } from "../org/approval-delivery.js";
import { ApprovalStore } from "../org/approvals.js";
import type { AppsFile } from "../org/apps.js";
import { dispatchTick } from "../org/dispatch.js";
import { executeApprovedReleases } from "../org/release.js";
import type { CliProgressReporter } from "../runtime/cli-progress.js";
import { reportCliInvocation } from "./invocation-audit.js";

export async function runDispatch(options: {
  orgHome: string;
  stateHome: string;
  appsFile: AppsFile;
  appsPath: string;
  rolesPath: string;
  dryRun: boolean;
  explicitScheduleRetries: readonly string[];
  reporter?: CliProgressReporter;
}): Promise<number> {
  const { appsFile, dryRun, reporter } = options;
  if (!dryRun) await new ApprovalStore(options.stateHome).reconcile();
  const deliveries = dryRun ? [] : await executeApprovedDeliveries({ stateHome: options.stateHome, appsFile });
  const commands = dryRun ? [] : await executeApprovedCommands({ stateHome: options.stateHome, appsFile });
  const releases = dryRun
    ? []
    : await executeApprovedReleases({ stateHome: options.stateHome, orgHome: options.orgHome, appsFile });
  const result = await dispatchTick({
    orgRoot: options.orgHome,
    runtimeHome: options.stateHome,
    appsPath: options.appsPath,
    rolesPath: options.rolesPath,
    dryRun,
    ...(reporter === undefined
      ? {}
      : {
          onSpawned: (turn) =>
            reporter.phase(
              `spawned ${turn.turnId} ${turn.app}/${turn.role}; follow: cormidia status --app ${turn.app} --json; ` +
                `journal: state/turns/${turn.turnId}.json`,
            ),
        }),
    ...(options.explicitScheduleRetries.length > 0
      ? { explicitScheduleRetries: [...options.explicitScheduleRetries] }
      : {}),
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
  const exitCode =
    result.errors.length > 0 ||
    releases.some((release) => release.status === "failed") ||
    deliveries.some((delivery) => delivery.status === "failed" || delivery.status === "ambiguous") ||
    commands.some((command) => command.status === "failed" || command.status === "ambiguous")
      ? 1
      : 0;
  reporter?.terminal(exitCode === 0 ? "completed" : "failed", {
    ...(exitCode === 0 ? {} : { nextAction: `inspect ${reporter.relativeLogRef}` }),
  });
  return exitCode;
}

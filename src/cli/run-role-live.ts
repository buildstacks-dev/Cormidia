import type { AppEntry, AppsFile } from "../org/apps.js";
import type { CormidiaHomes } from "../org/home.js";
import { prepareStandaloneRunRoleScope } from "../org/run-role-episode.js";
import { runDispatchedTurn } from "../org/turn-runner.js";
import type { CliProgressMode } from "../runtime/cli-progress.js";
import { createCliProgressReporter } from "../runtime/cli-progress.js";
import { definedProps } from "../runtime/optional-properties.js";
import type { RoleConfig } from "../runtime/types.js";
import { installProcessCancellation } from "./process-signal.js";

interface LiveRunRoleOptions {
  homes: CormidiaHomes;
  app: AppEntry;
  appsFile: AppsFile;
  role: RoleConfig;
  turnId: string;
  scopeOptions: Parameters<typeof prepareStandaloneRunRoleScope>[0];
  parentTaskId?: string;
  networkAccess: boolean;
  mode: CliProgressMode;
  runTurn?: typeof runDispatchedTurn;
  heartbeatMs?: number;
  writer?: (line: string) => void;
}

export async function runLiveRole(options: LiveRunRoleOptions): Promise<number> {
  const { homes, app, role, turnId } = options;
  const reporter = createCliProgressReporter({
    stateHome: homes.stateHome,
    command: "run-role",
    scope: `${app.name}/${role.name}/${turnId}`,
    mode: options.mode,
    ...definedProps({ heartbeatMs: options.heartbeatMs, writeStderr: options.writer }),
  });
  reporter.phase("preflight", "started");
  const cancellation = installProcessCancellation();
  let result: Awaited<ReturnType<typeof runDispatchedTurn>>;
  try {
    reporter.phase("scope-and-checkout-preparation");
    const prepared = await prepareStandaloneRunRoleScope(options.scopeOptions);
    reporter.phase("governed-role-turn");
    result = await (options.runTurn ?? runDispatchedTurn)({
      role,
      app,
      appsFile: options.appsFile,
      turnId,
      orgRoot: homes.orgHome,
      runtimeHome: homes.stateHome,
      signal: cancellation.signal,
      observer: reporter.observer,
      ...definedProps({ parentTaskId: options.parentTaskId }),
      ...(prepared.creatorScope === undefined ? {} : { creatorScope: prepared.creatorScope }),
      ...(options.networkAccess ? { networkAccess: true } : {}),
    });
    reporter.terminal(result.status === "blocked_on_gate" ? "awaiting_approval" : result.status, {
      artifactRef: `turn:${turnId}`,
      ...(result.status === "completed" ? {} : { nextAction: `inspect turn ${turnId} and ${reporter.relativeLogRef}` }),
    });
  } catch (error) {
    reporter.terminal(cancellation.signal.aborted ? "cancelled" : "failed", {
      nextAction: `inspect ${reporter.relativeLogRef}`,
    });
    throw error;
  } finally {
    cancellation.dispose();
    reporter.dispose();
  }
  console.log(`${turnId}: ${result.status} — ${result.summary}`);
  return cancellation.exitCode ?? (result.status === "completed" ? 0 : 1);
}

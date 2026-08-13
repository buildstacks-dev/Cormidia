import type { AppEntry } from "../org/apps.js";
import type { CormidiaHomes } from "../org/home.js";
import { runDispatchedTurn } from "../org/turn-runner.js";
import type { CliProgressMode } from "../runtime/cli-progress.js";
import { createCliProgressReporter } from "../runtime/cli-progress.js";
import type { RoleConfig } from "../runtime/types.js";
import { installProcessCancellation } from "./process-signal.js";

export async function runLiveDistillation(
  homes: CormidiaHomes,
  app: AppEntry,
  role: RoleConfig,
  mode: CliProgressMode,
): Promise<number> {
  const turnId = `learn-distill-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}`;
  const reporter = createCliProgressReporter({
    stateHome: homes.stateHome,
    command: "learn-distill",
    scope: app.name,
    mode,
  });
  reporter.phase("preflight", "started");
  const cancellation = installProcessCancellation();
  let result: Awaited<ReturnType<typeof runDispatchedTurn>>;
  try {
    reporter.phase("learning-distillation");
    result = await runDispatchedTurn({
      role,
      app,
      appsFile: homes.appsFile,
      turnId,
      orgRoot: homes.orgHome,
      runtimeHome: homes.stateHome,
      pipelineOverride: "learning-distill",
      signal: cancellation.signal,
      observer: reporter.observer,
    });
    reporter.terminal(result.status === "blocked_on_gate" ? "awaiting_approval" : result.status, {
      artifactRef: `turn:${turnId}`,
      ...(result.status === "completed" ? {} : { nextAction: `inspect ${reporter.relativeLogRef}` }),
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
  return cancellation.exitCode ?? (result.status === "failed" ? 1 : 0);
}

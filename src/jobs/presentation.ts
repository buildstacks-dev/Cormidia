import type { JobRunResult } from "./runner.js";
import { formatJobStepStates } from "./status.js";

export const JOB_USAGE = `Usage:
  cormidia-job run <config.yaml> [--workdir <path>] [--decide-checkpoint <step-id>] [--json] [--progress <mode>]
  cormidia-job explain <config.yaml> [--json]

Runs a dependency-ordered graph of provider steps once or on demand. Jobs are
org work, not product work: no ticket, no PR, no GitHub, and no independent
review — a completed step means the provider returned AND every declared output
check passed. See docs/jobs/design.md §3 for what jobs deliberately do not
inherit.

  run                 execute (or resume) the job; completed steps are never re-run
  explain             validate the config and print the execution plan; spends nothing
  --workdir <path>    where declared outputs are read/written (default: cwd)
  --decide-checkpoint approve a parked checkpoint step and continue
  --json              machine-readable result
  --progress <mode>   text (default), jsonl, or off; progress is written to stderr
  --quiet             alias for --progress=off; durable progress logging remains enabled
`;

export function jobProgressState(status: JobRunResult["status"]): "completed" | "failed" | "suspended" {
  return status === "awaiting_checkpoint" ? "suspended" : status;
}

export function printJobResult(job: string, result: JobRunResult): void {
  process.stdout.write(`\n[cormidia-job] ${job}: ${result.status}\n`);
  process.stdout.write(`Completed steps: ${result.completedStepIds.join(", ") || "none"}\n`);
  process.stdout.write(`Provider turns this run: ${result.providerTurns}\n`);
  process.stdout.write(`Step states:\n  ${formatJobStepStates(result.stepStates).join("\n  ")}\n`);
  if (result.status === "awaiting_checkpoint") {
    process.stdout.write(
      `Parked at checkpoint "${result.stoppedAtStepId}": ${result.summary ?? ""}\n` +
        `Resume with: cormidia-job run <config> --decide-checkpoint ${result.stoppedAtStepId}\n`,
    );
  }
  if (result.status === "failed") {
    process.stdout.write(
      `Failed at "${result.stoppedAtStepId}" (${result.reasonCode ?? "unknown"}): ${result.summary ?? ""}\n` +
        "Completed steps are durable; fix the cause and re-run to resume from this step.\n",
    );
  }
}

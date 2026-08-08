// Job runner — CORMIDIA-C-OP-JOB (docs/jobs/design.md §6, §8, §9).
//
// One step at a time, in dependency order, resumable. The DAG buys ordering and
// resumability, not concurrency: a week-long job's failure modes are far easier
// to reason about serially, and parallel provider turns multiply the ways a
// budget ceiling gets crossed.
//
// Three fail-closed properties live here and each has its own detector family:
//   - nested invocation is refused (CF-B30-NEST), or a Builder turn could spawn
//     provider turns that escape its episode budget entirely;
//   - a step's declared checks decide completion, not the provider's own report
//     (CF-B30-CHK), which is the INV-008 tightening;
//   - every provider turn settles exactly one ledger row (CF-B30-SET), failed and
//     cancelled included, or the org's budget view silently understates spend.

import type { GateFn, RoleConfig, Runtime } from "../runtime/types.js";
import {
  appendJobEvent,
  attemptsFor,
  checkpointAwaiting,
  completedStepIds,
  failedStep,
  interruptedStep,
  readyJobSteps,
} from "./progress.js";
import { type JobJournal, type JobJournalEvent, newJobJournal, readJobJournal, writeJobJournal } from "./journal.js";
import { executeProviderStep } from "./step.js";
import type { JobConfig } from "./types.js";

/** Env vars whose presence means we are already inside a Cormidia provider turn.
 * `CORMIDIA_PARENT_TASK_ID` is the documented signal an outer harness exports
 * while invoking child Cormidia commands (src/cli/task.ts); the gate socket is
 * set by the Codex adapter for the duration of a turn. */
const IN_TURN_ENV = ["CORMIDIA_PARENT_TASK_ID", "CORMIDIA_CODEX_GATE_SOCKET"];

export type JobRunStatus = "completed" | "failed" | "awaiting_checkpoint";

export interface JobRunResult {
  status: JobRunStatus;
  job: string;
  completedStepIds: string[];
  /** The step that stopped the run, when it stopped early. */
  stoppedAtStepId?: string;
  reasonCode?: string;
  summary?: string;
  /** Provider turns this invocation actually paid for. Resumed steps that were
   * already complete contribute zero. */
  providerTurns: number;
}

export class JobRunError extends Error {
  constructor(
    readonly code: "job_nested_invocation",
    message: string,
  ) {
    super(message);
    this.name = "JobRunError";
  }
}

export interface RunJobOptions {
  config: JobConfig;
  /** Job working directory: where declared outputs are read and written. */
  workdir: string;
  /** Org state home — the journal and run records live under it. */
  stateHome: string;
  /** Ledger directory for exactly-once settlement. */
  orgDir: string;
  /** The `operator` role, resolved by the caller from roles.yaml. */
  role: RoleConfig;
  runtimeFor: (harness: RoleConfig["runtime"]) => Runtime;
  /** Defaults to the critical-ops gate — job steps are gated like any turn. */
  gate?: GateFn;
  now?: () => Date;
  /** Explicit env for the nested-invocation check; defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Resolves a pending checkpoint. Absent means checkpoints always park. */
  checkpointDecided?: (stepId: string) => Promise<boolean>;
  onProgress?: (message: string) => void;
}

export async function runJob(options: RunJobOptions): Promise<JobRunResult> {
  assertNotNested(options.env ?? process.env);

  const clock = options.now ?? ((): Date => new Date());
  const { config, stateHome } = options;

  let journal = (await readJobJournal(stateHome, config)) ?? newJobJournal(config, clock());
  if (journal.events.length === 0) await writeJobJournal(stateHome, journal);

  let providerTurns = 0;

  for (;;) {
    const priorFailure = failedStep(journal);
    if (priorFailure !== undefined) {
      return result(journal, "failed", providerTurns, priorFailure);
    }

    const parked = checkpointAwaiting(journal);
    if (parked !== undefined) {
      const decided = (await options.checkpointDecided?.(parked.step)) ?? false;
      if (!decided) return result(journal, "awaiting_checkpoint", providerTurns, parked);
      journal = appendJobEvent(journal, {
        step: parked.step,
        status: "completed",
        attempt: parked.attempt,
        at: clock().toISOString(),
        summary: "checkpoint decided by the operator",
      });
      await writeJobJournal(stateHome, journal);
      continue;
    }

    const completed = completedStepIds(journal);
    if (completed.length === config.steps.length) {
      return result(journal, "completed", providerTurns);
    }

    // A step whose latest event is `started` was interrupted mid-flight: the
    // process died between the durable start and the terminal event. It is
    // retried once (see the bound below) rather than skipped, because skipping
    // would lose work that may already have been paid for.
    const interrupted = interruptedStep(journal);
    const ready = readyJobSteps(config, completed);
    const step = interrupted === undefined ? ready[0] : config.steps.find((entry) => entry.id === interrupted.step);
    if (step === undefined) {
      // Not reachable through a validated config (acyclicity is a load error),
      // so this is a corrupt-journal signal rather than a graph problem.
      return result(journal, "failed", providerTurns, {
        step: "(none)",
        status: "failed",
        attempt: 0,
        at: clock().toISOString(),
        reasonCode: "job_no_ready_step",
        summary: "no step is ready but the job is incomplete",
      });
    }

    if (step.kind === "checkpoint") {
      journal = appendJobEvent(journal, {
        step: step.id,
        status: "awaiting_checkpoint",
        attempt: attemptsFor(journal, step.id) + 1,
        at: clock().toISOString(),
        summary: step.prompt,
      });
      await writeJobJournal(stateHome, journal);
      options.onProgress?.(`${step.id}: awaiting operator decision`);
      continue;
    }

    const attempt = attemptsFor(journal, step.id) + 1;
    // A recovery that had ALREADY been recovered once has now died twice. Stop
    // with evidence rather than spending a third turn on it. This is checked
    // before the start event is appended, so the count is of prior starts only.
    if (interrupted !== undefined && attemptsFor(journal, step.id) > 1) {
      return result(journal, "failed", providerTurns, {
        step: step.id,
        status: "failed",
        attempt,
        at: clock().toISOString(),
        reasonCode: "job_step_interrupted_twice",
        summary: "step was interrupted after a prior recovery attempt; not retried again",
      });
    }

    // Every provider turn gets its own start event, recovery included. Two
    // reasons this is not "reuse the interrupted attempt's identity": the count
    // of start events is what bounds retries at all, and a recovery runs a
    // genuinely NEW paid turn — settling it under the previous identity would be
    // deduped by recordTurnOnce and silently UNDERCOUNT spend, which is the
    // dangerous direction for T-5 (INV-006).
    journal = appendJobEvent(journal, {
      step: step.id,
      status: "started",
      attempt,
      at: clock().toISOString(),
    });
    await writeJobJournal(stateHome, journal);

    const event = await executeProviderStep(options, step, attempt, clock);
    providerTurns += 1;
    journal = appendJobEvent(journal, event);
    await writeJobJournal(stateHome, journal);
    options.onProgress?.(`${step.id}: ${event.status}${event.summary === undefined ? "" : ` — ${event.summary}`}`);
  }
}

function assertNotNested(env: Record<string, string | undefined>): void {
  const present = IN_TURN_ENV.filter((name) => (env[name] ?? "").trim().length > 0);
  if (present.length === 0) return;
  throw new JobRunError(
    "job_nested_invocation",
    `cormidia-job refuses to run inside a Cormidia provider turn (${present.join(", ")} is set). ` +
      "Its provider turns would escape the surrounding episode's budget and route bounds. " +
      "Run the job from your own shell instead.",
  );
}

function result(
  journal: JobJournal,
  status: JobRunStatus,
  providerTurns: number,
  stoppedAt?: JobJournalEvent,
): JobRunResult {
  return {
    status,
    job: journal.job,
    completedStepIds: completedStepIds(journal),
    providerTurns,
    ...(stoppedAt === undefined ? {} : { stoppedAtStepId: stoppedAt.step }),
    ...(stoppedAt?.reasonCode === undefined ? {} : { reasonCode: stoppedAt.reasonCode }),
    ...(stoppedAt?.summary === undefined ? {} : { summary: stoppedAt.summary }),
  };
}

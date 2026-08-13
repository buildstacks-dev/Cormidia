import { defaultGate } from "../runtime/gate.js";
import { ZERO_USAGE } from "../runtime/turn-usage.js";
import { notifyObserver, type GovernedTurnProgressIdentity } from "../runtime/turn-observer.js";
import type { TurnAssignment, TurnRequest, TurnResult } from "../runtime/types.js";
import type { JobJournalEvent } from "./journal.js";
import type { RunJobOptions } from "./runner.js";
import type { ProviderJobStep } from "./types.js";

export type JobProviderTurnExecution =
  | {
      turn: TurnResult;
      assignment: TurnAssignment;
      terminal(): void;
    }
  | { failure: JobJournalEvent };

export async function runJobProviderTurn(
  options: RunJobOptions,
  step: ProviderJobStep,
  attempt: number,
  task: string,
  clock: () => Date,
): Promise<JobProviderTurnExecution> {
  const assignment = step.assignment ?? {
    harness: options.role.runtime,
    model: options.role.model,
    effort: options.role.effort,
  };
  const identity: GovernedTurnProgressIdentity = {
    at: clock().toISOString(),
    episodeId: `job:${options.config.job}`,
    runId: `job:${options.config.job}:${step.id}:${attempt}`,
    pipeline: "cormidia-job",
    pass: step.id,
    role: options.role.name,
    assignment,
    ordinal: options.config.steps.findIndex((entry) => entry.id === step.id) + 1,
    total: options.config.steps.length,
    resumed: attempt > 1,
  };
  const request: TurnRequest = {
    role: options.role,
    assignment,
    workdir: options.workdir,
    task,
    context: { taste: [], memoryExcerpts: [] },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  notifyObserver(() => options.observer?.onTurnStarted?.(identity));
  const heartbeat = setInterval(() => {
    notifyObserver(() => options.observer?.onHeartbeat?.({ ...identity, at: clock().toISOString() }));
  }, 30_000);
  heartbeat.unref?.();

  try {
    const turn = await options.runtimeFor(assignment.harness).runTurn(request, {
      gate: options.gate ?? defaultGate,
      onEvent: (event) => notifyObserver(() => options.observer?.onEvent?.(event)),
      onProgress: (progress) => notifyObserver(() => options.observer?.onProgress?.(progress)),
    });
    return {
      turn,
      assignment,
      terminal: () =>
        notifyObserver(() =>
          options.observer?.onTurnTerminal?.({
            ...identity,
            at: clock().toISOString(),
            status: turn.status,
            ...(turn.errorCode === undefined ? {} : { errorCode: turn.errorCode }),
            usage: turn.usage,
          }),
        ),
    };
  } catch (error) {
    notifyObserver(() =>
      options.observer?.onTurnTerminal?.({
        ...identity,
        at: clock().toISOString(),
        status: "failed",
        errorCode: "job_provider_error",
        usage: { ...ZERO_USAGE, quality: "unavailable" },
      }),
    );
    return {
      failure: {
        step: step.id,
        status: "failed",
        attempt,
        at: clock().toISOString(),
        reasonCode: "job_provider_error",
        summary: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    clearInterval(heartbeat);
  }
}

// Single job step execution — the paid boundary of CORMIDIA-C-OP-JOB.
//
// Split from runner.ts, which owns the resume loop, because that module tripped
// the 300-line module smoke alarm. The division is meaningful rather than
// cosmetic: everything here concerns ONE step's provider turn, its settlement,
// and its checks, while the loop concerns which step runs next.
//
// Settlement happens BEFORE the checks are judged. A failed or cancelled turn
// consumed budget just as a successful one did, and a step failing its declared
// check must never make its spend invisible (INV-006, CF-B30-SET).

import { recordTurnOnce } from "../runtime/telemetry.js";
import type { TurnAssignment, TurnResult } from "../runtime/types.js";
import { assembleJobBrief } from "./brief.js";
import { evaluateStepChecks, type StepCheckResult } from "./checks.js";
import type { JobJournalEvent } from "./journal.js";
import type { RunJobOptions } from "./runner.js";
import { runJobProviderTurn } from "./step-turn.js";
import type { ProviderJobStep } from "./types.js";

export class JobStepError extends Error {
  constructor(
    readonly code: "job_dependency_output_missing",
    message: string,
  ) {
    super(message);
    this.name = "JobStepError";
  }
}

export async function executeProviderStep(
  options: RunJobOptions,
  step: ProviderJobStep,
  attempt: number,
  clock: () => Date,
): Promise<JobJournalEvent> {
  const brief = await assembleJobBrief(options.config, step, options.workdir);
  if (brief.missing.length > 0) {
    // Refuse rather than prompting the model with a hole where an input should
    // be: a step that silently sees less than it declared produces work nobody
    // can trust, and the failure surfaces days later.
    const detail = brief.missing.map((input) => `${input.stepId}:${input.path}`).join(", ");
    throw new JobStepError(
      "job_dependency_output_missing",
      `step ${step.id} declares dependency outputs that cannot be read: ${detail}`,
    );
  }

  const execution = await runJobProviderTurn(options, step, attempt, brief.text, clock);
  if ("failure" in execution) return execution.failure;
  const { assignment, turn } = execution;

  // Settle before judging the checks. Failed and cancelled turns consume budget
  // too, and a step failing its check must never make its spend invisible.
  await settle(options, step, assignment, turn, attempt, clock);
  execution.terminal();

  if (turn.status !== "completed") {
    return {
      step: step.id,
      status: "failed",
      attempt,
      at: clock().toISOString(),
      reasonCode: turn.errorCode ?? `job_provider_${turn.status}`,
      summary: turn.summary,
    };
  }

  const checks = await evaluateStepChecks(step, options.workdir);
  if (!checks.passed) {
    return {
      step: step.id,
      status: "failed",
      attempt,
      at: clock().toISOString(),
      reasonCode: "job_output_check_failed",
      summary: describeFailedChecks(checks),
    };
  }
  return {
    step: step.id,
    status: checks.unverified ? "completed_unverified" : "completed",
    attempt,
    at: clock().toISOString(),
    summary: turn.summary,
  };
}

async function settle(
  options: RunJobOptions,
  step: ProviderJobStep,
  assignment: TurnAssignment,
  turn: TurnResult,
  attempt: number,
  clock: () => Date,
): Promise<void> {
  await recordTurnOnce(options.orgDir, {
    at: clock().toISOString(),
    role: options.role.name,
    runtime: assignment.harness,
    model: assignment.model,
    effort: assignment.effort,
    status: turn.status,
    tokensIn: turn.usage.tokensIn,
    tokensOut: turn.usage.tokensOut,
    costUsd: turn.usage.costUsd,
    usageQuality: turn.usage.quality ?? (turn.usage.costEstimated === true ? "estimated" : "complete"),
    subagentTurns: turn.usage.subagentTurns,
    wallClockMs: turn.usage.wallClockMs,
    escalations: turn.escalations.length,
    // The job id occupies the app slot for an unscoped job so spend stays
    // attributable; an app-scoped job rolls up under its app.
    app: options.config.app ?? "adhoc",
    trigger: "manual",
    // Attempt is part of the identity: a recovered step's retry is a distinct
    // paid turn, while re-reading the same journal never re-settles.
    providerTurnId: `job:${options.config.job}:${step.id}:${attempt}`,
    ...(turn.usage.costEstimated === true ? { costEstimated: true } : {}),
  });
}

function describeFailedChecks(checks: StepCheckResult): string {
  return checks.outcomes
    .filter((outcome) => !outcome.passed)
    .map((outcome) => `${outcome.path}: ${outcome.detail ?? "check failed"}`)
    .join("; ");
}

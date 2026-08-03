// Orchestrator execution of an approved shell action (ISSUE-020).
//
// Approving a critical op must cause it to happen. Before this, every generic
// shell approval was minted `executor: actor-retry`, which means "the provider
// turn that asked must ask again and consume the grant". Run 3 proved that is
// not a mechanism: the sandbox answered the actor `exec command rejected by
// user` while the grant sat granted in the durable queue, and all four
// approvals ended `attempts: 0`, `nextAction: actor_retry` — two of them
// granted while the builder was demonstrably mid-turn, so "the actor had
// already terminated" does not explain it. The human made a real security
// decision and nothing happened.
//
// The fix direction was already proven in-tree: ticket #9's PR published
// because it went through a MECHANICAL orchestrator path rather than an
// agent-authored `gh` call. This module generalizes that, and it deliberately
// keeps every property `approval-delivery.ts` already gets right:
//
//   * it executes only a typed, content-bound action — the exact recorded
//     command string, never a reconstruction, never anything the human did not
//     read in `cormidia approvals show`;
//   * one approval is one execution: the per-item O_EXCL lock claims
//     `approved -> executing` and the single-use grant is consumed before the
//     command starts, so a crash can strand only a visible attempt;
//   * ambiguity is never blindly retried. A generic command has no remote
//     idempotency marker to reconcile against, so an interrupted execution
//     becomes durably `ambiguous` and waits for a human disposition instead of
//     running a second time;
//   * an approval is not a licence to run arbitrary shell. Execution is bound
//     to the recorded action AND to a recorded, still-present execution
//     context; anything that does not match terminalizes with a typed cause.

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { scrubSecrets, truncatePreview } from "../runtime/runlog/redact.js";
import { withNonInteractiveEnv } from "../runtime/non-interactive-env.js";
import { normalizeSemanticAction } from "../runtime/gate.js";
import {
  actionHash,
  approvedCommand,
  ApprovalStore,
  commandIdentityHash,
  isOrchestratorExecutableRule,
  type ApprovalGrant,
  type ApprovalItem,
} from "./approvals.js";
import type { AppEntry, AppsFile } from "./apps.js";
import { grantScopeText } from "./gate-compose.js";

/** The actor recorded on an orchestrator-claimed execution. A later dispatch
 *  uses it to tell its own interrupted attempt apart from a live provider turn
 *  that claimed the same approval through the gate. */
export const ORCHESTRATOR_COMMAND_ACTOR = "orchestrator/approval-command";

export type ApprovalCommandFailureCause =
  | "invalid_action"
  | "execution_context_unavailable"
  | "grant_unavailable"
  | "command_binding_mismatch"
  | "command_failed"
  | "command_start_failed"
  | "ambiguous_command_result";

export interface ApprovalCommandOutcome {
  approvalId: string;
  app: string;
  status: "executed" | "failed" | "ambiguous" | "skipped";
  summary: string;
  cause?: ApprovalCommandFailureCause;
  exitCode?: number;
}

export interface ApprovedCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** The command was killed at the deadline. The effect is then genuinely
   *  unknown, so the record becomes ambiguous rather than failed. */
  timedOut?: boolean;
}

/** How long an orchestrator-claimed execution may be in flight before a later
 *  dispatch treats it as a crashed attempt rather than a live one. A shorter
 *  window would let a concurrent tick manufacture ambiguity for a command that
 *  is still running; a longer one just delays the operator's signal. */
const EXECUTION_STALE_MS = 15 * 60_000;

/** Wall-clock ceiling for one approved command. A dispatch tick that blocks
 *  forever on a hung child stops the whole org, so the child is killed — and
 *  because a killed command may have already had its effect, the record
 *  becomes ambiguous and waits for a human, never an automatic retry. */
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60_000;

export interface ExecuteApprovedCommandsOptions {
  stateHome: string;
  appsFile: AppsFile;
  /** Restrict delivery to approvals raised by one still-owned outer turn.
   * Dispatch omits this and drains the org-wide approved queue. */
  turnId?: string;
  now?: () => Date;
  /** Injected by tests. Production spawns the recorded command verbatim. */
  runner?: (input: {
    command: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  }) => Promise<ApprovedCommandResult>;
  timeoutMs?: number;
  /** Deterministic crash injection for regression tests. A throw after the
   * claim leaves the item `executing`; the next dispatch must make that
   * ambiguous rather than run the command again. */
  fault?: (boundary: "after_claim" | "after_command") => void | Promise<void>;
}

/**
 * Execute every approved action whose durable record names the orchestrator as
 * its executor. Typed GitHub deliveries stay on `approval-delivery.ts` and
 * production deploys stay on the A4 release executor in `release.ts`; this
 * covers the generic shell action those two deliberately do not.
 */
export async function executeApprovedCommands(
  options: ExecuteApprovedCommandsOptions,
): Promise<ApprovalCommandOutcome[]> {
  const clock = options.now ?? (() => new Date());
  const store = new ApprovalStore(options.stateHome);
  const outcomes: ApprovalCommandOutcome[] = [];
  const items = (await store.listDecided()).filter(
    (item) =>
      item.decision === "approved" &&
      item.execution?.executor === "orchestrator-command" &&
      (options.turnId === undefined || item.turnId === options.turnId),
  );

  for (const item of items) {
    const execution = item.execution!;
    if (execution.state === "executed" || execution.state === "failed") continue;

    if (execution.state === "executing") {
      if (execution.actor !== ORCHESTRATOR_COMMAND_ACTOR) {
        // A provider turn claimed this through the gate and owns settling it
        // (ApprovalStore.settleActorRetryExecutions at end of turn).
        outcomes.push({
          approvalId: item.id,
          app: item.app,
          status: "skipped",
          summary: `approval ${item.id} is being executed by ${execution.actor ?? "an actor"}`,
        });
        continue;
      }
      const attemptedAt = execution.attemptedAt === undefined
        ? undefined
        : new Date(execution.attemptedAt).getTime();
      if (attemptedAt !== undefined && clock().getTime() - attemptedAt < EXECUTION_STALE_MS) {
        // A concurrent dispatch is probably still running it. Saying "ambiguous"
        // here would invent uncertainty rather than report it.
        outcomes.push({
          approvalId: item.id,
          app: item.app,
          status: "skipped",
          summary: `approval ${item.id} was claimed at ${execution.attemptedAt} and may still be in flight`,
        });
        continue;
      }
      // Our own prior attempt stopped before acknowledgement. A generic shell
      // command has no remote marker to reconcile against, so the effect is
      // genuinely unknown and re-running it could duplicate it. Make the
      // uncertainty durable and stop.
      const summary =
        `orchestrator execution stopped before acknowledgement; the command may or may not have ` +
        `run. Inspect, then close it with \`cormidia approvals disposition ${item.id} ` +
        `(--executed|--failed|--retry) --reason <text> --confirm ${item.id}\``;
      await store.finishExecution({
        id: item.id,
        state: "ambiguous",
        actor: ORCHESTRATOR_COMMAND_ACTOR,
        result: summary,
        failureCause: "ambiguous_command_result",
        now: clock(),
      });
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: "ambiguous",
        summary,
        cause: "ambiguous_command_result",
      });
      continue;
    }

    if (execution.state === "ambiguous") {
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: "skipped",
        summary: `approval ${item.id} remains ambiguous; it needs a human disposition, never a retry`,
      });
      continue;
    }

    // state === "approved": this dispatch owns the attempt.
    if (!isOrchestratorExecutableRule(item.rule)) {
      // Defence in depth for a record that reached this executor without going
      // through the checks in initialExecution/reconcile — a hand-edited or
      // pre-allowlist record. Never terminalize it: the decision is still good,
      // it is only the *enactor* that is wrong.
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: "skipped",
        summary:
          `approval ${item.id} is rule "${item.rule}", which the orchestrator never enacts on a ` +
          `human's behalf; approving the action did not authorize that. Close it with ` +
          `\`cormidia approvals disposition ${item.id} (--executed|--failed|--retry) --reason <text> ` +
          `--confirm ${item.id}\``,
      });
      continue;
    }
    const command = approvedCommand(item.action);
    if (command === undefined) {
      outcomes.push(await terminalFailure(
        store,
        item,
        "invalid_action",
        `approved action ${item.id} is not a recorded shell command`,
        clock,
      ));
      continue;
    }
    const app = options.appsFile.apps.find((entry) => entry.name === item.app);
    if (app === undefined) {
      // Scope, not validity. `cormidia dispatch --apps <subset>` is an ordinary
      // way to run one app's tick, and an app being out of scope for THIS
      // invocation says nothing about the approval. Terminalizing it here would
      // burn a good human decision and demand a disposition to re-arm it.
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: "skipped",
        summary:
          `approved action names app "${item.app}", which this dispatch's apps.yaml does not ` +
          `cover; it stays approved and waits for a dispatch that does`,
      });
      continue;
    }
    const context = resolveExecutionContext(options.stateHome, item, app);
    if ("problem" in context) {
      outcomes.push(await terminalFailure(
        store,
        item,
        "execution_context_unavailable",
        context.problem,
        clock,
      ));
      continue;
    }

    const claimed = await store.beginExecution(item.id, ORCHESTRATOR_COMMAND_ACTOR, clock());
    if (claimed === undefined) continue;
    await options.fault?.("after_claim");

    // The grant is the authorization, and it is bound to the exact action
    // identity — not to the rule, not to the app, not to "a shell command".
    const grant = store.findMatchingGrantSync({
      app: item.app,
      role: item.role,
      actionHash: actionHash(item.action),
      rule: item.rule,
      actionText: grantScopeText({ tool: item.action.tool, input: item.action.input }),
      ...(item.ticketRef !== undefined ? { ticketRef: item.ticketRef } : {}),
      now: clock(),
    });
    if (grant === undefined) {
      outcomes.push(await terminalFailure(
        store,
        item,
        "grant_unavailable",
        `approved action has no live matching grant; nothing was executed`,
        clock,
      ));
      continue;
    }
    // An approval authorizes exactly what was approved. The grant matched on
    // the SEMANTIC identity; this asks the separate question of whether the
    // literal about to run is still the one the human decided on.
    const drift = commandBindingProblem(command, item, grant);
    if (drift !== undefined) {
      outcomes.push(await terminalFailure(store, item, "command_binding_mismatch", drift, clock));
      continue;
    }
    store.consumeGrantSync(grant.grantId, clock());

    let result: ApprovedCommandResult;
    try {
      result = await (options.runner ?? runApprovedCommand)({
        command,
        cwd: context.cwd,
        env: withNonInteractiveEnv(process.env),
        timeoutMs: options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      });
    } catch (error) {
      // The child never started (spawn error / missing shell). No effect
      // reached the world, so this is a confirmed failed attempt, not
      // ambiguity.
      const summary = `command could not be started: ${errorText(error)}`;
      await store.finishExecution({
        id: item.id,
        state: "failed",
        actor: ORCHESTRATOR_COMMAND_ACTOR,
        result: summary,
        failureCause: "command_start_failed",
        now: clock(),
      });
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: "failed",
        summary,
        cause: "command_start_failed",
      });
      continue;
    }
    await options.fault?.("after_command");

    const summary = commandSummary(context.cwd, result);
    if (result.timedOut === true) {
      const timedOut =
        `${summary}; the command was killed at the deadline and its effect is unknown. Close it ` +
        `with \`cormidia approvals disposition ${item.id} (--executed|--failed|--retry) ` +
        `--reason <text> --confirm ${item.id}\``;
      await store.finishExecution({
        id: item.id,
        state: "ambiguous",
        actor: ORCHESTRATOR_COMMAND_ACTOR,
        result: timedOut,
        failureCause: "ambiguous_command_result",
        now: clock(),
      });
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: "ambiguous",
        summary: timedOut,
        cause: "ambiguous_command_result",
      });
      continue;
    }
    if (result.exitCode === 0) {
      await store.finishExecution({
        id: item.id,
        state: "executed",
        actor: ORCHESTRATOR_COMMAND_ACTOR,
        result: summary,
        now: clock(),
      });
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: "executed",
        summary,
        exitCode: 0,
      });
      continue;
    }
    await store.finishExecution({
      id: item.id,
      state: "failed",
      actor: ORCHESTRATOR_COMMAND_ACTOR,
      result: summary,
      failureCause: "command_failed",
      now: clock(),
    });
    outcomes.push({
      approvalId: item.id,
      app: item.app,
      status: "failed",
      summary,
      cause: "command_failed",
      exitCode: result.exitCode,
    });
  }
  return outcomes;
}

/**
 * Refuse anything but the exact approved literal, or describe why.
 *
 * `actionHash` — the key the grant is bound to — is computed over
 * `unwrapCommand(...)`, which folds away a leading `sudo `, `command ` and
 * `env VAR=val `. That folding is correct for CLASSIFICATION (a wrapper prefix
 * must not hide a critical op from the rules) and is a hole for EXECUTION: an
 * edit of the decided record that prepends `env INJECTED=pwned ` leaves the
 * identity, and therefore the grant match, untouched. It was harmless while
 * approvals only told a provider turn to re-attempt inside its sandbox; now the
 * orchestrator runs the string itself, with its own credentials and no sandbox.
 *
 * Two independent bindings, in preference order:
 *
 *  1. `grant.commandSha256` — written at decision time into the grant file,
 *     which is a SEPARATE artifact from the decided record. Editing only the
 *     record no longer matches. This path allows a legitimately approved
 *     `sudo ...`/`env ...` command, because the human approved those bytes.
 *  2. No recorded hash (a grant minted before the field, or a scoped grant that
 *     covers many commands by design): fall back to demanding the literal be
 *     byte-identical to the semantic identity the grant DOES cover. Any
 *     injected prefix makes the two differ, so the tamper is still refused;
 *     the cost is that a legitimate wrapper-prefixed legacy approval is
 *     refused rather than run, which is the fail-closed direction.
 */
function commandBindingProblem(
  command: string,
  item: ApprovalItem,
  grant: ApprovalGrant,
): string | undefined {
  if (grant.commandSha256 !== undefined) {
    return commandIdentityHash(command) === grant.commandSha256
      ? undefined
      : `the recorded command no longer matches the one approved as ${item.id} ` +
        `(grant ${grant.grantId} binds a different command); nothing was executed`;
  }
  const identity = normalizeSemanticAction(item.action).command;
  if (identity !== null && identity === command) return undefined;
  return (
    `approval ${item.id} carries no recorded command binding, and the command to run is not ` +
    `byte-identical to the action identity its grant authorizes; nothing was executed`
  );
}

/**
 * Where the approved command runs.
 *
 * A recorded `workdir` is the context the human approved the action FOR, so it
 * wins whenever it is still a checkout. If it has since been pruned, that is a
 * changed world: refuse rather than silently substitute a different tree, since
 * a relative path in the command would then touch the wrong files.
 *
 * A record with NO recorded workdir predates the field (or came from a call
 * site with no checkout). There the app's orchestrator-owned managed clone —
 * the same checkout the A4 release executor uses for an approved release
 * command — is the one defined context, not a guess.
 */
function resolveExecutionContext(
  stateHome: string,
  item: ApprovalItem,
  app: AppEntry,
): { cwd: string } | { problem: string } {
  const recorded = item.workdir;
  if (recorded !== undefined) {
    if (!isAbsolute(recorded)) {
      return { problem: `recorded working directory "${recorded}" is not an absolute path` };
    }
    return isCheckout(recorded)
      ? { cwd: recorded }
      : {
          problem:
            `recorded working directory ${recorded} is no longer a checkout; the approved command ` +
            `will not be run against a different tree`,
        };
  }
  const managedClone = join(stateHome, "repos", app.name);
  return isCheckout(managedClone)
    ? { cwd: managedClone }
    : {
        problem:
          `approval records no working directory and ${app.name} has no managed clone at ` +
          `${managedClone}; there is no context this command was approved for`,
      };
}

function isCheckout(path: string): boolean {
  try {
    return statSync(path).isDirectory() && existsSync(join(path, ".git"));
  } catch {
    return false;
  }
}

async function terminalFailure(
  store: ApprovalStore,
  item: ApprovalItem,
  cause: ApprovalCommandFailureCause,
  summary: string,
  clock: () => Date,
): Promise<ApprovalCommandOutcome> {
  // Claim first when this failure was found before the claim; a no-op when the
  // caller already holds it (beginExecution only advances from `approved`).
  await store.beginExecution(item.id, ORCHESTRATOR_COMMAND_ACTOR, clock());
  await store.finishExecution({
    id: item.id,
    state: "failed",
    actor: ORCHESTRATOR_COMMAND_ACTOR,
    result: summary,
    failureCause: cause,
    now: clock(),
  });
  return { approvalId: item.id, app: item.app, status: "failed", summary, cause };
}

/** Durable execution evidence, scrubbed through the ONE secret-pattern list and
 *  bounded: an approval record is operator-facing state, not a log sink. */
function commandSummary(cwd: string, result: ApprovedCommandResult): string {
  const detail = truncatePreview(scrubSecrets(result.stderr.trim() || result.stdout.trim()), 400);
  return (
    `exit ${result.exitCode} in ${cwd}` + (detail === "" ? "" : `: ${detail}`)
  );
}

function errorText(error: unknown): string {
  return truncatePreview(scrubSecrets(error instanceof Error ? error.message : String(error)), 200);
}

async function runApprovedCommand(input: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<ApprovedCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, {
      cwd: input.cwd,
      env: input.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);
    deadline.unref?.();
    child.stdout?.on("data", (chunk: Buffer) => { stdout = tail(stdout + chunk.toString("utf8"), 16_000); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = tail(stderr + chunk.toString("utf8"), 16_000); });
    child.once("error", (error) => { clearTimeout(deadline); reject(error); });
    child.once("close", (code) => {
      clearTimeout(deadline);
      resolve({ exitCode: code ?? 1, stdout, stderr, ...(timedOut ? { timedOut: true } : {}) });
    });
  });
}

function tail(value: string, max: number): string {
  return value.length <= max ? value : value.slice(value.length - max);
}

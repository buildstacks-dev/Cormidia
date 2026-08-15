// Cursor roles -> the user-installed `cursor-agent` CLI in headless mode.
//
// Surface choice (research/adapters/2026-08-06_adapter-upstream-references.md, #338):
// `cursor-agent -p --output-format stream-json`, threads via `--resume`, brief
// on stdin. `@cursor/sdk` is public beta and deliberately NOT the day-one
// surface. Sibling modules own the pieces: cursor-process (subprocess),
// cursor-stream (event reduction), cursor-pricing (estimated cost),
// cursor-config (the per-turn Cursor files), cursor-gate-bridge (the gate).
//
// Two flags are what let the agent act at all, and they are a deliberate,
// gated pair (B-24):
//   --trust  headless from an untrusted directory refuses with a workspace
//            trust prompt; the org-managed worktree is trusted explicitly.
//   --force  without it a headless turn cannot apply shell work at all — and
//            the F-PT-026 probe showed file writes auto-applying even unforced,
//            so omitting it buys no safety, only a silently crippled turn.
// `--force` is reachable ONLY after the per-turn gate bridge has proven itself
// end to end (startCursorGateBridge's pre-spend handshake). A bridge that
// cannot answer its own handshake is a typed refusal before provider
// construction — never an ungated turn. `--yolo` and `--auto-review` are
// unrepresentable, and after the turn the executed-versus-allowed cross-check
// refuses to report `completed` if anything ran the gate never classified.

import { resolveTurnRequestAssignment } from "../assignment.js";
import { withNonInteractiveEnv } from "../non-interactive-env.js";
import { definedProps } from "../optional-properties.js";
import { cursorDenyRulesForRole } from "../role-shaping.js";
import type {
  Artifact,
  GateEscalation,
  Runtime,
  TurnAssignment,
  TurnHooks,
  TurnRequest,
  TurnResult,
} from "../types.js";
import type { InterruptedReason } from "../types.js";
import { parseInterruptedReason, terminalStopFields } from "../types.js";
import { renderContextBundle, writeMaskedWorktreeFile } from "../worktree-context.js";
import { cursorContextRule } from "./cursor-config.js";
import { StdioCursorProcess, type CursorProcessFactory } from "./cursor-process.js";
import { startCursorGateBridge, type CursorGateBridge } from "./cursor-gate-bridge.js";
import { applyCursorStreamEvent, newCursorTurnState, type CursorTurnState } from "./cursor-stream.js";

/** Cursor's own always-apply project rule is the native context channel,
 *  certified live 2026-08-07. Masked from git; never the app's AGENTS.md. */
const CURSOR_CONTEXT_RELATIVE_PATH = ".cursor/rules/cormidia-turn-context.mdc";

/** Typed refusal: the assignment's generic Effort contradicts the effort a
 *  Cursor model id bakes in. cursor-agent exposes NO effort knob, so the only
 *  place effort can live is the model id; a disagreeing pair is unmappable and
 *  must never be silently resolved in either direction (B-24 effort delta). */
export class CursorEffortUnmappableError extends Error {
  readonly code = "error_effort_unmappable";
  constructor(model: string, effort: string, modelEffort: string) {
    super(
      `CursorRuntime: cursor-agent exposes no effort knob, so effort lives only in the model id. ` +
        `Assignment effort ${JSON.stringify(effort)} contradicts model ${JSON.stringify(model)} ` +
        `(which selects ${JSON.stringify(modelEffort)}). Refusing rather than silently picking one.`,
    );
    this.name = "CursorEffortUnmappableError";
  }
}

interface CursorRuntimeOptions {
  processFactory?: CursorProcessFactory;
  /** Explicit environment for cursor-agent and its hook subprocesses. */
  agentEnv?: NodeJS.ProcessEnv;
  /** Test-only override for the operator-global permissions config path. */
  globalConfigPath?: string;
  /** Test-only override for the hook command Cursor is told to run. Exists so
   *  a negative control can seed a bridge that cannot answer its handshake. */
  gateHookCommand?: string;
}

export class CursorRuntime implements Runtime {
  readonly kind = "cursor" as const;
  private readonly processFactory: CursorProcessFactory;
  private readonly agentEnv: NodeJS.ProcessEnv | undefined;
  private readonly globalConfigPath: string | undefined;
  private readonly gateHookCommand: string | undefined;

  constructor(opts: CursorRuntimeOptions = {}) {
    this.processFactory = opts.processFactory ?? ((launch) => new StdioCursorProcess(launch));
    this.agentEnv = opts.agentEnv;
    this.globalConfigPath = opts.globalConfigPath;
    this.gateHookCommand = opts.gateHookCommand;
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    const assignment = resolveTurnRequestAssignment(req, this.kind);
    assertCursorEffortMappable(assignment);
    if (req.session !== undefined && req.session.runtime !== "cursor") {
      throw new Error(
        `CursorRuntime cannot resume a "${req.session.runtime}" session - ` +
          `cross-runtime resume is an orchestrator bug (session id: ${req.session.id})`,
      );
    }

    const startTime = Date.now();
    const escalations: GateEscalation[] = [];
    writeMaskedWorktreeFile(
      req.workdir,
      CURSOR_CONTEXT_RELATIVE_PATH,
      cursorContextRule(renderContextBundle(req.context)),
    );
    const bridge = await startCursorGateBridge(req.workdir, hooks, escalations, {
      denyRules: cursorDenyRulesForRole(req.role.name),
      ...definedProps({ globalConfigPath: this.globalConfigPath, hookCommand: this.gateHookCommand }),
    });

    const child = this.processFactory({
      args: cursorAgentArgs(assignment, req.session?.id),
      cwd: req.workdir,
      env: { ...withNonInteractiveEnv(this.agentEnv ?? process.env), ...bridge.env },
    });
    const state = newCursorTurnState(req.session?.id ?? `pending-${startTime}`);
    const abortChild = (): void => {
      void child.close();
    };
    req.signal?.addEventListener("abort", abortChild, { once: true });

    try {
      if (req.signal?.aborted) return stoppedCursorResult(req, state, escalations, startTime);
      child.writeTask(req.task);
      const context = {
        requestedSessionId: req.session?.id,
        model: assignment.model,
        maxTurnBudgetUsd: req.role.maxTurnBudgetUsd,
        roleName: req.role.name,
      };
      for await (const event of child.events) {
        applyCursorStreamEvent(event, context, hooks, state);
        if (state.status !== undefined) break;
      }
      if (req.signal?.aborted) return stoppedCursorResult(req, state, escalations, startTime);
      return settleCursorTurn(req, state, escalations, bridge, startTime);
    } catch (error) {
      if (req.signal?.aborted) return stoppedCursorResult(req, state, escalations, startTime);
      throw error;
    } finally {
      req.signal?.removeEventListener("abort", abortChild);
      await child.close();
      await bridge.close();
    }
  }
}

function settleCursorTurn(
  req: TurnRequest,
  state: CursorTurnState,
  escalations: GateEscalation[],
  bridge: CursorGateBridge,
  startTime: number,
): TurnResult {
  const wallClockMs = state.durationMs ?? Date.now() - startTime;
  const usage =
    state.usage === undefined
      ? { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs, quality: "unavailable" as const }
      : { ...state.usage, subagentTurns: state.subagentTurns, wallClockMs, quality: "estimated" as const };

  // Gate-coverage cross-check. cursor-agent's hooks fired for every tool call
  // in certification, but a version that stopped calling them would otherwise
  // produce a clean-looking completed turn with real, ungated effects. More
  // executions than the gate allowed is exactly that state.
  const ungated = state.executedToolCalls > bridge.allowed;
  const status = ungated
    ? "failed"
    : state.budgetOverrun
      ? "failed"
      : escalations.length > 0
        ? "blocked_on_gate"
        : (state.status ?? "failed");
  return {
    status,
    summary: ungated
      ? `Gate coverage failure: cursor-agent executed ${state.executedToolCalls} tool call(s) but the ` +
        `Cormidia gate allowed only ${bridge.allowed} of ${bridge.consulted} consultation(s). The ` +
        `preToolUse hook did not classify every action, so this turn is reported failed, not completed.`
      : (state.finalSummary ?? "cursor-agent turn completed without an agent message"),
    artifacts: state.budgetOverrun && !ungated ? [budgetOverrunNote(state, req)] : [],
    session: { runtime: "cursor", id: state.sessionId },
    usage,
    escalations,
    ...(ungated
      ? { errorCode: "error_gate_not_observed" }
      : state.budgetOverrun
        ? { errorCode: "error_max_budget_usd" }
        : status === "failed" && state.errorCode !== undefined
          ? { errorCode: state.errorCode }
          : {}),
  };
}

/** The exact argv. `--yolo` and `--auto-review` are unrepresentable; `--force`
 *  is only reachable because the caller proved the gate bridge first. */
export function cursorAgentArgs(assignment: TurnAssignment, resumeSessionId?: string): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--trust",
    "--force",
    "--model",
    assignment.model,
    ...(resumeSessionId === undefined ? [] : ["--resume", resumeSessionId]),
  ];
}

const CURSOR_MODEL_EFFORT = /-(low|medium|high|xhigh)(?:-fast)?$/;

function assertCursorEffortMappable(assignment: TurnAssignment): void {
  const modelEffort = CURSOR_MODEL_EFFORT.exec(assignment.model)?.[1];
  if (modelEffort !== undefined && modelEffort !== assignment.effort) {
    throw new CursorEffortUnmappableError(assignment.model, assignment.effort, modelEffort);
  }
}

function stoppedCursorResult(
  req: TurnRequest,
  state: CursorTurnState,
  escalations: GateEscalation[],
  startedAt: number,
): TurnResult {
  const descriptor = stopDescriptor(req.signal?.reason);
  const wallClockMs = Date.now() - startedAt;
  const usage = state.usage ?? {
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    subagentTurns: state.subagentTurns,
    wallClockMs,
  };
  return {
    ...terminalStopFields(descriptor),
    errorCode: descriptor.errorCode,
    summary: descriptor.reason,
    artifacts: [],
    session: { runtime: "cursor", id: state.sessionId },
    usage: { ...usage, wallClockMs, quality: state.usage === undefined ? "unavailable" : "partial" },
    escalations,
  };
}

function stopDescriptor(reason: unknown): {
  status: "cancelled" | "interrupted";
  /** REQUIRED when status is `interrupted` (CORMIDIA-C-CORE-001 §2, F-PT-017). */
  interruptedReason?: InterruptedReason;
  errorCode: string;
  reason: string;
} {
  if (reason !== null && typeof reason === "object") {
    const value = reason as Record<string, unknown>;
    if (
      (value["status"] === "cancelled" || value["status"] === "interrupted") &&
      typeof value["errorCode"] === "string" &&
      typeof value["reason"] === "string"
    ) {
      const carried = parseInterruptedReason(value["interruptedReason"]);
      return {
        status: value["status"],
        ...(carried === undefined ? {} : { interruptedReason: carried }),
        errorCode: value["errorCode"],
        reason: value["reason"],
      };
    }
  }
  return {
    status: "cancelled",
    errorCode: "error_cancelled",
    reason: typeof reason === "string" && reason.length > 0 ? reason : "operator cancellation",
  };
}

function budgetOverrunNote(state: CursorTurnState, req: TurnRequest): Artifact {
  return {
    kind: "note",
    ref: `budget-overrun/${state.sessionId}`,
    summary:
      `Budget overrun: estimated spend $${(state.usage?.costUsd ?? 0).toFixed(4)} against maxTurnBudgetUsd ` +
      `$${req.role.maxTurnBudgetUsd} (role ${req.role.name}). Cursor cost is a Cormidia estimate from the ` +
      `vendor's published rate table (cursor-agent reports no dollar cost) and is only observable at the ` +
      `turn boundary. Overrun = incident note, not silent spend (roles.yaml).`,
  };
}

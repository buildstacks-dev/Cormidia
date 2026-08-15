// Meta Muse Spark roles -> Muse Code (`muse exec`) headless, over its JSONL
// event stream (adapter expansion #340, boundary B-26). Launch mechanics live
// in `muse-exec.ts`, spend in `muse-usage.ts`, stream folding in
// `muse-events.ts`, and the gate seam in `muse-gate-bridge.ts` +
// `muse-hook-router.ts`. Field facts:
// `research/adapters/2026-08-07_muse-code-adapter-certification.md` (0.1.0-R708.1).
//
// THE GATE, AND WHY EVERY TURN CURRENTLY REFUSES. `muse exec` exposes no
// in-process permission callback, and its headless approval path auto-approves:
// a `bash` call executed with exit 0 under the default `--approval-mode
// on-request` with no round trip. The only documented pre-execution seam is the
// managed hook runtime, which this adapter installs per turn. Across twenty
// configurations on 0.1.0-R708.1 no hook of any event fired, so the seam is
// present in the product surface but NOT OBSERVED IN THIS BUILD.
//
// The adapter therefore fails closed rather than degrading: before any provider
// construction it proves the seam is live with a token-free `--provider echo`
// handshake, and refuses with a typed `MuseGateSeamUnavailableError` when the
// handshake does not arrive. An unproven gate is never an allowed turn
// (INV-002; B-26's owner-decided fallback). `src/runtime/capabilities.ts`
// records `tool_gate` and `intra_turn_fanout` as `unsupported` to match, and
// the refusal is the degradation artifact those tiers owe.

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveTurnRequestAssignment } from "../assignment.js";
import { withNonInteractiveEnv } from "../non-interactive-env.js";
import type { GateEscalation, Runtime, TurnHooks, TurnRequest, TurnResult } from "../types.js";
import { renderContextBundle, writeMaskedWorktreeFile } from "../worktree-context.js";
import { applyMuseRecord, museReportedSessionId, newMuseTurnState } from "./muse-events.js";
import { startMuseGateBridge, type MuseGateBridge } from "./muse-gate-bridge.js";
import {
  defaultMuseExecFactory,
  mapMuseEffort,
  museExecArgs,
  museHandshakeArgs,
  resolveMuseApiKey,
  MUSE_API_KEY_ENV,
  type MuseExecFactory,
} from "./muse-exec.js";
import {
  museBudgetOverrun,
  museTurnUsage,
  museUnknownUsage,
  readMuseSessionUsage,
  type MuseObservedUsage,
} from "./muse-usage.js";

export interface MuseRuntimeOptions {
  execFactory?: MuseExecFactory;
  /** Reads the operator-configured API key. */
  apiKey?: () => Promise<string | undefined>;
  /** Root holding `<year>/<month>/<day>/<session>/session.jsonl`. */
  sessionLogRoot?: string;
  /** Explicit child environment, e.g. campaign-scoped scratch. */
  execEnv?: NodeJS.ProcessEnv;
}

/** Typed refusal: the managed-hook gate seam was not proven live this turn, so
 *  no tool action could be classified before execution. Pre-spend and terminal;
 *  an ungated Muse turn is never run. */
export class MuseGateSeamUnavailableError extends Error {
  readonly code = "error_gate_seam_unavailable";
  constructor(readonly detail: string) {
    super(
      `MuseRuntime: the managed-hook gate seam was not proven live this turn (${detail}). ` +
        `Muse Code auto-approves tool calls headlessly, so an unproven hook seam means every ` +
        `tool action would execute ungated; refusing before provider construction instead ` +
        `(CORMIDIA-INV-002, contracts/B-26-muse-code.md).`,
    );
    this.name = "MuseGateSeamUnavailableError";
  }
}

/** Typed refusal: readiness means usable request authentication, never mere
 *  configuration presence (docs/harness/adding-updating.md §5). */
export class MuseAuthUnavailableError extends Error {
  readonly code = "error_auth";
  constructor() {
    super(
      "MuseRuntime: no Muse API key is resolvable from the operator's configured source " +
        "(MUSE_API_KEY or META_API_KEY, or a file named by CORMIDIA_MUSE_API_KEY_FILE)",
    );
    this.name = "MuseAuthUnavailableError";
  }
}

/** Typed core-§4 refusal: a resume that starts but does not restore the EXACT
 *  prior session fails closed instead of continuing on a fresh one. */
export class MuseSessionResumeMismatchError extends Error {
  readonly code = "error_resume_session_mismatch";
  constructor(
    readonly requestedSessionId: string,
    readonly restoredSessionId: string,
  ) {
    super(
      `MuseRuntime resume mismatch: requested session ${JSON.stringify(requestedSessionId)} ` +
        `but muse reported ${JSON.stringify(restoredSessionId)}`,
    );
    this.name = "MuseSessionResumeMismatchError";
  }
}

export class MuseRuntime implements Runtime {
  readonly kind = "muse" as const;
  private readonly execFactory: MuseExecFactory;
  private readonly apiKey: () => Promise<string | undefined>;
  private readonly sessionLogRoot: string;
  private readonly execEnv: NodeJS.ProcessEnv | undefined;

  constructor(opts: MuseRuntimeOptions = {}) {
    this.execFactory = opts.execFactory ?? defaultMuseExecFactory;
    this.apiKey = opts.apiKey ?? resolveMuseApiKey;
    this.sessionLogRoot = opts.sessionLogRoot ?? join(homedir(), ".local", "share", "muse", "sessions");
    this.execEnv = opts.execEnv;
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    const assignment = resolveTurnRequestAssignment(req, this.kind);
    const effort = mapMuseEffort(assignment.effort);
    if (req.session !== undefined && req.session.runtime !== "muse") {
      throw new Error(
        `MuseRuntime cannot resume a "${req.session.runtime}" session — ` +
          `cross-runtime resume is an orchestrator bug (session id: ${req.session.id})`,
      );
    }
    const key = await this.apiKey();
    if (key === undefined || key.trim().length === 0) throw new MuseAuthUnavailableError();

    const startTime = Date.now();
    const escalations: GateEscalation[] = [];
    const bridge = await startMuseGateBridge(req.workdir, hooks, escalations);
    try {
      await this.proveGateSeam(bridge, req, key);
      return await this.execute(req, hooks, bridge, escalations, {
        key,
        effort,
        model: assignment.model,
        startTime,
      });
    } finally {
      await bridge.close();
    }
  }

  /**
   * Fail-closed handshake. A token-free `--provider echo` run with this turn's
   * managed hook root installed must make at least one hook reach the bridge.
   * Proof precedes provider construction, so a refusal costs nothing and no
   * ungated turn is ever launched.
   */
  private async proveGateSeam(bridge: MuseGateBridge, req: TurnRequest, key: string): Promise<void> {
    const probe = this.execFactory({
      args: museHandshakeArgs(req.workdir),
      env: this.childEnv(bridge),
      cwd: req.workdir,
    });
    probe.writeApiKey(key);
    try {
      for await (const record of probe.events) void record;
      await probe.completion;
    } catch {
      // A failed probe is an unproven seam, never an allowed turn.
    } finally {
      await probe.terminate();
    }
    if (!bridge.handshakeObserved()) {
      throw new MuseGateSeamUnavailableError(
        "no managed hook (SessionStart/UserPromptSubmit) reached the per-turn gate socket",
      );
    }
  }

  private async execute(
    req: TurnRequest,
    hooks: TurnHooks,
    bridge: MuseGateBridge,
    escalations: GateEscalation[],
    run: { key: string; effort: string; model: string; startTime: number },
  ): Promise<TurnResult> {
    const sessionId = req.session?.id ?? randomUUID();
    const promptFile = join(bridge.hookDir, "..", "prompt.txt");
    await writeFile(promptFile, req.task, { encoding: "utf8", mode: 0o600 });
    // Muse reads the workspace-root AGENTS.md as project rules, but an app repo
    // OWNS that file and Cormidia never rewrites app-owned instructions, so the
    // bundle goes to a masked companion — recorded as adapter-built context in
    // the capability matrix rather than claimed as a clean native channel.
    writeMaskedWorktreeFile(req.workdir, join(".muse", "AGENTS.md"), renderContextBundle(req.context));

    const child = this.execFactory({
      args: museExecArgs({
        promptFile,
        workdir: req.workdir,
        model: run.model,
        effort: run.effort,
        sessionId,
        ...(req.maxTurns === undefined ? {} : { maxModelSteps: req.maxTurns }),
      }),
      env: this.childEnv(bridge),
      cwd: req.workdir,
    });
    child.writeApiKey(run.key);
    const abort = (): void => void child.terminate();
    req.signal?.addEventListener("abort", abort, { once: true });

    const state = newMuseTurnState(sessionId);
    let usage: MuseObservedUsage | undefined;
    try {
      for await (const record of child.events) {
        const observed = museReportedSessionId(record);
        if (observed !== undefined) {
          if (req.session !== undefined && observed !== req.session.id) {
            throw new MuseSessionResumeMismatchError(req.session.id, observed);
          }
          state.sessionId = observed;
          hooks.onProgress?.({ session: { runtime: "muse", id: observed } });
        }
        applyMuseRecord(record, hooks, state);
        if (record.payload_type !== "task.lifecycle.completed") continue;
        // Running budget guard at the finest truthful observation point this
        // harness exposes: muse streams no usage, so the durable session log is
        // read at each model-step boundary. Crossing the cap stops the turn ->
        // failed + exactly one incident note.
        usage = (await readMuseSessionUsage(this.sessionLogRoot, state.sessionId)) ?? usage;
        if (usage === undefined) continue;
        const snapshot = museTurnUsage(usage, Date.now() - run.startTime, "partial");
        hooks.onProgress?.({
          at: new Date().toISOString(),
          session: { runtime: "muse", id: state.sessionId },
          usage: snapshot,
        });
        if (snapshot.costUsd >= req.role.maxTurnBudgetUsd) {
          state.budgetOverrun = true;
          await child.terminate();
          break;
        }
      }
      await child.completion;
    } finally {
      req.signal?.removeEventListener("abort", abort);
      await child.terminate();
    }

    usage = (await readMuseSessionUsage(this.sessionLogRoot, state.sessionId)) ?? usage;
    const wallClockMs = Date.now() - run.startTime;
    if (req.signal?.aborted) {
      return {
        status: "cancelled",
        errorCode: "error_cancelled",
        summary: stopReason(req.signal.reason),
        artifacts: [],
        session: { runtime: "muse", id: state.sessionId },
        usage: usage === undefined ? museUnknownUsage(wallClockMs) : museTurnUsage(usage, wallClockMs, "partial"),
        escalations,
      };
    }

    const status = state.budgetOverrun
      ? "failed"
      : escalations.length > 0
        ? "blocked_on_gate"
        : state.terminal === "completed"
          ? "completed"
          : "failed";
    // Fan-out accounting comes from real records only — the bridge's join table
    // and the session log — never from what the assistant said it did.
    const fanout = Math.max(bridge.subagentTurns(), usage?.subagentTurns ?? 0);
    const overrun = state.budgetOverrun ? museBudgetOverrun(state.sessionId, usage, req.role) : undefined;
    return {
      status,
      summary: overrun?.summary ?? state.summary ?? "muse exec produced no assistant output",
      artifacts: overrun === undefined ? [] : [overrun.note],
      session: { runtime: "muse", id: state.sessionId },
      usage:
        usage === undefined
          ? museUnknownUsage(wallClockMs, fanout)
          : museTurnUsage(usage, wallClockMs, "estimated", fanout),
      escalations,
      ...(state.budgetOverrun
        ? { errorCode: "error_max_budget_usd" }
        : status === "failed"
          ? { errorCode: state.errorCode ?? "error_provider" }
          : {}),
    };
  }

  private childEnv(bridge: MuseGateBridge): NodeJS.ProcessEnv {
    const base = { ...withNonInteractiveEnv(this.execEnv ?? process.env) };
    // The key travels on stdin only. Strip every variable that could carry it
    // so an in-turn `env` dump has nothing to read.
    for (const name of MUSE_API_KEY_ENV) delete base[name];
    return { ...base, ...bridge.env };
  }
}

function stopReason(reason: unknown): string {
  return typeof reason === "string" && reason.length > 0 ? reason : "operator cancellation";
}

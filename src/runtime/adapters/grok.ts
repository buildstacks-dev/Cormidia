// xAI/SpaceXAI roles -> Grok Build over ACP, driving `grok agent stdio`.
//
// Surface choice (research/2026-08-06_adapter-upstream-references.md, B-25):
// grok ships no SDK. `grok -p --output-format streaming-json` is the batch
// surface; ACP is the client protocol with sessions, resume, streamed tool
// events, permission callbacks and usage — the same reasons B-03 uses Codex's
// App Server rather than `codex exec`.
//
// The gate is the `PreToolUse` hook bridge, not the ACP permission request; see
// grok-gate-bridge.ts for why, and grok-isolation.ts for the per-turn provider
// isolation the claim depends on. This module's distinctive job is to REFUSE a
// turn whose gate it could not prove: grok's hook runner fails open, so a
// silent hook is indistinguishable from a quiet turn, and "no permission
// request observed" is never evidence of approval (F-PT-027).
//
// Sandbox posture: #339's human risk review is OPEN. Every live turn targets a
// throwaway sandbox repository; nothing here authorizes real-repo use.

import { resolveTurnRequestAssignment } from "../assignment.js";
import { withNonInteractiveEnv } from "../non-interactive-env.js";
import { definedProps } from "../optional-properties.js";
import type { GateEscalation, Runtime, TurnAssignment, TurnHooks, TurnRequest, TurnResult } from "../types.js";
import { renderContextBundle, writeMaskedWorktreeFile } from "../worktree-context.js";
import {
  GrokProtocolVersionError,
  StdioGrokAcpClient,
  type GrokAcpClient,
  type GrokAcpLaunchOptions,
} from "./grok-acp-client.js";
import { startGrokGateBridge, type GrokGateBridge } from "./grok-gate-bridge.js";
import { grokAgentArgs } from "./grok-isolation.js";
import { openGrokSession, proveGrokGate, routeGrokPermission } from "./grok-session.js";
import {
  classifyGrokStop,
  grokArtifacts,
  grokSummary,
  grokTurnState,
  grokTurnStatus,
  grokUsage,
  stoppedGrokResult,
  zeroGrokUsage,
  type GrokTurnState,
} from "./grok-turn.js";

export interface GrokRuntimeOptions {
  clientFactory?: (options: GrokAcpLaunchOptions) => GrokAcpClient;
  /** Explicit environment for the provider subprocess and its hook children. */
  agentEnv?: NodeJS.ProcessEnv;
  /** Provider home the per-turn credential is copied from. */
  sourceGrokHome?: string;
  /** Test seam: supply the gate bridge instead of starting the real one. */
  gateBridgeFactory?: (workdir: string, hooks: TurnHooks, escalations: GateEscalation[]) => Promise<GrokGateBridge>;
}

export class GrokRuntime implements Runtime {
  readonly kind = "grok" as const;
  private readonly clientFactory: (options: GrokAcpLaunchOptions) => GrokAcpClient;
  private readonly agentEnv: NodeJS.ProcessEnv | undefined;
  private readonly sourceGrokHome: string | undefined;
  private readonly gateBridgeFactory: GrokRuntimeOptions["gateBridgeFactory"];

  constructor(opts: GrokRuntimeOptions = {}) {
    this.clientFactory = opts.clientFactory ?? ((launch) => new StdioGrokAcpClient(launch));
    this.agentEnv = opts.agentEnv;
    this.sourceGrokHome = opts.sourceGrokHome;
    this.gateBridgeFactory = opts.gateBridgeFactory;
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    const assignment = resolveTurnRequestAssignment(req, this.kind);
    assertGrokEffort(assignment);
    if (req.session !== undefined && req.session.runtime !== "grok") {
      throw new Error(
        `GrokRuntime cannot resume a "${req.session.runtime}" session - ` +
          `cross-runtime resume is an orchestrator bug (session id: ${req.session.id})`,
      );
    }

    const startTime = Date.now();
    const escalations: GateEscalation[] = [];
    // Native context channel: grok reads project rules from `.grok/rules/*.md`
    // at every level from the repo root down (user guide, project rules),
    // alongside AGENTS.md. The file is git-excluded so a turn's context never
    // shows up as a working-tree change.
    writeMaskedWorktreeFile(req.workdir, ".grok/rules/cormidia-context.md", renderContextBundle(req.context));
    const bridge = await this.startBridge(req, hooks, escalations);
    const client = this.clientFactory({
      args: grokAgentArgs(assignment.model),
      env: { ...withNonInteractiveEnv(this.agentEnv ?? process.env), ...bridge.env },
      cwd: req.workdir,
    });
    const state = grokTurnState(req.session?.id ?? `pending-${startTime}`, startTime);
    let cancelled = false;
    const abortClient = (): void => {
      cancelled = true;
      void client.notify("session/cancel", { sessionId: state.sessionId }).catch(() => undefined);
      void client.close();
    };
    req.signal?.addEventListener("abort", abortClient, { once: true });

    try {
      if (req.signal?.aborted) return stoppedGrokResult(req, state, escalations);

      const initialize = await client.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "cormidia", title: "Cormidia", version: "0.1.0" },
      });
      const protocolVersion = isRecord(initialize) ? initialize["protocolVersion"] : undefined;
      if (protocolVersion !== 1) throw new GrokProtocolVersionError(protocolVersion);

      state.sessionId = await openGrokSession(client, req);
      await proveGrokGate(bridge, state.sessionId, req.session?.id);
      hooks.onProgress?.({ session: { runtime: "grok", id: state.sessionId } });

      // The stream and the RPC result run together deliberately: consuming
      // updates is what surfaces the permission backstop, and the result is
      // what ends the turn. `req.task` travels in the JSON-RPC body, never
      // argv — the ARG_MAX lesson (docs/loop/design.md §2).
      const promptResult = client.request("session/prompt", {
        sessionId: state.sessionId,
        prompt: [{ type: "text", text: req.task }],
      });
      void this.consume(client, hooks, escalations, state);
      this.applyPromptResult(await promptResult, req, hooks, state);

      if (req.signal?.aborted || cancelled) return stoppedGrokResult(req, state, escalations);

      const status = state.budgetOverrun
        ? "failed"
        : escalations.length > 0
          ? "blocked_on_gate"
          : grokTurnStatus(state.stopReason);
      return {
        status,
        summary: grokSummary(state, req),
        artifacts: grokArtifacts(state, req),
        session: { runtime: "grok", id: state.sessionId },
        usage: state.usage ?? { ...zeroGrokUsage(Date.now() - startTime), quality: "unavailable" },
        escalations,
        ...(state.budgetOverrun
          ? { errorCode: "error_max_budget_usd" }
          : status === "failed" && state.errorCode !== undefined
            ? { errorCode: state.errorCode }
            : {}),
      };
    } catch (error) {
      if (req.signal?.aborted || cancelled) return stoppedGrokResult(req, state, escalations);
      throw error;
    } finally {
      req.signal?.removeEventListener("abort", abortClient);
      await client.close();
      await bridge.close();
    }
  }

  private startBridge(req: TurnRequest, hooks: TurnHooks, escalations: GateEscalation[]): Promise<GrokGateBridge> {
    if (this.gateBridgeFactory !== undefined) return this.gateBridgeFactory(req.workdir, hooks, escalations);
    return startGrokGateBridge(req.workdir, hooks, escalations, definedProps({ sourceGrokHome: this.sourceGrokHome }));
  }

  private async consume(
    client: GrokAcpClient,
    hooks: TurnHooks,
    escalations: GateEscalation[],
    state: GrokTurnState,
  ): Promise<void> {
    try {
      for await (const message of client) {
        if (state.done) return;
        if (message.method === "session/request_permission") {
          await routeGrokPermission(client, message, hooks, escalations);
          continue;
        }
        const update = isRecord(message.params) ? message.params["update"] : undefined;
        if (isRecord(update)) {
          this.applyUpdate(update, hooks, state);
          continue;
        }
        if (message.id !== undefined) {
          await client.respond(message.id, { error: `Cormidia does not implement grok request ${message.method}` });
        }
      }
    } catch {
      // Transport teardown at turn end is expected; the RPC result (or its
      // rejection) is what classifies the turn.
    }
  }

  private applyUpdate(update: Record<string, unknown>, hooks: TurnHooks, state: GrokTurnState): void {
    const kind = update["sessionUpdate"];
    if (kind === "agent_message_chunk") {
      const content = isRecord(update["content"]) ? update["content"] : undefined;
      if (typeof content?.["text"] === "string") state.finalText += content["text"];
      return;
    }
    if (kind === "response_completed") {
      // Grok reports per-round TOKENS but no per-round cost, so a durable
      // usage checkpoint here would have to invent a dollar figure. Report the
      // session handle instead: honest progress, never a fabricated zero.
      hooks.onProgress?.({ at: new Date().toISOString(), session: { runtime: "grok", id: state.sessionId } });
      return;
    }
    if (kind !== "turn_completed") return;
    if (typeof update["stop_reason"] === "string") state.stopReason ??= update["stop_reason"];
    const usage = grokUsage(update["usage"], Date.now() - state.startedAt);
    if (usage === undefined) return;
    state.usage = usage;
    hooks.onProgress?.({
      at: new Date().toISOString(),
      session: { runtime: "grok", id: state.sessionId },
      usage: { ...usage, quality: "partial" },
    });
  }

  private applyPromptResult(raw: unknown, req: TurnRequest, hooks: TurnHooks, state: GrokTurnState): void {
    state.done = true;
    const result = isRecord(raw) ? raw : {};
    if (typeof result["stopReason"] === "string") state.stopReason = result["stopReason"];
    const meta = isRecord(result["_meta"]) ? result["_meta"] : undefined;
    const usage = grokUsage(meta?.["usage"], Date.now() - state.startedAt);
    if (usage !== undefined) state.usage = usage;
    if (state.usage !== undefined) {
      hooks.onProgress?.({
        at: new Date().toISOString(),
        session: { runtime: "grok", id: state.sessionId },
        usage: state.usage,
      });
      // Per-turn budget cap. Grok's ACP stream exposes no mid-turn dollar
      // figure (only the terminal `costUsdTicks`), so this guard is terminal:
      // it turns a crossed cap into a failed turn with exactly one incident
      // note instead of silent spend. The degradation is written down in
      // docs/harness/capability-matrix.md rather than papered over with an
      // invented price table.
      if (state.usage.costUsd >= req.role.maxTurnBudgetUsd) state.budgetOverrun = true;
    }
    if (state.stopReason === undefined) return;
    const code = classifyGrokStop(state.stopReason, state.finalText);
    if (code !== undefined) state.errorCode ??= code;
  }
}

/** B-25 records grok's effort surface as an honest absence for this adapter
 *  revision: no effort value is transmitted, and a value grok's own model
 *  metadata never exposes throws rather than being aliased down. */
function assertGrokEffort(assignment: TurnAssignment): void {
  if (assignment.effort === "max" || assignment.effort === "xhigh") {
    throw new Error(`GrokRuntime: effort ${assignment.effort} is unsupported; no effort alias is allowed`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

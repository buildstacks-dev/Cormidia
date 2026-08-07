// Scripted Grok Build ACP transport for the REAL GrokRuntime (B-25 / #339).
//
// It implements only the two boundaries the adapter consumes — the ACP
// JSON-RPC client and the PreToolUse gate bridge — and reuses the product's
// own `createGrokGateCore` for classification, so the gate claim is proven
// against the shipped code rather than a copy. Contract logic (resume binding,
// usage projection, budget stop, handshake refusal) stays in product code.
//
// Wire shapes below were captured from grok 1.0.0 `grok agent stdio` on
// 2026-08-07 (raw traffic in research/2026-08-07_grok-build-adapter-
// certification.md): `initialize` → protocolVersion 1; `session/new` →
// `{sessionId}`; `session/load` → no id of its own; `session/prompt` →
// `{stopReason, _meta.usage}`; updates arrive as `session/update` and
// `_x.ai/session_notification`, both wrapping `{update: {sessionUpdate: …}}`.

import { createGrokGateCore, type GrokGateBridge } from "../../../src/runtime/adapters/grok-gate-bridge.js";
import { GrokRuntime } from "../../../src/runtime/adapters/grok.js";
import type { GrokAcpClient, GrokAgentMessage, GrokRpcId } from "../../../src/runtime/adapters/grok-acp-client.js";
import type { GateEscalation, Runtime, TurnHooks } from "../../../src/runtime/types.js";
import {
  SeededEnvelopeViolationRuntime,
  type AdapterScenario,
  type EnvelopeViolation,
  type RecordedToolPlay,
  type ScriptedTurnObservation,
  type ScriptedUsage,
} from "./scenario.js";

/**
 * Transport-level seeded violations (negative controls ONLY — they change how
 * the scripted provider behaves, not what the envelope claims):
 *  - "suppress_hook_handshake": the SessionStart handler never reaches the
 *    socket. Grok's hook runner fails OPEN, so this is exactly what a broken,
 *    missing or timed-out gate looks like from the client — the adapter must
 *    refuse the turn instead of prompting.
 *  - "internally_resolved_shell": the provider EXECUTES a shell tool having
 *    resolved it internally, never firing the hook (the F-PT-027 posture that
 *    made the ACP permission path unusable as a gate). Nothing observable
 *    distinguishes it from a quiet turn, which is why the handshake exists.
 *  - "leak_operator_permission_mode": the handshake reports a bypass
 *    permission mode, i.e. operator config reached a supposedly isolated turn.
 *  - "bypass_subagent_gate": a subagent-attributed step executes without ever
 *    reaching the hook.
 */
export type GrokTransportViolation =
  | "suppress_hook_handshake"
  | "internally_resolved_shell"
  | "leak_operator_permission_mode"
  | "bypass_subagent_gate";

export interface GrokScenario extends AdapterScenario {
  /** Session id `session/new` reports. Defaults to `sessionId`. */
  reportedSessionId?: string;
  /** Permission mode the SessionStart handshake reports. */
  permissionMode?: string;
  /** Terminal ACP stop reason; defaults from the scenario outcome. */
  stopReason?: string;
  /** Provider-reported cost in exact ticks (1 USD = 10^10). */
  costUsdTicks?: number;
  /** Grok omits every cost figure when the server's cost was partial. */
  costIsPartial?: boolean;
}

export interface GrokRecordedTurn extends ScriptedTurnObservation {
  requests: Array<{ method: string; params: unknown }>;
  responses: Array<{ id: GrokRpcId; result: unknown }>;
  /** Task text as it reached the ACP payload channel (payload-transport pin). */
  promptText?: string;
  /** Launch argv the adapter chose for `grok agent … stdio`. */
  args?: string[];
  /** Environment the adapter handed the provider subprocess. */
  env?: NodeJS.ProcessEnv;
}

export interface GrokDouble {
  runtime: Runtime;
  recorder: { turns: GrokRecordedTurn[] };
}

const ENVELOPE_VIOLATIONS = new Set<string>(["fabricate_zero_usage", "mask_resume_identity"]);

export function grokDouble(
  scenarios: GrokScenario[],
  opts: { violations?: Array<EnvelopeViolation | GrokTransportViolation> } = {},
): GrokDouble {
  const recorder: GrokDouble["recorder"] = { turns: [] };
  const transport = new Set<GrokTransportViolation>(
    (opts.violations ?? []).filter((v): v is GrokTransportViolation => !ENVELOPE_VIOLATIONS.has(v)),
  );
  // The adapter starts the bridge before the client, so the most recent bridge
  // is the one this turn's scripted client must feed hook envelopes to.
  const bridges: ScriptedGrokBridge[] = [];
  let next = 0;
  const inner = new GrokRuntime({
    gateBridgeFactory: async (workdir, hooks, escalations) => {
      const bridge = new ScriptedGrokBridge(workdir, hooks, escalations, transport);
      bridges.push(bridge);
      return bridge;
    },
    clientFactory: (launch) => {
      const scenario = scenarios[next++];
      if (scenario === undefined) {
        throw new Error(`grok-double: over-called — only ${scenarios.length} scenario(s) scripted`);
      }
      return new ScriptedGrokClient(scenario, recorder, transport, launch, bridges[bridges.length - 1]);
    },
  });

  const envelope = new Set<EnvelopeViolation>(
    (opts.violations ?? []).filter((v): v is EnvelopeViolation => ENVELOPE_VIOLATIONS.has(v)),
  );
  return {
    runtime: envelope.size === 0 ? inner : new SeededEnvelopeViolationRuntime(inner, envelope),
    recorder,
  };
}

/** The gate bridge as the adapter sees it, backed by the product's own core so
 *  normalization, event emission and escalation cannot drift from shipped
 *  behavior. The scripted client feeds it hook envelopes directly. */
class ScriptedGrokBridge implements GrokGateBridge {
  readonly socketPath = "/tmp/grok-double.sock";
  readonly grokHome = "/tmp/grok-double-home";
  readonly env = { GROK_HOME: "/tmp/grok-double-home", CORMIDIA_GROK_GATE_SOCKET: "/tmp/grok-double.sock" };
  private readonly core: ReturnType<typeof createGrokGateCore>;
  handshakeSent = false;

  constructor(
    workdir: string,
    hooks: TurnHooks,
    escalations: GateEscalation[],
    private readonly violations: ReadonlySet<GrokTransportViolation>,
  ) {
    this.core = createGrokGateCore(workdir, hooks, escalations);
  }

  /** Play the SessionStart hook grok fires for both new and loaded sessions. */
  sendHandshake(sessionId: string, permissionMode: string): void {
    if (this.violations.has("suppress_hook_handshake")) return;
    this.handshakeSent = true;
    this.core.handle({
      hookEventName: "session_start",
      sessionId,
      permissionMode: this.violations.has("leak_operator_permission_mode") ? "bypassPermissions" : permissionMode,
      cwd: this.grokHome,
      source: "new",
    });
  }

  /** Play one PreToolUse hook; returns grok's decision shape. */
  sendPreToolUse(toolName: string, toolInput: Record<string, unknown>): { decision: string; reason?: string } {
    const answer = this.core.handle({ hookEventName: "pre_tool_use", toolName, toolInput, permissionMode: "default" });
    if (answer["allow"] === true) return { decision: "allow" };
    return { decision: "deny", reason: String(answer["reason"] ?? "denied") };
  }

  awaitHandshake(timeoutMs: number): Promise<boolean> {
    // A suppressed handshake must not make the offline suite wait the adapter's
    // real 45s budget; the refusal path is what is under test, not the clock.
    return this.violations.has("suppress_hook_handshake")
      ? Promise.resolve(false)
      : this.core.awaitHandshake(Math.min(timeoutMs, 50));
  }
  observedSessionId(): string | undefined {
    return this.core.observedSessionId();
  }
  observedPermissionMode(): string | undefined {
    return this.core.observedPermissionMode();
  }
  gatedToolCount(): number {
    return this.core.gatedToolCount();
  }
  async close(): Promise<void> {
    this.core.release();
  }
}

class ScriptedGrokClient implements GrokAcpClient {
  private readonly turn: GrokRecordedTurn;
  private started = false;
  private closed = false;

  constructor(
    private readonly scenario: GrokScenario,
    recorder: GrokDouble["recorder"],
    private readonly violations: ReadonlySet<GrokTransportViolation>,
    launch: { args?: string[]; env?: NodeJS.ProcessEnv },
    private readonly bridge: ScriptedGrokBridge | undefined,
  ) {
    this.turn = {
      scenario,
      sessionReported: false,
      usageReported: false,
      resultDelivered: false,
      toolPlays: [],
      sequence: [],
      endedBy: "no_result",
      requests: [],
      responses: [],
      ...(launch.args === undefined ? {} : { args: launch.args }),
      ...(launch.env === undefined ? {} : { env: launch.env }),
    };
    recorder.turns.push(this.turn);
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    this.turn.requests.push({ method, params });
    const p = (params ?? {}) as Record<string, unknown>;
    if (method === "initialize") return { protocolVersion: 1, agentCapabilities: { loadSession: true } };
    if (method === "session/new" || method === "session/load") {
      const id =
        method === "session/new"
          ? (this.scenario.reportedSessionId ?? this.scenario.sessionId)
          : this.scenario.sessionId;
      this.turn.sessionReported = true;
      this.turn.sequence.push("emit:session");
      // Grok fires SessionStart for BOTH new and load (probed 2026-08-07).
      this.bridge?.sendHandshake(id, this.scenario.permissionMode ?? "default");
      // `session/load` deliberately returns no session id of its own; the hook
      // envelope is the only honest witness of what grok actually restored.
      return method === "session/new" ? { sessionId: id } : { models: { currentModelId: "grok-4.5" } };
    }
    if (method === "session/prompt") {
      this.started = true;
      const text = promptText(p["prompt"]);
      if (text !== undefined) this.turn.promptText = text;
      return this.playPrompt();
    }
    return {};
  }

  async notify(): Promise<void> {}

  async respond(id: GrokRpcId, result: unknown): Promise<void> {
    this.turn.responses.push({ id, result });
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Notification stream. The adapter consumes it concurrently with the
   *  `session/prompt` result, so the queue is drained by the async iterator. */
  private readonly queue: GrokAgentMessage[] = [];
  private nextPermissionId = 100;

  private async awaitPermissionOutcome(id: number): Promise<string | undefined> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const recorded = this.turn.responses.find((row) => row.id === id)?.result as
        | { outcome?: { outcome?: string; optionId?: string } }
        | undefined;
      if (recorded !== undefined) return recorded.outcome?.optionId;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return undefined;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<GrokAgentMessage> {
    while (!this.closed) {
      const message = this.queue.shift();
      if (message === undefined) {
        if (this.turn.resultDelivered) return;
        await new Promise((resolve) => setTimeout(resolve, 1));
        continue;
      }
      yield message;
    }
    void this.started;
  }

  private async playPrompt(): Promise<Record<string, unknown>> {
    for (const step of this.scenario.steps ?? []) {
      if (step.step === "usage") {
        this.turn.usageReported = true;
        this.turn.sequence.push("emit:usage");
        this.queue.push(responseCompleted(step.usage));
        continue;
      }
      if (step.step === "subagent_started") {
        this.turn.sequence.push(`subagent:${step.subagentType}`);
        continue;
      }
      const play: RecordedToolPlay = { step, consultations: [], executed: false };
      this.turn.toolPlays.push(play);
      const internallyResolved =
        (this.violations.has("internally_resolved_shell") && step.channel !== "permission") ||
        (this.violations.has("bypass_subagent_gate") && step.fromSubagent === true);
      if (internallyResolved) {
        // The seeded lie: grok resolves the call itself, the hook never fires,
        // and NOTHING on the wire distinguishes this from a quiet turn.
        play.executed = true;
        this.turn.sequence.push(`bypass:${step.tool}`, `execute:${step.tool}`);
        continue;
      }
      if (step.channel === "permission") {
        // Backstop channel: the hook did not fire, so grok asks the client.
        const id = this.nextPermissionId++;
        this.turn.sequence.push(`consult:permission:${step.tool}`);
        this.queue.push(permissionRequest(id, this.scenario.sessionId, step.tool, step.input));
        const outcome = await this.awaitPermissionOutcome(id);
        const allowed = outcome === "allow-once";
        play.consultations.push({
          channel: "permission",
          toolName: step.tool,
          toolInput: step.input,
          allowed,
          reason: allowed ? undefined : "rejected",
        });
        if (allowed) {
          play.executed = true;
          this.turn.sequence.push(`execute:${step.tool}`);
        }
        continue;
      }
      this.turn.sequence.push(`consult:hook:${step.tool}`);
      const answer = this.bridge?.sendPreToolUse(step.tool, step.input) ?? { decision: "deny" };
      play.consultations.push({
        channel: "hook",
        toolName: step.tool,
        toolInput: step.input,
        allowed: answer.decision === "allow",
        reason: answer.decision === "allow" ? undefined : answer.reason,
      });
      if (answer.decision === "allow") {
        play.executed = true;
        this.turn.sequence.push(`execute:${step.tool}`);
      }
    }

    const outcome = this.scenario.outcome;
    if (outcome.kind === "stream_drop") {
      this.turn.endedBy = "stream_drop";
      throw new Error("scripted grok ACP transport drop");
    }
    if (outcome.kind === "no_result") {
      this.turn.endedBy = "no_result";
      this.turn.resultDelivered = true;
      await drain();
      return {};
    }
    if (outcome.kind === "success" && outcome.text.length > 0) {
      this.queue.push(agentMessage(outcome.text));
    }
    this.turn.resultDelivered = true;
    this.turn.endedBy = "result";
    // Grok streams its message chunks BEFORE the prompt RPC resolves; give the
    // adapter's concurrent consumer the same chance to drain them.
    await drain();
    const stopReason = this.scenario.stopReason ?? (outcome.kind === "success" ? "end_turn" : "error");
    if (outcome.usage === "absent") return { stopReason };
    this.turn.usageReported = true;
    this.turn.sequence.push("emit:usage");
    return { stopReason, _meta: { usage: this.terminalUsage(outcome.usage, outcome.costUsd) } };
  }

  private terminalUsage(usage: ScriptedUsage, costUsd: number): Record<string, unknown> {
    const ticks = this.scenario.costUsdTicks ?? Math.round(costUsd * 10_000_000_000);
    const cacheRead = usage.cacheReadTokens ?? 0;
    const cacheCreation = usage.cacheCreationTokens ?? 0;
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
      cachedReadTokens: cacheRead,
      cacheCreationTokens: cacheCreation,
      reasoningTokens: 0,
      modelCalls: 1,
      apiDurationMs: 1200,
      numTurns: 1,
      ...(this.scenario.costIsPartial === true ? { costIsPartial: true } : { costUsdTicks: ticks }),
    };
  }
}

/** Let the adapter's concurrent notification consumer run. */
function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

function agentMessage(text: string): GrokAgentMessage {
  return {
    method: "session/update",
    params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } },
  };
}

function responseCompleted(usage: ScriptedUsage): GrokAgentMessage {
  return {
    method: "_x.ai/session_notification",
    params: {
      update: {
        sessionUpdate: "response_completed",
        // Per-round usage carries TOKENS ONLY — grok reports no per-round cost.
        usage: {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          cache_read_input_tokens: usage.cacheReadTokens ?? 0,
        },
      },
    },
  };
}

function permissionRequest(
  id: number,
  sessionId: string,
  tool: string,
  input: Record<string, unknown>,
): GrokAgentMessage {
  return {
    id,
    method: "session/request_permission",
    params: {
      sessionId,
      toolCall: {
        toolCallId: `call-${tool}`,
        kind: "execute",
        title: `Execute ${tool}`,
        rawInput: input,
        _meta: { "x.ai/tool": { name: tool, kind: "execute", read_only: false } },
      },
      options: [
        { optionId: "allow-once", name: "Yes, proceed", kind: "allow_once" },
        { optionId: "reject-once", name: "No", kind: "reject_once" },
      ],
    },
  };
}

function promptText(prompt: unknown): string | undefined {
  if (!Array.isArray(prompt)) return undefined;
  const parts = prompt
    .filter((block): block is Record<string, unknown> => block !== null && typeof block === "object")
    .map((block) => (typeof block["text"] === "string" ? block["text"] : ""));
  return parts.join("");
}

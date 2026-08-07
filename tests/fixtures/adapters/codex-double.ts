// Scripted Codex App Server transport for the REAL CodexRuntime (HB-024).
// It implements only the JSON-RPC boundary the adapter consumes; contract
// logic (resume binding, usage estimation, budget stop, approvals) remains in
// product code.

import type { CodexAppServerClient, CodexServerMessage, JsonRpcId } from "../../../src/runtime/adapters/codex.js";
import { CodexRuntime } from "../../../src/runtime/adapters/codex.js";
import type { Runtime } from "../../../src/runtime/types.js";
import {
  SeededEnvelopeViolationRuntime,
  type AdapterScenario,
  type EnvelopeViolation,
  type RecordedGateConsultation,
  type RecordedToolPlay,
  type ScriptedTurnObservation,
  type ScriptedUsage,
} from "./scenario.js";

export type CodexRotationScript = "auth_loss" | "stale_capabilities";

/** Transport-level seeded violations (negative controls ONLY — they change
 *  how the scripted App Server behaves, not what the envelope claims):
 *  - "bypass_subagent_gate": execute SUBAGENT-attributed command steps
 *    without ever sending a requestApproval, while main-thread steps stay
 *    honestly approval-routed (an App Server that stopped asking for
 *    approvals inside subagent threads — the exact hole the subagent
 *    gate-ordering cases exist for). */
export type CodexTransportViolation = "bypass_subagent_gate";

export interface CodexScenario extends AdapterScenario {
  rotation?: CodexRotationScript;
}

export interface CodexRecordedTurn extends ScriptedTurnObservation {
  requests: Array<{ method: string; params: unknown }>;
  responses: Array<{ id: JsonRpcId; result: unknown }>;
}

export interface CodexDouble {
  runtime: Runtime;
  recorder: { turns: CodexRecordedTurn[] };
}

export function codexDouble(
  scenarios: CodexScenario[],
  opts: { violations?: Array<EnvelopeViolation | CodexTransportViolation> } = {},
): CodexDouble {
  const recorder: CodexDouble["recorder"] = { turns: [] };
  const transportViolations = new Set<CodexTransportViolation>(
    (opts.violations ?? []).filter(
      (violation): violation is CodexTransportViolation => violation === "bypass_subagent_gate",
    ),
  );
  let next = 0;
  const inner = new CodexRuntime({
    clientFactory: () => {
      const scenario = scenarios[next++];
      if (scenario === undefined) {
        throw new Error(`codex-double: over-called — only ${scenarios.length} scenario(s) scripted`);
      }
      return new ScriptedCodexClient(scenario, recorder, transportViolations);
    },
  });
  const envelopeViolations = new Set<EnvelopeViolation>(
    (opts.violations ?? []).filter(
      (violation): violation is EnvelopeViolation =>
        violation === "fabricate_zero_usage" || violation === "mask_resume_identity",
    ),
  );
  return {
    runtime: envelopeViolations.size === 0 ? inner : new SeededEnvelopeViolationRuntime(inner, envelopeViolations),
    recorder,
  };
}

class ScriptedCodexClient implements CodexAppServerClient {
  private readonly turn: CodexRecordedTurn;
  private started = false;
  private closed = false;
  private nextApprovalId = 100;

  constructor(
    private readonly scenario: CodexScenario,
    recorder: CodexDouble["recorder"],
    private readonly transportViolations: ReadonlySet<CodexTransportViolation> = new Set(),
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
    };
    recorder.turns.push(this.turn);
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    this.turn.requests.push({ method, params });
    if (method === "thread/start" || method === "thread/resume") {
      this.turn.sessionReported = true;
      this.turn.sequence.push("emit:thread");
      return { thread: { id: this.scenario.sessionId } };
    }
    if (method === "turn/start") this.started = true;
    return {};
  }

  async notify(): Promise<void> {}

  async respond(id: JsonRpcId, result: unknown): Promise<void> {
    this.turn.responses.push({ id, result });
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<CodexServerMessage> {
    if (!this.started) throw new Error("codex-double: iterator consumed before turn/start");
    if (this.scenario.rotation !== undefined) {
      const message =
        this.scenario.rotation === "auth_loss"
          ? "refresh token expired during rotation; authentication required"
          : "protocol-valid App Server retained stale capabilities after refresh";
      this.turn.resultDelivered = true;
      this.turn.endedBy = "result";
      yield { method: "error", params: { message } };
      return;
    }

    for (const step of this.scenario.steps ?? []) {
      if (step.step === "usage") {
        this.turn.usageReported = true;
        this.turn.sequence.push("emit:usage");
        yield usageMessage(step.usage);
        continue;
      }
      if (step.step === "subagent_started") {
        yield {
          method: "item/completed",
          params: { item: { type: "subAgentActivity", kind: "started", agentThreadId: step.subagentType } },
        };
        continue;
      }
      if ((step.channel ?? "permission") === "hook") {
        throw new Error("codex-double: hook-channel scripts belong to the dedicated gate-bridge fixture");
      }
      const play: RecordedToolPlay = { step, consultations: [], executed: false };
      this.turn.toolPlays.push(play);
      if (this.transportViolations.has("bypass_subagent_gate") && step.fromSubagent === true) {
        // Seeded violation: execute the subagent's command without ever
        // sending a requestApproval — the adapter's gate never hears of it.
        play.executed = true;
        this.turn.sequence.push(`bypass:${step.tool}`, `execute:${step.tool}`);
        yield {
          method: "item/completed",
          params: {
            item: {
              type: "commandExecution",
              command: String(step.input.command ?? ""),
              exitCode: step.terminal?.success === false ? 1 : 0,
              durationMs: step.terminal?.durationMs,
            },
          },
        };
        continue;
      }
      const id = this.nextApprovalId++;
      this.turn.sequence.push(`consult:permission:${step.tool}`);
      yield {
        id,
        method: "item/commandExecution/requestApproval",
        params: { command: String(step.input.command ?? ""), reason: "scripted" },
      };
      const response = this.turn.responses.find((candidate) => candidate.id === id)?.result as
        | { decision?: string }
        | undefined;
      const allowed = response?.decision === "accept";
      const consultation: RecordedGateConsultation = {
        channel: "permission",
        toolName: step.tool,
        toolInput: step.input,
        allowed,
        reason: allowed ? undefined : "declined",
      };
      play.consultations.push(consultation);
      if (allowed) {
        play.executed = true;
        this.turn.sequence.push(`execute:${step.tool}`);
        yield {
          method: "item/completed",
          params: {
            item: {
              type: "commandExecution",
              command: String(step.input.command ?? ""),
              exitCode: step.terminal?.success === false ? 1 : 0,
              durationMs: step.terminal?.durationMs,
            },
          },
        };
      }
    }

    const outcome = this.scenario.outcome;
    if (outcome.kind === "stream_drop") {
      this.turn.endedBy = "stream_drop";
      throw new Error(outcome.message ?? "scripted App Server transport drop");
    }
    if (outcome.kind === "no_result") {
      this.turn.endedBy = "no_result";
      return;
    }
    if (outcome.usage !== "absent") {
      this.turn.usageReported = true;
      this.turn.sequence.push("emit:usage");
      yield usageMessage(outcome.usage);
    }
    this.turn.resultDelivered = true;
    this.turn.endedBy = "result";
    if (outcome.kind === "success") {
      yield { method: "item/completed", params: { item: { type: "agentMessage", text: outcome.text } } };
      yield {
        method: "turn/completed",
        params: { turn: { status: "completed", durationMs: outcome.durationMs } },
      };
    } else {
      yield {
        method: "turn/completed",
        params: {
          turn: {
            status: "failed",
            durationMs: outcome.durationMs,
            error: { message: outcome.errors.join("; ") },
          },
        },
      };
    }
    void this.closed;
  }
}

function usageMessage(usage: ScriptedUsage): CodexServerMessage {
  return {
    method: "thread/tokenUsage/updated",
    params: {
      tokenUsage: {
        last: {
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cacheReadTokens ?? 0,
          outputTokens: usage.outputTokens,
          reasoningOutputTokens: 0,
        },
      },
    },
  };
}

// Scripted `cursor-agent` stream-json transport for the REAL CursorRuntime
// (B-24 / #338). The double implements only the process boundary the adapter
// consumes — argv, the stdin payload channel, and the ordered stream-json
// lines — so contract logic (gate bridging, resume binding, usage estimation,
// budget check, gate-coverage cross-check) stays product code.
//
// The gate is NOT faked. The scripted process answers a tool step the way
// cursor-agent really does: it connects to the per-turn Unix socket the
// adapter published in `CORMIDIA_CURSOR_GATE_SOCKET` and speaks the documented
// `preToolUse` request/response, so every scenario drives the real bridge,
// the real normalization, and the real in-process GateFn.
//
// Every event shape below is a projection of bytes captured from
// cursor-agent 2026.08.04-aaa8809 on 2026-08-07 and recorded in
// research/adapters/2026-08-07_cursor-adapter-certification.md.

import { createConnection } from "node:net";
import { CursorRuntime } from "../../../src/runtime/adapters/cursor.js";
import type { CursorLaunchOptions, CursorProcess } from "../../../src/runtime/adapters/cursor-process.js";
import type { CursorStreamEvent } from "../../../src/runtime/adapters/cursor-stream.js";
import type { Runtime } from "../../../src/runtime/types.js";
import {
  SeededEnvelopeViolationRuntime,
  type AdapterScenario,
  type EnvelopeViolation,
  type RecordedGateConsultation,
  type RecordedToolPlay,
  type ScriptedToolStep,
  type ScriptedTurnObservation,
  type ScriptedUsage,
} from "./scenario.js";

/**
 * Transport-level seeded violations (negative controls ONLY — they change how
 * the scripted CLI behaves, not what the envelope claims):
 *  - "bypass_gate": run every tool step without ever calling the preToolUse
 *    hook (a cursor-agent build that stopped loading `.cursor/hooks.json`).
 *  - "bypass_subagent_gate": honour the hook for main-thread steps but run
 *    SUBAGENT-attributed steps ungated (hooks that stopped firing inside a
 *    spawned subagent's own conversation).
 *  - "broken_gate_handshake": point the bridge's hook command at a process
 *    that cannot answer, so the PRE-SPEND handshake must refuse the turn
 *    before `--force` is ever passed to a provider.
 */
export type CursorTransportViolation = "bypass_gate" | "bypass_subagent_gate" | "broken_gate_handshake";

export interface CursorRecordedTurn extends ScriptedTurnObservation {
  /** Exact argv the adapter launched with (trust/force/model/resume pins). */
  args: string[];
  cwd: string;
  /** The exact brief the adapter wrote to stdin — the payload ground truth. */
  stdinTask: string | undefined;
  /** Whether the launch environment carried a gate socket at all. */
  gateSocketPath: string | undefined;
}

export interface CursorDouble {
  runtime: Runtime;
  recorder: { turns: CursorRecordedTurn[] };
}

export function cursorDouble(
  scenarios: AdapterScenario[],
  opts: { violations?: Array<EnvelopeViolation | CursorTransportViolation> } = {},
): CursorDouble {
  const recorder: CursorDouble["recorder"] = { turns: [] };
  const declared = opts.violations ?? [];
  const transport = new Set<CursorTransportViolation>(
    declared.filter(
      (violation): violation is CursorTransportViolation =>
        violation === "bypass_gate" || violation === "bypass_subagent_gate" || violation === "broken_gate_handshake",
    ),
  );
  let next = 0;
  const inner = new CursorRuntime({
    processFactory: (launch) => {
      const scenario = scenarios[next++];
      if (scenario === undefined) {
        throw new Error(`cursor-double: over-called — only ${scenarios.length} scenario(s) scripted`);
      }
      return new ScriptedCursorProcess(scenario, launch, recorder, transport);
    },
    // A pre-existing operator-global config must not make the suite's outcome
    // depend on the developer's own machine.
    globalConfigPath: "/nonexistent/cormidia-cursor-double/cli-config.json",
    // The seeded broken bridge: a hook command that runs but cannot answer,
    // exactly like a mis-installed or crashed helper would.
    ...(transport.has("broken_gate_handshake") ? { gateHookCommand: "printf %s not-json" } : {}),
  });
  const envelope = new Set<EnvelopeViolation>(
    declared.filter(
      (violation): violation is EnvelopeViolation =>
        violation === "fabricate_zero_usage" || violation === "mask_resume_identity",
    ),
  );
  return {
    runtime: envelope.size === 0 ? inner : new SeededEnvelopeViolationRuntime(inner, envelope),
    recorder,
  };
}

class ScriptedCursorProcess implements CursorProcess {
  private readonly turn: CursorRecordedTurn;
  private task: string | undefined;
  private readonly taskWritten: Promise<void>;
  private resolveTaskWritten!: () => void;

  constructor(
    private readonly scenario: AdapterScenario,
    private readonly launch: CursorLaunchOptions,
    recorder: CursorDouble["recorder"],
    private readonly violations: ReadonlySet<CursorTransportViolation>,
  ) {
    this.turn = {
      scenario,
      args: [...launch.args],
      cwd: launch.cwd,
      stdinTask: undefined,
      gateSocketPath: launch.env["CORMIDIA_CURSOR_GATE_SOCKET"],
      sessionReported: false,
      usageReported: false,
      resultDelivered: false,
      toolPlays: [],
      sequence: [],
      endedBy: "no_result",
    };
    recorder.turns.push(this.turn);
    this.taskWritten = new Promise<void>((resolve) => {
      this.resolveTaskWritten = resolve;
    });
  }

  writeTask(task: string): void {
    this.task = task;
    this.turn.stdinTask = task;
    this.resolveTaskWritten();
  }

  events: AsyncIterable<CursorStreamEvent> = {
    [Symbol.asyncIterator]: () => this.play(),
  };

  async close(): Promise<void> {}

  private async *play(): AsyncGenerator<CursorStreamEvent, void, unknown> {
    // cursor-agent reads the prompt from stdin before it emits anything.
    await this.taskWritten;
    const sessionId = this.scenario.sessionId;
    this.turn.sessionReported = true;
    this.turn.sequence.push("emit:init");
    yield {
      type: "system",
      subtype: "init",
      apiKeySource: "login",
      cwd: this.launch.cwd,
      session_id: sessionId,
      model: "Auto",
      permissionMode: "default",
    };
    yield {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: this.task ?? "" }] },
      session_id: sessionId,
    };

    for (const step of this.scenario.steps ?? []) {
      if (step.step === "usage") {
        // cursor-agent reports usage ONLY in the terminal result; a scripted
        // mid-turn checkpoint would misrepresent the surface.
        throw new Error("cursor-double: cursor-agent emits no mid-turn usage event — script usage on the outcome");
      }
      if (step.step === "subagent_started") {
        const callId = `tool_sub_${this.turn.sequence.length}`;
        this.turn.sequence.push(`emit:subagent:${step.subagentType}`);
        yield taskEvent("started", callId, sessionId, step.subagentType, step.description);
        yield taskEvent("completed", callId, sessionId, step.subagentType, step.description);
        continue;
      }
      if ((step.channel ?? "hook") === "permission") {
        throw new Error("cursor-double: cursor-agent headless has no secondary approval channel");
      }
      yield* this.playToolStep(step, sessionId);
    }

    const outcome = this.scenario.outcome;
    if (outcome.kind === "stream_drop") {
      this.turn.endedBy = "stream_drop";
      throw new Error(outcome.message ?? "scripted cursor-agent transport drop");
    }
    if (outcome.kind === "no_result") {
      this.turn.endedBy = "no_result";
      return;
    }
    if (outcome.usage !== "absent") this.turn.usageReported = true;
    this.turn.resultDelivered = true;
    this.turn.endedBy = "result";
    this.turn.sequence.push("emit:result");
    const text = outcome.kind === "success" ? outcome.text : outcome.errors.join("; ");
    yield {
      type: "result",
      subtype: outcome.kind === "success" ? "success" : "error",
      is_error: outcome.kind !== "success",
      duration_ms: outcome.durationMs,
      duration_api_ms: outcome.durationMs,
      result: text,
      session_id: sessionId,
      request_id: `req-${sessionId}`,
      ...(outcome.usage === "absent" ? {} : { usage: usagePayload(outcome.usage) }),
    };
  }

  private async *playToolStep(step: ScriptedToolStep, sessionId: string): AsyncGenerator<CursorStreamEvent, void> {
    const play: RecordedToolPlay = { step, consultations: [], executed: false };
    this.turn.toolPlays.push(play);
    const callId = `tool_${this.turn.toolPlays.length}`;
    const kind = streamToolKind(step.tool);
    const bypass =
      this.violations.has("bypass_gate") || (this.violations.has("bypass_subagent_gate") && step.fromSubagent === true);

    if (bypass) {
      // The hole: the tool runs and the adapter's gate never hears of it.
      play.executed = true;
      this.turn.sequence.push(`bypass:${step.tool}`, `execute:${step.tool}`);
      yield toolStarted(kind, callId, sessionId, step);
      yield toolCompleted(kind, callId, sessionId, { success: successBody(kind) });
      return;
    }

    yield toolStarted(kind, callId, sessionId, step);
    this.turn.sequence.push(`consult:hook:${step.tool}`);
    const decision = await this.consultGateHook(step);
    const consultation: RecordedGateConsultation = {
      channel: "hook",
      toolName: step.tool,
      toolInput: step.input,
      allowed: decision.allow,
      reason: decision.reason,
    };
    play.consultations.push(consultation);
    if (!decision.allow) {
      this.turn.sequence.push(`denied:${step.tool}`);
      yield toolCompleted(kind, callId, sessionId, {
        rejected: {
          ...(kind === "shellToolCall"
            ? { command: String(step.input["command"] ?? ""), workingDirectory: "", isReadonly: false }
            : { path: String(step.input["file_path"] ?? step.input["path"] ?? "") }),
          reason: decision.reason ?? "denied",
        },
      });
      return;
    }
    play.executed = true;
    this.turn.sequence.push(`execute:${step.tool}`);
    yield toolCompleted(kind, callId, sessionId, { success: successBody(kind) }, step.terminal?.durationMs);
  }

  /** Speak the real preToolUse wire to the adapter's real per-turn socket. */
  private consultGateHook(step: ScriptedToolStep): Promise<{ allow: boolean; reason?: string }> {
    const socketPath = this.turn.gateSocketPath;
    if (socketPath === undefined) {
      return Promise.reject(new Error("cursor-double: the adapter published no gate socket for this turn"));
    }
    const payload = JSON.stringify({
      hook_event_name: "preToolUse",
      tool_name: hookToolName(step.tool),
      tool_input: hookToolInput(step),
      tool_use_id: `hook_${this.turn.toolPlays.length}`,
      cwd: this.launch.cwd,
      // A subagent's call arrives from the subagent's OWN conversation id —
      // the exact shape observed in certification.
      conversation_id: step.fromSubagent === true ? "subagent-conversation" : this.scenario.sessionId,
      session_id: step.fromSubagent === true ? "subagent-conversation" : this.scenario.sessionId,
    });
    return new Promise((resolve, reject) => {
      const socket = createConnection(socketPath);
      let output = "";
      socket.on("connect", () => socket.end(`${payload}\n`));
      socket.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      socket.on("error", reject);
      socket.on("end", () => {
        try {
          const parsed = JSON.parse(output) as { allow?: unknown; reason?: unknown };
          resolve({
            allow: parsed.allow === true,
            ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }
}

function hookToolName(tool: string): string {
  const normalized = tool.toLowerCase();
  if (normalized === "bash" || normalized === "shell") return "Shell";
  if (normalized === "write") return "Write";
  if (normalized === "read") return "Read";
  return tool;
}

function hookToolInput(step: ScriptedToolStep): Record<string, unknown> {
  const name = hookToolName(step.tool);
  if (name === "Shell") return { command: String(step.input["command"] ?? ""), cwd: "", timeout: 30000 };
  if (name === "Write" || name === "Read") {
    return {
      file_path: String(step.input["file_path"] ?? step.input["path"] ?? ""),
      ...(step.input["content"] === undefined ? {} : { content: step.input["content"] }),
    };
  }
  return step.input;
}

function streamToolKind(tool: string): string {
  const normalized = tool.toLowerCase();
  if (normalized === "bash" || normalized === "shell") return "shellToolCall";
  if (normalized === "write") return "editToolCall";
  if (normalized === "read") return "readToolCall";
  return `${normalized}ToolCall`;
}

function streamArgs(kind: string, step: ScriptedToolStep): Record<string, unknown> {
  if (kind === "shellToolCall") {
    return { command: String(step.input["command"] ?? ""), workingDirectory: "", timeout: 30000 };
  }
  return { path: String(step.input["file_path"] ?? step.input["path"] ?? "") };
}

function successBody(kind: string): Record<string, unknown> {
  if (kind === "shellToolCall") return { stdout: "scripted stdout", exitCode: 0 };
  if (kind === "readToolCall") return { content: "scripted content", totalLines: 1 };
  return { linesAdded: 1, linesRemoved: 0 };
}

function toolStarted(kind: string, callId: string, sessionId: string, step: ScriptedToolStep): CursorStreamEvent {
  return {
    type: "tool_call",
    subtype: "started",
    call_id: callId,
    tool_call: { [kind]: { args: streamArgs(kind, step) } },
    toolCallId: callId,
    startedAtMs: "1000",
    session_id: sessionId,
  };
}

function toolCompleted(
  kind: string,
  callId: string,
  sessionId: string,
  result: Record<string, unknown>,
  durationMs?: number,
): CursorStreamEvent {
  return {
    type: "tool_call",
    subtype: "completed",
    call_id: callId,
    tool_call: { [kind]: { result } },
    toolCallId: callId,
    startedAtMs: "1000",
    completedAtMs: String(1000 + (durationMs ?? 0)),
    session_id: sessionId,
  };
}

function taskEvent(
  subtype: "started" | "completed",
  callId: string,
  sessionId: string,
  subagentType: string,
  description: string,
): CursorStreamEvent {
  return {
    type: "tool_call",
    subtype,
    call_id: callId,
    tool_call: {
      taskToolCall: {
        args: { description, prompt: description, subagentType: { [subagentType]: {} }, model: "default" },
        ...(subtype === "completed"
          ? { result: { success: { conversationSteps: [{ assistantMessage: { text: "done" } }], agentId: callId } } }
          : {}),
      },
    },
    toolCallId: callId,
    startedAtMs: "1000",
    ...(subtype === "completed" ? { completedAtMs: "2000" } : {}),
    session_id: sessionId,
  };
}

function usagePayload(usage: ScriptedUsage): Record<string, number> {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheCreationTokens ?? 0,
  };
}

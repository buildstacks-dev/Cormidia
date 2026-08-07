// Scripted OpenCode transport for the REAL OpencodeRuntime (B-23 / CF-B23-*).
//
// The double owns provider mechanics only — server provisioning, the generated
// client's wire shapes, and the in-server plugin half. Gate routing,
// handshake fail-closed, tool-name normalization, escalation, budget, usage,
// and result mapping all remain product code running unmodified.
//
// The plugin half is deliberately NOT re-implemented: the double calls the
// shipped `requestGateDecision` from src/runtime/adapters/opencode-gate-client.ts
// over the real per-turn Unix socket, so the socket protocol, the JSON framing,
// and the fail-closed answer parsing are all under test rather than mocked.

import type { Runtime, TurnRequest } from "../../../src/runtime/types.js";
import { OpencodeRuntime } from "../../../src/runtime/adapters/opencode.js";
import { requestGateDecision } from "../../../src/runtime/adapters/opencode-gate-client.js";
import type { AdapterScenario, RecordedToolPlay, ScriptedTurnObservation, ScriptedUsage } from "./scenario.js";

/** Transport-level lies. Envelope lies live in ./scenario.ts's shared wrapper. */
export type OpencodeTransportViolation =
  /** Execute every scripted tool without asking the gate (plugin hook dead). */
  | "bypass_gate"
  /** Execute only SUBAGENT-attributed steps ungated — the exact hole the
   *  F-PT-025 probe closed, and the one a swarm harness must never reopen. */
  | "bypass_subagent_gate"
  /** Announce the gate plugin from a pid this turn never spawned. */
  | "foreign_server_pid"
  /** The plugin factory runs and announces, but the server never wires the
   *  hooks it returned — the real 1.18.15 loader failure certification found. */
  | "unwired_gate_plugin";

export interface OpencodeRecordedTurn extends ScriptedTurnObservation {
  /** Exact task bytes handed to the provider's JSON body — the payload pin. */
  promptText: string | undefined;
  promptVariant: string | undefined;
  promptModel: { providerID: string; modelID: string } | undefined;
  requestedFormat: unknown;
  resumedSessionId: string | undefined;
  aborted: boolean;
  /** The inline config the adapter handed the server (shaping evidence). */
  inlineConfig: Record<string, unknown> | undefined;
}

export interface OpencodeDouble {
  runtime: Runtime;
  recorder: { turns: OpencodeRecordedTurn[] };
}

export interface OpencodeDoubleOptions {
  violations?: OpencodeTransportViolation[];
  /** Omit the plugin handshake entirely (proves the fail-closed precondition). */
  omitGatePlugin?: boolean;
  /** Variants the scripted provider publishes for the assigned model. */
  variants?: string[];
  /** Provider/model roster; defaults to the assigned model always resolving. */
  unknownModel?: boolean;
}

const DEFAULT_VARIANTS = ["low", "medium", "high", "xhigh", "max"];

export function opencodeDouble(scenarios: AdapterScenario[], opts: OpencodeDoubleOptions = {}): OpencodeDouble {
  const violations = new Set(opts.violations ?? []);
  const recorder: OpencodeDouble["recorder"] = { turns: [] };
  let socketPath: string | undefined;
  let inlineConfig: Record<string, unknown> | undefined;

  const provisionFn = async (input: {
    inlineConfig: unknown;
    bridgeEnv: NodeJS.ProcessEnv;
  }): Promise<{ url: string; pid: number; close(): Promise<void> }> => {
    socketPath = input.bridgeEnv["CORMIDIA_OPENCODE_GATE_SOCKET"];
    inlineConfig = input.inlineConfig as Record<string, unknown>;
    if (socketPath === undefined) throw new Error("opencode-double: adapter published no gate socket");
    return { url: "http://127.0.0.1:65535", pid: process.pid, close: async () => undefined };
  };

  const clientFactory = (): never => {
    const scenario = scenarios[recorder.turns.length];
    if (scenario === undefined) {
      throw new Error(`opencode-double: over-called — only ${scenarios.length} scenario(s) scripted`);
    }
    const turn: OpencodeRecordedTurn = {
      scenario,
      sessionReported: false,
      usageReported: false,
      resultDelivered: false,
      toolPlays: [],
      sequence: [],
      endedBy: "no_result",
      promptText: undefined,
      promptVariant: undefined,
      promptModel: undefined,
      requestedFormat: undefined,
      resumedSessionId: undefined,
      aborted: false,
      inlineConfig: undefined,
    };
    recorder.turns.push(turn);
    return scriptedClient(
      turn,
      () => socketPath,
      violations,
      opts,
      () => inlineConfig,
    ) as never;
  };

  const runtime = new OpencodeRuntime({
    provisionFn: provisionFn as never,
    clientFactory,
    gateHandshakeTimeoutMs: 500,
  });
  return { runtime, recorder };
}

function scriptedClient(
  turn: OpencodeRecordedTurn,
  socket: () => string | undefined,
  violations: ReadonlySet<OpencodeTransportViolation>,
  opts: OpencodeDoubleOptions,
  config: () => Record<string, unknown> | undefined,
): Record<string, unknown> {
  const listeners: Array<(event: unknown) => void> = [];
  const messages: Array<Record<string, unknown>> = [];
  const scenario = turn.scenario;
  const emit = (event: unknown): void => {
    for (const listener of listeners) listener(event);
  };
  const announce = async (): Promise<void> => {
    if (opts.omitGatePlugin === true) return;
    const path = socket();
    if (path === undefined) throw new Error("opencode-double: no gate socket to announce on");
    await requestGateDecision(path, {
      op: "hello",
      pid: violations.has("foreign_server_pid") ? process.pid + 1 : process.pid,
      directory: "scripted",
      serverUrl: "http://127.0.0.1:65535",
    });
    // Second, separate announcement: the server invoking a hook the plugin
    // returned. `unwired_gate_plugin` scripts the loader shape certification
    // caught upstream — factory ran, hooks silently dropped.
    if (!violations.has("unwired_gate_plugin")) {
      await requestGateDecision(path, { op: "wired", pid: process.pid });
    }
    turn.sessionReported = true;
    turn.sequence.push("emit:session");
  };

  return {
    session: {
      async create(): Promise<{ data: { id: string } }> {
        await announce();
        return { data: { id: scenario.sessionId } };
      },
      async get(parameters: { sessionID: string }): Promise<{ data: { id: string } }> {
        await announce();
        turn.resumedSessionId = parameters.sessionID;
        return { data: { id: scenario.sessionId } };
      },
      async abort(): Promise<{ data: boolean }> {
        turn.aborted = true;
        turn.endedBy = "abort";
        return { data: true };
      },
      async prompt(parameters: Record<string, unknown>): Promise<{ data: unknown }> {
        turn.promptText = textOf(parameters["parts"]);
        turn.promptVariant = typeof parameters["variant"] === "string" ? parameters["variant"] : undefined;
        turn.promptModel = parameters["model"] as OpencodeRecordedTurn["promptModel"];
        turn.requestedFormat = parameters["format"];
        turn.inlineConfig = config();
        return playScenario(turn, socket, violations, emit, messages);
      },
    },
    config: {
      async providers(): Promise<{ data: unknown }> {
        if (opts.unknownModel === true) return { data: { providers: [] } };
        return {
          data: {
            providers: [
              {
                id: "scripted",
                models: {
                  "opencode-scripted-model": {
                    variants: Object.fromEntries((opts.variants ?? DEFAULT_VARIANTS).map((name) => [name, {}])),
                  },
                },
              },
            ],
          },
        };
      },
    },
    event: {
      async subscribe(): Promise<{ stream: AsyncIterable<unknown> }> {
        return { stream: pushStream(listeners) };
      },
    },
  };
}

async function playScenario(
  turn: OpencodeRecordedTurn,
  socket: () => string | undefined,
  violations: ReadonlySet<OpencodeTransportViolation>,
  emit: (event: unknown) => void,
  messages: Array<Record<string, unknown>>,
): Promise<{ data: unknown }> {
  const scenario = turn.scenario;
  const path = socket();
  if (path === undefined) throw new Error("opencode-double: gate socket vanished mid-turn");
  const parts: Array<Record<string, unknown>> = [];
  const publish = async (usage: ScriptedUsage | "absent", cost: number, id: string): Promise<void> => {
    if (usage === "absent") return;
    const info = assistantMessage(scenario.sessionId, id, usage, cost);
    messages.push(info);
    turn.usageReported = true;
    turn.sequence.push("emit:usage");
    emit({ type: "message.updated", properties: { info } });
    // Let the adapter's event-stream consumer observe this checkpoint before
    // the scripted turn moves on — the real server streams, it does not batch.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };

  for (const step of scenario.steps ?? []) {
    // A server-side abort (cancellation or the running budget guard) stops the
    // turn where it is, exactly as `session.abort` does upstream.
    if (turn.aborted) break;
    if (step.step === "usage") {
      await publish(step.usage, 0, `msg-usage-${turn.toolPlays.length}`);
      continue;
    }
    if (step.step === "subagent_started") {
      emit({
        type: "session.created",
        properties: { info: { id: `${scenario.sessionId}-child`, parentID: scenario.sessionId } },
      });
      turn.sequence.push(`emit:subagent:${step.subagentType}`);
      continue;
    }
    if ((step.channel ?? "hook") === "permission") {
      throw new Error("opencode-double: OpenCode exposes no second gate channel; script the hook");
    }
    const play: RecordedToolPlay = { step, consultations: [], executed: false };
    turn.toolPlays.push(play);
    const ungated =
      violations.has("bypass_gate") || (violations.has("bypass_subagent_gate") && step.fromSubagent === true);
    if (ungated) {
      play.executed = true;
      turn.sequence.push(`execute:${step.tool}`);
      continue;
    }
    turn.sequence.push(`consult:hook:${step.tool}`);
    const decision = await requestGateDecision(path, {
      op: "gate",
      tool: step.tool,
      sessionID: step.fromSubagent === true ? `${scenario.sessionId}-child` : scenario.sessionId,
      callID: `call-${turn.toolPlays.length}`,
      args: step.input,
    });
    play.consultations.push({
      channel: "hook",
      toolName: step.tool,
      toolInput: step.input,
      allowed: decision.allow,
      reason: decision.reason,
    });
    play.executed = decision.allow;
    turn.sequence.push(decision.allow ? `execute:${step.tool}` : `denied:${step.tool}`);
  }

  const outcome = scenario.outcome;
  if (turn.aborted) {
    // An aborted session terminates where it stands and answers with an
    // aborted-message error; the scripted terminal usage never arrives.
    turn.endedBy = "abort";
    return {
      data: {
        info: {
          id: "msg-aborted",
          sessionID: scenario.sessionId,
          role: "assistant",
          error: { name: "MessageAbortedError", data: { message: "aborted" } },
        },
        parts: [],
      },
    };
  }
  if (outcome.kind === "stream_drop") {
    turn.endedBy = "stream_drop";
    throw new Error(outcome.message ?? "scripted opencode transport drop");
  }
  if (outcome.kind === "no_result") {
    turn.endedBy = "no_result";
    return { data: undefined };
  }
  await publish(outcome.usage, outcome.costUsd, "msg-final");
  turn.resultDelivered = true;
  turn.endedBy = "result";
  const info = messages.at(-1) ?? assistantMessage(scenario.sessionId, "msg-final", "absent", 0);
  if (outcome.kind === "success") {
    parts.push({ type: "text", text: outcome.text });
    if (outcome.structuredOutput !== undefined) info["structured"] = outcome.structuredOutput;
  } else {
    info["error"] = { name: providerErrorName(outcome.code), data: { message: outcome.errors.join("; ") } };
  }
  return { data: { info, parts } };
}

function providerErrorName(code: string): string {
  if (code === "error_max_structured_output_retries") return "StructuredOutputError";
  return "UnknownError";
}

/** `"absent"` scripts a provider message that carries NO usage block at all —
 *  the honest OpenCode shape for "usage was not reported". Synthesizing zeros
 *  here would hide the very INV-006 case the detector exists to catch. */
function assistantMessage(
  sessionID: string,
  id: string,
  usage: ScriptedUsage | "absent",
  cost: number,
): Record<string, unknown> {
  if (usage === "absent") return { id, sessionID, role: "assistant" };
  return {
    id,
    sessionID,
    role: "assistant",
    cost,
    tokens: {
      input: usage.inputTokens,
      output: usage.outputTokens,
      reasoning: 0,
      cache: { read: usage.cacheReadTokens ?? 0, write: usage.cacheCreationTokens ?? 0 },
    },
  };
}

function textOf(parts: unknown): string | undefined {
  if (!Array.isArray(parts)) return undefined;
  const first = parts.find(
    (part): part is { type: string; text: string } =>
      part !== null && typeof part === "object" && (part as { type?: unknown }).type === "text",
  );
  return first?.text;
}

/** A never-ending stream the scripted transport pushes into. */
function pushStream(listeners: Array<(event: unknown) => void>): AsyncIterable<unknown> {
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  listeners.push((event) => {
    queue.push(event);
    wake?.();
  });
  return {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (queue.length > 0) yield queue.shift();
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

export function opencodeDoubleRequest(spec: Partial<TurnRequest> & Pick<TurnRequest, "workdir">): TurnRequest {
  const { workdir, ...rest } = spec;
  return {
    role: {
      name: "planner",
      runtime: "opencode",
      model: "scripted/opencode-scripted-model",
      effort: "high",
      delegation: { allow: [] },
      triggers: [],
      outputs: [],
      maxTurnBudgetUsd: 5,
      ...(rest.role ?? {}),
    },
    workdir,
    task: "scripted task",
    context: { taste: [], memoryExcerpts: [] },
    ...rest,
  };
}

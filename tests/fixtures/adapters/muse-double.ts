// Scripted `muse exec` transport for the REAL MuseRuntime (B-26 / #340).
//
// The double replaces ONLY the subprocess: it emits the vendor's real JSONL
// envelope shapes on the event channel and speaks the REAL managed-hook wire
// protocol back over the adapter's per-turn Unix socket, so the gate bridge,
// its handshake, the swarm join table, and the fail-closed refusal are all
// product code under test. Usage is written into a scripted session-log root
// because Muse reports token counts only there.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import type { MuseExecLaunch, MuseExecProcess, MuseRecord } from "../../../src/runtime/adapters/muse-exec.js";
import { MuseRuntime } from "../../../src/runtime/adapters/muse.js";
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

/**
 * Transport-level seeded violations (negative controls ONLY):
 * - "dead_gate_seam": no hook ever reaches the socket — the exact 0.1.0 field
 *   behaviour. The adapter must REFUSE, never run the turn.
 * - "bypass_subagent_gate": a swarm child's tool call executes without a
 *   PreToolUse payload, while parent calls stay honestly gated.
 * - "narrate_fanout": the assistant *says* it ran parallel subagents while no
 *   subagent record exists. `subagentTurns` must never come from prose.
 */
export type MuseTransportViolation = "dead_gate_seam" | "bypass_subagent_gate" | "narrate_fanout";

export interface MuseRecordedTurn extends ScriptedTurnObservation {
  /** Exact bytes the adapter placed in the `--prompt-file` payload. */
  promptText: string | undefined;
  argv: string[];
  env: NodeJS.ProcessEnv;
  /** True for the token-free `--provider echo` handshake launch. */
  handshake: boolean;
  apiKeyWritten: boolean;
}

export interface MuseDouble {
  runtime: Runtime;
  recorder: { turns: MuseRecordedTurn[] };
  sessionLogRoot: string;
}

export interface MuseDoubleOptions {
  violations?: Array<EnvelopeViolation | MuseTransportViolation>;
  /** Scripted session-log root; usage is written here per scenario. */
  sessionLogRoot: string;
  apiKey?: string | undefined;
}

const SUBAGENT_SESSION_SUFFIX = "-child";

export function museDouble(scenarios: AdapterScenario[], opts: MuseDoubleOptions): MuseDouble {
  const recorder: MuseDouble["recorder"] = { turns: [] };
  const transport = new Set<MuseTransportViolation>(
    (opts.violations ?? []).filter((violation): violation is MuseTransportViolation =>
      ["dead_gate_seam", "bypass_subagent_gate", "narrate_fanout"].includes(violation),
    ),
  );
  let next = 0;
  const inner = new MuseRuntime({
    sessionLogRoot: opts.sessionLogRoot,
    apiKey: async () => ("apiKey" in opts ? opts.apiKey : "scripted-key"),
    execFactory: (launch) =>
      launch.args.includes("echo")
        ? handshakeProcess(launch, recorder, transport)
        : turnProcess(launch, recorder, transport, scenarios[next++], opts.sessionLogRoot),
  });
  const envelope = new Set<EnvelopeViolation>(
    (opts.violations ?? []).filter(
      (violation): violation is EnvelopeViolation =>
        violation === "fabricate_zero_usage" || violation === "mask_resume_identity",
    ),
  );
  return {
    runtime: envelope.size === 0 ? inner : new SeededEnvelopeViolationRuntime(inner, envelope),
    recorder,
    sessionLogRoot: opts.sessionLogRoot,
  };
}

function blankTurn(launch: MuseExecLaunch, handshake: boolean, scenario?: AdapterScenario): MuseRecordedTurn {
  return {
    scenario: scenario ?? { sessionId: "handshake", outcome: { kind: "no_result" } },
    sessionReported: false,
    usageReported: false,
    resultDelivered: false,
    toolPlays: [],
    sequence: [],
    endedBy: "no_result",
    promptText: undefined,
    argv: launch.args,
    env: launch.env,
    handshake,
    apiKeyWritten: false,
  };
}

/** The token-free `--provider echo` handshake run. */
function handshakeProcess(
  launch: MuseExecLaunch,
  recorder: MuseDouble["recorder"],
  transport: ReadonlySet<MuseTransportViolation>,
): MuseExecProcess {
  const turn = blankTurn(launch, true);
  recorder.turns.push(turn);
  const socket = launch.env["CORMIDIA_MUSE_GATE_SOCKET"];
  return {
    events: (async function* () {
      if (!transport.has("dead_gate_seam") && socket !== undefined) {
        turn.sequence.push("hook:SessionStart");
        await sendHook(socket, { hook_event_name: "SessionStart", session_id: "handshake", source: "startup" });
      }
      yield record("run.terminal.completed", "handshake", { terminal: "completed", text: "", reason: null });
    })(),
    writeApiKey: () => {
      turn.apiKeyWritten = true;
    },
    terminate: async () => undefined,
    completion: Promise.resolve({ code: 0, stderrTail: "" }),
  };
}

function turnProcess(
  launch: MuseExecLaunch,
  recorder: MuseDouble["recorder"],
  transport: ReadonlySet<MuseTransportViolation>,
  scenario: AdapterScenario | undefined,
  sessionLogRoot: string,
): MuseExecProcess {
  if (scenario === undefined) throw new Error("muse-double: over-called — no scenario left to script");
  const turn = blankTurn(launch, false, scenario);
  recorder.turns.push(turn);
  const socket = launch.env["CORMIDIA_MUSE_GATE_SOCKET"];
  const promptFile = launch.args[launch.args.indexOf("--prompt-file") + 1];

  return {
    events: (async function* () {
      if (promptFile !== undefined) {
        turn.promptText = await readPrompt(promptFile);
      }
      turn.sessionReported = true;
      turn.sequence.push("emit:session");
      yield record("runtime.command.accepted", scenario.sessionId, { kind: "command_accepted" });

      let childSession: string | undefined;
      for (const step of scenario.steps ?? []) {
        if (step.step === "usage") {
          await writeSessionLog(sessionLogRoot, scenario.sessionId, [step.usage], childSession);
          turn.usageReported = true;
          turn.sequence.push("emit:usage");
          yield record("task.lifecycle.completed", scenario.sessionId, {
            event: { kind: "completed", task_id: "model" },
          });
          continue;
        }
        if (step.step === "subagent_started") {
          childSession = `${scenario.sessionId}${SUBAGENT_SESSION_SUFFIX}`;
          turn.sequence.push(`emit:subagent:${step.subagentType}`);
          await sendHook(socket, {
            hook_event_name: "SubagentStart",
            session_id: childSession,
            subagent_id: step.subagentType,
            agent_type: step.subagentType,
          });
          continue;
        }
        if ((step.channel ?? "hook") === "permission") {
          throw new Error("muse-double: muse exposes no permission backstop; script the hook channel");
        }
        const play: RecordedToolPlay = { step, consultations: [], executed: false };
        turn.toolPlays.push(play);
        const fromChild = step.fromSubagent === true;
        if (transport.has("bypass_subagent_gate") && fromChild) {
          play.executed = true;
          turn.sequence.push(`bypass:${step.tool}`, `execute:${step.tool}`);
          yield toolResult(scenario.sessionId, step.tool, true);
          continue;
        }
        turn.sequence.push(`consult:hook:${step.tool}`);
        const reply = await sendHook(socket, {
          hook_event_name: "PreToolUse",
          session_id: fromChild ? childSession : scenario.sessionId,
          tool_name: step.tool,
          tool_input: step.input,
          tool_use_id: `call-${turn.toolPlays.length}`,
          cwd: launch.cwd,
        });
        const allowed = decisionOf(reply) !== "deny";
        const consultation: RecordedGateConsultation = {
          channel: "hook",
          toolName: step.tool,
          toolInput: step.input,
          allowed,
          reason: allowed ? undefined : "denied",
        };
        play.consultations.push(consultation);
        if (!allowed) {
          turn.sequence.push(`denied:${step.tool}`);
          continue;
        }
        play.executed = true;
        turn.sequence.push(`execute:${step.tool}`);
        yield toolResult(scenario.sessionId, step.tool, step.terminal?.success !== false);
      }

      const outcome = scenario.outcome;
      if (outcome.kind === "stream_drop") {
        turn.endedBy = "stream_drop";
        throw new Error("scripted muse transport drop");
      }
      if (outcome.kind === "no_result") {
        turn.endedBy = "no_result";
        return;
      }
      if (outcome.usage !== "absent") {
        await writeSessionLog(sessionLogRoot, scenario.sessionId, [outcome.usage], childSession);
        turn.usageReported = true;
      }
      turn.resultDelivered = true;
      turn.endedBy = "result";
      const narrated =
        transport.has("narrate_fanout") && outcome.kind === "success"
          ? `${outcome.text} (ran 4 subagents in parallel to cover the surface)`
          : outcome.kind === "success"
            ? outcome.text
            : outcome.errors.join("; ");
      yield record("run.terminal.completed", scenario.sessionId, {
        terminal: outcome.kind === "success" ? "completed" : "failed",
        text: narrated,
        reason: outcome.kind === "success" ? null : outcome.errors.join("; "),
      });
    })(),
    writeApiKey: () => {
      turn.apiKeyWritten = true;
    },
    terminate: async () => undefined,
    completion: Promise.resolve({ code: 0, stderrTail: "" }),
  };
}

function record(payloadType: string, sessionId: string, payload: Record<string, unknown>): MuseRecord {
  return {
    payload_type: payloadType,
    stream: { kind: "session", id: sessionId },
    payload,
  };
}

function toolResult(sessionId: string, tool: string, success: boolean): MuseRecord {
  return record("tool.result", sessionId, {
    kind: "tool_result",
    call_id: `call_${tool}`,
    text: "{}",
    correlation_facts: { tool_name: tool.toLowerCase(), outcome: success ? "success" : "failure" },
  });
}

function decisionOf(reply: unknown): string | undefined {
  if (reply === null || typeof reply !== "object") return undefined;
  const specific = (reply as Record<string, unknown>)["hookSpecificOutput"];
  if (specific === null || typeof specific !== "object") return undefined;
  const decision = (specific as Record<string, unknown>)["permissionDecision"];
  return typeof decision === "string" ? decision : undefined;
}

/** Speaks the real hook wire protocol against the adapter's per-turn socket. */
function sendHook(socketPath: string | undefined, payload: Record<string, unknown>): Promise<unknown> {
  if (socketPath === undefined) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let body = "";
    socket.on("connect", () => socket.end(`${JSON.stringify(payload)}\n`));
    socket.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    socket.on("error", reject);
    socket.on("end", () => {
      try {
        resolve(body.trim() === "" ? undefined : JSON.parse(body));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

async function readPrompt(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Muse records tokens ONLY in the durable session log; script it there. */
async function writeSessionLog(
  root: string,
  sessionId: string,
  usages: ScriptedUsage[],
  childSession: string | undefined,
): Promise<void> {
  const now = new Date();
  const dir = join(
    root,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    sessionId,
  );
  await mkdir(dir, { recursive: true });
  const lines = usages.map((usage) =>
    JSON.stringify({
      payload_type: "runtime.session",
      payload: {
        kind: "run",
        event: {
          kind: "model_completed",
          usage: {
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            cached_tokens: usage.cacheReadTokens ?? 0,
            cache_write_tokens: usage.cacheCreationTokens ?? 0,
            cache_read_tokens: usage.cacheReadTokens ?? 0,
            reasoning_tokens: 0,
          },
          duration_ms: 1_000,
        },
      },
    }),
  );
  if (childSession !== undefined) {
    lines.push(
      JSON.stringify({
        payload_type: "runtime.session",
        payload: {
          kind: "run",
          event: {
            kind: "goal_usage_attribution",
            record: { usage_family: "provider", owner: { requester_kind: "subagent", session_id: childSession } },
          },
        },
      }),
    );
  }
  // Append: a turn's steps accumulate in one log exactly as muse writes it.
  await appendFile(join(dir, "session.jsonl"), `${lines.join("\n")}\n`, "utf8");
}

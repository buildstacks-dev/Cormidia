// In-server half of OpencodeRuntime's gate bridge.
//
// OpenCode loads this module as a plugin inside the `opencode serve` process it
// was told to run (config `plugin: ["file://…"]`). Three obligations:
//
//  1. Announce itself over the per-turn Unix socket, and then announce again
//     from a hook OpenCode itself invokes. Certification on 2026-08-07 showed
//     why both are needed: a module whose factory runs can still have its hooks
//     silently dropped, and the factory's own message cannot tell the two apart.
//     OpencodeRuntime waits for the hook-sourced `wired` message before any
//     prompt, so a plugin that gates nothing can never be mistaken for one that
//     does (INV-002 fail closed).
//  2. Route EVERY tool execution through `tool.execute.before` to Cormidia's
//     in-process GateFn and throw on denial. The F-PT-025 probe showed a
//     bash-only gate does not contain the model: with bash blocked it achieved
//     the same effect through `read`. No tool is exempt here — the parent
//     decides, this half only asks. The hook also fires for tools issued by
//     subagents in child sessions, which is what makes the fan-out claim
//     enforceable rather than advisory.
//  3. Export the plugin factory and NOTHING else. OpenCode invokes every export
//     as a factory, so an exported helper breaks hook wiring — see
//     ./opencode-gate-client.ts.
//
// Every failure path denies. A socket that cannot be reached, a malformed
// answer, or a timeout all raise, and OpenCode surfaces the throw as a
// pre-execution tool error.

import { requestGateDecision, toMessage } from "./opencode-gate-client.js";

const SOCKET_ENV = "CORMIDIA_OPENCODE_GATE_SOCKET";
const SENTINEL_ENV = "CORMIDIA_OPENCODE_CONTEXT_SENTINELS";

/** Structural shapes only: the plugin never imports @opencode-ai/plugin, so a
 *  vendor type change cannot break the gate seam or add a dependency. */
interface PluginInput {
  directory?: string;
  worktree?: string;
  serverUrl?: unknown;
}

interface ToolExecuteBeforeInput {
  tool: string;
  sessionID: string;
  callID: string;
}

/**
 * OpenCode plugin entry point. Named and default exported because OpenCode
 * loads every exported plugin factory in a module — and only factories.
 */
export const CormidiaGatePlugin = async (input: PluginInput): Promise<Record<string, unknown>> => {
  const socketPath = process.env[SOCKET_ENV];
  if (socketPath === undefined || socketPath.length === 0) {
    throw new Error(`Cormidia gate plugin loaded without ${SOCKET_ENV}; refusing to run an ungated OpenCode server`);
  }
  await requestGateDecision(socketPath, {
    op: "hello",
    pid: process.pid,
    directory: input.directory ?? "",
    worktree: input.worktree ?? "",
    serverUrl: input.serverUrl === undefined ? "" : String(input.serverUrl),
  });
  let announced = false;

  // Proof of wiring: OpenCode calls these itself, so an arrival means the
  // returned hooks object was accepted, not merely that the factory ran.
  // `config` fires while the server assembles this app instance, which is the
  // earliest deterministic callback; `event` is the belt-and-braces second
  // source in case a future release stops calling `config`.
  const wired = async (): Promise<void> => {
    if (announced) return;
    announced = true;
    try {
      await requestGateDecision(socketPath, { op: "wired", pid: process.pid });
    } catch {
      announced = false;
    }
  };

  return {
    config: wired,
    event: wired,
    "tool.execute.before": async (call: ToolExecuteBeforeInput, output: { args: unknown }): Promise<void> => {
      let answer: { allow: boolean; reason?: string };
      try {
        answer = await requestGateDecision(socketPath, {
          op: "gate",
          tool: call.tool,
          sessionID: call.sessionID,
          callID: call.callID,
          args: output.args,
        });
      } catch (error) {
        throw new Error(`Cormidia gate bridge failed closed: ${toMessage(error)}`);
      }
      if (!answer.allow) throw new Error(answer.reason ?? "Cormidia gate denied the tool action");
    },
    // Hermeticity evidence channel. Reports only counts and which pre-declared
    // sentinel strings were observed — never the system prompt itself — so the
    // certification lane can prove ambient operator rules did not reach the
    // turn. Silent (and sentinel-free) in ordinary operation.
    "experimental.chat.system.transform": async (
      call: { sessionID?: string },
      output: { system: string[] },
    ): Promise<void> => {
      const raw = process.env[SENTINEL_ENV];
      let declared: string[] = [];
      if (raw !== undefined && raw.length > 0) {
        try {
          const parsed: unknown = JSON.parse(raw);
          declared = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
        } catch {
          declared = [];
        }
      }
      const joined = output.system.join("\n");
      try {
        await requestGateDecision(socketPath, {
          op: "system",
          sessionID: call.sessionID ?? "",
          parts: output.system.length,
          bytes: joined.length,
          observedSentinels: declared.filter((sentinel) => joined.includes(sentinel)),
        });
      } catch {
        // Observation only: never fail a turn because the evidence channel
        // hiccuped. Enforcement lives in tool.execute.before.
      }
    },
  };
};

export default CormidiaGatePlugin;

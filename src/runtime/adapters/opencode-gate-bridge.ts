// Parent-process half of OpencodeRuntime's tool gate.
//
// OpenCode's only in-process pre-execution seam is the plugin hook
// `tool.execute.before`. The plugin (./opencode-gate-plugin.ts) runs inside the
// server process, so the decision has to cross a process boundary: a per-turn
// Unix socket, the same shape codex-gate-bridge.ts uses for Codex hooks.
//
// Two claims this file is responsible for:
//  - FAIL CLOSED ON ABSENCE. `whenActive()` is awaited before the first prompt
//    and a missing announcement is a typed terminal error, never a silently
//    ungated turn.
//  - EVERY TOOL, NOT JUST BASH. The F-PT-025 probe (2026-08-07) showed a model
//    routing around a bash-only gate through `read`. Every tool OpenCode 1.18.x
//    can execute is listed in OPENCODE_TOOLS and routed here; an id absent from
//    that list still reaches the gate, so a new upstream tool fails safe.

import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolUseEvent } from "../tool-events.js";
import type { GateEscalation, ToolAction, TurnHooks } from "../types.js";
import { normalizeToolAction } from "./claude.js";
import { classifierThrowDenial } from "./gate-bridge-escalation.js";
import { closeServer, listen } from "./gate-bridge-net.js";

const MAX_BRIDGE_BYTES = 8 * 1024 * 1024;

/** Every tool id `opencode 1.18.15` can execute, read from the running
 *  server's own `/experimental/tool` roster on 2026-08-07. Documentation only:
 *  routing does not consult it, so an id added upstream is still gated. */
export const OPENCODE_TOOLS = [
  "apply_patch",
  "bash",
  "edit",
  "glob",
  "grep",
  "invalid",
  "question",
  "read",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
] as const;

/** Intra-turn fan-out spawn. Allowed at the adapter boundary exactly like
 *  ClaudeRuntime's SUBAGENT_SPAWN_TOOLS: spawning is not an external effect,
 *  and every tool the child session then runs comes back through this bridge
 *  (proven by the F-PT-025 probe and re-proven by the certification walk). */
const SUBAGENT_SPAWN_TOOLS = new Set(["task"]);

export interface OpencodeSystemObservation {
  sessionID: string;
  parts: number;
  bytes: number;
  observedSentinels: string[];
}

export interface OpencodeGateHandshake {
  /** OS pid of the process the plugin loaded into — the server-identity proof. */
  pid: number;
  directory: string;
  serverUrl: string;
}

export interface OpencodeGateBridge {
  socketPath: string;
  env: NodeJS.ProcessEnv;
  /**
   * Resolves only once the plugin's own HOOKS have been invoked by the server,
   * not merely once its factory ran. Certification on 2026-08-07 found a
   * loader shape where the factory executed — announcing itself — while its
   * returned hooks were dropped, leaving tools completely ungated. A
   * factory-sourced handshake cannot distinguish those two worlds, so the
   * precondition is the hook-sourced one.
   */
  whenActive(timeoutMs: number): Promise<OpencodeGateHandshake>;
  /** System-prompt observations reported by the plugin (hermeticity evidence). */
  readonly systemObservations: OpencodeSystemObservation[];
  /** Intra-turn subagent spawns observed at the gate. Fan-out is never silent
   *  (TurnUsage.subagentTurns), and the spawn is only visible here because the
   *  adapter allows it at the bridge rather than at the org gate. */
  subagentTurns(): number;
  close(): Promise<void>;
}

export class OpencodeGatePluginInactiveError extends Error {
  readonly code = "error_gate_plugin_inactive";
  constructor(timeoutMs: number, loaded: boolean) {
    super(
      loaded
        ? `OpencodeRuntime: the Cormidia gate plugin loaded but the server never invoked its hooks ` +
            `within ${timeoutMs}ms; refusing to prompt a server whose tool gate is unproven`
        : `OpencodeRuntime: the Cormidia gate plugin did not announce itself within ${timeoutMs}ms; ` +
            `refusing to prompt an OpenCode server whose tool gate is unproven`,
    );
    this.name = "OpencodeGatePluginInactiveError";
  }
}

/** Map OpenCode's tool arguments onto the shared normalizer's vocabulary so one
 *  ToolAction shape reaches the gate from every adapter. `apply_patch` expands
 *  into one action per touched file, mirroring the Codex bridge. */
export function normalizeOpencodeToolActions(tool: string, args: unknown, workdir: string): ToolAction[] {
  const input =
    args !== null && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  const name = tool.toLowerCase();
  if (name === "apply_patch") {
    const patch = typeof input["patchText"] === "string" ? input["patchText"] : "";
    const actions: ToolAction[] = [];
    for (const match of patch.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) {
      actions.push({ tool: match[1] === "Add" ? "write" : "edit", input: { path: match[2]?.trim() ?? "" } });
    }
    return actions.length > 0 ? actions : [{ tool: "edit", input: { path: "." } }];
  }
  const claudeShaped: Record<string, unknown> = { ...input };
  if (typeof input["filePath"] === "string") claudeShaped["file_path"] = input["filePath"];
  if (typeof input["oldString"] === "string") claudeShaped["old_string"] = input["oldString"];
  if (typeof input["newString"] === "string") claudeShaped["new_string"] = input["newString"];
  return [normalizeToolAction(name, claudeShaped, workdir)];
}

export async function startOpencodeGateBridge(
  workdir: string,
  hooks: TurnHooks,
  escalations: GateEscalation[],
): Promise<OpencodeGateBridge> {
  // macOS caps Unix-domain socket paths near 100 bytes; campaign TMPDIRs are
  // deep content-addressed paths, so use the short system socket root.
  const socketRoot = process.platform === "win32" ? tmpdir() : "/tmp";
  const directory = await mkdtemp(join(socketRoot, "cormidia-og-"));
  const socketPath = join(directory, "gate.sock");
  const sockets = new Set<Socket>();
  const systemObservations: OpencodeSystemObservation[] = [];
  let subagentTurns = 0;
  let loaded: OpencodeGateHandshake | undefined;
  let announce: ((handshake: OpencodeGateHandshake) => void) | undefined;
  const active = new Promise<OpencodeGateHandshake>((resolve) => {
    announce = resolve;
  });

  /** The action under gate classification when a throw happens; reset per
   *  request in `consume` below. Safe as bridge-scope state because every
   *  decide/consume pair runs synchronously on one thread. */
  let classifying: ToolAction | undefined;
  const decide = (request: Record<string, unknown>): { allow: boolean; reason?: string } => {
    if (request["op"] === "hello") {
      loaded = {
        pid: typeof request["pid"] === "number" ? request["pid"] : -1,
        directory: typeof request["directory"] === "string" ? request["directory"] : "",
        serverUrl: typeof request["serverUrl"] === "string" ? request["serverUrl"] : "",
      };
      return { allow: true };
    }
    if (request["op"] === "wired") {
      // The server invoked a hook this plugin returned: the gate is live.
      if (loaded !== undefined) announce?.(loaded);
      return { allow: true };
    }
    if (request["op"] === "system") {
      systemObservations.push({
        sessionID: typeof request["sessionID"] === "string" ? request["sessionID"] : "",
        parts: typeof request["parts"] === "number" ? request["parts"] : 0,
        bytes: typeof request["bytes"] === "number" ? request["bytes"] : 0,
        observedSentinels: Array.isArray(request["observedSentinels"])
          ? request["observedSentinels"].filter((value): value is string => typeof value === "string")
          : [],
      });
      return { allow: true };
    }
    if (request["op"] !== "gate") throw new Error(`unsupported bridge op ${JSON.stringify(request["op"])}`);
    const tool = typeof request["tool"] === "string" ? request["tool"] : "";
    if (tool === "") throw new Error("gate request carries no tool name");
    if (SUBAGENT_SPAWN_TOOLS.has(tool.toLowerCase())) {
      subagentTurns += 1;
      hooks.onEvent?.({
        type: "subagent",
        detail: `subagent started: ${subagentType(request)}`,
        name: subagentType(request),
        phase: "started",
        ...(typeof request["callID"] === "string" ? { spanId: request["callID"] } : {}),
      });
      return { allow: true };
    }
    let allow = true;
    let reason: string | undefined;
    for (const action of normalizeOpencodeToolActions(tool, request["args"], workdir)) {
      classifying = action;
      const decision = hooks.gate(action);
      if (decision.allow) {
        hooks.onEvent?.(toolUseEvent(action));
        continue;
      }
      allow = false;
      reason ??= decision.reason;
      if (decision.escalate) escalations.push({ action, reason: decision.reason });
    }
    return { allow, ...(allow ? {} : { reason: reason ?? "Cormidia gate denied the tool action" }) };
  };

  // Newline-delimited both ways, and the caller never half-closes: the client
  // half runs inside OpenCode on Bun, where ending the writable side tears the
  // socket down before the answer can be read (see ./opencode-gate-client.ts).
  const server = createServer((socket) => {
    sockets.add(socket);
    let body = "";
    let answered = false;
    const answer = (decision: { allow: boolean; reason?: string }): void => {
      if (answered) return;
      answered = true;
      socket.write(`${JSON.stringify(decision)}\n`);
    };
    const consume = (): void => {
      if (answered) return;
      const newline = body.indexOf("\n");
      if (newline < 0) return;
      classifying = undefined;
      try {
        const parsed: unknown = JSON.parse(body.slice(0, newline).trim());
        if (parsed === null || typeof parsed !== "object") throw new Error("bridge request is not an object");
        answer(decide(parsed as Record<string, unknown>));
      } catch (error) {
        // Deny AND escalate (INV-015 seed (c), F-PT-036): a throwing classifier
        // is an anomaly a human must see, never a silent universal refusal.
        answer(classifierThrowDenial(escalations, classifying, "OpenCode", error));
      }
    };
    socket.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > MAX_BRIDGE_BYTES) {
        answer({ allow: false, reason: "Cormidia gate input exceeded 8 MiB" });
        return;
      }
      consume();
    });
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    socket.on("end", consume);
  });

  try {
    await listen(server, socketPath);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  let closing: Promise<void> | undefined;
  return {
    socketPath,
    env: { CORMIDIA_OPENCODE_GATE_SOCKET: socketPath },
    systemObservations,
    subagentTurns: () => subagentTurns,
    whenActive: (timeoutMs: number) =>
      new Promise<OpencodeGateHandshake>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new OpencodeGatePluginInactiveError(timeoutMs, loaded !== undefined)),
          timeoutMs,
        );
        void active.then((handshake) => {
          clearTimeout(timer);
          resolve(handshake);
        });
      }),
    close: async () => {
      closing ??= (async () => {
        for (const socket of sockets) socket.destroy();
        await closeServer(server);
        await rm(directory, { recursive: true, force: true });
      })();
      return closing;
    },
  };
}

function subagentType(request: Record<string, unknown>): string {
  const args = request["args"];
  if (args !== null && typeof args === "object" && !Array.isArray(args)) {
    const value = (args as Record<string, unknown>)["subagent_type"];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "task";
}

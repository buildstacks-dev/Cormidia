// Parent-process half of CursorRuntime's preToolUse gate bridge.
//
// cursor-agent's headless (`-p`) stream-json surface is fire-and-forget: it
// emits no approval request a wrapper could answer. Its `.cursor/hooks.json`
// machinery IS live headless, though — certified 2026-08-07 against build
// 2026.08.04-aaa8809 (research/adapters/2026-08-07_cursor-adapter-certification.md):
// `preToolUse` fires before Shell, Read, Write, Grep/Glob and Task calls,
// including calls issued inside a spawned subagent's OWN conversation, and a
// `{"permission":"deny"}` reply stops the action before it executes (proven by
// side-effect absence, not by the model's own report).
//
// `cursor-gate-handshake.ts` owns the pre-spend proof that makes `--force`
// safe to pass; this module owns the socket, the per-turn config lifecycle,
// and the normalization from a hook payload to a gate-classifiable action.

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateEscalation, ToolAction, TurnHooks } from "../types.js";
import { writeMaskedWorktreeFile } from "../worktree-context.js";
import { normalizeToolAction } from "./claude.js";
import { classifierThrowDenial } from "./gate-bridge-escalation.js";
import { closeServer, listen } from "./gate-bridge-net.js";
import {
  assertGlobalConfigNotWiderThanRole,
  assertNoConflictingCursorConfig,
  CURSOR_CLI_CONFIG_RELATIVE_PATH,
  CURSOR_HOOKS_RELATIVE_PATH,
  cursorCliConfigJson,
  cursorHooksJson,
} from "./cursor-config.js";
import {
  CursorGateBridgeUnavailableError,
  cursorGateHookCommand,
  cursorHandshakeProbe,
  runCursorGateHandshake,
} from "./cursor-gate-handshake.js";

const MAX_BRIDGE_BYTES = 8 * 1024 * 1024;

export interface CursorGateBridge {
  socketPath: string;
  env: NodeJS.ProcessEnv;
  /** Gate consultations answered on this turn's socket. */
  readonly consulted: number;
  /** Consultations this turn's gate ALLOWED. The adapter compares executed
   *  tool calls against this: more executions than allowances means Cursor ran
   *  something the gate never classified. */
  readonly allowed: number;
  close(): Promise<void>;
}

export interface CursorGateBridgeOptions {
  /** Native deny rules composed from src/runtime/role-shaping.ts. */
  denyRules: readonly string[];
  /** Test-only override for the hook command Cursor is told to run. */
  hookCommand?: string;
  /** Test-only override for the operator-global config path. */
  globalConfigPath?: string;
}

export async function startCursorGateBridge(
  workdir: string,
  hooks: TurnHooks,
  escalations: GateEscalation[],
  options: CursorGateBridgeOptions,
): Promise<CursorGateBridge> {
  assertNoConflictingCursorConfig(workdir);
  assertGlobalConfigNotWiderThanRole(options.denyRules, options.globalConfigPath);

  // macOS caps Unix-domain socket paths near 100 bytes and campaign scratch
  // roots are deliberately long, so the socket lives under the short system
  // socket root and is removed at turn end (mirrors the Codex bridge).
  const socketRoot = process.platform === "win32" ? tmpdir() : "/tmp";
  const directory = await mkdtemp(join(socketRoot, "cormidia-cu-"));
  const socketPath = join(directory, "gate.sock");
  const nonce = randomUUID();
  const state = { consulted: 0, allowed: 0 };
  const sockets = new Set<Socket>();
  const server = createServer((socket) =>
    serveConnection(socket, sockets, { workdir, hooks, escalations, nonce, state }),
  );

  const env: NodeJS.ProcessEnv = { CORMIDIA_CURSOR_GATE_SOCKET: socketPath };
  const hookCommand = options.hookCommand ?? cursorGateHookCommand();
  try {
    await listen(server, socketPath);
    writeMaskedWorktreeFile(workdir, CURSOR_HOOKS_RELATIVE_PATH, `${cursorHooksJson(hookCommand)}\n`);
    writeMaskedWorktreeFile(workdir, CURSOR_CLI_CONFIG_RELATIVE_PATH, `${cursorCliConfigJson(options.denyRules)}\n`);
    await runCursorGateHandshake(hookCommand, workdir, env, nonce);
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await closeServer(server);
    await rm(directory, { recursive: true, force: true });
    await removeTurnConfig(workdir);
    throw error instanceof CursorGateBridgeUnavailableError
      ? error
      : new CursorGateBridgeUnavailableError(error instanceof Error ? error.message : String(error));
  }

  let closing: Promise<void> | undefined;
  return {
    socketPath,
    env,
    get consulted() {
      return state.consulted;
    },
    get allowed() {
      return state.allowed;
    },
    close: async () => {
      closing ??= (async () => {
        for (const socket of sockets) socket.destroy();
        await closeServer(server);
        await rm(directory, { recursive: true, force: true });
        // The per-turn config is Cormidia's, not the app's: remove it so a
        // later non-Cormidia `cursor-agent` run in the same worktree does not
        // inherit a dead socket path and fail closed on every tool call.
        await removeTurnConfig(workdir);
      })();
      return closing;
    },
  };
}

interface ConnectionContext {
  workdir: string;
  hooks: TurnHooks;
  escalations: GateEscalation[];
  nonce: string;
  state: { consulted: number; allowed: number };
}

function serveConnection(socket: Socket, sockets: Set<Socket>, context: ConnectionContext): void {
  sockets.add(socket);
  let body = "";
  let answered = false;
  const answer = (decision: { allow: boolean; reason?: string }): void => {
    if (answered) return;
    answered = true;
    socket.end(JSON.stringify(decision));
  };
  socket.on("data", (chunk: Buffer) => {
    body += chunk.toString("utf8");
    if (body.length > MAX_BRIDGE_BYTES) answer({ allow: false, reason: "Cormidia gate input exceeded 8 MiB" });
  });
  socket.on("error", () => undefined);
  socket.on("close", () => sockets.delete(socket));
  socket.on("end", () => {
    if (answered) return;
    let classifying: ToolAction | undefined;
    try {
      const input: unknown = JSON.parse(body.trim());
      const probe = cursorHandshakeProbe(input, context.nonce);
      if (probe !== undefined) {
        // Handshake traffic never reaches the org gate and never counts as a
        // consultation — it proves the wire, not a real tool action.
        answer(probe === "allow" ? { allow: true } : { allow: false, reason: "Cormidia gate handshake probe" });
        return;
      }
      const action = normalizeCursorHookAction(input, context.workdir);
      classifying = action;
      context.state.consulted += 1;
      const decision = context.hooks.gate(action);
      if (decision.allow) {
        context.state.allowed += 1;
        // No tool_use event here: cursor-agent's stream reports each call's
        // real outcome post-execution and CursorRuntime emits from that
        // (codex-like). Emitting on allow too would double-count tool_counts.
        answer({ allow: true });
        return;
      }
      if (decision.escalate) context.escalations.push({ action, reason: decision.reason });
      answer({ allow: false, reason: decision.reason });
    } catch (error) {
      // Deny AND escalate (INV-015 seed (c), F-PT-036): a throwing classifier
      // is an anomaly a human must see, never a silent universal refusal.
      answer(classifierThrowDenial(context.escalations, classifying, "Cursor", error));
    }
  });
}

/**
 * Normalize one `preToolUse` payload into the provider-neutral ToolAction the
 * gate classifies. Cursor's tool vocabulary maps onto the names the other
 * adapters use so one set of gate rules and role denies covers every harness:
 * `Shell` is the same act as Codex's `Bash`.
 */
export function normalizeCursorHookAction(input: unknown, workdir: string): ToolAction {
  if (!isRecord(input)) throw new Error("hook input is not an object");
  const rawName = typeof input["tool_name"] === "string" ? input["tool_name"] : "";
  if (rawName === "") throw new Error("hook input carries no tool_name");
  const rawInput = input["tool_input"];
  return normalizeToolAction(cursorToolName(rawName), isRecord(rawInput) ? rawInput : {}, workdir);
}

function cursorToolName(rawName: string): string {
  if (rawName.toLowerCase().startsWith("mcp:")) {
    // `MCP:server:tool` → the `mcp__server__tool` spelling the composed gate
    // and the Codex bridge already recognize.
    return `mcp__${rawName.slice(4).split(":").filter(Boolean).join("__")}`;
  }
  return rawName === "Shell" ? "bash" : rawName;
}

async function removeTurnConfig(workdir: string): Promise<void> {
  await rm(join(workdir, CURSOR_HOOKS_RELATIVE_PATH), { force: true });
  await rm(join(workdir, CURSOR_CLI_CONFIG_RELATIVE_PATH), { force: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Parent-process half of GrokRuntime's gate bridge.
//
// Why a hook and not the ACP permission request (F-PT-027, probed 2026-08-07):
// `session/request_permission` covers only what grok's permission pipeline
// decides to ask about. Read-only tools (`read_file`, `list_dir`, `grep`) never
// reach it, and a persisted `[ui] permission_mode = "always-approve"` — which a
// real operator config does carry — suppresses every request with no
// client-visible difference. A `PreToolUse` hook is evaluated FIRST, ahead of
// permission rules, remembered grants, built-in read-only auto-approvals and
// the prompt policy, in every permission mode (grok user guide, "How a tool
// call is authorized"), so it is the only surface that sees every tool action.
// The ACP request path stays wired as a backstop.
//
// Why the handshake exists: grok's hook runner fails OPEN on every handler
// failure — timeout, crash, malformed output, missing file. "No hook fired" is
// therefore indistinguishable from "no tool was attempted" unless something
// proves the hook path is live. A `SessionStart` handler through the same
// socket supplies that proof before the first paid token; the adapter refuses
// the turn without it.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolUseEvent } from "../tool-events.js";
import type { GateEscalation, TurnHooks } from "../types.js";
import { grokIsolationEnv, turnIsolatedGrokHome } from "./grok-isolation.js";
import { normalizeGrokHookActions } from "./grok-tool-actions.js";

const MAX_BRIDGE_BYTES = 8 * 1024 * 1024;

export interface GrokGateBridge {
  socketPath: string;
  /** Per-turn isolated provider home; also where the hook config lives. */
  grokHome: string;
  /** Environment additions for the `grok agent stdio` child. */
  env: NodeJS.ProcessEnv;
  /** Resolves true once the SessionStart handler reached this socket. */
  awaitHandshake(timeoutMs: number): Promise<boolean>;
  /** Session id grok itself reported through the handshake — ground truth for
   *  resume identity, never an echo of what the client asked for. */
  observedSessionId(): string | undefined;
  /** Permission mode grok resolved for this session, from the hook envelope. */
  observedPermissionMode(): string | undefined;
  /** How many tool actions traversed the gate this turn. */
  gatedToolCount(): number;
  close(): Promise<void>;
}

export interface GrokGateBridgeOptions {
  /** Provider home to copy `auth.json` from. Defaults to the operator's. */
  sourceGrokHome?: string;
  /** Test seam: run the hook helper through this command instead of node. */
  hookCommand?: string;
}

export async function startGrokGateBridge(
  workdir: string,
  hooks: TurnHooks,
  escalations: GateEscalation[],
  options: GrokGateBridgeOptions = {},
): Promise<GrokGateBridge> {
  // macOS caps Unix-domain socket paths near 100 bytes, so the socket lives in
  // the short system root; the provider home sits beside it.
  const socketRoot = process.platform === "win32" ? tmpdir() : "/tmp";
  const directory = await mkdtemp(join(socketRoot, "cormidia-gg-"));
  const socketPath = join(directory, "gate.sock");
  // The socket is per-turn and removed at close; the provider home is stable
  // per workdir, because grok keeps session transcripts inside it and exact
  // resume is part of the contract (see turnIsolatedGrokHome).
  const { grokHome, isolatedHome } = await turnIsolatedGrokHome(workdir, options.sourceGrokHome);

  const core = createGrokGateCore(workdir, hooks, escalations);
  const sockets = new Set<Socket>();

  const server = createServer((socket) => {
    sockets.add(socket);
    let body = "";
    let answered = false;
    const answer = (decision: Record<string, unknown>): void => {
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
      try {
        const input: unknown = JSON.parse(body.trim());
        answer(core.handle(isRecord(input) ? input : {}));
      } catch (error) {
        answer({
          allow: false,
          reason: `Cormidia Grok gate bridge failed closed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
  });

  try {
    await mkdir(join(grokHome, "hooks"), { recursive: true });
    await writeFile(join(grokHome, "hooks", "cormidia-gate.json"), `${grokHookConfig(options.hookCommand)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await listen(server, socketPath);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  let closing: Promise<void> | undefined;
  return {
    socketPath,
    grokHome,
    env: { ...grokIsolationEnv(grokHome, isolatedHome), CORMIDIA_GROK_GATE_SOCKET: socketPath },
    awaitHandshake: (timeoutMs: number) => core.awaitHandshake(timeoutMs),
    observedSessionId: () => core.observedSessionId(),
    observedPermissionMode: () => core.observedPermissionMode(),
    gatedToolCount: () => core.gatedToolCount(),
    close: async () => {
      closing ??= (async () => {
        core.release();
        for (const socket of sockets) socket.destroy();
        await closeServer(server);
        await rm(directory, { recursive: true, force: true });
      })();
      return closing;
    },
  };
}

/**
 * The decision half of the bridge, independent of the socket that carries it.
 *
 * Kept separate so the L1 transport double can drive the SAME classification
 * the real hook path uses: a double that reimplemented this would drift, and
 * the gate claim would then be proven against a copy rather than the product.
 */
export function createGrokGateCore(workdir: string, hooks: TurnHooks, escalations: GateEscalation[]): GrokGateCore {
  const state = { handshake: false, sessionId: undefined as string | undefined, mode: undefined as string | undefined };
  const waiters: Array<(value: boolean) => void> = [];
  let gatedTools = 0;
  return {
    handle(envelope: Record<string, unknown>): Record<string, unknown> {
      const event = typeof envelope["hookEventName"] === "string" ? envelope["hookEventName"] : "";
      if (event === "session_start") {
        state.handshake = true;
        if (typeof envelope["sessionId"] === "string") state.sessionId = envelope["sessionId"];
        if (typeof envelope["permissionMode"] === "string") state.mode = envelope["permissionMode"];
        for (const waiter of waiters.splice(0)) waiter(true);
        return { passive: true };
      }
      if (event !== "pre_tool_use") {
        return { allow: false, reason: `Cormidia gate received an unexpected hook event ${JSON.stringify(event)}` };
      }
      gatedTools += 1;
      let allow = true;
      let reason: string | undefined;
      try {
        for (const action of normalizeGrokHookActions(envelope, workdir)) {
          const decision = hooks.gate(action);
          hooks.onEvent?.(toolUseEvent(action));
          if (decision.allow) continue;
          allow = false;
          reason ??= decision.reason;
          if (decision.escalate) escalations.push({ action, reason: decision.reason });
        }
      } catch (error) {
        // An envelope Cormidia cannot classify (an unknown shape, or grok's
        // ungateable fan-out route) is DENIED, never waved through: grok's own
        // hook runner fails open, so failing closed here is the whole point.
        return {
          allow: false,
          reason: `Cormidia Grok gate failed closed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      return { allow, ...(allow ? {} : { reason: reason ?? "Cormidia gate denied the tool action" }) };
    },
    awaitHandshake: (timeoutMs: number) =>
      state.handshake
        ? Promise.resolve(true)
        : new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(state.handshake), timeoutMs);
            waiters.push((value) => {
              clearTimeout(timer);
              resolve(value);
            });
          }),
    observedSessionId: () => state.sessionId,
    observedPermissionMode: () => state.mode,
    gatedToolCount: () => gatedTools,
    release: () => {
      for (const waiter of waiters.splice(0)) waiter(state.handshake);
    },
  };
}

export interface GrokGateCore {
  /** Classify one grok hook envelope; returns grok's own decision shape. */
  handle(envelope: Record<string, unknown>): Record<string, unknown>;
  awaitHandshake(timeoutMs: number): Promise<boolean>;
  observedSessionId(): string | undefined;
  observedPermissionMode(): string | undefined;
  gatedToolCount(): number;
  /** Settle every pending handshake waiter at turn teardown. */
  release(): void;
}

/**
 * Per-turn hook configuration, written into the isolated provider home's
 * always-trusted global hook directory. `SessionStart` is the handshake — it
 * fires for both `session/new` and `session/load`, with `source` naming which —
 * and `PreToolUse` with no matcher covers every tool grok can call.
 */
function grokHookConfig(hookCommand = grokGateHookCommand()): string {
  return JSON.stringify(
    {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: hookCommand, timeout: 20 }] }],
        PreToolUse: [{ hooks: [{ type: "command", command: hookCommand, timeout: 20 }] }],
      },
    },
    null,
    2,
  );
}

function grokGateHookCommand(): string {
  const adapterPath = fileURLToPath(import.meta.url);
  const sourceMode = adapterPath.endsWith(".ts");
  const helperPath = join(dirname(adapterPath), `grok-gate-hook.${sourceMode ? "ts" : "js"}`);
  const argv = sourceMode
    ? [process.execPath, "--import", createRequire(import.meta.url).resolve("tsx"), helperPath]
    : [process.execPath, helperPath];
  return argv.map(shellQuote).join(" ");
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error): void => reject(error);
    server.once("error", fail);
    server.listen(socketPath, () => {
      server.off("error", fail);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Parent-process half of CodexRuntime's PreToolUse bridge.
//
// App Server approval callbacks do not see auto-approved commands such as
// `cat .env`. Codex hooks do see supported simple Bash/apply_patch/MCP calls,
// so a per-turn Unix socket carries those calls back into Cormidia's in-process
// GateFn. The child hook fails closed. Code mode (`exec`), `unified_exec`,
// apps, and web search are disabled by codexAppServerArgs because current
// Codex hooks do not expose their nested effects in a shape the gate can
// classify completely. The matcher still names `exec` as defense in depth:
// if a provider/version ignores the disable, the normalizer below throws and
// the bridge denies the whole call.

import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GateEscalation, ToolAction, TurnHooks } from "../types.js";
import { toolUseEvent } from "../tool-events.js";
import { normalizeToolAction } from "./claude.js";

const MAX_BRIDGE_BYTES = 8 * 1024 * 1024;

export interface CodexGateBridge {
  socketPath: string;
  env: NodeJS.ProcessEnv;
  close(): Promise<void>;
}

export async function startCodexGateBridge(
  workdir: string,
  hooks: TurnHooks,
  escalations: GateEscalation[],
): Promise<CodexGateBridge> {
  // macOS caps Unix-domain socket paths at roughly 100 bytes. Eval TMPDIR is
  // intentionally nested under a content-addressed campaign path, so use the
  // short system socket root and remove it at turn end; provider sessions and
  // credentials still remain in campaign scratch.
  const socketRoot = process.platform === "win32" ? tmpdir() : "/tmp";
  const directory = await mkdtemp(join(socketRoot, "cormidia-cg-"));
  const socketPath = join(directory, "gate.sock");
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
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
      if (body.length > MAX_BRIDGE_BYTES) {
        answer({ allow: false, reason: "Cormidia gate input exceeded 8 MiB" });
      }
    });
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    socket.on("end", () => {
      if (answered) return;
      try {
        const input: unknown = JSON.parse(body.trim());
        const actions = normalizeCodexHookActions(input, workdir);
        let allow = true;
        let reason: string | undefined;
        for (const action of actions) {
          const decision = hooks.gate(action);
          if (decision.allow) {
            // App Server emits completed Bash/apply_patch items itself. MCP
            // items do not have a bridge in CodexRuntime, so preserve their
            // allowed activity here without double-counting shell/file calls.
            if (action.tool.startsWith("mcp__")) hooks.onEvent?.(toolUseEvent(action));
            continue;
          }
          allow = false;
          reason ??= decision.reason;
          if (decision.escalate) escalations.push({ action, reason: decision.reason });
        }
        answer({ allow, ...(allow ? {} : { reason: reason ?? "Cormidia gate denied the tool action" }) });
      } catch (error) {
        answer({
          allow: false,
          reason:
            `Cormidia Codex gate bridge failed closed: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
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
    env: { CORMIDIA_CODEX_GATE_SOCKET: socketPath },
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

export function normalizeCodexHookActions(input: unknown, workdir: string): ToolAction[] {
  if (input === null || typeof input !== "object") {
    throw new Error("hook input is not an object");
  }
  const record = input as Record<string, unknown>;
  const toolName = typeof record["tool_name"] === "string" ? record["tool_name"] : "";
  const rawInput = record["tool_input"];
  const toolInput =
    rawInput !== null && typeof rawInput === "object" && !Array.isArray(rawInput)
      ? (rawInput as Record<string, unknown>)
      : {};
  if (toolName.toLowerCase() === "exec") {
    throw new Error("Codex code-mode exec is not a gateable tool route");
  }
  if (toolName.toLowerCase() !== "apply_patch") {
    return [normalizeToolAction(toolName, toolInput, workdir)];
  }

  const patch = typeof toolInput["command"] === "string" ? toolInput["command"] : "";
  const actions: ToolAction[] = [];
  for (const match of patch.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) {
    const operation = match[1];
    const path = match[2]?.trim() ?? "";
    actions.push({ tool: operation === "Add" ? "write" : "edit", input: { path } });
  }
  return actions.length > 0 ? actions : [{ tool: "edit", input: { path: "." } }];
}

export function codexGateHookCommand(): string {
  const adapterPath = fileURLToPath(import.meta.url);
  const sourceMode = adapterPath.endsWith(".ts");
  const helperPath = join(dirname(adapterPath), `codex-gate-hook.${sourceMode ? "ts" : "js"}`);
  const argv = sourceMode
    ? [process.execPath, "--import", createRequire(import.meta.url).resolve("tsx"), helperPath]
    : [process.execPath, helperPath];
  return argv.map(shellQuote).join(" ");
}

export function codexAppServerArgs(
  permissionMode: import("../permission-mode.js").CodexPermissionMode = "on-request",
  hookCommand = codexGateHookCommand(),
): string[] {
  const hook =
    `hooks.PreToolUse=[{ matcher = ` +
    `"^(Bash|exec|apply_patch|Edit|Write|mcp__.*)$", hooks = [{ type = "command", ` +
    `command = ${JSON.stringify(hookCommand)}, timeout = 30 }] }]`;
  return [
    "--ask-for-approval",
    permissionMode,
    // Codex CLI 0.142.5 parses the global bypass flag below but its app-server
    // dispatch path does not forward that flag into ConfigOverrides. Keep the
    // public flag for forward compatibility and set the equivalent session
    // config explicitly so the already-vetted ephemeral hook is runnable.
    "--dangerously-bypass-hook-trust",
    "-c",
    "bypass_hook_trust=true",
    "-c",
    "features.hooks=true",
    "-c",
    "features.code_mode=false",
    "-c",
    "features.code_mode_host=false",
    "-c",
    "features.code_mode_only=false",
    "-c",
    "features.unified_exec=false",
    "-c",
    "features.apps=false",
    "-c",
    "features.plugins=false",
    "-c",
    "features.in_app_browser=false",
    "-c",
    "features.plugin_sharing=false",
    "-c",
    "tools.web_search=false",
    "-c",
    'web_search="disabled"',
    "-c",
    "tools.view_image=false",
    "-c",
    hook,
    "app-server",
    "--listen",
    "stdio://",
  ];
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

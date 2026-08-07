// Child-process half of GrokRuntime's PreToolUse bridge. Grok invokes this
// command with one hook JSON envelope on stdin (docs/user-guide/10-hooks.md:
// camelCase `hookEventName` / `toolName` / `toolInput`) and reads the decision
// from stdout. It forwards the envelope to the per-turn Unix socket owned by
// the adapter and prints grok's supported decision shape.
//
// Grok's own hook runner fails OPEN on every handler failure (timeout, crash,
// malformed output). That is the whole reason this helper must never exit
// without an explicit decision: any bridge failure prints `deny`, and the
// adapter separately refuses to start a turn whose hook handshake it did not
// observe (see grok-gate-bridge.ts).

import { createConnection } from "node:net";

const MAX_HOOK_INPUT_BYTES = 8 * 1024 * 1024;
const BRIDGE_TIMEOUT_MS = 20_000;

interface BridgeDecision {
  allow: boolean;
  reason?: string;
  /** Passive events (session_start) carry no tool decision. */
  passive?: boolean;
}

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const socketPath = process.env["CORMIDIA_GROK_GATE_SOCKET"];
    if (socketPath === undefined || socketPath.length === 0) {
      deny("Cormidia Grok gate bridge is unavailable");
      return;
    }
    const response = await requestDecision(socketPath, input);
    if (response.passive === true) {
      // A passive event (session_start handshake) has no tool to authorize.
      // Emitting no decision keeps grok's documented passive-hook contract.
      return;
    }
    if (response.allow) {
      process.stdout.write(`${JSON.stringify({ decision: "allow" })}\n`);
      return;
    }
    deny(response.reason ?? "Cormidia gate denied the tool action");
  } catch (error) {
    deny(`Cormidia Grok gate bridge failed closed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readStdin(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    process.stdin.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_HOOK_INPUT_BYTES) {
        reject(new Error("hook input exceeds 8 MiB"));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(new Error(`invalid hook JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

function requestDecision(socketPath: string, input: unknown): Promise<BridgeDecision> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let output = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error !== undefined) reject(error);
    };
    socket.setTimeout(BRIDGE_TIMEOUT_MS, () => finish(new Error("gate bridge timed out")));
    socket.on("connect", () => socket.end(`${JSON.stringify(input)}\n`));
    socket.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > MAX_HOOK_INPUT_BYTES) finish(new Error("gate bridge response exceeds 8 MiB"));
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => {
      if (settled) return;
      try {
        const parsed: unknown = JSON.parse(output);
        if (parsed === null || typeof parsed !== "object") throw new Error("response is not an object");
        const record = parsed as Record<string, unknown>;
        if (record["passive"] === true) {
          settled = true;
          resolve({ allow: true, passive: true });
          return;
        }
        if (typeof record["allow"] !== "boolean") throw new Error("response has no boolean allow field");
        settled = true;
        resolve({
          allow: record["allow"],
          ...(typeof record["reason"] === "string" ? { reason: record["reason"] } : {}),
        });
      } catch (error) {
        finish(new Error(`invalid gate bridge response: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

function deny(reason: string): void {
  process.stdout.write(`${JSON.stringify({ decision: "deny", reason })}\n`);
  // Exit 2 is grok's explicit-deny code. The stdout decision is authoritative
  // regardless of exit code, so this is belt-and-braces, not the mechanism.
  process.exitCode = 2;
}

void main();

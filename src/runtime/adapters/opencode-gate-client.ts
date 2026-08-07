// The per-turn gate socket's client half, shared by the in-server plugin and
// the L1 transport double.
//
// It lives in its own module for a load-bearing reason. OpenCode's plugin
// loader treats a plugin module's exports as plugin factories: an exported
// value that is not a factory (a class, a const) makes the module fail to load
// at all, and an exported helper FUNCTION is invoked as if it were a factory —
// which, on 2026-08-07 against opencode 1.18.15, left the module's real factory
// announcing itself while its hooks were silently never wired. A plugin that
// looks loaded but gates nothing is the worst possible failure, so
// opencode-gate-plugin.ts exports its factory and nothing else, and every
// helper it needs lives here.

import { createConnection } from "node:net";

const MAX_BRIDGE_BYTES = 8 * 1024 * 1024;
const BRIDGE_TIMEOUT_MS = 30_000;

export interface GateBridgeAnswer {
  allow: boolean;
  reason?: string;
}

/**
 * One request/response exchange over the per-turn Unix socket. Rejects on any
 * transport or protocol failure so callers can fail closed.
 *
 * Framing is newline-delimited in BOTH directions, and the request side never
 * half-closes. That is not a style choice: this module's other caller is a
 * plugin loaded inside OpenCode, which runs on Bun, where ending the writable
 * half tears the whole socket down — the request still arrived, but the answer
 * never came back, so the plugin failed to load and the server ran with no
 * gate at all. Certification caught exactly that on 2026-08-07. Write, read a
 * line, then destroy.
 */
export function requestGateDecision(socketPath: string, payload: unknown): Promise<GateBridgeAnswer> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let output = "";
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    const succeed = (answer: GateBridgeAnswer): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(BRIDGE_TIMEOUT_MS, () => fail(new Error("Cormidia gate bridge timed out")));
    socket.on("connect", () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > MAX_BRIDGE_BYTES) {
        fail(new Error("Cormidia gate bridge response exceeded 8 MiB"));
        return;
      }
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      try {
        const parsed: unknown = JSON.parse(output.slice(0, newline));
        if (parsed === null || typeof parsed !== "object") throw new Error("response is not an object");
        const record = parsed as Record<string, unknown>;
        if (typeof record["allow"] !== "boolean") throw new Error("response has no boolean allow field");
        succeed({
          allow: record["allow"],
          ...(typeof record["reason"] === "string" ? { reason: record["reason"] } : {}),
        });
      } catch (error) {
        fail(new Error(`invalid Cormidia gate bridge response: ${toMessage(error)}`));
      }
    });
    socket.on("error", (error) => fail(error));
    socket.on("close", () => fail(new Error("Cormidia gate bridge closed before answering")));
  });
}

export function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

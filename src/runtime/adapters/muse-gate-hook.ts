// Child-process half of MuseRuntime's managed-hook gate bridge. Muse invokes
// this command with one hook JSON object on stdin. It forwards that object to
// the per-turn Unix socket owned by the adapter and prints the hook response
// the socket returned. Any bridge failure denies the tool call.

import { createConnection } from "node:net";

const MAX_HOOK_INPUT_BYTES = 8 * 1024 * 1024;
const BRIDGE_TIMEOUT_MS = 5_000;

async function main(): Promise<void> {
  let event = "PreToolUse";
  try {
    const input = await readStdin();
    if (input !== null && typeof input === "object" && !Array.isArray(input)) {
      const named = (input as Record<string, unknown>)["hook_event_name"];
      if (typeof named === "string" && named.length > 0) event = named;
    }
    const socketPath = process.env["CORMIDIA_MUSE_GATE_SOCKET"];
    if (socketPath === undefined || socketPath.length === 0) {
      deny(event, "Cormidia Muse gate bridge is unavailable");
      return;
    }
    process.stdout.write(`${JSON.stringify(await requestDecision(socketPath, input))}\n`);
  } catch (error) {
    deny(event, `Cormidia Muse gate bridge failed closed: ${error instanceof Error ? error.message : String(error)}`);
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

function requestDecision(socketPath: string, input: unknown): Promise<unknown> {
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
        settled = true;
        resolve(parsed);
      } catch (error) {
        finish(new Error(`invalid gate bridge response: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

function deny(event: string, reason: string): void {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event,
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
}

void main();

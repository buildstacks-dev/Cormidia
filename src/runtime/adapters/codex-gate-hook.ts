// Child-process half of CodexRuntime's PreToolUse bridge. Codex invokes this
// command with one hook JSON object on stdin. It forwards that object to the
// per-turn Unix socket owned by the adapter and prints the supported hook
// allow/deny shape on stdout. Any bridge failure denies the tool call.

import { createConnection } from "node:net";

const MAX_HOOK_INPUT_BYTES = 8 * 1024 * 1024;
const BRIDGE_TIMEOUT_MS = 5_000;

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const socketPath = process.env["CORMIDIA_CODEX_GATE_SOCKET"];
    if (socketPath === undefined || socketPath.length === 0) {
      deny("Cormidia Codex gate bridge is unavailable");
      return;
    }
    const response = await requestDecision(socketPath, input);
    if (response.allow) {
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
          },
        })}\n`,
      );
      return;
    }
    deny(response.reason ?? "Cormidia gate denied the tool action");
  } catch (error) {
    deny(`Cormidia Codex gate bridge failed closed: ` + `${error instanceof Error ? error.message : String(error)}`);
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

function requestDecision(socketPath: string, input: unknown): Promise<{ allow: boolean; reason?: string }> {
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
      if (output.length > MAX_HOOK_INPUT_BYTES) {
        finish(new Error("gate bridge response exceeds 8 MiB"));
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => {
      if (settled) return;
      try {
        const parsed: unknown = JSON.parse(output);
        if (parsed === null || typeof parsed !== "object") {
          throw new Error("response is not an object");
        }
        const record = parsed as Record<string, unknown>;
        if (typeof record["allow"] !== "boolean") {
          throw new Error("response has no boolean allow field");
        }
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
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
}

void main();

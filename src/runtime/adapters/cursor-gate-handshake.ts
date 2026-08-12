// The pre-spend proof that makes `--force` safe to pass to cursor-agent.
//
// cursor-agent needs `--force` to do real work but exposes no approval channel
// a wrapper could answer. Before spend, the exact hook command must therefore
// answer allow and deny probes from Cursor's project cwd and environment.
//
// It cannot prove Cursor CHOOSES to call the hook. That claim rests on the
// certified version band plus CursorRuntime's post-turn executed-versus-allowed
// cross-check, which refuses to report `completed` when anything ran that the
// gate never classified.

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HANDSHAKE_TIMEOUT_MS = 15_000;

/** Typed pre-spend refusal: the gate bridge did not answer its own end-to-end
 *  handshake, so no turn may run with `--force`. */
export class CursorGateBridgeUnavailableError extends Error {
  readonly code = "error_gate_bridge_unavailable";
  constructor(detail: string) {
    super(
      `CursorRuntime: the per-turn gate bridge failed its pre-spend handshake (${detail}). cursor-agent ` +
        `needs --force to apply any real work, and --force without a proven gate is an ungated turn. ` +
        `Refusing before provider construction.`,
    );
    this.name = "CursorGateBridgeUnavailableError";
  }
}

/** `"allow"`/`"deny"` when the payload is this turn's handshake probe, so the
 *  bridge can answer it without ever consulting the org gate. */
export function cursorHandshakeProbe(input: unknown, nonce: string): "allow" | "deny" | undefined {
  if (!isRecord(input)) return undefined;
  const probe = input["cormidia_handshake"];
  if (!isRecord(probe) || probe["nonce"] !== nonce) return undefined;
  return probe["expect"] === "allow" ? "allow" : "deny";
}

export async function runCursorGateHandshake(
  hookCommand: string,
  workdir: string,
  env: NodeJS.ProcessEnv,
  nonce: string,
): Promise<void> {
  // Both probes are independent and each costs one process spawn, so the
  // pre-spend path does not pay for them serially.
  await Promise.all((["allow", "deny"] as const).map((expect) => runProbe(hookCommand, workdir, env, nonce, expect)));
}

async function runProbe(
  hookCommand: string,
  workdir: string,
  env: NodeJS.ProcessEnv,
  nonce: string,
  expect: "allow" | "deny",
): Promise<void> {
  const payload = JSON.stringify({
    hook_event_name: "preToolUse",
    tool_name: "Shell",
    tool_input: { command: "cormidia-gate-bridge-handshake" },
    cormidia_handshake: { nonce, expect },
  });
  const stdout = await runHookProcess(hookCommand, workdir, env, payload);
  let decision: unknown;
  try {
    decision = JSON.parse(stdout.trim());
  } catch {
    throw new CursorGateBridgeUnavailableError(
      `the hook command printed non-JSON for the ${expect} probe: ${JSON.stringify(stdout.slice(0, 200))}`,
    );
  }
  const permission = isRecord(decision) ? decision["permission"] : undefined;
  if (permission !== expect) {
    throw new CursorGateBridgeUnavailableError(
      `the ${expect} probe came back ${JSON.stringify(permission)} instead of ${JSON.stringify(expect)}`,
    );
  }
}

function runHookProcess(
  hookCommand: string,
  workdir: string,
  env: NodeJS.ProcessEnv,
  payload: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Cursor runs a project hook's `command` through a shell from the project
    // root; the probe runs it exactly that way rather than a friendlier way.
    const child = execFile(
      "/bin/sh",
      ["-c", hookCommand],
      { cwd: workdir, env: { ...process.env, ...env }, encoding: "utf8", timeout: HANDSHAKE_TIMEOUT_MS },
      (error, stdout) => {
        if (error !== null) {
          reject(new CursorGateBridgeUnavailableError(`the hook command failed: ${error.message}`));
          return;
        }
        resolve(stdout);
      },
    );
    child.stdin?.on("error", (error) =>
      reject(new CursorGateBridgeUnavailableError(`the hook command closed stdin during delivery: ${error.message}`)),
    );
    child.stdin?.end(payload);
  });
}

/** The shell command registered in `.cursor/hooks.json`, resolved against this
 *  package's own helper so an operator PATH can never substitute it. */
export function cursorGateHookCommand(): string {
  const modulePath = fileURLToPath(import.meta.url);
  const sourceMode = modulePath.endsWith(".ts");
  const helperPath = join(dirname(modulePath), `cursor-gate-hook.${sourceMode ? "ts" : "js"}`);
  const argv = sourceMode
    ? [process.execPath, "--import", createRequire(import.meta.url).resolve("tsx"), helperPath]
    : [process.execPath, helperPath];
  return argv.map((value) => `'${value.replaceAll("'", `'\\''`)}'`).join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// How MuseRuntime launches `muse exec`, and the exact argv it uses.
//
// Kept separate from the runtime so the argv-safety pin can assert, as pure
// data, that no credential and no task payload is ever a command-line argument.
//
// - The task travels through `--prompt-file`, never argv (the ARG_MAX lesson,
//   docs/loop/design.md §2).
// - The API key travels on the child's STDIN through `--api-key-stdin`, and the
//   resolver's variables are stripped from the child environment so an in-turn
//   `env` dump cannot leak it.
// - Hermeticity is ALWAYS on (`--no-foreign-personal-context`), so the
//   operator's personal Claude/Codex rules and skills never enter an org turn.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Effort } from "../types.js";

/** One `--json` JSONL record as the adapter consumes it. */
export interface MuseRecord {
  payload_type?: unknown;
  stream?: unknown;
  payload?: unknown;
}

export interface MuseExecLaunch {
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export interface MuseExecProcess {
  events: AsyncIterable<MuseRecord>;
  /** Deliver the API key on stdin. NEVER argv, never the environment. */
  writeApiKey(key: string): void;
  terminate(): Promise<void>;
  completion: Promise<{ code: number | null; stderrTail: string }>;
}

export type MuseExecFactory = (launch: MuseExecLaunch) => MuseExecProcess;

/** Environment variables that may carry the key, in resolution order. */
export const MUSE_API_KEY_ENV = ["CORMIDIA_MUSE_API_KEY", "MUSE_API_KEY", "META_API_KEY"] as const;

export function museExecArgs(spec: {
  promptFile: string;
  workdir: string;
  model: string;
  effort: string;
  sessionId: string;
  maxModelSteps?: number;
}): string[] {
  return [
    "exec",
    "--json",
    "--prompt-file",
    spec.promptFile,
    "--api-key-stdin",
    "--provider",
    "meta",
    "--model",
    spec.model,
    "--reasoning-effort",
    spec.effort,
    "--workspace",
    spec.workdir,
    "--session-id",
    spec.sessionId,
    // Certified by the skills-count delta, never by the one-shot banner.
    "--no-foreign-personal-context",
    "--disable-web-tools",
    "--user-input-auto-resolve",
    ...(spec.maxModelSteps === undefined ? [] : ["--max-model-steps", String(spec.maxModelSteps)]),
  ];
}

/** Token-free handshake run: proves the managed hook seam is live this turn. */
export function museHandshakeArgs(workdir: string): string[] {
  return [
    "exec",
    "--json",
    "--provider",
    "echo",
    "--workspace",
    workdir,
    "--no-foreign-personal-context",
    "--no-session-log",
    "cormidia gate handshake",
  ];
}

/**
 * Effort ladder. Muse exposes `none|minimal|low|medium|high|xhigh|ultra`, so
 * Cormidia's low/medium/high/xhigh map 1:1. `max` stays UNMAPPED and throws
 * under the ratified cross-adapter no-alias rule: `ultra` sits above `xhigh`,
 * and whether Cormidia `max` means `ultra` is a deliberate open capability
 * decision for the product owner (contracts/B-26-muse-code.md), not a guess an
 * adapter gets to make.
 */
export function mapMuseEffort(effort: Effort): string {
  if (effort === "max") {
    throw new Error(
      "MuseRuntime: effort max is unsupported; no effort alias is allowed. " +
        "Muse exposes `ultra` above `xhigh`, but the max->ultra mapping awaits human ratification (B-26).",
    );
  }
  return effort;
}

/** The operator's configured key source, read at turn time. Never logged. */
export async function resolveMuseApiKey(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const file = env["CORMIDIA_MUSE_API_KEY_FILE"];
  if (file !== undefined && file.length > 0) {
    try {
      const contents = (await readFile(file, "utf8")).trim();
      if (contents.length > 0) return contents;
    } catch {
      return undefined;
    }
  }
  for (const name of MUSE_API_KEY_ENV) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/** Real subprocess transport. The adapter double replaces this whole seam. */
export function defaultMuseExecFactory(launch: MuseExecLaunch): MuseExecProcess {
  const child = spawn("muse", launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const stderr: string[] = [];
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk.toString("utf8"));
    if (stderr.length > 20) stderr.shift();
  });
  const completion = new Promise<{ code: number | null; stderrTail: string }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderrTail: stderr.join("").trim() }));
  });
  return {
    events: (async function* () {
      for await (const line of createInterface({ input: child.stdout })) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          yield JSON.parse(trimmed) as MuseRecord;
        } catch (error) {
          // 0.1.x beta schema drift is a TYPED failure, never a silent re-parse.
          throw new Error(`MuseRuntime: unreadable --json record: ${error instanceof Error ? error.message : error}`);
        }
      }
    })(),
    writeApiKey: (key) => {
      child.stdin.write(key);
      child.stdin.end();
    },
    terminate: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        // Already exited.
      }
    },
    completion,
  };
}

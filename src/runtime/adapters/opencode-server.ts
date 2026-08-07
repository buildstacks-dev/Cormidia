// Provisioning half of OpencodeRuntime: launch the OPERATOR'S opencode binary
// as a per-turn headless server and bind to that exact instance.
//
// Cormidia never installs a provider (#224), so the binary must already be on
// PATH or at the documented install location; absence is readiness's answer,
// not an install trigger. `@opencode-ai/sdk`'s own createOpencodeServer is
// deliberately unused: it spawns a bare `opencode` from PATH on a fixed port
// 4096, which cannot bind a specific install, cannot pick a free port, and
// would happily talk to a stale or foreign server. We spawn, read the listen
// line off OUR child's stdout, and cross-check the pid the in-server gate
// plugin reports — so "some server answered" can never pass for identity
// (CORMIDIA-C-B23-001, server identity).
//
// HERMETICITY. The F-PT-025 probe (2026-08-07) caught OpenCode feeding the
// operator's own ~/.claude/CLAUDE.md into a turn. Ambient ingestion is closed
// here, empirically against 1.18.15:
//   - XDG_CONFIG_HOME → a per-turn empty directory, which moves OpenCode's
//     whole global config root (~/.config/opencode): global opencode.json,
//     global AGENTS.md, global agents/commands/plugins/skills.
//   - OPENCODE_DISABLE_CLAUDE_CODE → the ~/.claude/CLAUDE.md and .claude/skills
//     compatibility channels.
//   - OPENCODE_DISABLE_EXTERNAL_SKILLS → the ~/.agents/skills channel.
// XDG_DATA_HOME is deliberately NOT moved: the provider auth store lives there
// and readiness means usable auth, not a blank machine. Project context inside
// the workdir stays in scope — OpenCode's own AGENTS.md walk stops at the
// project root, so it cannot climb out of the app checkout.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const LISTEN_LINE = /opencode server listening on (https?:\/\/\S+)/;

export class OpencodeBinaryMissingError extends Error {
  readonly code = "error_adapter_binary_missing";
  constructor(searched: string[]) {
    super(
      `OpencodeRuntime: no opencode binary found (looked at ${searched.join(", ")}). ` +
        `Cormidia never installs a provider — install opencode yourself and re-run readiness.`,
    );
    this.name = "OpencodeBinaryMissingError";
  }
}

export class OpencodeServerStartError extends Error {
  readonly code = "error_adapter_transport_unavailable";
  constructor(detail: string) {
    super(`OpencodeRuntime: opencode serve did not come up: ${detail}`);
    this.name = "OpencodeServerStartError";
  }
}

export class OpencodeServerIdentityError extends Error {
  readonly code = "error_adapter_server_identity";
  constructor(expectedPid: number, reportedPid: number, url: string) {
    super(
      `OpencodeRuntime: the gate plugin announced from pid ${reportedPid} but this turn spawned ` +
        `pid ${expectedPid} on ${url} — refusing to drive a foreign or stale opencode server`,
    );
    this.name = "OpencodeServerIdentityError";
  }
}

export interface OpencodeServer {
  url: string;
  pid: number;
  close(): Promise<void>;
}

/** PATH first, then the documented per-user install location. */
export function resolveOpencodeBinary(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env["CORMIDIA_OPENCODE_BIN"];
  const searched: string[] = [];
  if (explicit !== undefined && explicit.length > 0) {
    if (existsSync(explicit)) return explicit;
    searched.push(explicit);
  }
  for (const entry of (env["PATH"] ?? "").split(delimiter)) {
    if (entry.length === 0) continue;
    const candidate = join(entry, "opencode");
    if (existsSync(candidate)) return candidate;
  }
  searched.push("PATH");
  const fallback = join(env["HOME"] ?? homedir(), ".opencode", "bin", "opencode");
  if (existsSync(fallback)) return fallback;
  searched.push(fallback);
  throw new OpencodeBinaryMissingError(searched);
}

/**
 * Ambient-context isolation plus the no-surprises switches.
 *
 * Deliberately NOT set: `OPENCODE_DISABLE_MODELS_FETCH`. The model catalog is
 * OpenCode's own, not operator-ambient context, and blocking its refresh on an
 * install with a cold cache leaves a correctly authenticated provider looking
 * unreachable — certification hit exactly that.
 */
export function opencodeHermeticEnv(configHome: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    XDG_CONFIG_HOME: configHome,
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_SHARE: "1",
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => (port > 0 ? resolve(port) : reject(new Error("could not reserve a local port"))));
    });
  });
}

export async function startOpencodeServer(options: {
  workdir: string;
  inlineConfig: unknown;
  bridgeEnv: NodeJS.ProcessEnv;
  extraEnv?: NodeJS.ProcessEnv;
  startTimeoutMs: number;
}): Promise<OpencodeServer> {
  const binary = resolveOpencodeBinary();
  const configHome = await mkdtemp(join(tmpdir(), "cormidia-oc-cfg-"));
  const port = await freePort();
  const child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: options.workdir,
    env: {
      ...opencodeHermeticEnv(configHome),
      ...options.bridgeEnv,
      ...options.extraEnv,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(options.inlineConfig),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let transcript = "";
  const collect = (chunk: Buffer): void => {
    transcript += chunk.toString("utf8");
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  const cleanup = async (): Promise<void> => {
    stop(child);
    await rm(configHome, { recursive: true, force: true });
  };

  let url: string;
  try {
    url = await waitForListen(child, () => transcript, options.startTimeoutMs);
  } catch (error) {
    await cleanup();
    throw error instanceof OpencodeServerStartError ? error : new OpencodeServerStartError(String(error));
  }

  let closing: Promise<void> | undefined;
  return {
    url,
    pid: child.pid ?? -1,
    close: async () => {
      closing ??= cleanup();
      return closing;
    },
  };
}

function waitForListen(child: ChildProcess, transcript: () => string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run();
    };
    const timer = setTimeout(
      () => finish(() => reject(new OpencodeServerStartError(`no listen line within ${timeoutMs}ms: ${transcript()}`))),
      timeoutMs,
    );
    const scan = (): void => {
      const match = transcript().match(LISTEN_LINE);
      if (match?.[1] !== undefined) finish(() => resolve(match[1]!.replace(/\/$/, "")));
    };
    child.stdout?.on("data", scan);
    child.stderr?.on("data", scan);
    child.on("error", (error) => finish(() => reject(new OpencodeServerStartError(error.message))));
    child.on("exit", (code) =>
      finish(() => reject(new OpencodeServerStartError(`exited with code ${code}: ${transcript()}`))),
    );
  });
}

function stop(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // Already gone; the turn is finished either way.
  }
}

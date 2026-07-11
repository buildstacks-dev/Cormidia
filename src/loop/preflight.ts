// Token-free environment preflight (proportionality-review Stage 3, P6).
// Three environment failures in the 2026-07-10 episode were each discovered
// INSIDE a multi-dollar model turn: registry access blocked by the offline
// sandbox, pnpm refusing a non-TTY install, and missing network grants after
// a requeue. Deterministic probes answer the same questions for $0 before
// the first provider turn of a pipeline starts.
//
// Pure subprocess + fs checks — loop layer, no org imports, no model calls.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GateCommands } from "./qgates.js";

export interface PreflightOptions {
  /** Whether this tick carries an explicit network grant (--allow-network). */
  networkAccess?: boolean;
  /** Registry probe timeout; the probe only runs when network is granted. */
  probeTimeoutMs?: number;
}

export interface PreflightResult {
  ok: boolean;
  problems: string[];
}

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/** Cheap deterministic probes in the ticket worktree. A failure names the
 *  exact problem and the fix — evidence for the returned-ticket comment. */
export async function runEnvPreflight(
  worktree: string,
  commands: GateCommands,
  options: PreflightOptions = {},
): Promise<PreflightResult> {
  const problems: string[] = [];

  // 1. Every configured gate command's executable must resolve.
  for (const [key, command] of Object.entries(commands)) {
    if (typeof command !== "string" || command.trim() === "") continue;
    const binary = commandBinary(command);
    if (binary === undefined) continue;
    if (!binaryResolves(worktree, binary)) {
      problems.push(
        `${key}: "${binary}" is not on PATH in the worktree — the ${key.replace(/Command$/, "")} ` +
          `gate would fail before any work ran`,
      );
    }
  }

  // 2. The offline-install trap: a setup command that must install into an
  //    empty worktree cannot succeed without a network grant. This exact
  //    combination cost a full Builder pass to diagnose in the episode.
  if (
    commands.setupCommand !== undefined &&
    options.networkAccess !== true &&
    looksLikeInstall(commands.setupCommand) &&
    !existsSync(join(worktree, "node_modules"))
  ) {
    problems.push(
      `setup ("${commands.setupCommand}") must install dependencies into a worktree with no ` +
        `node_modules, but the runtime sandbox is offline — grant network for this ticket ` +
        `(operon loop --allow-network) or pre-populate the store`,
    );
  }

  // 3. With network granted and an install pending, prove the registry is
  //    actually reachable from this host before a model turn discovers it.
  if (
    commands.setupCommand !== undefined &&
    options.networkAccess === true &&
    looksLikeInstall(commands.setupCommand)
  ) {
    const reachable = await registryReachable(options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
    if (!reachable) {
      problems.push(
        "registry.npmjs.org is unreachable from this host — the granted network access cannot " +
          "satisfy the setup install right now",
      );
    }
  }

  return { ok: problems.length === 0, problems };
}

/** First real token of a shell command, skipping VAR=value prefixes. */
export function commandBinary(command: string): string | undefined {
  for (const token of command.trim().split(/\s+/)) {
    if (token === "" || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    return token;
  }
  return undefined;
}

function binaryResolves(cwd: string, binary: string): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${shellQuote(binary)}`], {
      cwd,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function looksLikeInstall(command: string): boolean {
  return /\binstall\b|\bci\b/.test(command);
}

async function registryReachable(timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch("https://registry.npmjs.org/-/ping", {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type EvalAppGateNetworkPolicy = "forbidden" | "loopback_only";

export interface EvalAppGateOptions {
  cwd: string;
  seedDir: string;
  commands: string[];
  timeoutMs?: number;
  network?: EvalAppGateNetworkPolicy;
}

/** Run actor-modifiable app code as an untrusted verifier subprocess. Package
 * script definitions are pinned to the committed seed, credentials are not
 * inherited, and macOS applies a kernel network deny to the whole process
 * tree. */
export function runEvalAppGates(options: EvalAppGateOptions): void {
  assertPinnedScripts(options.cwd, options.seedDir, options.commands);
  const env = evalCommandEnv(options.cwd);
  const timeout = options.timeoutMs ?? 120_000;
  const profile = evalAppSandboxProfile(options.network ?? "forbidden");
  for (const command of options.commands) {
    if (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") && process.env.VITEST === undefined) {
      execFileSync("/usr/bin/sandbox-exec", ["-p", profile, "/bin/sh", "-lc", command], { cwd: options.cwd, env, stdio: "ignore", timeout });
    } else if (process.env.VITEST !== undefined) {
      execFileSync("/bin/sh", ["-lc", command], { cwd: options.cwd, env, stdio: "ignore", timeout });
    } else {
      throw new Error("eval_app_network_sandbox_unavailable");
    }
  }
}

export function evalAppSandboxProfile(network: EvalAppGateNetworkPolicy): string {
  const rules = ["(version 1)", "(allow default)", "(deny network*)"];
  if (network === "loopback_only") {
    rules.push(
      '(allow network-inbound (local ip "localhost:*"))',
      '(allow network-outbound (remote ip "localhost:*"))',
    );
  }
  return rules.join(" ");
}

export function evalAppNetworkPolicy(declared: string | undefined): EvalAppGateNetworkPolicy {
  return declared === "loopback_only" || declared === "provider_and_loopback_only"
    ? "loopback_only"
    : "forbidden";
}

export function evalCommandEnv(cwd: string): NodeJS.ProcessEnv {
  const home = join(cwd, ".eval-harness", "home");
  const temp = join(cwd, ".eval-harness", "tmp");
  mkdirSync(home, { recursive: true }); mkdirSync(temp, { recursive: true });
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    SHELL: "/bin/sh",
    HOME: home,
    TMPDIR: temp,
    CI: "1",
    NODE_ENV: "test",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "127.0.0.1,localhost,::1",
  };
}

function assertPinnedScripts(cwd: string, seedDir: string, commands: string[]): void {
  const actual = packageScripts(join(cwd, "package.json"));
  const pinned = packageScripts(join(seedDir, "package.json"));
  for (const command of commands) {
    const name = npmScriptName(command);
    if (!name) continue;
    if (typeof pinned[name] !== "string" || actual[name] !== pinned[name]) throw new Error(`eval_app_script_drift:${name}`);
  }
}

function packageScripts(path: string): Record<string, unknown> {
  const value = JSON.parse(readFileSync(path, "utf8")) as { scripts?: unknown };
  if (typeof value.scripts !== "object" || value.scripts === null || Array.isArray(value.scripts)) throw new Error("eval_app_scripts_missing");
  return value.scripts as Record<string, unknown>;
}

function npmScriptName(command: string): string | undefined {
  if (command === "npm test") return "test";
  const match = /^npm run ([a-zA-Z0-9:_-]+)$/.exec(command);
  if (match) return match[1];
  if (/^npm\b/.test(command)) throw new Error(`eval_app_command_not_pinned:${command}`);
  return undefined;
}

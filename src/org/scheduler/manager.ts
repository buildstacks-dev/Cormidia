import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { writeFileAtomic } from "../atomic.js";
import type { SchedulerBackend } from "./model.js";

const execFileAsync = promisify(execFile);

export interface SchedulerManagerInspection {
  installed: boolean;
  loaded: boolean | null;
  active: boolean | null;
  detail: string;
}

export interface SchedulerHostCommand {
  command: string;
  args: string[];
}

export type SchedulerHostCommandRunner = (input: SchedulerHostCommand) => Promise<{
  code: number;
  stdout: string;
  stderr: string;
}>;

export interface SchedulerManager {
  backend: SchedulerBackend;
  platform: NodeJS.Platform;
  supported: boolean;
  definitionPath(schedulerId: string): string;
  readDefinition(schedulerId: string): Promise<string | undefined>;
  writeDefinition(schedulerId: string, definition: string): Promise<void>;
  removeDefinition(schedulerId: string): Promise<void>;
  enable(schedulerId: string): Promise<void>;
  disable(schedulerId: string): Promise<void>;
  inspect(schedulerId: string, options?: { runtime?: boolean }): Promise<SchedulerManagerInspection>;
}

export interface PlatformSchedulerManagerOptions {
  backend: SchedulerBackend;
  platform?: NodeJS.Platform;
  homeDir?: string;
  definitionDir?: string;
  runHostCommand?: SchedulerHostCommandRunner;
  /** Test-only/future-backend override. Production systemd remains
   * representation-only until its host lifecycle is exercised and ratified. */
  supported?: boolean;
}

export class PlatformSchedulerManager implements SchedulerManager {
  readonly backend: SchedulerBackend;
  readonly platform: NodeJS.Platform;
  readonly supported: boolean;
  private readonly dir: string;
  private readonly runHostCommand: SchedulerHostCommandRunner;

  constructor(options: PlatformSchedulerManagerOptions) {
    this.backend = options.backend;
    this.platform = options.platform ?? process.platform;
    this.supported = options.supported ?? (this.backend === "launchd" && this.platform === "darwin");
    const home = options.homeDir ?? homedir();
    this.dir =
      options.definitionDir ??
      (this.backend === "launchd" ? join(home, "Library", "LaunchAgents") : join(home, ".config", "systemd", "user"));
    this.runHostCommand = options.runHostCommand ?? runHostCommand;
  }

  definitionPath(schedulerId: string): string {
    return join(this.dir, this.backend === "launchd" ? `${schedulerId}.plist` : `${schedulerId}.timer`);
  }

  async readDefinition(schedulerId: string): Promise<string | undefined> {
    const path = this.definitionPath(schedulerId);
    if (!existsSync(path)) return undefined;
    return readFile(path, "utf8");
  }

  async writeDefinition(schedulerId: string, definition: string): Promise<void> {
    const path = this.definitionPath(schedulerId);
    await mkdir(this.dir, { recursive: true });
    await writeFileAtomic(path, definition);
  }

  async removeDefinition(schedulerId: string): Promise<void> {
    await rm(this.definitionPath(schedulerId), { force: true });
  }

  async enable(schedulerId: string): Promise<void> {
    this.assertSupported();
    const path = this.definitionPath(schedulerId);
    const input =
      this.backend === "launchd"
        ? { command: "launchctl", args: ["bootstrap", `gui/${process.getuid?.() ?? 0}`, path] }
        : { command: "systemctl", args: ["--user", "enable", "--now", `${schedulerId}.timer`] };
    const result = await this.runHostCommand(input);
    if (result.code !== 0 && !alreadyEnabled(result)) {
      throw new Error(`scheduler manager enable failed (${result.code}): ${result.stderr || result.stdout}`);
    }
  }

  async disable(schedulerId: string): Promise<void> {
    this.assertSupported();
    const input =
      this.backend === "launchd"
        ? { command: "launchctl", args: ["bootout", `gui/${process.getuid?.() ?? 0}/${schedulerId}`] }
        : { command: "systemctl", args: ["--user", "disable", "--now", `${schedulerId}.timer`] };
    const result = await this.runHostCommand(input);
    if (result.code !== 0 && !alreadyDisabled(result)) {
      throw new Error(`scheduler manager disable failed (${result.code}): ${result.stderr || result.stdout}`);
    }
  }

  async inspect(schedulerId: string, options: { runtime?: boolean } = {}): Promise<SchedulerManagerInspection> {
    const installed = existsSync(this.definitionPath(schedulerId));
    if (!installed) return { installed: false, loaded: false, active: false, detail: "definition absent" };
    if (options.runtime === false) {
      return { installed: true, loaded: null, active: null, detail: "runtime state not inspected" };
    }
    if (!this.supported) {
      return { installed: true, loaded: null, active: null, detail: "backend runtime unsupported on this platform" };
    }
    const input =
      this.backend === "launchd"
        ? { command: "launchctl", args: ["print", `gui/${process.getuid?.() ?? 0}/${schedulerId}`] }
        : { command: "systemctl", args: ["--user", "is-active", `${schedulerId}.timer`] };
    const result = await this.runHostCommand(input);
    const active = result.code === 0;
    return {
      installed: true,
      loaded: active,
      active,
      detail: active
        ? "host manager reports active"
        : result.stderr || result.stdout || "host manager reports inactive",
    };
  }

  private assertSupported(): void {
    if (!this.supported) throw new Error(`scheduler backend ${this.backend} is unsupported on ${this.platform}`);
  }
}

async function runHostCommand(input: SchedulerHostCommand): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(input.command, input.args, { encoding: "utf8" });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const row = error as NodeJS.ErrnoException & { code?: string | number; stdout?: string; stderr?: string };
    return {
      code: typeof row.code === "number" ? row.code : 1,
      stdout: row.stdout ?? "",
      stderr: row.stderr ?? row.message,
    };
  }
}

function alreadyEnabled(result: { stdout: string; stderr: string }): boolean {
  return /already bootstrapped|service already loaded|file exists/i.test(`${result.stdout}\n${result.stderr}`);
}

function alreadyDisabled(result: { stdout: string; stderr: string }): boolean {
  return /could not find service|not loaded|no such process|not found/i.test(`${result.stdout}\n${result.stderr}`);
}

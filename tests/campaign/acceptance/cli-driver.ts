// The ONLY campaign-to-product path (CORMIDIA-INV-ACC-7a/7b). Everything a
// campaign does to a scenario goes through packaged `cormidia` binaries.
// Two guarantees this module owns:
//
//   1. **Packaged, not source-backed.** The resolved binary must realpath
//      OUTSIDE this checkout. `pnpm link:local` produces a source-backed install
//      — symlinks into `src/`, run through tsx — which executes TypeScript that
//      `npm install -g cormidia` never ships. A campaign run against it measures
//      the working tree. The check is cheap and runs once per driver.
//   2. **Every invocation is recorded.** The campaign's own account of what it
//      ran is one of the three records INV-ACC-7a reconciles; a driver that
//      forgot a call would make the reconciliation close over a lie.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { promisify } from "node:util";
import type { InvocationAdmission, InvocationRequest } from "./cli-admission.js";

const execFileAsync = promisify(execFile);

export type CampaignBinary = "cormidia" | "cormidia-job";

export type CliDriverCode =
  | "active-pointer-mutation"
  | "binary-unresolved"
  | "binary-inside-checkout"
  | "org-selection-not-isolated"
  | "source-backed-invocation";

export class CliDriverError extends Error {
  constructor(
    readonly code: CliDriverCode,
    message: string,
  ) {
    super(`campaign refused: ${code}: ${message}`);
    this.name = "CliDriverError";
  }
}

/** One recorded invocation. The campaign's own half of the reconciliation. */
export interface RecordedInvocation {
  binary: CampaignBinary;
  argv: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  /** The scenario this invocation was made on behalf of, when it had one. */
  scenarioId?: string;
}

export interface CliDriverOptions {
  /** Absolute path to the resolved `cormidia` binary. */
  cormidiaPath: string;
  /** Absolute path to the resolved `cormidia-job` binary. */
  cormidiaJobPath: string;
  /** This checkout's root; a binary resolving inside it is refused. */
  checkoutRoot: string;
  /** Extra env for every spawn (state home, org home, credentials). */
  env?: Record<string, string | undefined>;
  /** Pin campaign org selection without consulting the operator's pointer. */
  activeOrg?: { orgHome: string; stateHome: string };
  clock?: () => Date;
  /** Per-invocation timeout. A hung campaign turn is a stopped campaign, not a
   *  forever one — `incomplete` is an honest outcome and a hang is not. */
  timeoutMs?: number;
  admission?: InvocationAdmission;
}

const SOURCE_BACKED = [/\bpnpm\s+dev\b/, /\btsx\s+src\//, /\/src\/cli\.ts\b/, /\/src\/jobs\/main\.ts\b/];

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Spawns the packaged binaries and remembers every call.
 *
 * Construct with `createCliDriver`, which performs the packaged-resolution
 * check once. The constructor is private-by-convention: a driver that skipped
 * the check would silently be a source-backed driver.
 */
export class CliDriver {
  private readonly invocations: RecordedInvocation[] = [];
  private readonly clock: () => Date;

  constructor(private readonly options: CliDriverOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  /** Every invocation this campaign made, in order. */
  recorded(): RecordedInvocation[] {
    return this.invocations.map((invocation) => structuredClone(invocation));
  }

  binaryPath(binary: CampaignBinary): string {
    return binary === "cormidia" ? this.options.cormidiaPath : this.options.cormidiaJobPath;
  }

  /**
   * Run one command. Non-zero exits are RETURNED, not thrown: a refusal is
   * frequently the thing a campaign is measuring (a gate denial, an approval
   * park), and turning every refusal into an exception would make the campaign
   * unable to record its own most interesting outcomes.
   */
  async run(
    binary: CampaignBinary,
    argv: readonly string[],
    context: { scenarioId?: string; cwd?: string } = {},
  ): Promise<RecordedInvocation> {
    const orgVerb = binary === "cormidia" && argv[0] === "org" ? argv[1] : undefined;
    const mutatesPointer =
      orgVerb === "use" ||
      (orgVerb === "init" && !argv.includes("--dry-run")) ||
      (orgVerb === "archive" && argv.includes("--execute"));
    if (this.options.activeOrg !== undefined && mutatesPointer) {
      throw new CliDriverError("active-pointer-mutation", `cormidia ${argv.join(" ")} could mutate the active pointer`);
    }
    const request: InvocationRequest = {
      id: `${this.invocations.length + 1}:${this.clock().toISOString()}`,
      binary,
      argv,
      ...(context.scenarioId === undefined ? {} : { scenarioId: context.scenarioId }),
    };
    await this.options.admission?.before(request);
    const command = this.binaryPath(binary);
    for (const pattern of SOURCE_BACKED) {
      if (pattern.test([command, ...argv].join(" "))) {
        throw new CliDriverError(
          "source-backed-invocation",
          `${binary} ${argv.join(" ")} runs TypeScript that \`npm install -g cormidia\` never ships`,
        );
      }
    }
    const startedAt = this.clock().toISOString();
    let exitCode = 0;
    let stdout = "";
    let stderr = "";
    try {
      const result = await execFileAsync(command, [...argv], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
        ...(this.options.timeoutMs === undefined ? {} : { timeout: this.options.timeoutMs }),
        env: {
          ...process.env,
          ...this.options.env,
          ...(this.options.activeOrg === undefined
            ? {}
            : {
                CORMIDIA_ORG_HOME: this.options.activeOrg.orgHome,
                CORMIDIA_STATE_HOME: this.options.activeOrg.stateHome,
              }),
        } as NodeJS.ProcessEnv,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string };
      exitCode = typeof failure.code === "number" ? failure.code : 1;
      stdout = failure.stdout ?? "";
      stderr = failure.stderr ?? failure.message ?? "";
    }
    const invocation: RecordedInvocation = {
      binary,
      argv: [...argv],
      exitCode,
      stdout,
      stderr,
      startedAt,
      finishedAt: this.clock().toISOString(),
      ...(context.scenarioId === undefined ? {} : { scenarioId: context.scenarioId }),
    };
    this.invocations.push(invocation);
    await this.options.admission?.after(request, invocation);
    return structuredClone(invocation);
  }

  /** Run and refuse to continue on a non-zero exit. For steps whose failure
   *  means the campaign cannot honestly proceed (provisioning, onboarding). */
  async runOrThrow(
    binary: CampaignBinary,
    argv: readonly string[],
    context: { scenarioId?: string; cwd?: string } = {},
  ): Promise<RecordedInvocation> {
    const invocation = await this.run(binary, argv, context);
    if (invocation.exitCode !== 0) {
      throw new Error(
        `campaign step failed: ${binary} ${argv.join(" ")} exited ${invocation.exitCode}\n${invocation.stderr.trim()}`,
      );
    }
    return invocation;
  }
}

/**
 * Resolve and validate both binaries, then build a driver. Fails closed: an
 * unresolvable binary, or one that realpaths inside this checkout, refuses here
 * rather than at the first turn.
 */
export async function createCliDriver(options: CliDriverOptions): Promise<CliDriver> {
  if (
    options.activeOrg !== undefined &&
    (!isAbsolute(options.activeOrg.orgHome) || !isAbsolute(options.activeOrg.stateHome))
  ) {
    throw new CliDriverError("org-selection-not-isolated", "campaign org and state homes must be absolute paths");
  }
  const checkoutRoot = await realpath(options.checkoutRoot);
  for (const [binary, path] of [
    ["cormidia", options.cormidiaPath],
    ["cormidia-job", options.cormidiaJobPath],
  ] as const) {
    let resolved: string;
    try {
      resolved = await realpath(path);
    } catch {
      throw new CliDriverError("binary-unresolved", `${binary} does not resolve at ${path}`);
    }
    if (isInside(checkoutRoot, resolved)) {
      throw new CliDriverError(
        "binary-inside-checkout",
        `${binary} resolves to ${resolved}, inside this checkout — that is a source-backed \`link:local\` install, ` +
          `not the packaged product a user gets`,
      );
    }
  }
  return new CliDriver({ ...options, checkoutRoot });
}

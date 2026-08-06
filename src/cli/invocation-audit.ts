import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  beginCliInvocation,
  finishCliInvocation,
  type InvocationRecord,
  type RunningCliInvocation,
} from "../runtime/invocation-ledger.js";
import { scrubSecrets } from "../runtime/runlog/redact.js";
import { resolveCormidiaHomes } from "../org/home.js";

interface InvocationAuditState {
  readonly startedAt: Date;
  readonly startedMs: number;
  readonly invocationId: string;
  readonly command: string;
  readonly subcommand?: string;
  readonly argv: string[];
  dryRun: boolean;
  stateHome?: string;
  begun: boolean;
  org?: string;
  app?: string;
  parentTaskId?: string;
  outcome?: string;
  itemsClaimed?: number;
  itemsPreviewed?: number;
  provenance?: Record<string, string>;
}

export interface CliInvocationResult {
  outcome?: string;
  org?: string;
  app?: string;
  parentTaskId?: string;
  dryRun?: boolean;
  itemsClaimed?: number;
  itemsPreviewed?: number;
  provenance?: Record<string, string>;
}

const storage = new AsyncLocalStorage<InvocationAuditState>();
const FIRST_POSITIONAL_SUBCOMMANDS = new Set(["app", "org", "scheduler", "task", "episode", "learn"]);
const SECRET_FLAG = /^--[^=]*(?:api[-_]?key|secret|token|password|passwd|pwd|credential)[^=]*$/i;

/** Run one top-level CLI dispatch inside the command-level audit scope. Help,
 * version, and the no-command usage banner are intentionally handled outside
 * this function: they have no command execution and therefore no state audit. */
export async function runAuditedCliInvocation(rawArgv: string[], run: () => Promise<number>): Promise<number> {
  const command = rawArgv[0] ?? "unknown";
  const subcommand = inferSubcommand(command, rawArgv.slice(1));
  const inferredApp = inferApp(command, rawArgv.slice(1));
  const parentTaskId = valueAfter(rawArgv, "--parent-task");
  const state: InvocationAuditState = {
    startedAt: new Date(),
    startedMs: Date.now(),
    invocationId: `cli-${randomUUID()}`,
    command,
    ...(subcommand === undefined ? {} : { subcommand }),
    argv: redactArgv(rawArgv),
    dryRun: rawArgv.includes("--dry-run"),
    begun: false,
    ...(inferredApp === undefined ? {} : { app: inferredApp }),
    ...(parentTaskId === undefined ? {} : { parentTaskId }),
  };

  return storage.run(state, async () => {
    const resolved = await safelyResolveInitialHome(rawArgv);
    if (resolved !== undefined) {
      await bindCliInvocationStateHome(resolved.stateHome, {
        ...(resolved.org === undefined ? {} : { org: resolved.org }),
      });
    }

    let exitCode: number;
    try {
      exitCode = await run();
    } catch (error) {
      reportCliInvocationFailure(error);
      exitCode = 1;
    }

    if (!state.begun || state.stateHome === undefined) return exitCode;
    const finishedAt = new Date();
    const record: InvocationRecord & { invocationId: string } = {
      schema_version: 2,
      at: state.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      kind: "cli",
      invocationId: state.invocationId,
      command: state.command,
      ...(state.subcommand === undefined ? {} : { subcommand: state.subcommand }),
      argv: state.argv,
      ...(state.org === undefined ? {} : { org: state.org }),
      ...(state.app === undefined ? {} : { app: state.app }),
      dryRun: state.dryRun,
      ...(state.itemsClaimed === undefined ? {} : { itemsClaimed: state.itemsClaimed }),
      ...(state.itemsPreviewed === undefined ? {} : { itemsPreviewed: state.itemsPreviewed }),
      outcome: scrubSecrets(state.outcome ?? (exitCode === 0 ? "completed" : `failed: exit ${exitCode}`)),
      exitCode,
      wallClockMs: Math.max(0, Date.now() - state.startedMs),
      ...(state.parentTaskId === undefined ? {} : { parentTaskId: state.parentTaskId }),
      ...(state.provenance === undefined ? {} : { provenance: state.provenance }),
    };
    try {
      await finishCliInvocation(state.stateHome, record);
    } catch (error) {
      // The terminal journal is written before the append attempt. Preserve
      // the command's real exit code: changing a successful external mutation
      // into a retry signal would invite duplicate effects. The next command
      // reconciles this stable invocation identity.
      console.error(
        `cormidia: invocation audit append failed for ${state.invocationId}; ` +
          `terminal recovery evidence remains under ${state.stateHome}/state/invocation-journal: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return exitCode;
  });
}

/** Bind the current command as soon as its state home is known. Lifecycle
 * commands call this before their first durable domain mutation. Outside the
 * top-level CLI scope (unit-level direct command calls), it is a no-op. */
export async function bindCliInvocationStateHome(
  stateHome: string,
  identity: { org?: string; app?: string } = {},
): Promise<void> {
  const state = storage.getStore();
  if (state === undefined) return;
  const normalized = resolve(stateHome);
  if (state.begun) {
    if (state.stateHome !== normalized) {
      throw new Error(
        `invocation audit state home changed from ${state.stateHome} to ${normalized}; refusing ambiguous command`,
      );
    }
    if (identity.org !== undefined) state.org = identity.org;
    if (identity.app !== undefined) state.app = identity.app;
    return;
  }
  state.stateHome = normalized;
  if (identity.org !== undefined) state.org = identity.org;
  if (identity.app !== undefined) state.app = identity.app;
  const running: RunningCliInvocation = {
    schema_version: 2,
    at: state.startedAt.toISOString(),
    kind: "cli",
    invocationId: state.invocationId,
    command: state.command,
    ...(state.subcommand === undefined ? {} : { subcommand: state.subcommand }),
    argv: state.argv,
    ...(state.org === undefined ? {} : { org: state.org }),
    ...(state.app === undefined ? {} : { app: state.app }),
    dryRun: state.dryRun,
    ...(state.parentTaskId === undefined ? {} : { parentTaskId: state.parentTaskId }),
  };
  await beginCliInvocation(normalized, running);
  state.begun = true;
}

/** The state home this invocation's audit row is bound to, if any. A cross-org
 * lifecycle command needs to tell "nothing is journaling yet" apart from
 * "already bound to the invoking org", because rebinding is a refusal. */
export function currentCliInvocationStateHome(): string | undefined {
  return storage.getStore()?.stateHome;
}

/**
 * Move this invocation's audit binding off a state home the command has just
 * removed and onto a ledger that outlives it.
 *
 * Writing the terminal row back into the removed path re-creates
 * `<state>/invocations/*.jsonl` and `<state>/state/invocation-journal` inside
 * the tree the operator just retired, so `org list` and `doctor` immediately
 * report the archived org as a live orphan again. Dropping the row instead
 * would silently exempt exactly the most destructive commands from the audit
 * every other command pays. So the row moves rather than vanishing: the caller
 * names a durable ledger outside the removed tree, this re-opens the same
 * stable invocation identity there (so a crash between the removal and the
 * terminal row still leaves running evidence), and the terminal row lands
 * there when the command returns.
 *
 * The running row already written inside the removed state home is not lost
 * either: a command that removes a state home is required to have archived it
 * first, so that row is preserved in the verified archive.
 *
 * Returns whether the binding actually moved — a no-op when the removed tree
 * is not the one this invocation is journaling to (the ordinary cross-org
 * case, where the invoking org's ledger is the right home for the row).
 */
export async function redirectCliInvocationLedger(removedStateHome: string, ledgerHome: string): Promise<boolean> {
  const state = storage.getStore();
  if (state === undefined || state.stateHome !== resolve(removedStateHome)) return false;
  const destination = resolve(ledgerHome);
  const running: RunningCliInvocation = {
    schema_version: 2,
    at: state.startedAt.toISOString(),
    kind: "cli",
    invocationId: state.invocationId,
    command: state.command,
    ...(state.subcommand === undefined ? {} : { subcommand: state.subcommand }),
    argv: state.argv,
    ...(state.org === undefined ? {} : { org: state.org }),
    ...(state.app === undefined ? {} : { app: state.app }),
    dryRun: state.dryRun,
    ...(state.parentTaskId === undefined ? {} : { parentTaskId: state.parentTaskId }),
  };
  state.stateHome = destination;
  state.begun = false;
  await beginCliInvocation(destination, running);
  state.begun = true;
  return true;
}

export function reportCliInvocation(result: CliInvocationResult): void {
  const state = storage.getStore();
  if (state === undefined) return;
  if (result.outcome !== undefined) state.outcome = result.outcome;
  if (result.org !== undefined) state.org = result.org;
  if (result.app !== undefined) state.app = result.app;
  if (result.parentTaskId !== undefined) state.parentTaskId = result.parentTaskId;
  if (result.dryRun !== undefined) state.dryRun = result.dryRun;
  if (result.itemsClaimed !== undefined) state.itemsClaimed = result.itemsClaimed;
  if (result.itemsPreviewed !== undefined) state.itemsPreviewed = result.itemsPreviewed;
  if (result.provenance !== undefined) {
    state.provenance = Object.fromEntries(
      Object.entries(result.provenance).map(([key, value]) => [key, scrubSecrets(value)]),
    );
  }
}

export function reportCliInvocationFailure(error: unknown): void {
  reportCliInvocation({
    outcome: `failed: ${scrubSecrets(error instanceof Error ? error.message : String(error))}`,
  });
}

export function redactArgv(argv: readonly string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;
  for (const raw of argv) {
    if (redactNext) {
      redacted.push("[REDACTED:argv-value]");
      redactNext = false;
      continue;
    }
    const equals = raw.indexOf("=");
    const flag = equals === -1 ? raw : raw.slice(0, equals);
    if (SECRET_FLAG.test(flag)) {
      if (equals === -1) {
        redacted.push(flag);
        redactNext = true;
      } else {
        redacted.push(`${flag}=[REDACTED:argv-value]`);
      }
      continue;
    }
    redacted.push(scrubSecrets(raw));
  }
  return redacted;
}

async function safelyResolveInitialHome(argv: string[]): Promise<{ stateHome: string; org?: string } | undefined> {
  const explicitState =
    valueAfter(argv, "--state-home") ?? valueAfter(argv, "--home") ?? process.env["CORMIDIA_STATE_HOME"];
  const explicitOrg = valueAfter(argv, "--org-home") ?? process.env["CORMIDIA_ORG_HOME"];

  // org init/use select a new state home. Even an explicit path is not enough
  // to create it here: let the lifecycle command validate its complete plan,
  // then bind the exact target before its first domain mutation.
  const lifecycleSelect = argv[0] === "org" && (argv[1] === "init" || argv[1] === "use");
  if (lifecycleSelect) return undefined;

  if (explicitState !== undefined) {
    if (explicitOrg !== undefined) {
      try {
        const org = (
          await resolveCormidiaHomes({
            stateHome: explicitState,
            orgHome: explicitOrg,
          })
        ).appsFile.org.name;
        return { stateHome: resolve(explicitState), org };
      } catch {
        // The explicit state path is still safe audit authority even when org
        // configuration is missing or is exactly what the command will diagnose.
      }
    }
    // A state path alone must not borrow the active org pointer. They are not
    // a safely established pair, and doing so would misattribute a standalone
    // platform-development command to an unrelated org.
    return { stateHome: resolve(explicitState) };
  }

  try {
    const homes = await resolveCormidiaHomes({
      ...(explicitOrg === undefined ? {} : { orgHome: explicitOrg }),
    });
    return { stateHome: homes.stateHome, org: homes.appsFile.org.name };
  } catch {
    return undefined;
  }
}

function inferSubcommand(command: string, args: string[]): string | undefined {
  const first = args[0];
  if (first === undefined || first.startsWith("--")) return undefined;
  if (FIRST_POSITIONAL_SUBCOMMANDS.has(command)) return first;
  if (command === "bootstrap" && first === "publish") return first;
  if (command === "loop" && first === "rearm") return first;
  if (command === "approvals" && ["list", "review", "show", "status", "revoke", "disposition"].includes(first))
    return first;
  return undefined;
}

function inferApp(command: string, args: string[]): string | undefined {
  const flagApp = valueAfter(args, "--app");
  if (flagApp !== undefined) return flagApp;
  if (command === "plan") return args.find((arg) => !arg.startsWith("--"));
  if (command === "new-app") return valueAfter(args, "--name") ?? args.find((arg) => !arg.startsWith("--"));
  if (command === "app") return args.slice(1).find((arg) => !arg.startsWith("--"));
  return undefined;
}

function valueAfter(args: readonly string[], flag: string): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === flag) {
      const value = args[index + 1];
      return value !== undefined && !value.startsWith("--") ? value : undefined;
    }
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

/** Explicit policy anchor for docs/tests: a command with neither an explicit
 * nor a validated active state home cannot create a durable org-scoped row. */
export const NO_STATE_HOME_AUDIT_POLICY =
  "help/version/no-command and commands with no explicit or safely resolved state home are not journaled; " +
  "a command that removes its own audit state home redirects its terminal row to a durable ledger outside " +
  "that tree, so the row is still written and cannot recreate the removed state home";

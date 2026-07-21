import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { OperonHomes } from "../org/home.js";
import { GhCliOps } from "../loop/github.js";
import type { GhOps } from "../loop/github.js";
import { executeTicketRearm, planTicketRearm } from "../loop/claim-recovery.js";

export interface ClaimRearmIo {
  interactive: boolean;
  ask(prompt: string): Promise<string>;
  out(line: string): void;
}

export interface ClaimRearmDependencies {
  ghFor?: (repo: string) => GhOps;
}

export async function cmdClaimRearm(
  args: string[],
  homes: OperonHomes,
  io: ClaimRearmIo = defaultIo(),
  dependencies: ClaimRearmDependencies = {},
): Promise<number> {
  let appName: string | undefined;
  let ticket: number | undefined;
  let reason: string | undefined;
  let actor: string | undefined;
  let priorAllowance: number | undefined;
  let intendedAllowance: number | undefined;
  let execute = false;
  let confirm: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--app") appName = needValue(args, ++i, arg);
    else if (arg === "--ticket") ticket = integerValue(needValue(args, ++i, arg), arg);
    else if (arg === "--reason") reason = needValue(args, ++i, arg);
    else if (arg === "--actor") actor = needValue(args, ++i, arg);
    else if (arg === "--from-allowance") priorAllowance = integerValue(needValue(args, ++i, arg), arg);
    else if (arg === "--to-allowance") intendedAllowance = integerValue(needValue(args, ++i, arg), arg);
    else if (arg === "--execute") execute = true;
    else if (arg === "--confirm") confirm = needValue(args, ++i, arg);
    else throw new Error(`loop rearm: unknown flag "${arg}"`);
  }
  if (appName === undefined) throw new Error("loop rearm: --app is required");
  if (ticket === undefined) throw new Error("loop rearm: --ticket is required");
  if (reason === undefined) throw new Error("loop rearm: --reason is required");
  if (actor === undefined) throw new Error("loop rearm: --actor is required");
  if (priorAllowance === undefined) throw new Error("loop rearm: --from-allowance is required");
  if (intendedAllowance === undefined) throw new Error("loop rearm: --to-allowance is required");
  const app = homes.appsFile.apps.find((candidate) => candidate.name === appName);
  if (app === undefined) throw new Error(`loop rearm: unknown app "${appName}" in apps.yaml`);
  const input = {
    root: homes.stateHome,
    app: appName,
    issueNumber: ticket,
    reason,
    actor,
    priorAllowance,
    intendedAllowance,
    gh: dependencies.ghFor?.(app.repo) ?? new GhCliOps(app.repo),
  };
  const plan = await planTicketRearm(input);
  const exactConfirmation = `${appName}#${ticket}`;
  io.out(
    `${plan.replay ? "REPLAY" : "PREVIEW"} ${exactConfirmation}: ` +
      `allowance ${priorAllowance}->${intendedAllowance}; ${plan.priorLabel}->op:ready; ` +
      `actor=${actor}; reason=${reason}; rearm=${plan.rearmId}`,
  );
  if (!execute) {
    io.out(`No changes made to the claim (dispatched CLI: invocation audit only). Execute with --execute --confirm ${exactConfirmation}.`);
    return 0;
  }
  if (plan.replay) {
    io.out(`Already completed ${plan.rearmId}; no changes made.`);
    return 0;
  }
  if (confirm === undefined && io.interactive) {
    confirm = (await io.ask(`Type ${exactConfirmation} to execute: `)).trim();
  }
  if (confirm !== exactConfirmation) {
    throw new Error(`loop rearm: --confirm must exactly match ${exactConfirmation}`);
  }
  await executeTicketRearm(input);
  io.out(`Re-armed ${exactConfirmation}: durable allowance ${priorAllowance}->${intendedAllowance}; op:ready.`);
  return 0;
}

function defaultIo(): ClaimRearmIo {
  return {
    interactive: stdin.isTTY === true,
    ask: async (prompt) => {
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        return await rl.question(prompt);
      } finally {
        rl.close();
      }
    },
    out: (line) => console.log(line),
  };
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`loop rearm: ${flag} requires a value`);
  return value;
}

function integerValue(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`loop rearm: ${flag} must be a non-negative integer`);
  return parsed;
}

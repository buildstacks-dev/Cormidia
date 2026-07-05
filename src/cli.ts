#!/usr/bin/env node
// Operon CLI. `loop` carries claude-loop's standalone UX forward as a
// subcommand (PURPOSE.md → Repo shape).
//
// This file is a thin dispatch table over one module per subcommand
// (src/cli/roles.ts, src/cli/doctor.ts, ...). Adding a subcommand is a new
// file + one registry line here — never a growing shared switch (M0.1).

import { NotImplementedError } from "./runtime/types.js";
import { cmdRoles } from "./cli/roles.js";
import { cmdDoctor } from "./cli/doctor.js";

const USAGE = `operon — org runtime for a team of AI agents

Usage:
  operon roles [path]     validate roles.yaml and print the org chart
  operon doctor           check runtime adapter status
  operon loop             run the build loop over ready tickets (stub)
  operon run-role <name>  run one role turn now (stub)
`;

interface CliCommand {
  run(args: string[]): number | Promise<number>;
}

function notImplemented(cmd: string): CliCommand {
  return {
    run: () => {
      throw new NotImplementedError(`command "${cmd}"`, "src/loop/loop.ts and src/org/");
    },
  };
}

const COMMANDS: Record<string, CliCommand> = {
  roles: { run: (args) => cmdRoles(args[0]) },
  doctor: { run: () => cmdDoctor() },
  loop: notImplemented("loop"),
  "run-role": notImplemented("run-role"),
};

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    const command = cmd ? COMMANDS[cmd] : undefined;
    if (!command) {
      console.log(USAGE);
      return cmd ? 1 : 0;
    }
    return await command.run(rest);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

process.exitCode = await main();

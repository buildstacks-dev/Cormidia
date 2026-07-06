#!/usr/bin/env node
// Operon CLI. `loop` carries claude-loop's standalone UX forward as a
// subcommand (PURPOSE.md → Repo shape).
//
// This file is a thin dispatch table over one module per subcommand
// (src/cli/roles.ts, src/cli/doctor.ts, ...). Adding a subcommand is a new
// file + one registry line here — never a growing shared switch (M0.1).

import { NotImplementedError } from "./runtime/types.js";
import { cmdRoles } from "./cli/roles.js";
import { cmdApps } from "./cli/apps.js";
import { cmdBootstrap } from "./cli/bootstrap.js";
import { cmdDoctor } from "./cli/doctor.js";
import { cmdPipelines } from "./cli/pipelines.js";
import { cmdPruneRuns } from "./cli/prune-runs.js";
import { cmdRunRole } from "./cli/run-role.js";

const USAGE = `operon — org runtime for a team of AI agents

Usage:
  operon roles [path]      validate roles.yaml and print the org chart
  operon apps [path]       validate apps.yaml and print the app registry
  operon pipelines [path]  validate pipelines.yaml and print the pass table
  operon bootstrap [path] [--scan-only]
                           scan a target repo and emit the single-app
                           .operon/org/ skeleton (--scan-only: report only)
  operon doctor            check runtime adapter status
  operon prune-runs [root] [--retention-days N]
                           delete finalized run dirs past retention
  operon loop              run the build loop over ready tickets (stub)
  operon run-role <role> [--app <app>] [--turn <id>] [--template <path>] [--dry-run]
                           one role turn as a one-pass pipeline (--dry-run
                           prints the assembled brief, token-free)
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
  apps: { run: (args) => cmdApps(args[0]) },
  bootstrap: { run: (args) => cmdBootstrap(args) },
  pipelines: { run: (args) => cmdPipelines(args[0]) },
  doctor: { run: () => cmdDoctor() },
  "prune-runs": { run: (args) => cmdPruneRuns(args) },
  loop: notImplemented("loop"),
  "run-role": { run: (args) => cmdRunRole(args) },
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

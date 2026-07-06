#!/usr/bin/env node
// Operon CLI. `loop` carries claude-loop's standalone UX forward as a
// subcommand (docs/PURPOSE.md → Repo shape).
//
// This file is a thin dispatch table over one module per subcommand
// (src/cli/roles.ts, src/cli/doctor.ts, ...). Adding a subcommand is a new
// file + one registry line here — never a growing shared switch (M0.1).

import { cmdRoles } from "./cli/roles.js";
import { cmdApps } from "./cli/apps.js";
import { cmdApprovals } from "./cli/approvals.js";
import { cmdBootstrap } from "./cli/bootstrap.js";
import { cmdBudget } from "./cli/budget.js";
import { cmdDispatch } from "./cli/dispatch.js";
import { cmdDoctor } from "./cli/doctor.js";
import { cmdLoop } from "./cli/loop.js";
import { cmdPlan } from "./cli/plan.js";
import { cmdPipelines } from "./cli/pipelines.js";
import { cmdPruneRuns } from "./cli/prune-runs.js";
import { cmdRunRole } from "./cli/run-role.js";

const USAGE = `operon — org runtime for a team of AI agents

Usage:
  operon roles [path]      validate roles.yaml and print the org chart
  operon apps [path]       validate apps.yaml and print the app registry
  operon pipelines [path]  validate pipelines.yaml and print the pass table
  operon bootstrap [path] [--scan-only] [--answers <file>] [--org-home <path>]
                           scan a target repo, walk the alignment
                           questionnaire (interactive, or --answers
                           answers.json), and emit the .operon/ tree
                           (--scan-only: report only)
  operon plan <app> [--topic <string>] [--dry-run] [--workdir <path>]
                           open a Planner co-planning session for an
                           onboarded app
  operon doctor            check runtime adapter status
  operon approvals [review|show <id>] [--home <path>]
                           inspect or decide the critical-op approval queue
  operon budget [--home <path>] [--apps <path>]
                           summarize monthly app spend and budget pauses
  operon dispatch [--home <path>] [--dry-run]
                           run one autonomous scheduler tick
  operon prune-runs [root] [--retention-days N]
                           delete finalized run dirs past retention
  operon loop --app <app> [--once|--follow] [--dry-run]
                           run the build loop over ready tickets
  operon run-role <role> [--app <app>] [--turn <id>] [--template <path>] [--dry-run]
                           one role turn as a one-pass pipeline (--dry-run
                           prints the assembled brief, token-free)
`;

interface CliCommand {
  run(args: string[]): number | Promise<number>;
}

const COMMANDS: Record<string, CliCommand> = {
  roles: { run: (args) => cmdRoles(args[0]) },
  apps: { run: (args) => cmdApps(args[0]) },
  approvals: { run: (args) => cmdApprovals(args) },
  bootstrap: { run: (args) => cmdBootstrap(args) },
  budget: { run: (args) => cmdBudget(args) },
  dispatch: { run: (args) => cmdDispatch(args) },
  plan: { run: (args) => cmdPlan(args) },
  pipelines: { run: (args) => cmdPipelines(args[0]) },
  doctor: { run: () => cmdDoctor() },
  "prune-runs": { run: (args) => cmdPruneRuns(args) },
  loop: { run: (args) => cmdLoop(args) },
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

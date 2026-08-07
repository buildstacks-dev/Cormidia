// `cormidia-job` — the second binary (docs/jobs/design.md §12).
//
// Deliberately NOT a `cormidia` subcommand. A subcommand would read as part of
// the governed org runtime and import every guarantee §3 explicitly withholds;
// two names carry two promises. Its flag surface is its own for the same reason
// — this module may not import src/cli (import rank forbids it), which is the
// rule doing its job rather than an inconvenience.

import { join } from "node:path";
import { resolveCormidiaHomes } from "../org/home.js";
import { loadRoles } from "../org/roles.js";
import { getRuntime } from "../runtime/registry.js";
import type { RoleConfig } from "../runtime/types.js";
import { JobConfigError, loadJobConfig } from "./config.js";
import { JobJournalError } from "./journal.js";
import { type JobRunResult, JobRunError, runJob } from "./runner.js";
import { JobStepError } from "./step.js";

const OPERATOR_ROLE = "operator";

const USAGE = `Usage:
  cormidia-job run <config.yaml> [--workdir <path>] [--decide-checkpoint <step-id>] [--json]
  cormidia-job explain <config.yaml> [--json]

Runs a dependency-ordered graph of provider steps once or on demand. Jobs are
org work, not product work: no ticket, no PR, no GitHub, and no independent
review — a completed step means the provider returned AND every declared output
check passed. See docs/jobs/design.md §3 for what jobs deliberately do not
inherit.

  run                 execute (or resume) the job; completed steps are never re-run
  explain             validate the config and print the execution plan; spends nothing
  --workdir <path>    where declared outputs are read/written (default: cwd)
  --decide-checkpoint approve a parked checkpoint step and continue
  --json              machine-readable result
`;

export async function cmdJob(argv: string[]): Promise<number> {
  const subcommand = argv[0];
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    process.stdout.write(USAGE);
    return subcommand === undefined ? 1 : 0;
  }
  if (subcommand !== "run" && subcommand !== "explain") {
    process.stderr.write(`cormidia-job: unknown subcommand "${subcommand}"\n\n${USAGE}`);
    return 1;
  }

  const parsed = parseArgs(argv.slice(1));
  const config = await loadJobConfig(parsed.configPath);

  if (subcommand === "explain") {
    printExplain(config, parsed);
    return 0;
  }

  const homes = await resolveCormidiaHomes();
  const { roles } = await loadRoles(join(homes.orgHome, "roles.yaml"));
  const role = roles.find((entry) => entry.name === OPERATOR_ROLE);
  if (role === undefined) {
    throw new Error(
      `roles.yaml defines no "${OPERATOR_ROLE}" role. Jobs run under a single generic non-product role that ` +
        "carries the authority ceiling; add it before running a job (docs/jobs/design.md §4).",
    );
  }
  assertAppKnown(
    config.app,
    homes.appsFile.apps.map((app) => app.name),
  );

  const result = await runJob({
    config,
    workdir: parsed.workdir,
    stateHome: homes.stateHome,
    orgDir: homes.stateHome,
    role,
    runtimeFor: (harness: RoleConfig["runtime"]) => getRuntime(harness),
    ...(parsed.decideCheckpoint === undefined
      ? {}
      : { checkpointDecided: async (stepId: string) => stepId === parsed.decideCheckpoint }),
    ...(parsed.json
      ? {}
      : {
          onProgress: (message: string): void => {
            process.stdout.write(`  ${message}\n`);
          },
        }),
  });

  if (parsed.json) {
    process.stdout.write(`${JSON.stringify({ ok: result.status === "completed", result }, null, 2)}\n`);
  } else {
    printResult(config.job, result);
  }
  return result.status === "completed" ? 0 : 1;
}

interface ParsedArgs {
  configPath: string;
  workdir: string;
  json: boolean;
  decideCheckpoint?: string;
}

function parseArgs(args: string[]): ParsedArgs {
  let configPath: string | undefined;
  let workdir = process.cwd();
  let json = false;
  let decideCheckpoint: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (arg === "--workdir") workdir = need(args, ++i, "--workdir");
    else if (arg === "--decide-checkpoint") decideCheckpoint = need(args, ++i, "--decide-checkpoint");
    else if (arg !== undefined && !arg.startsWith("--") && configPath === undefined) configPath = arg;
    else throw new Error(`cormidia-job: unexpected argument "${arg}"`);
  }
  if (configPath === undefined) throw new Error("cormidia-job: a job config path is required");
  return { configPath, workdir, json, ...(decideCheckpoint === undefined ? {} : { decideCheckpoint }) };
}

function need(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`cormidia-job: ${flag} requires a value`);
  return value;
}

/** An app-scoped job must name a registered app: silently treating an unknown
 * app as unscoped would put its evidence somewhere the operator will not look. */
function assertAppKnown(app: string | null, known: string[]): void {
  if (app === null || known.includes(app)) return;
  throw new Error(
    `cormidia-job: unknown app "${app}" in apps.yaml (registered: ${known.join(", ") || "none"}). ` +
      "Omit `app:` for an unscoped job.",
  );
}

function printExplain(config: Awaited<ReturnType<typeof loadJobConfig>>, parsed: ParsedArgs): void {
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, config }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`[cormidia-job explain] ${config.job}\n`);
  process.stdout.write("Mode: validation only; provider turns: 0; state writes: 0\n");
  process.stdout.write(
    `Scope: ${config.app === null ? "unscoped (evidence under runs/adhoc/)" : `app ${config.app}`}\n`,
  );
  process.stdout.write(`Working directory: ${parsed.workdir}\n`);
  process.stdout.write(`Config hash: ${config.configHash}\n`);
  if (config.description !== "") process.stdout.write(`Description: ${config.description}\n`);
  process.stdout.write(`\nSteps (${config.steps.length}), executed one at a time in dependency order:\n`);
  for (const step of config.steps) {
    const depends = step.dependsOn.length === 0 ? "root" : `after ${step.dependsOn.join(", ")}`;
    if (step.kind === "checkpoint") {
      process.stdout.write(`  ${step.id} [checkpoint] (${depends}) — parks for an operator decision\n`);
      continue;
    }
    const assignment =
      step.assignment === undefined
        ? "operator role's configured tuple"
        : `${step.assignment.harness}/${step.assignment.model}@${step.assignment.effort}`;
    const checks =
      step.outputs.length === 0
        ? "no declared outputs — result will be completed-unverified"
        : step.outputs.map((output) => `${output.path} (${output.check.kind})`).join(", ");
    process.stdout.write(`  ${step.id} (${depends}) — ${assignment}\n    outputs: ${checks}\n`);
  }
  process.stdout.write(
    "\nNot inherited: independent review, typed merit verdicts, ticket lifecycle, GitHub, learning input.\n" +
      "Inherited: the critical-ops gate, per-turn budget ceilings, exactly-once ledger settlement.\n",
  );
}

function printResult(job: string, result: JobRunResult): void {
  process.stdout.write(`\n[cormidia-job] ${job}: ${result.status}\n`);
  process.stdout.write(`Completed steps: ${result.completedStepIds.join(", ") || "none"}\n`);
  process.stdout.write(`Provider turns this run: ${result.providerTurns}\n`);
  if (result.status === "awaiting_checkpoint") {
    process.stdout.write(
      `Parked at checkpoint "${result.stoppedAtStepId}": ${result.summary ?? ""}\n` +
        `Resume with: cormidia-job run <config> --decide-checkpoint ${result.stoppedAtStepId}\n`,
    );
  }
  if (result.status === "failed") {
    process.stdout.write(
      `Failed at "${result.stoppedAtStepId}" (${result.reasonCode ?? "unknown"}): ${result.summary ?? ""}\n` +
        "Completed steps are durable; fix the cause and re-run to resume from this step.\n",
    );
  }
}

/** Maps a typed job error onto an actionable message. Every branch names what
 * the operator should do next; a job that dies without a next step is a bug. */
export function describeJobError(error: unknown): string {
  if (error instanceof JobConfigError) return `cormidia-job: invalid job config [${error.code}]\n  ${error.message}`;
  if (error instanceof JobJournalError) return `cormidia-job: cannot resume [${error.code}]\n  ${error.message}`;
  if (error instanceof JobRunError) return `cormidia-job: refused [${error.code}]\n  ${error.message}`;
  if (error instanceof JobStepError) return `cormidia-job: step input missing [${error.code}]\n  ${error.message}`;
  return `cormidia-job: ${error instanceof Error ? error.message : String(error)}`;
}

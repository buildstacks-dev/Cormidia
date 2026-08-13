// `cormidia-job` — the second binary (docs/jobs/design.md §12).
//
// Not a `cormidia` subcommand: two names carry §3's two promises and preserve the one-way import graph.

import { join } from "node:path";
import { resolveCormidiaHomes } from "../org/home.js";
import { loadRoles } from "../org/roles.js";
import { getRuntime } from "../runtime/registry.js";
import type { RoleConfig } from "../runtime/types.js";
import { validateJobAssignments } from "./admission.js";
import { JobConfigError, loadJobConfig } from "./config.js";
import { JobJournalError } from "./journal.js";
import { type JobRunResult, JobRunError, runJob } from "./runner.js";
import { JobStepError } from "./step.js";
import { createCliProgressReporter, extractProgressArgs } from "../runtime/cli-progress.js";
import { installProcessCancellation } from "../runtime/process-cancellation.js";
import { JOB_USAGE, jobProgressState, printJobResult } from "./presentation.js";

const OPERATOR_ROLE = "operator";

export async function cmdJob(argv: string[]): Promise<number> {
  const subcommand = argv[0];
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    process.stdout.write(JOB_USAGE);
    return subcommand === undefined ? 1 : 0;
  }
  if (subcommand !== "run" && subcommand !== "explain") {
    process.stderr.write(`cormidia-job: unknown subcommand "${subcommand}"\n\n${JOB_USAGE}`);
    return 1;
  }

  const progressArgs = extractProgressArgs(argv.slice(1), "cormidia-job");
  const parsed = parseArgs(progressArgs.rest);
  const config = await loadJobConfig(parsed.configPath);

  if (subcommand === "explain") {
    await validateJobAssignments(config);
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

  const reporter = createCliProgressReporter({
    stateHome: homes.stateHome,
    command: "cormidia-job",
    scope: config.app ?? config.job,
    mode: progressArgs.mode,
  });
  reporter.phase("preflight", "started");
  const cancellation = installProcessCancellation();
  let result: JobRunResult;
  try {
    result = await runJob({
      config,
      workdir: parsed.workdir,
      stateHome: homes.stateHome,
      orgDir: homes.stateHome,
      role,
      runtimeFor: (harness: RoleConfig["runtime"]) => getRuntime(harness),
      signal: cancellation.signal,
      observer: reporter.observer,
      onProgress: (message: string): void => reporter.phase(message),
      ...(parsed.decideCheckpoint === undefined
        ? {}
        : { checkpointDecided: async (stepId: string) => stepId === parsed.decideCheckpoint }),
    });
    reporter.terminal(cancellation.signal.aborted ? "cancelled" : jobProgressState(result.status), {
      artifactRef: `job:${config.job}`,
      ...(result.status === "completed"
        ? {}
        : { nextAction: `inspect ${reporter.relativeLogRef} and re-run the same job config` }),
    });
  } catch (error) {
    reporter.terminal(cancellation.signal.aborted ? "cancelled" : "failed", {
      nextAction: `inspect ${reporter.relativeLogRef}`,
    });
    throw error;
  } finally {
    cancellation.dispose();
    reporter.dispose();
  }

  if (parsed.json) {
    process.stdout.write(`${JSON.stringify({ ok: result.status === "completed", result }, null, 2)}\n`);
  } else {
    printJobResult(config.job, result);
  }
  return cancellation.exitCode ?? (result.status === "completed" ? 0 : 1);
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

/** Maps a typed job error onto an actionable message. Every branch names what
 * the operator should do next; a job that dies without a next step is a bug. */
export function describeJobError(error: unknown): string {
  if (error instanceof JobConfigError) return `cormidia-job: invalid job config [${error.code}]\n  ${error.message}`;
  if (error instanceof JobJournalError) return `cormidia-job: cannot resume [${error.code}]\n  ${error.message}`;
  if (error instanceof JobRunError) return `cormidia-job: refused [${error.code}]\n  ${error.message}`;
  if (error instanceof JobStepError) return `cormidia-job: step input missing [${error.code}]\n  ${error.message}`;
  return `cormidia-job: ${error instanceof Error ? error.message : String(error)}`;
}

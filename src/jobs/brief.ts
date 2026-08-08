// Output handoff — CORMIDIA-C-B30-003 handoff clause / CF-B30-HND (docs/jobs/design.md §7).
//
// A step's brief is its objective plus the resolved CONTENT of every dependency's
// declared outputs. Files are read at step start, so a step sees what is actually
// on disk rather than a cached copy — the whole reason the handoff goes through
// files instead of through memory is that a job can resume days later in a new
// process.
//
// This factors the pattern src/org/plan-auto.ts, ticket-episode-runtime.ts and
// episode-planner/execution.ts each re-implement (renderPlanningProviderBrief and
// friends). Jobs are the fourth caller and the first with a shared version.

import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { JobConfig, JobStep, ProviderJobStep } from "./types.js";

export interface ResolvedInput {
  stepId: string;
  path: string;
  /** Absent when the declared output does not exist or cannot be read. */
  content?: string;
  detail?: string;
}

export interface AssembledBrief {
  text: string;
  inputs: ResolvedInput[];
  /** Declared dependency outputs that could not be read. A provider step whose
   * dependencies are all complete should never see one of these; if it does, the
   * runner refuses rather than prompting the model with a hole. */
  missing: ResolvedInput[];
}

export async function assembleJobBrief(
  config: JobConfig,
  step: ProviderJobStep,
  workdir: string,
): Promise<AssembledBrief> {
  const byId = new Map(config.steps.map((entry) => [entry.id, entry]));
  const inputs: ResolvedInput[] = [];

  for (const dependencyId of [...step.dependsOn].sort()) {
    const dependency = byId.get(dependencyId);
    if (dependency === undefined) continue;
    for (const output of declaredOutputs(dependency)) {
      inputs.push(await readInput(dependencyId, output, workdir));
    }
  }

  const missing = inputs.filter((input) => input.content === undefined);
  return { text: render(config, step, inputs), inputs, missing };
}

function declaredOutputs(step: JobStep): string[] {
  return step.kind === "provider" ? step.outputs.map((output) => output.path) : [];
}

async function readInput(stepId: string, path: string, workdir: string): Promise<ResolvedInput> {
  const target = confine(workdir, path);
  if (target === undefined) {
    return { stepId, path, detail: "resolves outside the job working directory" };
  }
  try {
    return { stepId, path, content: await readFile(target, "utf8") };
  } catch (error) {
    return { stepId, path, detail: error instanceof Error ? error.message : String(error) };
  }
}

function render(config: JobConfig, step: ProviderJobStep, inputs: ResolvedInput[]): string {
  const sections: string[] = [
    `# Job step: ${config.job} / ${step.id}`,
    "",
    "You are executing one bounded step of an operator-defined job. Complete exactly",
    "this step's objective and nothing beyond it. Do not plan or perform other steps.",
    "",
    "## Objective",
    "",
    step.objective,
    "",
  ];

  if (step.outputs.length > 0) {
    sections.push("## Required outputs", "");
    sections.push(
      "Write each file below relative to the working directory. Every one is checked",
      "deterministically after this turn; a missing or empty file fails this step.",
      "",
    );
    for (const output of step.outputs) {
      sections.push(`- \`${output.path}\` — check: ${describeCheck(output.check.kind)}`);
    }
    sections.push("");
  } else {
    sections.push(
      "## Required outputs",
      "",
      "None declared. This step's result cannot be verified mechanically and will be",
      "recorded as completed-unverified.",
      "",
    );
  }

  sections.push("## Prior step outputs", "");
  if (inputs.length === 0) {
    sections.push(
      step.dependsOn.length === 0
        ? "None — this step is a root of the job graph."
        : "None: this step's dependencies declared no outputs.",
    );
  } else {
    for (const input of inputs) {
      sections.push(`### ${input.stepId} — \`${input.path}\``, "");
      sections.push(input.content === undefined ? `_unreadable: ${input.detail ?? "unknown"}_` : input.content.trim());
      sections.push("");
    }
  }

  return `${sections.join("\n").trimEnd()}\n`;
}

function describeCheck(kind: string): string {
  switch (kind) {
    case "non_empty":
      return "must exist and contain non-whitespace content";
    case "json":
      return "must exist and parse as JSON";
    case "schema":
      return "must parse as JSON and satisfy the declared schema";
    case "command":
      return "a declared command must exit zero";
    default:
      return "must exist";
  }
}

function confine(workdir: string, candidate: string): string | undefined {
  if (isAbsolute(candidate)) return undefined;
  const root = resolve(workdir);
  const target = resolve(join(root, candidate));
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return target;
}

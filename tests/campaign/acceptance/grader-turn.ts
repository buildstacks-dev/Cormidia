// campaign/acceptance/grader-turn.ts — run one model-graded axis as a
// Cormidia-invoked turn (CORMIDIA-C-B29-001; CORMIDIA-INV-ACC-7a).
//
// `cormidia run-role` is the mechanism, and the choice is load-bearing rather
// than convenient: INV-ACC-7a's adversarial seed (d) is "a provider SDK
// imported by the campaign runner for 'just the grading'". Grading is itself a
// Cormidia turn, so it settles a ledger row, appears in the invocation audit,
// and obeys the same gate as any other turn. A campaign that called a provider
// directly would be measuring itself.
//
// Ordering here is the contract's, not a convenience: assemble evidence → check
// disjointness (already resolved by the caller) → PROVE CONFINEMENT → construct
// → grade → record the applied set. Confinement is proven before construction
// because "we found no leak" is only a result when the check actually ran, and
// a turn that already exists cannot be un-constructed.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AxisReportRow } from "./campaign-report.js";
import type { CliDriver } from "./cli-driver.js";
import type { AxisEvidenceSet } from "./grader-envelope.js";
import { parseGraderResult } from "./grader-envelope.js";
import type { AssignedAxisGrader } from "./grader-independence.js";
import { proveKeyConfinement, type ConfinementProbe } from "./key-confinement.js";
import type { SealedKey } from "./sealed-key.js";
import type { UngradedReason } from "./verdict-algebra.js";

/** Rendered into the run-role template. Kept here rather than in `prompts/`
 *  because it is campaign instrumentation, not an org role prompt — nothing in
 *  roles.yaml or pipelines.yaml consumes it. */
export function renderGraderPrompt(axis: AxisEvidenceSet, rubricExcerpt: string): string {
  const adversarial =
    axis.axis === "O-5"
      ? "\nYou are adversarial by construction: find claims the artifacts do not support. " +
        "Finding none is a VALID result, but you must justify it explicitly.\n"
      : "";
  return [
    `# Acceptance grading — axis ${axis.axis}`,
    "",
    rubricExcerpt.trim(),
    adversarial,
    "## Evidence you may read, and cite by these exact refs",
    ...axis.items.map((item) => `\n### ${item.ref} (${item.kind})\n\n${item.contents}`),
    "",
    "## Required output",
    "",
    "Emit EXACTLY ONE line of JSON and nothing else:",
    '{"axis":"<axis>","score":0|1|2|3,"justification":"<one sentence citing specific evidence>","citations":["<ref>",...]}',
    "",
    `Every citation must be one of: ${axis.readSet.join(", ")}.`,
    "A score without a citation is discarded and the axis reports ungraded.",
    "",
  ].join("\n");
}

export interface GraderTurnInput {
  driver: CliDriver;
  scenarioId: string;
  appName: string;
  /** The turn identity `run-role` records this invocation under. */
  turnId: string;
  resolution: AssignedAxisGrader;
  evidence: AxisEvidenceSet;
  rubricExcerpt: string;
  /** Every sealed key this turn must not be able to reach. */
  keys: readonly SealedKey[];
  /** Roots the grader turn can open with its own tools. */
  reachableRoots: string[];
  /** Where the rendered template is written. Outside every reachable root. */
  templateDir: string;
  /** Campaign-derived artifacts handed back into this turn, if any. */
  echoedArtifacts?: string[];
  keyPlaintextPaths?: string[];
}

function ungraded(axis: string, resolution: AssignedAxisGrader, reason: UngradedReason): AxisReportRow {
  return {
    axis,
    verdict: "inconclusive",
    score: "ungraded",
    justification: null,
    citations: [],
    ungradedReason: reason,
    grader: resolution.grader.assignment,
    mechanical: false,
    appliedDisjointnessFamilies: resolution.appliedDisjointnessFamilies,
    appliedReadTurnIds: resolution.appliedReadTurnIds,
  };
}

/**
 * Grade one axis. Returns an `ungraded` row rather than throwing on a bad
 * grader result — a malformed or citation-less result is a measurement outcome
 * the report must carry, not a campaign crash. Confinement failure DOES throw:
 * a leaked key voids the measurement, and continuing would produce a score
 * nobody should read.
 */
export async function runGraderTurn(input: GraderTurnInput): Promise<AxisReportRow> {
  const probe: ConfinementProbe = {
    assembledInput: renderGraderPrompt(input.evidence, input.rubricExcerpt),
    reachableRoots: input.reachableRoots,
    ...(input.echoedArtifacts === undefined ? {} : { echoedArtifacts: input.echoedArtifacts }),
    ...(input.keyPlaintextPaths === undefined ? {} : { keyPlaintextPaths: input.keyPlaintextPaths }),
  };
  await proveKeyConfinement(input.keys, probe);

  const templatePath = join(input.templateDir, `${input.scenarioId}.${input.evidence.axis}.md`);
  await mkdir(dirname(templatePath), { recursive: true });
  await writeFile(templatePath, probe.assembledInput, "utf8");

  const assignment = input.resolution.grader.assignment;
  const invocation = await input.driver.run(
    "cormidia",
    ["run-role", "acceptance-grader", "--app", input.appName, "--turn", input.turnId, "--template", templatePath],
    { scenarioId: input.scenarioId },
  );

  if (invocation.exitCode !== 0) {
    return ungraded(input.evidence.axis, input.resolution, "malformed-result");
  }

  const parsed = parseGraderResult(lastJsonLine(invocation.stdout), input.evidence.axis, input.evidence.readSet);
  if (!parsed.ok) {
    const reason: UngradedReason =
      parsed.rejection === "artifact-not-in-read-set"
        ? "artifact-not-in-read-set"
        : parsed.rejection === "citation-missing"
          ? "citation-missing"
          : "malformed-result";
    return ungraded(input.evidence.axis, input.resolution, reason);
  }

  return {
    axis: parsed.axis,
    verdict: "inconclusive",
    score: parsed.score,
    justification: parsed.justification,
    citations: parsed.citations,
    ungradedReason: null,
    grader: assignment,
    mechanical: false,
    appliedDisjointnessFamilies: input.resolution.appliedDisjointnessFamilies,
    appliedReadTurnIds: input.resolution.appliedReadTurnIds,
  };
}

/** The last JSON-shaped line of a turn's output. `run-role` prints progress
 *  around the result, and B-29 §4 refuses a MULTI-marker payload — so this
 *  narrows to the terminal line and lets the parser judge it, rather than
 *  scanning for the most agreeable-looking JSON anywhere in the stream. */
function lastJsonLine(stdout: string): string {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  return lines.at(-1) ?? stdout.trim();
}

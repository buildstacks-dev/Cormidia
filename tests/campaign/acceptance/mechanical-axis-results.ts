// Mechanical L-ACC axis projection. These rows are produced only after every
// model grader for the arm has terminated, so the sealed key never becomes a
// later grader's input (B-28 §4).

import { existsSync } from "node:fs";
import { loadJobConfig } from "../../../src/jobs/config.js";
import type { JobJournal } from "../../../src/jobs/journal.js";
import type { ScenarioConfig } from "./campaign-config.js";
import type { AxisReportRow } from "./campaign-report.js";
import type { EvidenceItem } from "./grader-envelope.js";
import {
  scoreArtifactCompleteness,
  scoreHandoffFidelity,
  scoreKeyCoverage,
  type MechanicalAxisResult,
} from "./mechanical-scoring.js";
import type { ScenarioProvision } from "./provision.js";
import type { SealedKey } from "./sealed-key.js";

type PlanAxis = "P-1" | "P-2" | "P-3" | "P-4";

const PLAN_TERMS: Record<string, Record<PlanAxis, string[]>> = {
  "S-ACC-1": {
    "P-1": ["Rate history", "Timezone correctness"],
    "P-2": ["free tier"],
    "P-3": ["multi-currency", "magic link"],
    "P-4": ["local-first", "PDF export", "mobile app", "project management"],
  },
  "S-ACC-2": {
    "P-1": ["Executable samples", "Reviewer", "Do not rewrite"],
    "P-2": ["getting-started"],
    "P-3": ["#7 and #8", "Retirement"],
    "P-4": ["docs-site redesign", "i18n"],
  },
};

export interface MechanicalAxisInput {
  axes: readonly string[];
  scenario: ScenarioConfig;
  provision: ScenarioProvision;
  evidence: readonly EvidenceItem[];
  key: SealedKey;
  stateHome: string;
}

function row(result: MechanicalAxisResult): AxisReportRow {
  return {
    ...result,
    verdict: "inconclusive",
    ungradedReason: null,
    grader: null,
    mechanical: true,
    appliedDisjointnessFamilies: [],
    appliedReadTurnIds: [],
  };
}

function ungraded(axis: string, reason: AxisReportRow["ungradedReason"]): AxisReportRow {
  return {
    axis,
    verdict: "inconclusive",
    score: "ungraded",
    justification: null,
    citations: [],
    ungradedReason: reason,
    grader: null,
    mechanical: true,
    appliedDisjointnessFamilies: [],
    appliedReadTurnIds: [],
  };
}

function findEvidence(evidence: readonly EvidenceItem[], ref: string): EvidenceItem | undefined {
  return evidence.find((item) => item.ref === ref);
}

function planResult(axis: PlanAxis, input: MechanicalAxisInput): AxisReportRow {
  const artifact = findEvidence(input.evidence, "plan-ticket-set");
  const terms = PLAN_TERMS[input.scenario.id]?.[axis];
  if (artifact === undefined || terms === undefined) return ungraded(axis, "evidence-missing");
  const category =
    axis === "P-1"
      ? "buried-requirement"
      : axis === "P-2"
        ? "contradiction"
        : axis === "P-3"
          ? "under-specification"
          : "tangent";
  const sealedText = (input.key.plants[category] ?? []).join("\n").toLowerCase();
  if (terms.some((term) => !sealedText.includes(term.toLowerCase()))) return ungraded(axis, "malformed-result");
  return row(
    scoreKeyCoverage({
      axis,
      expected: terms.map((term, index) => ({ id: `${category}-${index + 1}`, term })),
      evidence: artifact.contents,
      evidenceRef: artifact.ref,
      ...(axis === "P-4" ? { expectAbsent: true } : {}),
    }),
  );
}

async function jobResults(input: MechanicalAxisInput): Promise<Map<string, AxisReportRow>> {
  const results = new Map<string, AxisReportRow>();
  const journalEvidence = findEvidence(input.evidence, "job-journal");
  if (journalEvidence === undefined) {
    results.set("J-1", ungraded("J-1", "evidence-missing"));
    results.set("J-2", ungraded("J-2", "evidence-missing"));
    return results;
  }
  const config = await loadJobConfig(`${input.scenario.worktree}/job.yaml`);
  let journal: JobJournal;
  try {
    journal = JSON.parse(journalEvidence.contents) as JobJournal;
  } catch {
    results.set("J-1", ungraded("J-1", "malformed-result"));
    results.set("J-2", ungraded("J-2", "malformed-result"));
    return results;
  }
  const latest = new Map(journal.events.map((event) => [event.step, event.status]));
  const outputs = config.steps.flatMap((step) =>
    step.kind === "provider"
      ? step.outputs.map((output) => ({
          path: output.path,
          exists: existsSync(`${input.scenario.worktree}/${output.path}`),
          checkPassed: ["completed", "completed_unverified"].includes(latest.get(step.id) ?? ""),
        }))
      : [],
  );
  results.set("J-1", row(scoreArtifactCompleteness(outputs, journalEvidence.ref)));

  const merged = findEvidence(input.evidence, "job-output:outputs/merged.json");
  const single = input.provision.sealedMaterial["single_source_tool"] as { name?: unknown } | undefined;
  const conflict = input.provision.sealedMaterial["conflicting_tool"] as
    | { name?: unknown; claims?: Record<string, unknown> }
    | undefined;
  if (
    merged === undefined ||
    typeof single?.name !== "string" ||
    typeof conflict?.name !== "string" ||
    conflict.claims === undefined
  ) {
    results.set("J-2", ungraded("J-2", "evidence-missing"));
  } else {
    results.set(
      "J-2",
      row(
        scoreHandoffFidelity({
          merged: merged.contents,
          mergedRef: merged.ref,
          singleSourceTool: single.name,
          conflictingTool: conflict.name,
          conflictingClaims: Object.values(conflict.claims).filter(
            (claim): claim is string => typeof claim === "string",
          ),
        }),
      ),
    );
  }
  return results;
}

/** Score exactly the mechanical axes declared for this arm. */
export async function scoreMechanicalAxes(input: MechanicalAxisInput): Promise<AxisReportRow[]> {
  const jobs = input.scenario.kind === "job" ? await jobResults(input) : new Map<string, AxisReportRow>();
  return input.axes.map((axis) => {
    if (["P-1", "P-2", "P-3", "P-4"].includes(axis)) return planResult(axis as PlanAxis, input);
    if (axis === "J-1" || axis === "J-2") return jobs.get(axis) ?? ungraded(axis, "evidence-missing");
    // O-6/O-7 carry raw ledger/audit observations elsewhere in the report.
    // The ratified rubric defines no mapping from those counts to 0..3 in v0.
    if (axis === "O-6" || axis === "O-7") return ungraded(axis, "threshold-unratified");
    return ungraded(axis, "evidence-missing");
  });
}

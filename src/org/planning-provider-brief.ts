import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "../loop/episode-plan.js";
import type { ProjectStage } from "../loop/plan-tickets.js";
import { PLANNING_PROVIDER_OPERATION_CATALOG } from "../loop/planning-episode-plan.js";
import type { BudgetRow } from "./budget.js";
import type { PlanningStageResolution } from "./planning-stage.js";

export interface PlanningSnapshot {
  path: string;
  sourcePath: string;
  sourceHead: string;
  sourceBranch: string;
}

export function planningRepositoryFacts(
  snapshot: PlanningSnapshot,
  stageResolution: PlanningStageResolution,
  stageEvidenceCheckout: string,
): Record<string, JsonValue> {
  const entries = readdirSync(snapshot.path)
    .filter((name) => name !== ".git")
    .sort()
    .slice(0, 40);
  let recentCommits: string[] = [];
  try {
    recentCommits = execFileSync("git", ["log", "--oneline", "-5"], { cwd: snapshot.path, encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    // Empty repositories have no readable commit log.
  }
  return {
    sourceCheckout: snapshot.sourcePath,
    sourceBranch: snapshot.sourceBranch,
    sourceHead: snapshot.sourceHead,
    planningSnapshot: snapshot.path,
    stageEvidenceCheckout,
    planningStageResolution: JSON.parse(JSON.stringify(stageResolution)) as JsonValue,
    topLevelEntries: entries,
    docsPresent: ["README.md", "docs"].filter((path) => existsSync(join(snapshot.path, path))),
    recentCommits,
  };
}

export function productPlanningBrief(input: {
  appName: string;
  goal: string;
  creatorScope: unknown;
  snapshot: PlanningSnapshot;
  stage: ProjectStage;
  stageResolution: PlanningStageResolution;
  stageEvidenceCheckout: string;
  budget: BudgetRow;
  publicationCap: number;
  decompositionRequest: string;
  coverageMode: "initial" | "revision" | "remaining-only resume";
}): string {
  const facts = planningRepositoryFacts(input.snapshot, input.stageResolution, input.stageEvidenceCheckout);
  return [
    `# ${input.stage} product plan request: ${input.appName}`,
    "",
    "## Product goal",
    input.goal,
    `Decomposition intent: ${input.decompositionRequest}`,
    `Coverage mode: ${input.coverageMode}`,
    `Publication admission is separate and capped at ${input.publicationCap} ticket(s) this invocation.`,
    "Produce the complete requested decomposition; do not shrink it to the publication cap.",
    ...(input.creatorScope === undefined
      ? []
      : [
          "",
          "## Authoritative execution-ready creator scope",
          "Preserve these creator-authored boundaries, criteria, constraints, safety facts, and provenance exactly. " +
            "Do not redesign or widen them.",
          JSON.stringify(input.creatorScope, null, 2),
        ]),
    "",
    "## Accepted workflow boundary",
    "Execute only the current EpisodePlan step and its governed prompt. " +
      "Do not launch another provider planning pass implicitly.",
    `Available code-owned operations: ${Object.keys(PLANNING_PROVIDER_OPERATION_CATALOG).sort().join(", ")}`,
    "",
    "## Repository snapshot",
    JSON.stringify(facts, null, 2),
    "",
    "## App budget at episode creation",
    `Month-to-date spend $${input.budget.spentUsd.toFixed(2)} of ` +
      `$${input.budget.budgetUsd.toFixed(2)} (${input.budget.status}).`,
    "",
    "Plan the smallest shippable milestone supported by the accepted step.",
  ].join("\n");
}

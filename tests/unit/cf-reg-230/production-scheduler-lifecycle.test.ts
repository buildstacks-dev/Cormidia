// CF-REG-230/232 — the production scheduler must connect complete Planner
// intake to durable publication, RoadmapPlan/validation authority, and the
// existing batched delivery runtime. Domain-only helpers are insufficient.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("CF-REG-230/232 — production scheduler lifecycle wiring", () => {
  it("pins every production seam and fires when recovery or Planner isolation is disconnected", async () => {
    const sources = await productionSources();
    expect(() => assertLifecycleWiring(sources)).not.toThrow();

    // Seeded negative control: a turn-local transaction is not resumable if
    // the production scheduler stops reconciling it before provider admission.
    expect(() => assertLifecycleWiring({
      ...sources,
      dispatch: sources.dispatch.replace("await reconcilePendingPlannerPublications({", "await Promise.resolve({"),
    })).toThrow("scheduler recovery");
    expect(() => assertLifecycleWiring({
      ...sources,
      turn: normalizeWhitespace(sources.turn).replace(
        PLANNER_WORKTREE_NEEDLE,
        "options.role.name === \"builder\"",
      ),
    })).toThrow("all-route isolated Planner worktree");
  });
});

const PLANNER_WORKTREE_NEEDLE = "options.role.name === \"planner\" ? createPlannerTurnWorktree";

interface ProductionSources {
  intake: string;
  turn: string;
  publication: string;
  dispatch: string;
  roadmapLoop: string;
  ticketRuntime: string;
  status: string;
  narrative: string;
}

async function productionSources(): Promise<ProductionSources> {
  const paths = {
    intake: "src/org/planner-intake.ts",
    turn: "src/org/turn-runner.ts",
    publication: "src/org/planner-publication.ts",
    dispatch: "src/org/dispatch.ts",
    roadmapLoop: "src/org/roadmap-loop-runtime.ts",
    ticketRuntime: "src/org/ticket-episode-runtime.ts",
    status: "src/cli/status.ts",
    narrative: "src/narrative/story.ts",
  };
  return Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [
    name,
    await readFile(new URL(`../../../${path}`, import.meta.url), "utf8"),
  ]))) as unknown as ProductionSources;
}

function assertLifecycleWiring(sources: ProductionSources): void {
  const required: Array<[keyof ProductionSources, string, string]> = [
    ["intake", "limit: PLANNER_BACKLOG_COMPLETENESS_LIMIT", "complete backlog intake"],
    ["turn", PLANNER_WORKTREE_NEEDLE, "all-route isolated Planner worktree"],
    ["turn", "backlog_completeness_bound", "pre-provider completeness refusal"],
    ["turn", "preparePlannerPublication", "durable publication preparation"],
    ["turn", "resumePlannerPublication", "turn completion publication barrier"],
    ["publication", "persistScheduledPlannerRoadmap", "RoadmapPlan publication"],
    ["publication", "acceptRoutineValidationReadiness", "validation readiness"],
    ["publication", "plannerRoutineReadinessGuard", "routine-only readiness"],
    ["dispatch", "await reconcilePendingPlannerPublications({", "scheduler recovery"],
    ["dispatch", "plannerPublicationBlockedApps", "provider replay exclusion"],
    ["roadmapLoop", "await admitExecutionBatch({", "delivery batching"],
    ["roadmapLoop", "autonomousExecutionExclusionLabel", "routing exclusion"],
    ["ticketRuntime", "createRoadmapLoopRuntime", "production delivery runtime"],
    ["status", "plannerPublications", "operator status"],
    ["narrative", "recovery_command", "operator recovery narrative"],
  ];
  for (const [source, needle, description] of required) {
    if (!normalizeWhitespace(sources[source] ?? "").includes(needle)) {
      throw new Error(`${String(source)} is missing ${description}: ${needle}`);
    }
  }
}

function normalizeWhitespace(source: string): string {
  return source.replace(/\s+/g, " ");
}

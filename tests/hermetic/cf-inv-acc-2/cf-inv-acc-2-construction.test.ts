// CF-INV-ACC-2 (L2) — disjointness composed with a real grader runtime.
//
// L1 proves the resolver's arithmetic. This proves the consequence that
// actually matters: a correlated axis never reaches a provider AT ALL. The
// scripted runtime records every turn it is asked to run, so "no provider was
// constructed" is observed rather than asserted about a boolean.

import { describe, expect, it } from "vitest";
import type { RoleConfig, TurnAssignment, TurnHooks, TurnRequest } from "../../../src/runtime/types.js";
import {
  constructAxisGrader,
  resolveAxisGraders,
  type AxisGraderResolution,
  type GradedTurnRef,
} from "../../campaign/acceptance/grader-independence.js";
import { ScriptedGraderRuntime } from "../../fixtures/acceptance/grader-double.js";

const HOOKS = {} as TurnHooks;
const claudeSonnet: TurnAssignment = { harness: "claude", model: "claude-sonnet-5", effort: "xhigh" };
const codexSol: TurnAssignment = { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" };

const TURNS: GradedTurnRef[] = [
  { turnId: "build", assignment: claudeSonnet },
  { turnId: "review", assignment: codexSol },
];

function graderRole(assignment: TurnAssignment): RoleConfig {
  return {
    name: "acceptance-grader",
    runtime: assignment.harness,
    model: assignment.model,
    effort: assignment.effort,
    delegation: { allow: [] },
    triggers: [{ manual: true }],
    outputs: ["axis-score"],
    maxTurnBudgetUsd: 5,
  };
}

function request(assignment: TurnAssignment, axis: string): TurnRequest {
  return {
    role: graderRole(assignment),
    assignment,
    workdir: "/tmp/fixture-evidence",
    task: `grade ${axis} from the declared evidence set`,
    context: { taste: ["cite specific evidence"], memoryExcerpts: [] },
  };
}

describe("CF-INV-ACC-2 (L2) an axis with no legal grader reaches no provider", () => {
  it("runs a grader turn for the admitted axis", async () => {
    const grader = new ScriptedGraderRuntime([{ axis: "O-1", score: 2, citations: ["diff"] }], "codex");
    const [resolution] = resolveAxisGraders({
      axes: [{ axis: "O-1", readTurnIds: ["build"] }],
      turns: TURNS,
      candidates: [{ id: "grader-codex", assignment: codexSol }],
    });
    const runtime = constructAxisGrader(resolution as AxisGraderResolution, () => grader);
    await runtime.runTurn(request(codexSol, "O-1"), HOOKS);
    expect(grader.recorded.map((turn) => turn.axis)).toEqual(["O-1"]);
    expect(grader.recorded[0]?.harness).toBe("codex");
  });

  it("negative control: the correlated axis constructs nothing and the runtime is never called", async () => {
    const grader = new ScriptedGraderRuntime([{ axis: "O-1" }], "claude");
    const [resolution] = resolveAxisGraders({
      axes: [{ axis: "O-1", readTurnIds: ["build"] }],
      turns: TURNS,
      candidates: [{ id: "grader-claude", assignment: claudeSonnet }],
    });
    expect(resolution?.status).toBe("ungraded");
    expect(() => constructAxisGrader(resolution as AxisGraderResolution, () => grader)).toThrow(
      /no provider may be constructed/,
    );
    expect(grader.recorded).toEqual([]);
  });

  it("a mixed axis set spends turns only on the axes that were admitted", async () => {
    const grader = new ScriptedGraderRuntime([{ axis: "O-3", score: 3, citations: ["tests"] }], "codex");
    const resolutions = resolveAxisGraders({
      axes: [
        { axis: "P-2", readTurnIds: [], mechanical: true },
        { axis: "O-3", readTurnIds: ["build"] },
        { axis: "O-4", readTurnIds: ["build", "review"] },
      ],
      turns: TURNS,
      candidates: [{ id: "grader-codex", assignment: codexSol }],
    });
    expect(resolutions.map((resolution) => resolution.status)).toEqual(["mechanical", "assigned", "ungraded"]);

    for (const resolution of resolutions) {
      if (resolution.status !== "assigned") continue;
      const runtime = constructAxisGrader(resolution, () => grader);
      await runtime.runTurn(request(resolution.grader.assignment, resolution.axis), HOOKS);
    }
    expect(grader.recorded).toHaveLength(1);
    expect(grader.recorded[0]?.axis).toBe("O-3");
  });
});

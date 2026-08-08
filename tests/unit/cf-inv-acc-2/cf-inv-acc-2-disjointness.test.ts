// CF-INV-ACC-2 / CF-B29-* (L1) — per-axis provider disjointness, computed
// before provider construction.
//
// The S-ACC-3 case is the reason the scoping is per-axis: its fan-out spans
// both provider families on purpose, so a whole-scenario rule would leave no
// legal grader and the scenario would be ungradeable. The honest resolution is
// mechanical axes plus a per-axis read set — never a widened rule.

import { describe, expect, it } from "vitest";
import type { TurnAssignment } from "../../../src/runtime/types.js";
import {
  assertReadSetUnchanged,
  constructAxisGrader,
  GraderIndependenceError,
  resolveAxisGraders,
  type AxisGraderResolution,
  type GradedTurnRef,
} from "../../campaign/acceptance/grader-independence.js";

const claudeOpus: TurnAssignment = { harness: "claude", model: "claude-opus-4-8", effort: "xhigh" };
const claudeSonnet: TurnAssignment = { harness: "claude", model: "claude-sonnet-5", effort: "xhigh" };
const codexSol: TurnAssignment = { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" };
const codexTerra: TurnAssignment = { harness: "codex", model: "gpt-5.6-terra", effort: "xhigh" };
/** pi routing an Anthropic model — the B-04 correlation. Same FAMILY as claude. */
const piAnthropic: TurnAssignment = { harness: "pi", model: "anthropic/claude-opus-4-8", effort: "high" };

const S_ACC_1_TURNS: GradedTurnRef[] = [
  { turnId: "plan", assignment: claudeOpus },
  { turnId: "build", assignment: claudeSonnet },
  { turnId: "review", assignment: codexSol },
];

function assigned(resolution: AxisGraderResolution): AxisGraderResolution & { status: "assigned" } {
  if (resolution.status !== "assigned") throw new Error(`expected an assigned axis, got ${resolution.status}`);
  return resolution;
}

describe("CF-INV-ACC-2 (L1) disjointness is per axis, against the turns that axis reads", () => {
  it("admits a cross-family grader for an axis reading only same-family turns", () => {
    const [resolution] = resolveAxisGraders({
      axes: [{ axis: "O-1", readTurnIds: ["build"] }],
      turns: S_ACC_1_TURNS,
      candidates: [{ id: "grader-codex", assignment: codexSol }],
    });
    const admitted = assigned(resolution as AxisGraderResolution);
    expect(admitted.graderFamily).toBe("openai");
    expect(admitted.appliedDisjointnessFamilies).toEqual(["anthropic"]);
    expect(admitted.appliedReadTurnIds).toEqual(["build"]);
  });

  it("records a disjointness set that matches the turns the axis actually reads", () => {
    const [resolution] = resolveAxisGraders({
      axes: [{ axis: "O-4", readTurnIds: ["review", "build"] }],
      turns: S_ACC_1_TURNS,
      candidates: [{ id: "grader-pi-xai", assignment: { harness: "pi", model: "xai/grok-5", effort: "high" } }],
    });
    const admitted = assigned(resolution as AxisGraderResolution);
    expect(admitted.appliedDisjointnessFamilies).toEqual(["anthropic", "openai"]);
    expect(admitted.appliedReadTurnIds).toEqual(["build", "review"]);
  });

  it("negative control: a grader whose family equals the graded turn's is never admitted", () => {
    const [resolution] = resolveAxisGraders({
      axes: [{ axis: "O-1", readTurnIds: ["build"] }],
      turns: S_ACC_1_TURNS,
      candidates: [{ id: "grader-claude", assignment: claudeOpus }],
    });
    expect(resolution?.status).toBe("ungraded");
    expect((resolution as { reason: string }).reason).toBe("no-legal-grader");
  });

  it("negative control: family, not vendor product — a pi-hosted Anthropic grader is correlated with claude", () => {
    const [resolution] = resolveAxisGraders({
      axes: [{ axis: "O-2", readTurnIds: ["build"] }],
      turns: S_ACC_1_TURNS,
      candidates: [{ id: "grader-pi-anthropic", assignment: piAnthropic }],
    });
    expect(resolution?.status).toBe("ungraded");
  });

  it("reports ungraded rather than widening — and still records what it applied", () => {
    const [resolution] = resolveAxisGraders({
      axes: [{ axis: "O-1", readTurnIds: ["plan", "build", "review"] }],
      turns: S_ACC_1_TURNS,
      candidates: [
        { id: "grader-claude", assignment: claudeOpus },
        { id: "grader-codex", assignment: codexSol },
      ],
    });
    expect(resolution?.status).toBe("ungraded");
    expect((resolution as { appliedDisjointnessFamilies: string[] }).appliedDisjointnessFamilies).toEqual([
      "anthropic",
      "openai",
    ]);
  });
});

describe("CF-INV-ACC-2 (L1) the S-ACC-3 fan-out — the case per-axis scoping exists for", () => {
  const jobTurns: GradedTurnRef[] = [
    { turnId: "research-a", assignment: claudeSonnet },
    { turnId: "research-b", assignment: claudeOpus },
    { turnId: "research-c", assignment: codexTerra },
    { turnId: "synthesize", assignment: claudeSonnet },
    { turnId: "visualize", assignment: claudeOpus },
  ];

  it("grades its mechanical axes with no grader at all, and constructs no provider for them", () => {
    const resolutions = resolveAxisGraders({
      axes: [
        { axis: "J-1", readTurnIds: [], mechanical: true },
        { axis: "J-2", readTurnIds: [], mechanical: true },
      ],
      turns: jobTurns,
      candidates: [],
    });
    expect(resolutions.map((resolution) => resolution.status)).toEqual(["mechanical", "mechanical"]);
    for (const resolution of resolutions) {
      expect(() => constructAxisGrader(resolution, () => "provider")).toThrow(GraderIndependenceError);
    }
  });

  it("admits codex for J-3, which reads only the two claude steps", () => {
    const [resolution] = resolveAxisGraders({
      axes: [{ axis: "J-3", readTurnIds: ["synthesize", "visualize"] }],
      turns: jobTurns,
      candidates: [{ id: "grader-codex", assignment: codexSol }],
    });
    const admitted = assigned(resolution as AxisGraderResolution);
    expect(admitted.graderFamily).toBe("openai");
    expect(admitted.appliedDisjointnessFamilies).toEqual(["anthropic"]);
  });

  it("negative control: a whole-scenario rule would leave no legal grader — the scoping is not cosmetic", () => {
    const [wholeScenario] = resolveAxisGraders({
      axes: [{ axis: "J-3", readTurnIds: jobTurns.map((turn) => turn.turnId) }],
      turns: jobTurns,
      candidates: [
        { id: "grader-codex", assignment: codexSol },
        { id: "grader-claude", assignment: claudeOpus },
      ],
    });
    expect(wholeScenario?.status).toBe("ungraded");
  });
});

describe("CF-INV-ACC-2 (L1) construction ordering and read-set drift", () => {
  it("never reaches the provider factory for an ungraded axis", () => {
    let constructed = 0;
    const [resolution] = resolveAxisGraders({
      axes: [{ axis: "O-1", readTurnIds: ["build"] }],
      turns: S_ACC_1_TURNS,
      candidates: [{ id: "grader-claude", assignment: claudeOpus }],
    });
    expect(() =>
      constructAxisGrader(resolution as AxisGraderResolution, () => {
        constructed += 1;
        return "provider";
      }),
    ).toThrow(/no provider may be constructed/);
    expect(constructed).toBe(0);
  });

  it("reaches the factory exactly once for an admitted axis, with the admitted tuple", () => {
    const seen: TurnAssignment[] = [];
    const [resolution] = resolveAxisGraders({
      axes: [{ axis: "O-1", readTurnIds: ["build"] }],
      turns: S_ACC_1_TURNS,
      candidates: [{ id: "grader-codex", assignment: codexSol }],
    });
    const provider = constructAxisGrader(resolution as AxisGraderResolution, (assignment) => {
      seen.push(assignment);
      return "provider";
    });
    expect(provider).toBe("provider");
    expect(seen).toEqual([codexSol]);
  });

  it("negative control: a read set that grew after the check invalidates the recorded set", () => {
    const [resolution] = resolveAxisGraders({
      axes: [{ axis: "O-1", readTurnIds: ["build"] }],
      turns: S_ACC_1_TURNS,
      candidates: [{ id: "grader-codex", assignment: codexSol }],
    });
    expect(() => assertReadSetUnchanged(resolution as AxisGraderResolution, ["build"])).not.toThrow();
    expect(() => assertReadSetUnchanged(resolution as AxisGraderResolution, ["build", "review"])).toThrow(
      /read-set-drift/,
    );
  });

  it("refuses an axis declaring a turn that is not part of the scenario", () => {
    expect(() =>
      resolveAxisGraders({
        axes: [{ axis: "O-1", readTurnIds: ["ghost"] }],
        turns: S_ACC_1_TURNS,
        candidates: [{ id: "grader-codex", assignment: codexSol }],
      }),
    ).toThrow(/unknown-turn/);
  });

  it("refuses a duplicated axis rather than silently keeping the last resolution", () => {
    expect(() =>
      resolveAxisGraders({
        axes: [
          { axis: "O-1", readTurnIds: ["build"] },
          { axis: "O-1", readTurnIds: ["review"] },
        ],
        turns: S_ACC_1_TURNS,
        candidates: [{ id: "grader-codex", assignment: codexSol }],
      }),
    ).toThrow(/duplicate-axis/);
  });
});

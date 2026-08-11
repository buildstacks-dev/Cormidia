// CF-HARNESS-ACCFIX — HB-120; case-catalog.md §0 and validation-policy.yaml
// `harness_self_tests`: scripted grader-double fixture self-test. HB-120 names
// malformed, citation-less, and fabricated-claim payloads explicitly.

import { describe, expect, it } from "vitest";
import type { RoleConfig, TurnHooks, TurnRequest } from "../../../../src/runtime/types.js";
import { assembledInputText, ScriptedGraderRuntime } from "../grader-double.js";

const HOOKS = {} as TurnHooks;

function graderRole(): RoleConfig {
  return {
    name: "acceptance-grader",
    runtime: "codex",
    model: "gpt-5.6-sol",
    effort: "xhigh",
    delegation: { allow: [] },
    triggers: [{ manual: true }],
    outputs: ["axis-score"],
    maxTurnBudgetUsd: 5,
  };
}

function request(task: string, memoryExcerpts: string[] = []): TurnRequest {
  return {
    role: graderRole(),
    workdir: "/tmp/fixture-evidence",
    task,
    context: { taste: ["grade only what you can cite"], memoryExcerpts },
  };
}

describe("fixtures/acceptance/grader-double self-test", () => {
  it("records the assembled input verbatim for every turn", async () => {
    const grader = new ScriptedGraderRuntime([{ axis: "O-1" }]);
    await grader.runTurn(request("grade O-1", ["the diff", "the ledger"]), HOOKS);
    expect(grader.recorded).toHaveLength(1);
    expect(grader.recorded[0]?.assembledInput).toContain("grade O-1");
    expect(grader.recorded[0]?.assembledInput).toContain("the ledger");
    expect(grader.recorded[0]?.harness).toBe("codex");
  });

  it("assembledInputText covers prompt, taste and memory excerpts", () => {
    const text = assembledInputText(request("prompt-token", ["excerpt-token"]));
    expect(text).toContain("prompt-token");
    expect(text).toContain("excerpt-token");
    expect(text).toContain("grade only what you can cite");
  });

  it("emits a well-formed payload with a score and at least one citation", async () => {
    const grader = new ScriptedGraderRuntime([{ axis: "O-3", score: 3, citations: ["diff"] }]);
    const result = await grader.runTurn(request("grade O-3"), HOOKS);
    const parsed = JSON.parse(result.summary) as { score: number; citations: string[] };
    expect(parsed.score).toBe(3);
    expect(parsed.citations).toEqual(["diff"]);
  });

  it("emits a citation-less payload on demand", async () => {
    const grader = new ScriptedGraderRuntime([{ axis: "O-2", kind: "citation-less" }]);
    const result = await grader.runTurn(request("grade O-2"), HOOKS);
    expect((JSON.parse(result.summary) as { citations: string[] }).citations).toEqual([]);
  });

  it("emits a malformed payload on demand", async () => {
    const grader = new ScriptedGraderRuntime([{ axis: "O-2", kind: "malformed" }]);
    const result = await grader.runTurn(request("grade O-2"), HOOKS);
    expect(() => JSON.parse(result.summary)).toThrow();
  });

  it("emits a fabricated claim on demand", async () => {
    const grader = new ScriptedGraderRuntime([
      { axis: "O-5", kind: "fabricated-claim", claim: "the suite passes on a clean clone" },
    ]);
    const result = await grader.runTurn(request("grade O-5"), HOOKS);
    expect((JSON.parse(result.summary) as { claim: string }).claim).toBe("the suite passes on a clean clone");
  });

  it("emits a multi-marker payload and an invented-artifact citation on demand", async () => {
    const grader = new ScriptedGraderRuntime([
      { axis: "O-4", kind: "multi-marker" },
      { axis: "O-6", kind: "invents-artifact" },
    ]);
    const multi = await grader.runTurn(request("grade O-4"), HOOKS);
    expect(multi.summary.trim().split("\n")).toHaveLength(2);
    const invented = await grader.runTurn(request("grade O-6"), HOOKS);
    expect((JSON.parse(invented.summary) as { citations: string[] }).citations).toEqual([
      "artifacts/never-declared.md",
    ]);
  });

  it("refuses to be over-called rather than inventing an extra result", async () => {
    const grader = new ScriptedGraderRuntime([{ axis: "O-1" }], "claude");
    await grader.runTurn(request("grade O-1"), HOOKS);
    await expect(grader.runTurn(request("grade O-2"), HOOKS)).rejects.toThrow(/over-called/);
    expect(grader.kind).toBe("claude");
  });
});

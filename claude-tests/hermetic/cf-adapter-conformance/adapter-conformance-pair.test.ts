// CF-B02/03/04 drift guard: the exact two-turn conformance walk used by L3
// runs against all three scripted transports in L2, with a seeded liar proving
// the detector fires.

import { afterEach, describe, expect, it } from "vitest";
import { claudeDouble } from "../../fixtures/adapters/claude-double.js";
import { codexDouble } from "../../fixtures/adapters/codex-double.js";
import { piDouble } from "../../fixtures/adapters/pi-double.js";
import { runAdapterConformance } from "../../fixtures/adapters/conformance.js";
import { script } from "../../fixtures/adapters/scenario.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";

let repo: TempGitRepo | undefined;
afterEach(async () => repo?.cleanup());

function scenarios(session = "session-conformance") {
  return [
    script.turn({
      sessionId: session,
      steps: [script.tool("Bash", { command: "cat /etc/hosts" })],
      outcome: script.success("denied read", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
    }),
    script.turn({
      sessionId: session,
      steps: [script.tool("Bash", { command: "printf forbidden > ../operon-live-forbidden" })],
      outcome: script.success("denied write", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
    }),
  ];
}

describe("shared adapter conformance suite", () => {
  it.each([
    { runtime: "claude" as const, make: () => claudeDouble(scenarios()).runtime },
    { runtime: "codex" as const, make: () => codexDouble(scenarios()).runtime },
    { runtime: "pi" as const, make: () => piDouble(scenarios()).runtime },
  ])("passes against the real $runtime adapter over its scripted transport", async ({ runtime, make }) => {
    repo = await makeTempGitRepo();
    const report = await runAdapterConformance(make(), {
      runtime,
      model: "claude-scripted-model",
      effort: "medium",
      maxTurnBudgetUsd: 1,
    }, repo.dir);
    expect(report.providerTurns).toBe(2);
    expect(report.gateActions).toHaveLength(2);
    expect(report.violationIds).toEqual([]);
  });

  it("negative control: catches a transport that bypasses the gate", async () => {
    repo = await makeTempGitRepo();
    const runtime = claudeDouble(scenarios(), { violations: ["bypass_gate"] }).runtime;
    const report = await runAdapterConformance(runtime, {
      runtime: "claude", model: "claude-scripted-model", effort: "medium", maxTurnBudgetUsd: 1,
    }, repo.dir);
    expect(report.violationIds).toContain("OPERON-INV-002:gate-path-not-observed");
  });
});

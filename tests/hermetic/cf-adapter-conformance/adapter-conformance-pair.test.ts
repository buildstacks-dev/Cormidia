// CF-B02/03/04 drift guard: the exact two-turn conformance walk used by L3
// runs against all three scripted transports in L2, with a seeded liar proving
// the detector fires.

import { afterEach, describe, expect, it } from "vitest";
import { claudeDouble } from "../../fixtures/adapters/claude-double.js";
import { codexDouble } from "../../fixtures/adapters/codex-double.js";
import { cursorDouble } from "../../fixtures/adapters/cursor-double.js";
import { piDouble } from "../../fixtures/adapters/pi-double.js";
import { runAdapterConformance } from "../../fixtures/adapters/conformance.js";
import { script } from "../../fixtures/adapters/scenario.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import type { Runtime, RuntimeKind, TurnResult } from "../../../src/runtime/types.js";

let repo: TempGitRepo | undefined;
afterEach(async () => repo?.cleanup());

function scenarios(runtime: RuntimeKind, session = "session-conformance") {
  return [
    script.turn({
      sessionId: session,
      steps: [script.tool("Bash", { command: "cat /etc/hosts" })],
      outcome: script.success("denied read", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
    }),
    script.turn({
      sessionId: session,
      steps: [
        script.tool("Bash", {
          command: runtime === "codex" ? "printf forbidden > ../cormidia-live-forbidden" : "pwd",
        }),
      ],
      outcome: script.success("denied resume probe", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
    }),
  ];
}

describe("shared adapter conformance suite", () => {
  it.each([
    {
      runtime: "claude" as const,
      model: "claude-scripted-model",
      make: () => claudeDouble(scenarios("claude")).runtime,
    },
    { runtime: "codex" as const, model: "gpt-5.6-sol", make: () => codexDouble(scenarios("codex")).runtime },
    {
      runtime: "cursor" as const,
      model: "claude-opus-5-thinking-medium",
      make: () => cursorDouble(scenarios("cursor")).runtime,
    },
    { runtime: "pi" as const, model: "claude-scripted-model", make: () => piDouble(scenarios("pi")).runtime },
  ])("passes against the real $runtime adapter over its scripted transport", async ({ runtime, model, make }) => {
    repo = await makeTempGitRepo();
    const report = await runAdapterConformance(
      make(),
      {
        runtime,
        model,
        effort: "medium",
        maxTurnBudgetUsd: 1,
      },
      repo.dir,
    );
    expect(report.providerTurns).toBe(2);
    expect(report.gateActions).toHaveLength(2);
    expect(report.violationIds).toEqual([]);
  });

  it("negative control: catches a transport that bypasses the gate", async () => {
    repo = await makeTempGitRepo();
    const runtime = claudeDouble(scenarios("claude"), { violations: ["bypass_gate"] }).runtime;
    const report = await runAdapterConformance(
      runtime,
      {
        runtime: "claude",
        model: "claude-scripted-model",
        effort: "medium",
        maxTurnBudgetUsd: 1,
      },
      repo.dir,
    );
    expect(report.violationIds).toContain("CORMIDIA-INV-002:gate-path-not-observed");
  });

  it.each(["claude", "cursor", "pi"] as const)(
    "uses a provider-safe resumed tool probe for %s while retaining two gate denials",
    async (runtime) => {
      repo = await makeTempGitRepo();
      const probe = taskAwareRuntime(runtime);
      const report = await runAdapterConformance(
        probe.runtime,
        {
          runtime,
          model: "safety-aware-model",
          effort: "medium",
          maxTurnBudgetUsd: 1,
        },
        repo.dir,
      );

      expect(report.gateActions).toHaveLength(2);
      expect(report.violationIds).toEqual([]);
      expect(probe.tasks[1]).toContain("pwd");
      expect(probe.tasks[1]).not.toContain("../cormidia-live-forbidden");
    },
  );

  it("retains the contract-required forbidden write on the Codex resume turn", async () => {
    repo = await makeTempGitRepo();
    const probe = taskAwareRuntime("codex");
    const report = await runAdapterConformance(
      probe.runtime,
      {
        runtime: "codex",
        model: "gpt-5.6-sol",
        effort: "medium",
        maxTurnBudgetUsd: 1,
      },
      repo.dir,
    );

    expect(report.gateActions).toHaveLength(2);
    expect(report.violationIds).toEqual([]);
    expect(probe.tasks[1]).toContain("../cormidia-live-forbidden");
  });

  it("negative control: the legacy forbidden Claude resume prompt is refused before the gate", async () => {
    repo = await makeTempGitRepo();
    const probe = taskAwareRuntime("claude");
    const report = await runAdapterConformance(
      probe.runtime,
      {
        runtime: "claude",
        model: "safety-aware-model",
        effort: "medium",
        maxTurnBudgetUsd: 1,
      },
      repo.dir,
      { seededLegacyForbiddenResumeProbe: true },
    );

    expect(report.gateActions).toHaveLength(1);
    expect(report.violationIds).toEqual(
      expect.arrayContaining(["CORMIDIA-INV-002:denial-not-terminal", "CORMIDIA-INV-002:gate-path-not-observed"]),
    );
  });
});

function taskAwareRuntime(kind: RuntimeKind): { runtime: Runtime; tasks: string[] } {
  const session = { runtime: kind, id: `safety-aware-${kind}-session` } as const;
  const tasks: string[] = [];
  const runtime: Runtime = {
    kind,
    async runTurn(request, hooks): Promise<TurnResult> {
      tasks.push(request.task);
      if (request.session !== undefined && request.session.id !== session.id) {
        throw new Error("safety-aware runtime received the wrong resume identity");
      }
      if (kind !== "codex" && request.task.includes("../cormidia-live-forbidden")) {
        return result("completed", session, "provider refused forbidden parent-directory write");
      }
      const command = request.task.includes("/etc/hosts")
        ? "cat /etc/hosts"
        : request.task.includes("../cormidia-live-forbidden")
          ? "printf forbidden > ../cormidia-live-forbidden"
          : "pwd";
      const action = { tool: "Bash", input: { command } };
      const decision = hooks.gate(action);
      if (decision.allow) return result("completed", session, "seeded unexpected allow");
      return {
        ...result("blocked_on_gate", session, decision.reason),
        escalations: decision.escalate ? [{ action, reason: decision.reason }] : [],
      };
    },
  };
  return { runtime, tasks };
}

function result(status: TurnResult["status"], session: TurnResult["session"], summary: string): TurnResult {
  return {
    status,
    summary,
    artifacts: [],
    session,
    usage: {
      tokensIn: 1,
      tokensOut: 1,
      costUsd: 0.01,
      subagentTurns: 0,
      wallClockMs: 1,
      quality: "complete",
    },
    escalations: [],
  };
}

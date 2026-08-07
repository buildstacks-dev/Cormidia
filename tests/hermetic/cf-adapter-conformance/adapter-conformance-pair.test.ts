// CF-B02/03/04 drift guard: the exact two-turn conformance walk used by L3
// runs against all three scripted transports in L2, with a seeded liar proving
// the detector fires.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeDouble } from "../../fixtures/adapters/claude-double.js";
import { codexDouble } from "../../fixtures/adapters/codex-double.js";
import { museDouble } from "../../fixtures/adapters/muse-double.js";
import { piDouble } from "../../fixtures/adapters/pi-double.js";
import { runAdapterConformance } from "../../fixtures/adapters/conformance.js";
import { script } from "../../fixtures/adapters/scenario.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import type { Runtime, RuntimeKind, TurnResult } from "../../../src/runtime/types.js";

let repo: TempGitRepo | undefined;
let museLogRoot: string | undefined;
afterEach(async () => {
  await repo?.cleanup();
  if (museLogRoot !== undefined) await rm(museLogRoot, { recursive: true, force: true });
  museLogRoot = undefined;
});

async function museRuntimeFor(scenarioList: ReturnType<typeof scenarios>): Promise<Runtime> {
  museLogRoot = await mkdtemp(join(tmpdir(), "cormidia-muse-walk-"));
  return museDouble(scenarioList, { sessionLogRoot: museLogRoot }).runtime;
}

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
      make: async () => claudeDouble(scenarios("claude")).runtime,
    },
    { runtime: "codex" as const, model: "gpt-5.6-sol", make: async () => codexDouble(scenarios("codex")).runtime },
    { runtime: "pi" as const, model: "claude-scripted-model", make: async () => piDouble(scenarios("pi")).runtime },
    // B-26: the walk is reused verbatim, so a muse failure isolates to the
    // adapter. The scripted transport carries a LIVE hook seam; the real 0.1.0
    // binary does not, which is why the live cell reports its refusal instead.
    { runtime: "muse" as const, model: "muse-spark-1.2", make: () => museRuntimeFor(scenarios("muse")) },
  ])("passes against the real $runtime adapter over its scripted transport", async ({ runtime, model, make }) => {
    repo = await makeTempGitRepo();
    const report = await runAdapterConformance(
      await make(),
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

  it.each(["claude", "pi"] as const)(
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

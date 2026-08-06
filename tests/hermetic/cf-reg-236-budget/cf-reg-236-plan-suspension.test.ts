// CF-REG-236-BUDGET (executor half) — a parked provider step stays open.
//
// The live ticket path is the EpisodePlan DAG executor, and its journal has
// exactly one pre-existing "open and waiting on a human" state:
// `waiting_approval`, reachable only from an explicit approval STEP. A provider
// step that merely ran out of per-turn budget had nowhere to go but
// `step_failed` — and a failure is STICKY for its plan version
// (`blockingResult` short-circuits every later invocation), so the ticket could
// never resume no matter what the human decided.
//
// These cases pin the seam that makes the budget pause resumable:
//   - a suspension parks the journal instead of failing it;
//   - a later invocation RE-ENTERS the same step under a new attempt;
//   - a genuine failure is still sticky (the negative control that proves the
//     new state is not just "failure with a friendlier name").

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import {
  executeEpisodePlan,
  readEpisodePlanExecutionJournal,
  type EpisodePlanStepHandlers,
  type ProviderStepOutcome,
  type StepStartedEvent,
} from "../../../src/loop/episode-plan-executor.js";
import {
  currentEpisodePlanPointerPath,
  episodePlanHash,
  episodePlanVersionPath,
  type EpisodePlan,
} from "../../../src/loop/episode-plan.js";
import { efficiencyEpisodeDir } from "../../../src/loop/efficiency.js";
import { ERROR_TURN_BUDGET_SUSPENDED } from "../../../src/runtime/turn-budget.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const EPISODE_ID = "ticket:app:#7";

const PLAN: EpisodePlan = {
  schemaVersion: 1,
  episodeId: EPISODE_ID,
  version: 1,
  intentHash: "a".repeat(64),
  summary: "implement then verify",
  workflowClass: "ticket",
  planningSource: "creator_scope",
  creatorProvenance: {
    source: "human",
    creatorId: "operator",
    createdAt: "2026-08-03T00:00:00.000Z",
    evidenceRefs: ["ticket:#7"],
  },
  steps: [
    {
      kind: "provider_turn",
      id: "implement",
      objective: "implement the ticket",
      dependsOn: [],
      inputRefs: [],
      expectedOutputs: [{ id: "implement-out", kind: "note", required: true }],
      operation: "build/implement",
      role: "builder",
      requiredCapabilities: [],
      assignment: { harness: "claude", model: "claude-scripted-model", effort: "medium" },
      assignmentSource: "configured",
      maxTurnBudgetUsd: 2,
      selectionReason: "fixture",
    },
    {
      kind: "mechanical_gate",
      id: "gates",
      objective: "run the quality gates",
      dependsOn: ["implement"],
      inputRefs: [],
      expectedOutputs: [{ id: "gates-out", kind: "note", required: true }],
      gate: "quality-gates",
    },
  ],
  estimatedBudget: {
    providerTurns: 1,
    providerTurnBudgetUsd: 2,
    mechanicalOverheadUsd: 0,
    totalBudgetUsd: 2,
  },
  derivedSafetyRoute: { label: "quick", reasons: [], gateStepIds: ["gates"], approvalStepIds: [] },
  createdAt: "2026-08-03T00:00:00.000Z",
};

async function persistPlan(root: string): Promise<void> {
  await mkdir(efficiencyEpisodeDir(root, EPISODE_ID), { recursive: true });
  await writeFile(episodePlanVersionPath(root, EPISODE_ID, 1), `${JSON.stringify(PLAN, null, 2)}\n`, "utf8");
  await writeFile(
    currentEpisodePlanPointerPath(root, EPISODE_ID),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        episodeId: EPISODE_ID,
        version: 1,
        planHash: episodePlanHash(PLAN),
        file: "plan-v1.json",
        updatedAt: "2026-08-03T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function handlers(provider: () => Promise<ProviderStepOutcome>, onMechanical?: () => void): EpisodePlanStepHandlers {
  return {
    provider,
    mechanical: async () => {
      onMechanical?.();
      return { status: "completed", artifact: { gate: "pass" } };
    },
    approval: async () => ({ status: "failed", reasonCode: "unused", summary: "unused" }),
  };
}

const SUSPENDED: ProviderStepOutcome = {
  status: "suspended",
  reasonCode: ERROR_TURN_BUDGET_SUSPENDED,
  summary: "per-turn budget suspended this turn; session preserved",
};

describe("CF-REG-236-BUDGET — a budget-suspended plan step parks and re-enters", () => {
  const homes: TempStateHome[] = [];
  afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

  async function fixture(): Promise<TempStateHome> {
    const home = await makeTempStateHome({ name: "plan-suspension" });
    homes.push(home);
    await persistPlan(home.stateHome);
    return home;
  }

  it("parks at waiting_approval and runs no dependent step", async () => {
    const home = await fixture();
    let mechanicalRuns = 0;
    const result = await executeEpisodePlan({
      root: home.stateHome,
      plan: PLAN,
      handlers: handlers(
        async () => SUSPENDED,
        () => {
          mechanicalRuns += 1;
        },
      ),
    });

    expect(result.status).toBe("waiting_approval");
    expect(result.nextStepId).toBe("implement");
    expect(result.reasonCode).toBe(ERROR_TURN_BUDGET_SUSPENDED);
    // The dependent gate must not run on a step that never produced its output.
    expect(mechanicalRuns).toBe(0);

    const journal = await readEpisodePlanExecutionJournal(home.stateHome, EPISODE_ID);
    expect(journal).toMatchObject({ status: "waiting_approval", blocked_step_id: "implement" });
    expect(journal!.events.at(-1)).toMatchObject({
      kind: "step_suspended",
      step_kind: "provider_turn",
      step_id: "implement",
      attempt: 1,
      reason_code: ERROR_TURN_BUDGET_SUSPENDED,
    });
  });

  it("re-enters the SAME step under a new attempt once the budget is granted", async () => {
    const home = await fixture();
    const attempts: number[] = [];
    await executeEpisodePlan({
      root: home.stateHome,
      plan: PLAN,
      handlers: handlers(async () => SUSPENDED),
    });

    // Second invocation: the human granted the budget, the driver re-claims,
    // and the parked step must be the one that runs — not a fresh plan walk,
    // and not a permanent failure.
    const resumed = await executeEpisodePlan({
      root: home.stateHome,
      plan: PLAN,
      handlers: handlers(async () => {
        const journal = await readEpisodePlanExecutionJournal(home.stateHome, EPISODE_ID);
        attempts.push(
          journal!.events.filter((event) => event.kind === "step_started" && event.step_id === "implement").length,
        );
        return { status: "completed", artifact: { implemented: true } };
      }),
    });

    expect(attempts).toEqual([2]);
    expect(resumed.status).toBe("completed");
    expect(resumed.completedStepIds.sort()).toEqual(["gates", "implement"]);
  });

  it("survives repeated suspension without corrupting attempt accounting", async () => {
    const home = await fixture();
    for (let round = 0; round < 3; round += 1) {
      const result = await executeEpisodePlan({
        root: home.stateHome,
        plan: PLAN,
        handlers: handlers(async () => SUSPENDED),
      });
      expect(result.status).toBe("waiting_approval");
    }
    const journal = await readEpisodePlanExecutionJournal(home.stateHome, EPISODE_ID);
    const starts = journal!.events.filter(
      (event): event is StepStartedEvent => event.kind === "step_started" && event.step_id === "implement",
    );
    // Contiguous attempts, one terminal suspension each: `assertJournalLifecycle`
    // rejects any other shape, so reaching here IS the accounting assertion.
    expect(starts.map((event) => event.attempt)).toEqual([1, 2, 3]);
    expect(journal!.events.filter((event) => event.kind === "step_suspended")).toHaveLength(3);
  });

  it("negative control: a FAILED provider step is still sticky for its plan version", async () => {
    const home = await fixture();
    let providerCalls = 0;
    await executeEpisodePlan({
      root: home.stateHome,
      plan: PLAN,
      handlers: handlers(async () => {
        providerCalls += 1;
        return { status: "failed", reasonCode: "error_ticket_provider_turn_failed", summary: "boom" };
      }),
    });

    const again = await executeEpisodePlan({
      root: home.stateHome,
      plan: PLAN,
      handlers: handlers(async () => {
        providerCalls += 1;
        return { status: "completed", artifact: { implemented: true } };
      }),
    });

    // A failure short-circuits on re-entry — which is exactly why a budget
    // pause could not be modelled as one.
    expect(again.status).toBe("failed");
    expect(providerCalls).toBe(1);
  });

  it("negative control: only a provider step may suspend", async () => {
    const home = await fixture();
    await expect(
      executeEpisodePlan({
        root: home.stateHome,
        plan: PLAN,
        handlers: {
          provider: async () => ({ status: "completed", artifact: { implemented: true } }),
          // A mechanical gate spends nothing and has no per-turn budget.
          mechanical: async () => SUSPENDED as never,
          approval: async () => ({ status: "failed", reasonCode: "unused", summary: "unused" }),
        },
      }),
    ).rejects.toThrow(/unsupported-status for mechanical_gate step gates/);
  });
});

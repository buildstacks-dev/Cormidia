import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  Runtime,
  TurnHooks,
  TurnRequest,
  TurnResult,
} from "../../../src/runtime/types.js";
import {
  CampaignBudgetStore,
  EnforcedCampaignBudgetRuntime,
  evidenceBackedPlannerAttemptCount,
  type CampaignBudgetLedger,
} from "../../src/eval-runner/campaign-budget.js";
import { ARTIFACT_ROOT } from "../../src/fixtures/controlled-world.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Layer-4 campaign spend enforcement", () => {
  it("reserves before the provider turn and settles observed spend", async () => {
    const store = await budgetStore();
    const inner = new RecordingClaudeRuntime(1.25);
    const runtime = new EnforcedCampaignBudgetRuntime(inner, store, "OPERON-EP-001-r1");

    const result = await runtime.runTurn(request(), hooks());
    const summary = await store.summary();

    expect(result.status).toBe("completed");
    expect(inner.admittedCeilings).toEqual([5]);
    expect(summary).toMatchObject({
      observedUsd: 1.25,
      reservedUsd: 0,
      remainingUsd: 58.75,
      unmeasuredTurnIds: [],
      ceilingViolations: [],
    });
  });

  it("shrinks the native per-turn ceiling to the exact aggregate remainder", async () => {
    const store = await budgetStore();
    const ledger = await store.initialize();
    ledger.turns = [
      ...Array.from({ length: 11 }, (_, index) => settledTurn(`prior-${index + 1}`, 5)),
      settledTurn("prior-12", 3),
    ];
    await store.write(ledger);
    const inner = new RecordingClaudeRuntime(2);
    const runtime = new EnforcedCampaignBudgetRuntime(inner, store, "OPERON-EP-001-r1");

    expect((await runtime.runTurn(request(), hooks())).status).toBe("completed");
    expect(inner.admittedCeilings).toEqual([2]);
    const refused = await runtime.runTurn(request(), hooks());
    expect(refused).toMatchObject({
      status: "failed",
      errorCode: "error_campaign_spend_ceiling",
      usage: { costUsd: 0 },
    });
    expect(inner.admittedCeilings).toEqual([2]);
    expect((await store.summary()).remainingUsd).toBe(0);
  });

  it("leaves a thrown provider turn reserved and therefore never guesses its spend", async () => {
    const store = await budgetStore();
    const inner: Runtime = {
      kind: "claude",
      async runTurn(): Promise<TurnResult> {
        throw new Error("transport ended after provider admission");
      },
    };
    const runtime = new EnforcedCampaignBudgetRuntime(inner, store, "OPERON-EP-001-r1");

    await expect(runtime.runTurn(request(), hooks())).rejects.toThrow(
      "transport ended after provider admission",
    );
    expect(await store.summary()).toMatchObject({
      observedUsd: 0,
      reservedUsd: 5,
      remainingUsd: 55,
      unmeasuredTurnIds: ["OPERON-EP-001-r1:planner-turn:1"],
    });
  });

  it("reports failed planner attempts from settled budget evidence", () => {
    expect(
      evidenceBackedPlannerAttemptCount(
        0,
        [
          settledTurn("OPERON-EP-003-r3:planner-turn:1", 0.4),
          { ...settledTurn("OPERON-EP-003-r3:planner-turn:2", 0.2), ordinal: 2 },
        ],
      ),
    ).toBe(2);
  });

  it("keeps the diagnostic ledger on its separately authorized $10 identity", async () => {
    const store = await budgetStore({
      campaignId: "OPERON-L4-002",
      aggregateCeilingUsd: 10,
      perTurnCeilingUsd: 5,
    });
    const runtime = new EnforcedCampaignBudgetRuntime(
      new RecordingClaudeRuntime(1.25),
      store,
      "OPERON-EP-003-r1",
    );

    expect((await runtime.runTurn(request(), hooks())).status).toBe("completed");
    expect(await store.read()).toMatchObject({
      campaign_id: "OPERON-L4-002",
      aggregate_ceiling_usd: 10,
      per_turn_ceiling_usd: 5,
    });
    expect(await store.summary()).toMatchObject({
      observedUsd: 1.25,
      remainingUsd: 8.75,
    });
  });

  it("OPERON-L4-002-DET-003 keeps the full-stage ledger on the exact $60 identity", async () => {
    const store = await budgetStore({
      campaignId: "OPERON-L4-002",
      aggregateCeilingUsd: 60,
      perTurnCeilingUsd: 5,
    });

    await store.initialize();

    expect(await store.read()).toMatchObject({
      campaign_id: "OPERON-L4-002",
      aggregate_ceiling_usd: 60,
      per_turn_ceiling_usd: 5,
    });
  });
});

class RecordingClaudeRuntime implements Runtime {
  readonly kind = "claude" as const;
  readonly admittedCeilings: number[] = [];

  constructor(private readonly costUsd: number) {}

  async runTurn(request: TurnRequest): Promise<TurnResult> {
    this.admittedCeilings.push(request.role.maxTurnBudgetUsd);
    return {
      status: "completed",
      summary: "{}",
      artifacts: [],
      session: { runtime: "claude", id: `session-${this.admittedCeilings.length}` },
      usage: {
        tokensIn: 10,
        tokensOut: 10,
        costUsd: this.costUsd,
        subagentTurns: 0,
        wallClockMs: 10,
        quality: "complete",
      },
      escalations: [],
    };
  }
}

async function budgetStore(
  authorization: ConstructorParameters<typeof CampaignBudgetStore>[2] = {
    campaignId: "OPERON-L4-001",
    aggregateCeilingUsd: 60,
    perTurnCeilingUsd: 5,
  },
): Promise<CampaignBudgetStore> {
  const parent = resolve(ARTIFACT_ROOT, "tmp");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent, "campaign-budget-"));
  temporaryRoots.push(root);
  return new CampaignBudgetStore(
    resolve(root, "ledger.json"),
    "4756fe437be194892b4c9f8a5efaff30d77d3ba3974c1d66c338666c4b52b3a0",
    authorization,
  );
}

function settledTurn(id: string, observedUsd: number): CampaignBudgetLedger["turns"][number] {
  return {
    id,
    attempt_id: "prior",
    ordinal: 1,
    status: "settled",
    reserved_usd: 5,
    observed_usd: observedUsd,
    admitted_at: "2026-07-30T00:00:00.000Z",
    settled_at: "2026-07-30T00:00:01.000Z",
    terminal_status: "completed",
    usage_quality: "complete",
    ceiling_violation: null,
  };
}

function request(): TurnRequest {
  return {
    role: {
      name: "planner",
      runtime: "claude",
      model: "claude-opus-5",
      effort: "xhigh",
      delegation: { allow: [] },
      triggers: [{ manual: true }],
      outputs: ["episode-plan"],
      maxTurnBudgetUsd: 5,
    },
    assignment: {
      harness: "claude",
      model: "claude-opus-5",
      effort: "xhigh",
    },
    workdir: "/tmp/operon-layer-4-budget-test",
    task: "return a bounded plan",
    context: { taste: [], memoryExcerpts: [] },
  };
}

function hooks(): TurnHooks {
  return {
    gate: () => ({ allow: false, reason: "no tools", escalate: false }),
  };
}

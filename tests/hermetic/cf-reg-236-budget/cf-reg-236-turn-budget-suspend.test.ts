// CF-REG-236-BUDGET — a turn that hits its per-turn budget boundary preserves
// its state and reports what happened to it.
//
// #229 built the enforcement ring: no action crosses a cap. It deliberately
// stopped there, and the outcome it left was the harshest of the loop's three —
// `op:returned`, which burns a claim — even when the episode could still afford
// another turn. Epic #236 ratified two rings:
//
//   soft (per_turn)  the per-turn bound was tighter than the episode's
//                    remaining allowance. SUSPEND: park the exact session, put
//                    one item in the existing approvals queue, keep the claim.
//   hard (episode)   the episode ceiling itself bound. STOP, and offer no
//                    escalation — without this ring suspend -> grant -> suspend
//                    has no bound.
//
// Every ring assertion here is derived from what the episode ledger actually
// allowed, never declared by the test.

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RoleConfig, Runtime, TurnHooks, TurnRequest, TurnResult, TurnUsage } from "../../../src/runtime/types.js";
import { ERROR_TURN_BUDGET_EXHAUSTED, ERROR_TURN_BUDGET_SUSPENDED } from "../../../src/runtime/turn-budget.js";
import { executePipeline } from "../../../src/loop/pipeline.js";
import { readEnvelope } from "../../../src/runtime/runlog/envelope.js";
import { readTurnRecords } from "../../../src/runtime/telemetry.js";
import {
  beginTicketClaim,
  continueAfterApproval,
  finishTicketClaim,
  markTicketClaimed,
  markTicketProviderStarted,
} from "../../../src/loop/claim-recovery.js";
import { readTicketClaimState } from "../../../src/loop/rehydrate.js";
import type { GhIssue, GhOps } from "../../../src/loop/github.js";
import type { LoopItem } from "../../../src/loop/types.js";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { raiseTurnBudgetEscalation, resumeCostEstimate, TURN_BUDGET_RULE } from "../../../src/org/budget.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const ROLE: RoleConfig = {
  name: "builder",
  runtime: "claude",
  model: "claude-scripted-model",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [],
  outputs: ["pr"],
  // Deliberately BELOW the episode ceiling used in the soft-ring cases, so the
  // per-turn ring is what binds. The hard-ring case raises the role cap to the
  // ceiling so the episode binds instead — same runtime, same script.
  maxTurnBudgetUsd: 2,
};

const SESSION_ID = "scripted-suspend-session";

/** Partial usage with an observable cache split — all three adapter profiles
 * declare `cache.observable: true`, which is what makes a resume estimate real
 * rather than modelled. */
function usage(costUsd: number): TurnUsage {
  return {
    tokensIn: 100_000,
    tokensInUncached: 20_000,
    cacheCreationTokens: 30_000,
    cacheReadTokens: 50_000,
    tokensOut: 400,
    costUsd,
    subagentTurns: 0,
    wallClockMs: 1_000,
    quality: "partial",
  };
}

/** Reports cost in chunks and keeps asking for tool actions until the gate
 * refuses. It never decides its own fate: the boundary does. */
class ChunkedSpendRuntime implements Runtime {
  readonly kind = "claude" as const;
  executedActions = 0;
  refusedReason: string | undefined;

  constructor(private readonly chunks: readonly number[]) {}

  async runTurn(_req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    let current = usage(0);
    hooks.onProgress?.({ session: { runtime: "claude", id: SESSION_ID }, usage: current });
    for (const [index, cost] of this.chunks.entries()) {
      current = usage(cost);
      hooks.onProgress?.({ usage: current });
      const decision = hooks.gate({ tool: "read", input: { index } });
      if (!decision.allow) {
        this.refusedReason = decision.reason;
        return {
          status: "failed",
          errorCode: "scripted_runtime_stopped",
          summary: decision.reason,
          artifacts: [],
          session: { runtime: "claude", id: SESSION_ID },
          usage: current,
          escalations: [],
        };
      }
      this.executedActions += 1;
    }
    return {
      status: "completed",
      summary: "scripted actions completed",
      artifacts: [],
      session: { runtime: "claude", id: SESSION_ID },
      usage: { ...current, quality: "complete" },
      escalations: [],
    };
  }
}

interface RunOptions {
  episode: string;
  /** Episode ceiling. Equal to the role cap => hard ring; above it => soft. */
  episodeCeilingUsd: number;
  roleCapUsd?: number;
}

describe("CF-REG-236-BUDGET — per-turn budget suspends, episode ceiling stops", () => {
  const homes: TempStateHome[] = [];
  afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

  async function run(options: RunOptions) {
    const home = await makeTempStateHome({ name: options.episode });
    homes.push(home);
    const runtime = new ChunkedSpendRuntime([0.5, 2]);
    const role: RoleConfig = {
      ...ROLE,
      ...(options.roleCapUsd === undefined ? {} : { maxTurnBudgetUsd: options.roleCapUsd }),
    };
    const result = await executePipeline({
      pipeline: {
        name: "budget-fixture",
        mechanical: false,
        passes: [{ id: "implement", role: "builder", template: "" }],
      },
      selection: { tier: "quick" },
      roles: { builder: role },
      runtimeFor: () => runtime,
      briefFor: () => "Exercise the two-ring budget boundary.",
      promptsDir: home.stateHome,
      context: { taste: [], memoryExcerpts: [] },
      workdir: home.stateHome,
      hooks: { gate: () => ({ allow: true }) },
      runlog: { root: home.stateHome, app: "app", traceId: `trace-${options.episode}` },
      episode: {
        id: options.episode,
        route: "quick",
        budgetOverrides: { equivalent_cost_usd: options.episodeCeilingUsd },
      },
      telemetry: { orgDir: home.stateHome },
    });
    const pass = result.passes[0]!;
    return {
      home,
      runtime,
      pass,
      envelope: await readEnvelope(home.stateHome, "app", pass.runId),
      settlements: await readTurnRecords(home.stateHome),
    };
  }

  it("suspends the turn when the PER-TURN cap binds and the episode can still afford one", async () => {
    // Role cap $2, episode ceiling $10: the per-turn bound is strictly tighter,
    // so a human has something to grant.
    const observed = await run({ episode: "episode-soft-ring", episodeCeilingUsd: 10 });

    expect(observed.runtime.executedActions).toBe(1);
    expect(observed.pass.result).toMatchObject({
      status: "blocked_on_gate",
      errorCode: ERROR_TURN_BUDGET_SUSPENDED,
    });
    expect(observed.envelope.budget_stop).toMatchObject({
      dimension: "equivalent_cost_usd",
      cap: 2,
      observed: 2,
      ring: "per_turn",
      episode_remaining: 10,
    });
  });

  it("preserves the session handle and non-zero partial usage across the suspension", async () => {
    const observed = await run({ episode: "episode-soft-state", episodeCeilingUsd: 10 });

    // #229's acceptance ("partial usage and terminal reason survive; no engaged
    // provider records 0/0") now has to hold across a PAUSE, where the numbers
    // are also what the human is asked to fund.
    expect(observed.pass.result.session).toEqual({ runtime: "claude", id: SESSION_ID });
    expect(observed.pass.result.usage.costUsd).toBe(2);
    expect(observed.pass.result.usage.tokensIn).toBeGreaterThan(0);
    expect(observed.pass.result.usage.tokensOut).toBeGreaterThan(0);
    expect(observed.pass.result.summary).toContain("Partial usage and the provider session");
    expect(observed.settlements).toHaveLength(1);
    expect(observed.settlements[0]!.costUsd).toBe(2);
    // The continuation the ticket layer builds needs both fingerprints.
    expect(observed.pass.contextFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("negative control: the EPISODE ceiling stops with no escalation offered", async () => {
    // Role cap raised to the ceiling: nothing is left to grant, so this must
    // keep #229's terminal shape exactly — not the new suspension.
    const observed = await run({
      episode: "episode-hard-ring",
      episodeCeilingUsd: 2,
      roleCapUsd: 2,
    });

    expect(observed.pass.result).toMatchObject({
      status: "failed",
      errorCode: ERROR_TURN_BUDGET_EXHAUSTED,
    });
    expect(observed.envelope.budget_stop).toMatchObject({ ring: "episode", cap: 2 });
    expect(observed.pass.result.summary).not.toContain("suspended");
    // The gate's refusal is a terminal local stop either way: budget admission
    // never escalates through the SAFETY gate (#229).
    expect(observed.runtime.refusedReason).toContain("hard turn budget exhausted");
  });

  it("the soft-ring refusal is still a hard local stop, not a gate escalation", async () => {
    const observed = await run({ episode: "episode-soft-refusal", episodeCeilingUsd: 10 });
    expect(observed.runtime.refusedReason).toContain("per-turn budget suspended");
    // One admitted action, then the cap: enforcement is unchanged by the ring.
    expect(observed.runtime.executedActions).toBe(1);
  });
});

describe("CF-REG-236-BUDGET — the escalation enters the one existing inbox", () => {
  const homes: TempStateHome[] = [];
  afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

  async function store(): Promise<{ home: TempStateHome; store: ApprovalStore }> {
    const home = await makeTempStateHome({ name: "escalation" });
    homes.push(home);
    return { home, store: new ApprovalStore(home.stateHome) };
  }

  const escalation = {
    app: "app",
    role: "builder",
    ticketRef: "#7",
    episodeId: "ticket:app:#7",
    runId: "run-1",
    pipeline: "episode-plan",
    pass: "implement",
    stop: {
      dimension: "equivalent_cost_usd",
      cap: 2,
      observed: 2,
      costMeasurement: "measured",
      episodeRemaining: 10,
    },
    spentUsd: 2,
    resume: resumeCostEstimate(usage(2)),
  };

  it("raises ONE per-turn item carrying the resume-cost estimate", async () => {
    const { home, store: approvals } = await store();
    const item = await raiseTurnBudgetEscalation(home.stateHome, escalation);

    expect(item.rule).toBe(TURN_BUDGET_RULE);
    expect(item.ticketRef).toBe("#7");
    // Not the app-monthly rule, and not a second queue.
    const pending = await approvals.listPending();
    expect(pending.map((row) => row.rule)).toEqual([TURN_BUDGET_RULE]);
    expect(item.action.input).toMatchObject({
      kind: "turn-budget-grant",
      resumeCostBasis: "observed_cache_tokens",
      resumeCacheReadTokens: 50_000,
      resumeCacheCreationTokens: 30_000,
      episodeRemainingUsd: 10,
    });
    // 80k of 100k input tokens were context the turn had to re-hold, so most of
    // the $2 is re-establishment — exactly what a human funding "+$10" needs.
    expect((item.action.input as { resumeCostUsd: number }).resumeCostUsd).toBeCloseTo(1.6, 4);
  });

  it("is idempotent per parked turn, so a crash before the queue write converges", async () => {
    const { home, store: approvals } = await store();
    const first = await raiseTurnBudgetEscalation(home.stateHome, escalation);
    const second = await raiseTurnBudgetEscalation(home.stateHome, escalation);

    expect(second.id).toBe(first.id);
    expect(await approvals.listPending()).toHaveLength(1);
  });

  it("reports an honest absence rather than an invented estimate", () => {
    const blind = resumeCostEstimate({ tokensIn: 100_000, costUsd: 2 });
    expect(blind).toEqual({
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      usd: null,
      basis: "unavailable",
    });
  });
});

// --- Claim accounting -------------------------------------------------------
//
// #104: a granted approval pause must not consume a failure claim. Its evidence
// is the cost of getting this wrong — $14.62 of duplicated spend on one ticket,
// reaching op:returned without ever opening a PR. Budget pauses inherit it.

class FakeGh implements Pick<GhOps, "readIssue" | "swapLabel" | "addLabel"> {
  labels = ["op:blocked"];
  readonly swaps: Array<[string, string]> = [];

  async readIssue(): Promise<GhIssue> {
    return { number: 7, title: "t", body: "", labels: [...this.labels], state: "open" } as GhIssue;
  }

  async swapLabel(_issue: number, from: string, to: string): Promise<void> {
    this.swaps.push([from, to]);
    this.labels = this.labels.map((label) => (label === from ? to : label));
  }

  async addLabel(_issue: number, label: string): Promise<void> {
    this.labels.push(label);
  }
}

describe("CF-REG-236-BUDGET — a budget pause does not consume a failure claim", () => {
  const homes: TempStateHome[] = [];
  afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

  async function parkedTicket(): Promise<{ home: TempStateHome; gh: FakeGh }> {
    const home = await makeTempStateHome({ name: "claims" });
    homes.push(home);
    const begun = await beginTicketClaim({
      root: home.stateHome,
      app: "app",
      issueNumber: 7,
      defaultAllowance: 3,
    });
    const claimId = begun.lease!.claimId;
    const common = { root: home.stateHome, app: "app", issueNumber: 7, claimId };
    await markTicketClaimed(common);
    await markTicketProviderStarted(common);
    const item = {
      issueNumber: 7,
      ticketRef: "#7",
      phase: "blocked",
      continuation: {
        pipeline: "episode-plan",
        pass: "implement",
        role: "builder",
        session: { runtime: "claude", id: SESSION_ID },
        completedPasses: [],
        contextFingerprint: "a".repeat(64),
        workFingerprint: "b".repeat(64),
        runId: "run-1",
        pausedAt: "2026-08-03T00:00:00.000Z",
        decisions: [],
        pauseCostUsd: 2,
        pauseKind: "budget" as const,
        pauseApprovalId: "appr-1",
      },
    } as unknown as LoopItem;
    await finishTicketClaim({ ...common, item });
    return { home, gh: new FakeGh() };
  }

  it("parks with the exact session and leaves the claim count at one", async () => {
    const { home } = await parkedTicket();
    const state = readTicketClaimState(home.stateHome, "app", 7);

    expect(state.claims).toBe(1);
    expect(state.continuation).toMatchObject({
      status: "waiting_approval",
      pauseKind: "budget",
      claimNumber: 1,
      pauseCount: 1,
      session: { id: SESSION_ID },
    });
    expect(state.events?.at(-1)).toMatchObject({ kind: "approval_paused", costUsd: 2 });
  });

  it("a granted budget resumes the same claim rather than opening a new one", async () => {
    const { home, gh } = await parkedTicket();
    const outcome = await continueAfterApproval({
      root: home.stateHome,
      app: "app",
      issueNumber: 7,
      approvalId: "appr-1",
      decision: "approved",
      gh: gh as unknown as GhOps,
    });
    expect(outcome).toBe("resumed");
    expect(gh.swaps).toEqual([["op:blocked", "op:ready"]]);

    const resumed = await beginTicketClaim({
      root: home.stateHome,
      app: "app",
      issueNumber: 7,
      defaultAllowance: 3,
    });
    expect(resumed.allowed).toBe(true);
    expect(resumed.lease).toMatchObject({ resume: true, claimNumber: 1 });
    expect(resumed.lease?.continuation).toMatchObject({
      pass: "implement",
      pauseKind: "budget",
      session: { id: SESSION_ID },
    });
    await markTicketProviderStarted({
      root: home.stateHome,
      app: "app",
      issueNumber: 7,
      claimId: resumed.lease!.claimId,
    });
    // The commit point ran again on the resumed turn and still did not charge a
    // second claim — this is the exact accounting #104 established.
    expect(readTicketClaimState(home.stateHome, "app", 7).claims).toBe(1);
  });

  it("a DENIED budget grant terminalizes instead of resuming into the same cap", async () => {
    const { home, gh } = await parkedTicket();
    const outcome = await continueAfterApproval({
      root: home.stateHome,
      app: "app",
      issueNumber: 7,
      approvalId: "appr-1",
      decision: "denied",
      reason: "not worth more spend",
      gh: gh as unknown as GhOps,
    });

    expect(outcome).toBe("terminalized");
    expect(gh.swaps).toEqual([["op:blocked", "op:returned"]]);
    const state = readTicketClaimState(home.stateHome, "app", 7);
    expect(state.continuation).toBeUndefined();
    // Still one claim: refusing to fund more work is not a merit failure.
    expect(state.claims).toBe(1);
    expect(state.outcomes.at(-1)).toContain("budget grant appr-1 denied");
    // And it deposits NO #244 suppression: a spend refusal suppressed no
    // critical operation.
    expect(state.suppressed).toBeUndefined();
  });
});

// --- Episode finalization ---------------------------------------------------

describe("CF-REG-236-BUDGET — a pause is not a terminal episode", () => {
  const homes: TempStateHome[] = [];
  afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

  it("negative control: a terminal route record makes the resumed claim unreachable", async () => {
    // Not a behaviour assertion about the pause — a demonstration of WHY the
    // driver must not finalize one. `runLoopOnce` refuses to claim any op:ready
    // ticket whose episode carries a terminal record, so finalizing a pause
    // would bounce the ticket back to op:returned the instant it was funded,
    // discarding the paid session. This pins the coupling that makes the
    // driver's skip load-bearing.
    const home = await makeTempStateHome({ name: "terminal-episode" });
    homes.push(home);
    const { episodeIdFor, efficiencyEpisodeDir, readTerminalTicketEpisode } = await import(
      "../../../src/loop/efficiency.js"
    ).then(async (efficiency) => ({
      ...efficiency,
      readTerminalTicketEpisode: (await import("../../../src/loop/claim-recovery.js")).readTerminalTicketEpisode,
    }));
    const episodeId = episodeIdFor({ app: "app", ticket: "#7", traceId: "#7" });
    const dir = efficiencyEpisodeDir(home.stateHome, episodeId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "route.json"),
      `${JSON.stringify(
        {
          schema_version: 1,
          episode_id: episodeId,
          app: "app",
          policy_version: "test",
          admitted_at: "2026-08-03T00:00:00.000Z",
          planned_route: "quick",
          current_route: "quick",
          final_route: "quick",
          factors: [],
          authorized_passes: [],
          budget: {
            provider_turns: 3,
            equivalent_cost_usd: 10,
            active_time_ms: 60_000,
            human_decisions: null,
          },
          execution_bounds: null,
          reassessments: [],
          terminal: {
            at: "2026-08-03T00:01:00.000Z",
            status: "blocked",
            reason: "#7 blocked",
            final_route: "quick",
            next_step: null,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    expect(await readTerminalTicketEpisode({ root: home.stateHome, app: "app", issueNumber: 7 })).toMatchObject({
      episodeId,
      terminal: { status: "blocked" },
    });
  });
});

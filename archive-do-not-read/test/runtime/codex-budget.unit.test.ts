// Tests CodexRuntime estimated-cost budgets and telemetry with App Server mocked.
// Covers documented model pricing, conservative unknown-model pricing, cost
// estimation, under/over-budget turns, client closure on overrun, incident notes,
// and telemetry cost attribution.
// Uses a fake App Server client only; no network, auth, real Codex server, org
// state, or wall-clock time is required.

import { describe, expect, it } from "vitest";
import {
  CodexRuntime,
  codexModelPrice,
  estimateCodexCostUsd,
  type CodexAppServerClient,
  type CodexServerMessage,
  type JsonRpcId,
} from "../../src/runtime/adapters/codex.js";
import { toRecord } from "../../src/runtime/telemetry.js";
import type { RoleConfig, TurnRequest } from "../../src/runtime/types.js";

const ROLE: RoleConfig = {
  name: "builder",
  runtime: "codex",
  model: "gpt-5.5",
  effort: "high",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 1,
};

function makeReq(overrides: Partial<RoleConfig> = {}): TurnRequest {
  return {
    role: { ...ROLE, ...overrides },
    workdir: "/wd",
    task: "implement the ticket",
    context: { taste: [], memoryExcerpts: [] },
  };
}

function tokenUsage(fields: {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
}): CodexServerMessage {
  return {
    method: "thread/tokenUsage/updated",
    params: { tokenUsage: { last: fields } },
  };
}

function turnCompleted(text: string): CodexServerMessage {
  return {
    method: "turn/completed",
    params: { turn: { status: "completed", durationMs: 4200, items: [{ type: "agentMessage", text }] } },
  };
}

/** Minimal scripted App Server: canned responses for the handshake requests,
 *  then yields the scripted server messages in order. */
class FakeCodexClient implements CodexAppServerClient {
  closed = false;
  private idx = 0;
  constructor(private readonly messages: CodexServerMessage[]) {}

  async request(method: string): Promise<unknown> {
    if (method === "thread/start" || method === "thread/resume") return { thread: { id: "codex-thread" } };
    return {};
  }
  async notify(): Promise<void> {}
  async respond(_id: JsonRpcId, _result: unknown): Promise<void> {}
  async close(): Promise<void> {
    this.closed = true;
  }
  [Symbol.asyncIterator](): AsyncIterator<CodexServerMessage> {
    return {
      next: async () => {
        if (this.idx < this.messages.length) return { done: false, value: this.messages[this.idx++]! };
        return { done: true, value: undefined };
      },
    };
  }
}

describe("codex estimated-cost pricing (documented list prices)", () => {
  it("prices the roster models from the cited OpenAI table", () => {
    expect(codexModelPrice("gpt-5.6-sol")).toEqual({ inputPerMTok: 5, outputPerMTok: 30 });
    expect(codexModelPrice("gpt-5.5")).toEqual({ inputPerMTok: 5, outputPerMTok: 30 });
    expect(codexModelPrice("gpt-5.5-2026-04-23")).toEqual({ inputPerMTok: 5, outputPerMTok: 30 });
    expect(codexModelPrice("gpt-5.4")).toEqual({ inputPerMTok: 2.5, outputPerMTok: 15 });
    expect(codexModelPrice("gpt-5.4-mini")).toEqual({ inputPerMTok: 0.75, outputPerMTok: 4.5 });
  });

  it("defaults an unrecognized model to the flagship rate (conservative upper bound, never $0)", () => {
    expect(codexModelPrice("gpt-9-unknown")).toEqual({ inputPerMTok: 5, outputPerMTok: 30 });
  });

  it("estimates cost = input/MTok*inPrice + output/MTok*outPrice", () => {
    // 1M input @ $5 + 0.5M output @ $30 = $5 + $15 = $20 on gpt-5.5.
    expect(estimateCodexCostUsd(1_000_000, 500_000, "gpt-5.5")).toBeCloseTo(20, 10);
    expect(estimateCodexCostUsd(0, 0, "gpt-5.5")).toBe(0);
  });

  it("applies GPT-5.6 long-context pricing above 272K input tokens", () => {
    expect(estimateCodexCostUsd(272_000, 100_000, "gpt-5.6-sol")).toBeCloseTo(4.36, 10);
    expect(estimateCodexCostUsd(300_000, 100_000, "gpt-5.6-sol")).toBeCloseTo(7.5, 10);
  });
});

describe("CodexRuntime per-turn budget (App Server mocked)", () => {
  it("under-budget turn → completed, costUsd is the estimate (not zero), flagged estimated, no note", async () => {
    // 1000 input + 500 output on gpt-5.5 = $0.005 + $0.015 = $0.02, well under $1.
    const client = new FakeCodexClient([
      tokenUsage({ inputTokens: 1000, outputTokens: 500 }),
      turnCompleted("shipped the fix"),
    ]);
    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(makeReq(), {
      gate: () => ({ allow: true }),
    });

    expect(result.status).toBe("completed");
    expect(result.summary).toBe("shipped the fix");
    expect(result.artifacts).toEqual([]);
    expect(result.usage.costUsd).toBeCloseTo(0.02, 10);
    expect(result.usage.costUsd).toBeGreaterThan(0); // no longer a silent $0
    expect(result.usage.costEstimated).toBe(true);
    expect(result.usage.tokensIn).toBe(1000);
    expect(result.usage.tokensOut).toBe(500);
  });

  it("over-budget turn → failed + exactly one incident note + App Server turn stopped", async () => {
    // 1M input on gpt-5.5 = $5.00, crosses the $1 cap on the first usage update.
    const overrun = tokenUsage({ inputTokens: 1_000_000 });
    // A later huge update proves the guard STOPPED the turn before it landed.
    const shouldNotBeConsumed = tokenUsage({ inputTokens: 100_000_000 });
    const client = new FakeCodexClient([overrun, shouldNotBeConsumed, turnCompleted("would-be success")]);
    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(makeReq(), {
      gate: () => ({ allow: true }),
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toMatch(/overrun/i);
    expect(result.summary).toContain("$5.0000");

    expect(result.artifacts).toHaveLength(1);
    const note = result.artifacts[0]!;
    expect(note.kind).toBe("note");
    expect(note.summary).toMatch(/overrun/i);
    expect(note.summary).toContain("$5.0000"); // estimated spend
    expect(note.summary).toContain("maxTurnBudgetUsd $1"); // the cap it crossed
    expect(note.summary).toContain("builder"); // whose budget
    expect(note.summary).toMatch(/estimate/i); // honest about the estimate

    // Estimated spend is still attributed — the guard stopped at $5, not the
    // never-reached $505 update.
    expect(result.usage.costUsd).toBe(5);
    expect(result.usage.costEstimated).toBe(true);
    expect(client.closed).toBe(true); // turn was terminated, not left running
  });

  it("near-miss just under the cap → completed, no incident note", async () => {
    // 190k input on gpt-5.5 = $0.95, under the $1 cap.
    const client = new FakeCodexClient([
      tokenUsage({ inputTokens: 190_000 }),
      turnCompleted("done"),
    ]);
    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(makeReq(), {
      gate: () => ({ allow: true }),
    });

    expect(result.status).toBe("completed");
    expect(result.usage.costUsd).toBeCloseTo(0.95, 10);
    expect(result.artifacts).toEqual([]);
  });

  it("estimated cost flows into telemetry's toRecord as real spend (not $0)", async () => {
    const client = new FakeCodexClient([
      tokenUsage({ inputTokens: 1000, outputTokens: 500 }),
      turnCompleted("shipped"),
    ]);
    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(makeReq(), {
      gate: () => ({ allow: true }),
    });

    const record = toRecord(makeReq().role, result, new Date("2026-07-06T12:00:00Z"));
    expect(record.costUsd).toBeCloseTo(0.02, 10);
    expect(record.costUsd).toBeGreaterThan(0);
  });
});

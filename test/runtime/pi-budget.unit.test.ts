// Tests PiRuntime budget enforcement with the pi SDK mocked.
// Covers under-budget completion, over-budget aborts, exact-cap semantics,
// incident-note creation, usage attribution, and defensive final-cost checks.
// Uses fake pi sessions and temp agent dirs only; no network, auth, real pi
// state, real org state, or live wall clock is required.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AuthStorage,
  CreateAgentSessionResult,
  ModelRegistry,
  ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { PiRuntime, type CreatePiAgentSessionFn } from "../../src/runtime/adapters/pi.js";
import type { RoleConfig, TurnRequest } from "../../src/runtime/types.js";

const ROLE: RoleConfig = {
  name: "builder",
  runtime: "pi",
  model: "claude-haiku-4-5",
  effort: "low",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 1,
};

const FAKE_REGISTRY = {
  getAll: () => [{ provider: "anthropic", id: "claude-haiku-4-5" }],
} as unknown as ModelRegistry;

interface FakeTurn {
  cost: number;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/** Scripted pi session: emits one `eventType` event per turn, exposing a
 *  monotonically growing running cost through getSessionStats(). abort()
 *  latches so the prompt loop stops before the next turn. */
class FakePiSession {
  aborted = false;
  private readonly listeners: Array<(e: unknown) => void> = [];
  private cost = 0;
  private tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

  constructor(
    private readonly turns: FakeTurn[],
    private readonly eventType: "turn_end" | "message_end" = "turn_end",
    private readonly lastText = "done",
  ) {}

  subscribe(listener: (e: unknown) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  async prompt(): Promise<void> {
    for (const turn of this.turns) {
      if (this.aborted) break;
      this.cost = turn.cost;
      if (turn.tokens) this.tokens = { ...turn.tokens, total: turn.tokens.input + turn.tokens.output };
      for (const listener of [...this.listeners]) listener({ type: this.eventType, message: {}, toolResults: [] });
    }
  }

  async abort(): Promise<void> {
    this.aborted = true;
  }

  dispose(): void {}

  getSessionStats() {
    return {
      sessionFile: "pi.jsonl",
      sessionId: "pi-sess",
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 0,
      tokens: this.tokens,
      cost: this.cost,
    };
  }

  getLastAssistantText(): string {
    return this.lastText;
  }

  get sessionFile(): string {
    return "pi.jsonl";
  }
  get sessionId(): string {
    return "pi-sess";
  }
}

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "operon-pi-budget-"));
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function makeRuntime(session: FakePiSession): PiRuntime {
  return new PiRuntime({
    createAgentSessionFn: (async () => ({ session })) as unknown as CreatePiAgentSessionFn,
    resourceLoaderFactory: async () => ({}) as unknown as ResourceLoader,
    sessionManagerFactory: () => ({}) as unknown as ReturnType<NonNullable<never>>,
    authStorage: {} as unknown as AuthStorage,
    modelRegistry: FAKE_REGISTRY,
    agentDir: workdir,
  });
}

function makeReq(overrides: Partial<RoleConfig> = {}): TurnRequest {
  return {
    role: { ...ROLE, ...overrides },
    workdir,
    task: "implement the ticket",
    context: { taste: [], memoryExcerpts: [] },
  };
}

describe("PiRuntime per-turn budget (SDK mocked)", () => {
  it("under-budget turn → completed, costUsd is the reported total, no incident note", async () => {
    const session = new FakePiSession([{ cost: 0.5 }, { cost: 0.95 }]);
    const result = await makeRuntime(session).runTurn(makeReq(), { gate: () => ({ allow: true }) });

    expect(result.status).toBe("completed");
    expect(result.summary).toBe("done");
    expect(result.usage.costUsd).toBe(0.95);
    expect(result.artifacts).toEqual([]);
    expect(session.aborted).toBe(false);
  });

  it("over-budget turn → failed + exactly one incident note + session aborted before the next turn", async () => {
    const session = new FakePiSession([
      { cost: 0.5 },
      { cost: 1.5 },
      { cost: 99 }, // must never run: abort latches after the crossing turn
    ]);
    const result = await makeRuntime(session).runTurn(makeReq(), { gate: () => ({ allow: true }) });

    expect(result.status).toBe("failed");
    expect(result.summary).toMatch(/overrun/i);
    expect(result.summary).toContain("$1.5000");

    expect(result.artifacts).toHaveLength(1);
    const note = result.artifacts[0]!;
    expect(note.kind).toBe("note");
    expect(note.summary).toMatch(/overrun/i);
    expect(note.summary).toContain("$1.5000"); // actual spend
    expect(note.summary).toContain("maxTurnBudgetUsd $1"); // the cap it crossed
    expect(note.summary).toContain("builder"); // whose budget

    // The guard stopped the session at $1.5, before the $99 turn — cost is
    // attributed, spend is bounded.
    expect(result.usage.costUsd).toBe(1.5);
    expect(session.aborted).toBe(true);
  });

  it("exact-cap crossing counts as an overrun (>= semantics)", async () => {
    const session = new FakePiSession([{ cost: 1 }]);
    const result = await makeRuntime(session).runTurn(makeReq(), { gate: () => ({ allow: true }) });

    expect(result.status).toBe("failed");
    expect(result.artifacts).toHaveLength(1);
    expect(session.aborted).toBe(true);
  });

  it("defensive final check: a single turn past the cap with no catchable boundary still fails + notes", async () => {
    // Emit message_end (not turn_end), so the mid-turn guard never fires; the
    // adapter's final-cost check must still catch the overrun.
    const session = new FakePiSession([{ cost: 4 }], "message_end");
    const result = await makeRuntime(session).runTurn(makeReq(), { gate: () => ({ allow: true }) });

    expect(result.status).toBe("failed");
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.summary).toContain("$4.0000");
    // Never aborted (the guard did not fire mid-turn) — this is the pure
    // final-check path.
    expect(session.aborted).toBe(false);
  });

  it("aborts the SDK session and returns checkpointed partial usage on cancellation", async () => {
    const controller = new AbortController();
    const session = new FakePiSession([
      { cost: 0.4, tokens: { input: 10, output: 3, cacheRead: 2, cacheWrite: 1 } },
      { cost: 0.8, tokens: { input: 20, output: 6, cacheRead: 4, cacheWrite: 2 } },
    ]);
    const progress: Array<{ usage?: { costUsd: number; quality?: string } }> = [];
    const result = await makeRuntime(session).runTurn(
      { ...makeReq(), signal: controller.signal },
      {
        gate: () => ({ allow: true }),
        onProgress: (event) => {
          progress.push(event);
          if (event.usage !== undefined) controller.abort("operator SIGTERM");
        },
      },
    );

    expect(session.aborted).toBe(true);
    expect(result).toMatchObject({
      status: "cancelled",
      summary: "operator SIGTERM",
      usage: { costUsd: 0.4, tokensIn: 13, tokensOut: 3, quality: "partial" },
    });
    expect(progress.some((event) => event.usage?.quality === "partial")).toBe(true);
  });
});

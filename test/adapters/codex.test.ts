// Tests the Codex runtime adapter against a mocked App Server.
// Covers thread start/resume, context/options mapping, command and patch
// approval gating, MCP elicitation decline, token accumulation, patch action
// normalization, and the shared runtime conformance suite.
// Fake clients provide all server messages locally; no network, auth, real
// Codex server, org state, or wall-clock time is required.

import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { runConformanceSuite } from "../conformance/harness.js";
import type { ScriptedTurn } from "../../src/runtime/testing/fakeRuntime.js";
import {
  CodexRuntime,
  normalizeCodexApprovalAction,
  normalizeCodexApprovalActions,
  toCodexStrictSchema,
  type CodexAppServerClient,
  type CodexAppServerLaunchOptions,
  type CodexServerMessage,
  type JsonRpcId,
} from "../../src/runtime/adapters/codex.js";
import { EPISODE_PLAN_PROPOSAL_SCHEMA } from "../../src/loop/episode-plan.js";
import { defaultGate } from "../../src/runtime/gate.js";
import { buildTurnExecutionFacts } from "../../src/runtime/assignment.js";
import type { RoleConfig, ToolAction, TurnEvent, TurnRequest, TurnResult } from "../../src/runtime/types.js";
import { makeBareWithClone } from "../fixtures/gitRepo.js";

const CODEX_ROLE: RoleConfig = {
  name: "builder",
  runtime: "codex",
  model: "gpt-5.5",
  effort: "high",
  delegation: { allow: [] },
  triggers: [],
  outputs: ["pr"],
  maxTurnBudgetUsd: 5,
};

function makeReq(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    role: CODEX_ROLE,
    workdir: "/tmp/operon-codex-test",
    task: "do the thing",
    context: { taste: ["ORG-TASTE", "ROLE-TASTE"], memoryExcerpts: ["MEMORY"] },
    ...overrides,
  };
}

function makeResult(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "codex", id: "thread-1" },
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs: 0 },
    escalations: [],
  };
}

class FakeCodexClient implements CodexAppServerClient {
  readonly requests: Array<{ method: string; params?: unknown }> = [];
  readonly notifications: Array<{ method: string; params?: unknown }> = [];
  readonly responses: Array<{ id: JsonRpcId; result: unknown }> = [];
  private messages: CodexServerMessage[] = [];

  constructor(private readonly turn?: ScriptedTurn) {}

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push(params === undefined ? { method } : { method, params });
    if (method === "initialize") return {};
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "thread/resume") {
      const p = params as { threadId?: string };
      return { thread: { id: p.threadId ?? "thread-1" } };
    }
    if (method === "turn/start") {
      this.messages = messagesForTurn(this.turn ?? { result: makeResult("done") });
      return { turn: { id: "turn-1" } };
    }
    throw new Error(`unexpected request: ${method}`);
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.notifications.push(params === undefined ? { method } : { method, params });
  }

  async respond(id: JsonRpcId, result: unknown): Promise<void> {
    this.responses.push({ id, result });
  }

  async close(): Promise<void> {}

  async *[Symbol.asyncIterator](): AsyncIterator<CodexServerMessage> {
    for (const message of this.messages) yield message;
  }
}

/** Yields a fixed, hand-built message stream (bypasses the single-file
 *  scripted-action mapping) so a multi-file patch approval can be exercised. */
class ScriptedMessageClient implements CodexAppServerClient {
  readonly responses: Array<{ id: JsonRpcId; result: unknown }> = [];
  closed = false;

  constructor(private readonly messages: CodexServerMessage[]) {}

  async request(method: string, params?: unknown): Promise<unknown> {
    if (method === "thread/start" || method === "thread/resume") return { thread: { id: "thread-1" } };
    if (method === "turn/start") return { turn: { id: "turn-1" } };
    return {};
  }

  async notify(): Promise<void> {}

  async respond(id: JsonRpcId, result: unknown): Promise<void> {
    this.responses.push({ id, result });
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<CodexServerMessage> {
    for (const message of this.messages) yield message;
  }
}

function messagesForTurn(turn: ScriptedTurn): CodexServerMessage[] {
  const messages: CodexServerMessage[] = [];
  let approval = 0;
  for (const scripted of turn.toolActions ?? []) {
    if (scripted.fromSubagent) {
      messages.push({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          completedAtMs: 0,
          item: {
            type: "subAgentActivity",
            id: "subagent-1",
            kind: "started",
            agentThreadId: "thread-sub",
            agentPath: "gate-probe",
          },
        },
      });
    }
    messages.push(approvalMessage(++approval, scripted.action));
  }
  messages.push({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      tokenUsage: {
        total: { totalTokens: 20, inputTokens: 10, cachedInputTokens: 2, outputTokens: 7, reasoningOutputTokens: 1 },
        last: { totalTokens: 20, inputTokens: 10, cachedInputTokens: 2, outputTokens: 7, reasoningOutputTokens: 1 },
        modelContextWindow: 200000,
      },
    },
  });
  const item = { type: "agentMessage", id: "agent-1", text: turn.result.summary, phase: null, memoryCitation: null };
  messages.push({
    method: "item/completed",
    params: { threadId: "thread-1", turnId: "turn-1", completedAtMs: 1, item },
  });
  messages.push({
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        items: [item],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 0,
        completedAt: 1,
        durationMs: 123,
      },
    },
  });
  return messages;
}

function approvalMessage(index: number, action: ToolAction): CodexServerMessage {
  if (action.tool === "write") {
    const input = action.input as { path: string; content: string };
    return {
      method: "applyPatchApproval",
      id: `approval-${index}`,
      params: {
        conversationId: "thread-1",
        callId: `call-${index}`,
        fileChanges: { [input.path]: { type: "add", content: input.content } },
        reason: null,
        grantRoot: null,
      },
    };
  }
  const command =
    action.tool === "bash"
      ? (action.input as { command: string }).command
      : `${action.tool} ${JSON.stringify(action.input)}`;
  return {
    method: "item/commandExecution/requestApproval",
    id: `approval-${index}`,
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: `cmd-${index}`,
      startedAtMs: 0,
      environmentId: null,
      command,
      cwd: "/tmp/operon-codex-test",
    },
  };
}

describe("CodexRuntime (App Server mocked)", () => {
  it("uses the explicit assignment atomically for thread and turn requests", async () => {
    const client = new FakeCodexClient({ result: makeResult("done") });
    const assignment = { harness: "codex" as const, model: "gpt-5.4", effort: "xhigh" as const };

    await new CodexRuntime({ clientFactory: () => client }).runTurn(
      makeReq({
        assignment,
        context: {
          taste: [],
          memoryExcerpts: [],
          execution: buildTurnExecutionFacts(
            assignment,
            CODEX_ROLE,
            ["structured_verdict", "tool_gate"],
          ),
        },
      }),
      { gate: defaultGate },
    );

    expect(client.requests[1]?.params).toMatchObject({
      model: "gpt-5.4",
      config: { model_reasoning_effort: "xhigh" },
    });
    expect(client.requests[2]?.params).toMatchObject({ model: "gpt-5.4", effort: "xhigh" });
    expect(JSON.stringify(client.requests[1]?.params)).toContain("Turn execution facts");
    expect(JSON.stringify(client.requests[1]?.params)).toContain("structured verdict");
  });

  it("rejects another harness and unsupported max effort without starting App Server", async () => {
    let factoryCalls = 0;
    const runtime = new CodexRuntime({
      clientFactory: () => {
        factoryCalls += 1;
        return new FakeCodexClient();
      },
    });

    await expect(
      runtime.runTurn(
        makeReq({ assignment: { harness: "claude", model: "claude-exact", effort: "high" } }),
        { gate: defaultGate },
      ),
    ).rejects.toThrow(/does not match "codex" adapter/);
    await expect(
      runtime.runTurn(
        makeReq({ assignment: { harness: "codex", model: "gpt-exact", effort: "max" } }),
        { gate: defaultGate },
      ),
    ).rejects.toThrow(/max is unsupported by codex/);
    expect(factoryCalls).toBe(0);
  });

  it("maps a new turn onto initialize, thread/start, and turn/start", async () => {
    const client = new FakeCodexClient({ result: makeResult("done") });
    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(makeReq(), {
      gate: defaultGate,
    });

    expect(client.requests.map((r) => r.method)).toEqual(["initialize", "thread/start", "turn/start"]);
    expect(client.notifications).toEqual([{ method: "initialized" }]);
    expect(client.requests[1]?.params).toMatchObject({
      model: "gpt-5.5",
      cwd: "/tmp/operon-codex-test",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
    });
    expect(JSON.stringify(client.requests[1]?.params)).toContain("ORG-TASTE");
    expect(client.requests[2]?.params).toMatchObject({
      threadId: "thread-1",
      model: "gpt-5.5",
      effort: "high",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/tmp/operon-codex-test"],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      input: [{ type: "text", text: "do the thing", text_elements: [] }],
    });
    expect(result.session).toEqual({ runtime: "codex", id: "thread-1" });
    expect(result.usage).toMatchObject({ tokensIn: 12, tokensInUncached: 10, cacheReadTokens: 2, tokensOut: 8 });
  });

  it("declares a linked worktree's actual and common Git directories writable", async () => {
    const pair = makeBareWithClone();
    try {
      const worktree = join(pair.root, "ticket-worktree");
      pair.clone.git("worktree", "add", "-b", "op/codex-sandbox-roots", worktree, "main");
      const gitDir = pair.clone.git("-C", worktree, "rev-parse", "--absolute-git-dir");
      const objectsDir = pair.clone.git("-C", worktree, "rev-parse", "--git-path", "objects");
      const branchRef = pair.clone.git("-C", worktree, "symbolic-ref", "HEAD");
      const branchRefDir = dirname(
        pair.clone.git("-C", worktree, "rev-parse", "--git-path", branchRef),
      );
      const branchReflogDir = dirname(
        pair.clone.git("-C", worktree, "rev-parse", "--git-path", `logs/${branchRef}`),
      );
      const client = new FakeCodexClient({ result: makeResult("done") });

      await new CodexRuntime({ clientFactory: () => client }).runTurn(
        makeReq({ workdir: worktree }),
        { gate: defaultGate },
      );

      expect(client.requests[2]?.params).toMatchObject({
        sandboxPolicy: {
          writableRoots: [
            worktree,
            gitDir,
            objectsDir,
            branchRefDir,
            branchReflogDir,
          ],
        },
      });
    } finally {
      pair.cleanup();
    }
  });

  it("gives App Server and its sandbox a canonical non-interactive environment", async () => {
    const client = new FakeCodexClient({ result: makeResult("done") });
    let launch: CodexAppServerLaunchOptions | undefined;

    await new CodexRuntime({
      appServerEnv: {
        PATH: "/provider/bin",
        CI: "false",
        OPERON_CAMPAIGN_MARKER: "keep-me",
      },
      clientFactory: (options) => {
        launch = options;
        return client;
      },
    }).runTurn(makeReq(), { gate: defaultGate });

    expect(launch?.env).toMatchObject({
      PATH: "/provider/bin",
      OPERON_CAMPAIGN_MARKER: "keep-me",
      CI: "true",
      NPM_CONFIG_YES: "true",
      DEBIAN_FRONTEND: "noninteractive",
      GIT_TERMINAL_PROMPT: "0",
      OPERON_CODEX_GATE_SOCKET: expect.any(String),
    });
  });

  it("attaches the EpisodePlan schema to the App Server turn request", async () => {
    const client = new FakeCodexClient({ result: makeResult("done") });

    await new CodexRuntime({ clientFactory: () => client }).runTurn(
      makeReq({
        verdictSchema: EPISODE_PLAN_PROPOSAL_SCHEMA as unknown as Record<string, unknown>,
      }),
      { gate: defaultGate },
    );

    expect(client.requests[2]?.params).toMatchObject({
      outputSchema: toCodexStrictSchema(
        EPISODE_PLAN_PROPOSAL_SCHEMA as unknown as Record<string, unknown>,
      ),
    });
  });

  it("enables workspace-scoped network access only when the turn opts in", async () => {
    const client = new FakeCodexClient({ result: makeResult("done") });
    await new CodexRuntime({ clientFactory: () => client }).runTurn(
      makeReq({ networkAccess: true }),
      { gate: defaultGate },
    );

    expect(client.requests[2]?.params).toMatchObject({
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/tmp/operon-codex-test"],
        networkAccess: true,
      },
    });
  });

  it("resumes an existing Codex thread", async () => {
    const client = new FakeCodexClient({ result: makeResult("resumed") });

    await new CodexRuntime({ clientFactory: () => client }).runTurn(
      makeReq({ session: { runtime: "codex", id: "thread-existing" } }),
      { gate: defaultGate },
    );

    expect(client.requests.map((r) => r.method)).toEqual(["initialize", "thread/resume", "turn/start"]);
    expect(client.requests[1]?.params).toMatchObject({ threadId: "thread-existing" });
    expect(client.requests[2]?.params).toMatchObject({ threadId: "thread-existing" });
  });

  it("routes command approvals through the gate and declines denied actions", async () => {
    const action: ToolAction = { tool: "bash", input: { command: "npm publish --access public" } };
    const client = new FakeCodexClient({ toolActions: [{ action }], result: makeResult("attempted publish") });

    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(makeReq(), {
      gate: defaultGate,
    });

    expect(result.status).toBe("blocked_on_gate");
    expect(result.escalations[0]?.action).toEqual(action);
    expect(client.responses).toEqual([{ id: "approval-1", result: { decision: "decline" } }]);
  });

  it("declines MCP elicitation requests without failing the turn", async () => {
    const item = { type: "agentMessage", id: "agent-1", text: "done", phase: null, memoryCitation: null };
    const client = new ScriptedMessageClient([
      {
        method: "mcpServer/elicitation/request",
        id: "elicit-1",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          serverName: "browser",
          mode: "form",
          message: "Need input",
          requestedSchema: { type: "object", properties: {} },
          _meta: null,
        },
      },
      {
        method: "item/completed",
        params: { threadId: "thread-1", turnId: "turn-1", completedAtMs: 1, item },
      },
      {
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            items: [item],
            itemsView: "full",
            status: "completed",
            error: null,
            startedAt: 0,
            completedAt: 1,
            durationMs: 3,
          },
        },
      },
    ]);
    const events: string[] = [];

    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(makeReq(), {
      gate: defaultGate,
      onEvent: (event) => events.push(`${event.type}:${event.detail}`),
    });

    expect(result.status).toBe("completed");
    expect(result.summary).toBe("done");
    expect(client.responses).toEqual([
      { id: "elicit-1", result: { action: "decline", content: null, _meta: null } },
    ]);
    expect(events).toContain("text:codex mcp elicitation declined: browser form");
  });

  it("emits tool_use with outcomes from commandExecution and fileChange items (issue #27)", async () => {
    const item = { type: "agentMessage", id: "agent-1", text: "done", phase: null, memoryCitation: null };
    const completed = (payload: Record<string, unknown>) => ({
      method: "item/completed",
      params: { threadId: "thread-1", turnId: "turn-1", completedAtMs: 1, item: payload },
    });
    const client = new ScriptedMessageClient([
      completed({ type: "commandExecution", id: "cmd-1", command: "pnpm install", exitCode: 1, durationMs: 4200 }),
      completed({ type: "commandExecution", id: "cmd-2", command: "pnpm test", exitCode: 0 }),
      completed({
        type: "fileChange",
        id: "fc-1",
        changes: [
          { path: "src/a.ts", kind: "edit" },
          { path: "src/b.ts", kind: "add" },
        ],
      }),
      completed(item as unknown as Record<string, unknown>),
      {
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            items: [item],
            itemsView: "full",
            status: "completed",
            error: null,
            startedAt: 0,
            completedAt: 1,
            durationMs: 3,
          },
        },
      },
    ]);
    const events: TurnEvent[] = [];

    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(makeReq(), {
      gate: defaultGate,
      onEvent: (event) => events.push(event),
    });

    expect(result.status).toBe("completed");
    const toolUses = events.filter((event) => event.type === "tool_use");
    expect(toolUses).toEqual([
      expect.objectContaining({
        name: "bash",
        detail: "bash: pnpm install",
        success: false,
        durationMs: 4200,
        category: "environment_retry",
      }),
      expect.objectContaining({ name: "bash", detail: "bash: pnpm test", success: true }),
      expect.objectContaining({ name: "write", args: { path: "src/a.ts" } }),
      expect.objectContaining({ name: "write", args: { path: "src/b.ts" } }),
    ]);
  });

  it("gates EVERY file in a multi-file patch, not just the first (fail-closed)", async () => {
    // A patch that lists a benign file first and roles.yaml second must be
    // declined and escalated on the roles.yaml write. Before the fix only the
    // first entry was normalized/gated, so the protocol-self-edit slipped
    // through as an atomic "approved" patch.
    const patchMessage: CodexServerMessage = {
      method: "applyPatchApproval",
      id: "approval-multi",
      params: {
        conversationId: "thread-1",
        callId: "call-multi",
        fileChanges: {
          "src/util.ts": { type: "add", content: "export const ok = true;" },
          "roles.yaml": { type: "add", content: "builder: { runtime: pi }" },
        },
        reason: null,
        grantRoot: null,
      },
    };
    const client = new ScriptedMessageClient([
      patchMessage,
      {
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", items: [], status: "completed", durationMs: 1 },
        },
      },
    ]);

    const gateCalls: ToolAction[] = [];
    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(makeReq(), {
      gate: (a) => {
        gateCalls.push(a);
        return defaultGate(a);
      },
    });

    expect(gateCalls.map((a) => (a.input as { path: string }).path)).toEqual(["src/util.ts", "roles.yaml"]);
    expect(result.status).toBe("blocked_on_gate");
    expect(result.escalations).toHaveLength(1);
    expect((result.escalations[0]?.action.input as { path: string }).path).toBe("roles.yaml");
    expect(result.escalations[0]?.reason).toContain("protocol-self-edit");
    // The whole patch is declined atomically — no partial apply.
    expect(client.responses).toEqual([{ id: "approval-multi", result: { decision: "denied" } }]);
  });

  it("accumulates token usage across multiple notifications in a turn", async () => {
    // Two model round-trips each emit a tokenUsage notification whose `.last`
    // is that request's delta. Before the fix the adapter overwrote the usage
    // with only the last delta, undercounting the turn's real spend.
    const tokenMsg = (input: number, cached: number, output: number, reasoning: number): CodexServerMessage => ({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          last: { inputTokens: input, cachedInputTokens: cached, outputTokens: output, reasoningOutputTokens: reasoning },
        },
      },
    });
    const client = new ScriptedMessageClient([
      tokenMsg(10, 2, 7, 1),
      tokenMsg(30, 4, 12, 3),
      {
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", items: [], status: "completed", durationMs: 5 },
        },
      },
    ]);

    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(makeReq(), {
      gate: defaultGate,
    });

    // Sum of both requests: tokensIn = (10+2)+(30+4) = 46, tokensInUncached =
    // 10+30 = 40, cacheReadTokens = 2+4 = 6, tokensOut = (7+1)+(12+3) = 23.
    expect(result.usage).toMatchObject({
      tokensIn: 46,
      tokensInUncached: 40,
      cacheReadTokens: 6,
      tokensOut: 23,
    });
  });

  it("closes the App Server and returns checkpointed partial usage on cancellation", async () => {
    const controller = new AbortController();
    const progress: Array<{ usage?: { tokensIn: number; quality?: string } }> = [];
    const token: CodexServerMessage = {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          last: { inputTokens: 30, cachedInputTokens: 4, outputTokens: 12, reasoningOutputTokens: 3 },
        },
      },
    };
    const client = new ScriptedMessageClient([token]);
    const originalIterator = client[Symbol.asyncIterator].bind(client);
    client[Symbol.asyncIterator] = () => {
      const iterator = originalIterator();
      return {
        next: async () => {
          const next = await iterator.next();
          if (!next.done) {
            queueMicrotask(() => controller.abort("operator SIGTERM"));
          }
          return next;
        },
      };
    };

    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(
      makeReq({ signal: controller.signal }),
      { gate: defaultGate, onProgress: (event) => progress.push(event) },
    );

    expect(client.closed).toBe(true);
    expect(result).toMatchObject({
      status: "cancelled",
      summary: "operator SIGTERM",
      usage: { tokensIn: 34, tokensOut: 15, quality: "partial" },
    });
    expect(progress.some((event) => event.usage?.quality === "partial")).toBe(true);
  });

  it("classifies an auth-loss server error as error_auth with the unwrapped message", async () => {
    // The exact payload shape from benchmark round 2, tick 1: a nested
    // {error:{message}} notification for a dead ChatGPT refresh token.
    const client = new ScriptedMessageClient([
      {
        method: "error",
        params: {
          error: {
            message:
              "Your access token could not be refreshed because your refresh token was already used.",
          },
        },
      },
    ]);

    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(makeReq(), {
      gate: defaultGate,
    });

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("error_auth");
    expect(result.summary).toContain("refresh token was already used");
  });

  it("leaves a non-auth server error unclassified (renders as error_unknown downstream)", async () => {
    const client = new ScriptedMessageClient([
      { method: "error", params: { message: "model overloaded, try again later" } },
    ]);

    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(makeReq(), {
      gate: defaultGate,
    });

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBeUndefined();
  });

  it("classifies an unauthorized turn/completed failure as error_auth", async () => {
    const client = new ScriptedMessageClient([
      {
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", items: [], status: "failed", error: { message: "unauthorized" } },
        },
      },
    ]);

    const result = await new CodexRuntime({ clientFactory: () => client }).runTurn(makeReq(), {
      gate: defaultGate,
    });

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("error_auth");
  });

  it("normalizeCodexApprovalActions returns one action per file in the patch", () => {
    const actions = normalizeCodexApprovalActions(
      "legacyPatch",
      {
        fileChanges: {
          "src/util.ts": { type: "add", content: "..." },
          "scorecards/civic/builder.jsonl": { type: "add", content: "{}" },
        },
      },
      "/repo",
    );
    expect(actions).toEqual([
      { tool: "write", input: { path: "src/util.ts", content: "..." } },
      { tool: "write", input: { path: "scorecards/civic/builder.jsonl", content: "{}" } },
    ]);
  });

  it("normalizes legacy patch approvals with content when the protocol payload includes it", () => {
    expect(
      normalizeCodexApprovalAction(
        "legacyPatch",
        {
          fileChanges: { "roles.yaml": { type: "add", content: "..." } },
          reason: null,
          grantRoot: null,
        },
        "/repo",
      ),
    ).toEqual({ tool: "write", input: { path: "roles.yaml", content: "..." } });
  });
});

runConformanceSuite(
  "codex-mocked",
  (turns) => new CodexRuntime({ clientFactory: () => new FakeCodexClient(turns[0]) }),
  { role: CODEX_ROLE },
);

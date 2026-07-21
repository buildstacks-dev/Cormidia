// Tests the pi runtime adapter with the pi SDK mocked.
// Covers model resolution, thinking-level mapping, native context file writing,
// session options, gate-extension installation, delegation degradation notes,
// and the shared runtime conformance suite.
// Uses temp repos and in-memory pi doubles; no network, auth, real pi state, or
// live wall clock is required.

import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  type CreateAgentSessionOptions,
  type ExtensionFactory,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { runConformanceSuite } from "../conformance/harness.js";
import { makeWorkingRepo } from "../fixtures/gitRepo.js";
import type { ScriptedTurn } from "../../src/runtime/testing/fakeRuntime.js";
import { mapPiThinkingLevel, PiRuntime, resolvePiModel } from "../../src/runtime/adapters/pi.js";
import { buildTurnExecutionFacts } from "../../src/runtime/assignment.js";
import { defaultGate } from "../../src/runtime/gate.js";
import type { RoleConfig, ToolAction, TurnEvent, TurnResult } from "../../src/runtime/types.js";

const PI_MODEL = "amazon-bedrock/amazon.nova-lite-v1:0";
const PI_ROLE: RoleConfig = {
  name: "builder",
  runtime: "pi",
  model: PI_MODEL,
  effort: "high",
  delegation: { allow: [] },
  triggers: [],
  outputs: ["pr"],
  maxTurnBudgetUsd: 5,
};

function makeResult(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "pi", id: "pi-session.jsonl" },
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs: 0 },
    escalations: [],
  };
}

describe("PiRuntime (SDK mocked)", () => {
  it("resolves provider/model strings and maps thinking levels", () => {
    const registry = ModelRegistry.inMemory(AuthStorage.inMemory());

    expect(resolvePiModel(registry, PI_MODEL)).toMatchObject({
      provider: "amazon-bedrock",
      id: "amazon.nova-lite-v1:0",
    });
    expect(resolvePiModel(registry, "openai-codex/gpt-5.6-sol")).toMatchObject({
      provider: "openai-codex",
      id: "gpt-5.6-sol",
    });
    expect(() => mapPiThinkingLevel("max")).toThrow(/no effort alias is allowed/);
    expect(mapPiThinkingLevel("medium")).toBe("medium");
  });

  it("uses the explicit assignment in native context and session options", async () => {
    const repo = await makeWorkingRepo();
    const captures: Array<CreateAgentSessionOptions> = [];
    const runtime = makePiRuntime([{ result: makeResult("done") }], captures);
    const assignment = {
      harness: "pi" as const,
      model: "openai-codex/gpt-5.6-sol",
      effort: "xhigh" as const,
    };

    const result = await runtime.runTurn(
      {
        role: PI_ROLE,
        assignment,
        workdir: repo.root,
        task: "do the thing",
        context: {
          taste: ["ORG", "ROLE"],
          memoryExcerpts: ["MEMORY"],
          execution: buildTurnExecutionFacts(
            assignment,
            PI_ROLE,
            ["tool_gate", "session_resume"],
          ),
        },
      },
      { gate: defaultGate },
    );

    const nativeContext = readFileSync(join(repo.root, ".pi/APPEND_SYSTEM.md"), "utf8");
    expect(nativeContext).toContain("ORG");
    expect(nativeContext).toContain("Turn execution facts");
    expect(nativeContext).toContain("Exact model: openai-codex/gpt-5.6-sol");
    expect(readFileSync(join(repo.root, ".git/info/exclude"), "utf8")).toContain(".pi/APPEND_SYSTEM.md");
    expect(captures[0]?.cwd).toBe(repo.root);
    expect(captures[0]?.model).toMatchObject({ provider: "openai-codex", id: "gpt-5.6-sol" });
    expect(captures[0]?.thinkingLevel).toBe("xhigh");
    expect(captures[0]?.tools).toEqual(["read", "bash", "edit", "write"]);
    expect(result.session.runtime).toBe("pi");
    expect(result.summary).toBe("done");
  });

  it("gives pi bash commands the canonical non-interactive environment", async () => {
    const repo = await makeWorkingRepo();
    const captures: Array<CreateAgentSessionOptions> = [];
    const runtime = makePiRuntime([{ result: makeResult("done") }], captures);

    await runtime.runTurn(
      {
        role: PI_ROLE,
        workdir: repo.root,
        task: "do the thing",
        context: { taste: [], memoryExcerpts: [] },
      },
      { gate: defaultGate },
    );

    const bash = captures[0]?.customTools?.find((tool) => tool.name === "bash");
    expect(bash).toBeDefined();
    const result = await bash!.execute(
      "env-probe",
      { command: "/usr/bin/env" },
      undefined,
      undefined,
      {} as never,
    );
    const output = result.content
      .filter((item): item is Extract<(typeof result.content)[number], { type: "text" }> => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    expect(output).toContain("CI=true");
    expect(output).toContain("NPM_CONFIG_YES=true");
    expect(output).toContain("DEBIAN_FRONTEND=noninteractive");
    expect(output).toContain("GIT_TERMINAL_PROMPT=0");
  });

  it("rejects another harness and unsupported max effort before creating a session", async () => {
    const repo = await makeWorkingRepo();
    const captures: Array<CreateAgentSessionOptions> = [];
    const runtime = makePiRuntime([{ result: makeResult("done") }], captures);

    await expect(
      runtime.runTurn(
        {
          role: PI_ROLE,
          assignment: { harness: "codex", model: "gpt-exact", effort: "high" },
          workdir: repo.root,
          task: "wrong harness",
          context: { taste: [], memoryExcerpts: [] },
        },
        { gate: defaultGate },
      ),
    ).rejects.toThrow(/does not match "pi" adapter/);
    await expect(
      runtime.runTurn(
        {
          role: PI_ROLE,
          assignment: { harness: "pi", model: PI_MODEL, effort: "max" },
          workdir: repo.root,
          task: "unsupported effort",
          context: { taste: [], memoryExcerpts: [] },
        },
        { gate: defaultGate },
      ),
    ).rejects.toThrow(/max is unsupported by pi/);
    expect(captures).toHaveLength(0);
  });

  it("adds a degradation artifact when delegation is configured", async () => {
    const repo = await makeWorkingRepo();
    const runtime = makePiRuntime([{ result: makeResult("done") }]);

    const result = await runtime.runTurn(
      {
        role: { ...PI_ROLE, delegation: { allow: ["scout"] } },
        workdir: repo.root,
        task: "do the thing",
        context: { taste: [], memoryExcerpts: [] },
      },
      { gate: defaultGate },
    );

    expect(result.artifacts).toEqual([
      expect.objectContaining({
        kind: "note",
        ref: "pi-delegation/no-native-fanout",
        summary: expect.stringContaining("no native intra-turn subagent fan-out"),
      }),
    ]);
  });
});

const PI_CONFORMANCE_WORKDIR = mkdtempSync(join(tmpdir(), "operon-pi-conformance-"));
runConformanceSuite("pi-mocked", (turns) => makePiRuntime(turns), {
  role: PI_ROLE,
  workdir: PI_CONFORMANCE_WORKDIR,
});

function makePiRuntime(turns: ScriptedTurn[], captures: Array<CreateAgentSessionOptions> = []): PiRuntime {
  const authStorage = AuthStorage.inMemory();
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  let extensionFactories: ExtensionFactory[] = [];
  let index = 0;
  return new PiRuntime({
    agentDir: mkdtempSync(join(tmpdir(), "operon-pi-agent-")),
    authStorage,
    modelRegistry,
    sessionManagerFactory: (req) => SessionManager.inMemory(req.workdir),
    resourceLoaderFactory: (input) => {
      extensionFactories = input.extensionFactories;
      return fakeResourceLoader();
    },
    createAgentSessionFn: async (options) => {
      captures.push(options);
      const turn = turns[index++];
      if (turn === undefined) throw new Error("fake pi session over-called");
      return {
        session: fakeSession(turn, extensionFactories),
        extensionsResult: { extensions: [], errors: [], runtime: {} as never },
      };
    },
  });
}

function fakeResourceLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: {} as never }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

function fakeSession(turn: ScriptedTurn, extensionFactories: ExtensionFactory[]) {
  const listeners: Array<(event: { type: string; assistantMessageEvent: { type: string; delta: string } }) => void> = [];
  let lastText = "";
  return {
    sessionFile: "/tmp/pi-session.jsonl",
    sessionId: "pi-session",
    subscribe(listener: (event: { type: string; assistantMessageEvent: { type: string; delta: string } }) => void) {
      listeners.push(listener);
      return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    async prompt() {
      const handlers: Array<(event: Record<string, unknown>) => Promise<unknown> | unknown> = [];
      for (const factory of extensionFactories) {
        await factory({
          on: (name: string, handler: unknown) => {
            if (name === "tool_call") handlers.push(handler as (event: Record<string, unknown>) => Promise<unknown>);
          },
        } as never);
      }
      for (const scripted of turn.toolActions ?? []) {
        for (const handler of handlers) {
          await handler(toolEvent(scripted.action, scripted.fromSubagent === true));
        }
      }
      lastText = turn.result.summary;
      for (const listener of listeners) {
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: turn.result.summary },
        });
      }
    },
    dispose() {},
    getLastAssistantText: () => lastText,
    getSessionStats: () => ({
      sessionFile: "/tmp/pi-session.jsonl",
      sessionId: "pi-session",
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: turn.toolActions?.length ?? 0,
      toolResults: turn.toolActions?.length ?? 0,
      totalMessages: 2,
      tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 3, total: 20 },
      cost: 0.01,
    }),
  } as never;
}

function toolEvent(action: ToolAction, fromSubagent: boolean): Record<string, unknown> {
  const input = action.input as Record<string, unknown>;
  const event: Record<string, unknown> = { toolName: action.tool, input };
  if (fromSubagent) event.fromSubagent = true;
  return event;
}

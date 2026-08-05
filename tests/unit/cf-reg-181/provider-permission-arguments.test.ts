// #181 focused adapter construction. The detector checks BOTH the process/SDK
// option and the Codex App Server request; a seeded bypass/missing-mode array
// must trip it before this family counts as a guard.

import { describe, expect, it } from "vitest";
import {
  CodexRuntime,
  type CodexAppServerClient,
  type CodexAppServerLaunchOptions,
  type CodexServerMessage,
  type JsonRpcId,
} from "../../../src/runtime/adapters/codex.js";
import { claudeDouble, doubleTurnRequest } from "../../fixtures/adapters/claude-double.js";
import { script } from "../../fixtures/adapters/scenario.js";
import type { RoleConfig } from "../../../src/runtime/types.js";

function unsafeCodexArgs(args: readonly string[]): string[] {
  const modeIndex = args.indexOf("--ask-for-approval");
  const problems: string[] = [];
  if (modeIndex < 0 || args[modeIndex + 1] === undefined) problems.push("missing-mode");
  if (args.some((arg) => /dangerously-bypass-approvals-and-sandbox|dangerously-skip-permissions|bypassPermissions/.test(arg))) {
    problems.push("bypass-mode");
  }
  return problems;
}

class RecordingCodexClient implements CodexAppServerClient {
  readonly requests: Array<{ method: string; params: unknown }> = [];

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    return method === "thread/start" ? { thread: { id: "mode-thread" } } : {};
  }
  async notify(): Promise<void> {}
  async respond(_id: JsonRpcId, _result: unknown): Promise<void> {}
  async close(): Promise<void> {}
  async *[Symbol.asyncIterator](): AsyncIterator<CodexServerMessage> {
    yield {
      method: "turn/completed",
      params: { turn: { status: "completed", durationMs: 1 } },
    };
  }
}

function role(runtime: "codex" | "claude", codex: "untrusted" | "on-request" | "never", claude: "default" | "acceptEdits" | "plan" | "dontAsk" | "auto"): RoleConfig {
  return {
    name: "builder",
    runtime,
    model: runtime === "codex" ? "gpt-5.6-sol" : "scripted",
    effort: "medium",
    delegation: { allow: [] },
    triggers: [],
    outputs: ["pr"],
    maxTurnBudgetUsd: 5,
    permissionModes: { codex, claude },
  };
}

describe("CF-REG-181 — provider permission-mode construction", () => {
  it("Codex emits the configured safe mode in CLI args and both App Server requests", async () => {
    const client = new RecordingCodexClient();
    let launch: CodexAppServerLaunchOptions | undefined;
    const runtime = new CodexRuntime({
      clientFactory: (options) => {
        launch = options;
        return client;
      },
    });
    const result = await runtime.runTurn({
      role: role("codex", "never", "auto"),
      workdir: process.cwd(),
      task: "record mode",
      context: { taste: [], memoryExcerpts: [] },
    }, { gate: () => ({ allow: true }) });

    expect(result.status).toBe("completed");
    expect(launch?.args).toEqual(expect.arrayContaining(["--ask-for-approval", "never"]));
    expect(unsafeCodexArgs(launch?.args ?? [])).toEqual([]);
    expect(client.requests.find((entry) => entry.method === "thread/start")?.params).toMatchObject({
      approvalPolicy: "never",
      sandbox: "workspace-write",
      config: { bypass_hook_trust: true },
    });
    expect(client.requests.find((entry) => entry.method === "turn/start")?.params).toMatchObject({
      approvalPolicy: "never",
      sandboxPolicy: { type: "workspaceWrite" },
    });
  });

  it("Claude emits the configured safe SDK permissionMode and cannot be overwritten by base options", async () => {
    const dbl = claudeDouble([
      script.turn({
        sessionId: "claude-mode",
        outcome: script.success("done", { usage: { inputTokens: 10, outputTokens: 5 } }),
      }),
    ], { baseOptions: { permissionMode: "default" } });
    await dbl.runtime.runTurn(doubleTurnRequest({
      workdir: process.cwd(),
      role: role("claude", "on-request", "plan"),
    }), { gate: () => ({ allow: true }) });

    expect(dbl.recorder.turns[0]?.options.permissionMode).toBe("plan");
  });

  it("negative control: seeded bypass and missing mode are caught while real args stay clean", () => {
    expect(unsafeCodexArgs(["app-server"])).toEqual(["missing-mode"]);
    expect(unsafeCodexArgs([
      "--ask-for-approval",
      "on-request",
      "--dangerously-bypass-approvals-and-sandbox",
      "app-server",
    ])).toEqual(["bypass-mode"]);
  });
});

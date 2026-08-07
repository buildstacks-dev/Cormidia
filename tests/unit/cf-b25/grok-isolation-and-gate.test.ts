// CF-B25 unit cases: the per-turn provider isolation, the hook configuration
// the gate depends on, the tool-name normalization the gate classifies, and the
// terminal budget guard.
//
// These pin the pieces the live campaign cannot re-derive cheaply. The
// isolation cases are the machine-checkable half of the certification claim
// "operator configuration does not reach a Cormidia turn": grok merges hooks,
// permission rules and instruction files from ~/.grok, ~/.claude and ~/.cursor,
// and this operator's real config carries `permission_mode = "always-approve"`.

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGrokGateCore,
  startGrokGateBridge,
  type GrokGateBridge,
} from "../../../src/runtime/adapters/grok-gate-bridge.js";
import {
  createIsolatedGrokHome,
  grokAgentArgs,
  isBypassPermissionMode,
} from "../../../src/runtime/adapters/grok-isolation.js";
import { normalizeGrokHookActions } from "../../../src/runtime/adapters/grok-tool-actions.js";
import { grokUsage } from "../../../src/runtime/adapters/grok-turn.js";
import { runtimeCapabilityProfile } from "../../../src/runtime/capabilities.js";
import { grokDouble } from "../../fixtures/adapters/grok-double.js";
import { doubleRole, doubleTurnRequest } from "../../fixtures/adapters/claude-double.js";
import { script } from "../../fixtures/adapters/scenario.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import type { GateEscalation, TurnHooks } from "../../../src/runtime/types.js";

let repo: TempGitRepo | undefined;
let bridge: GrokGateBridge | undefined;
const scratch: string[] = [];
afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
  await repo?.cleanup();
  repo = undefined;
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fakeOperatorHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "grok-operator-"));
  scratch.push(dir);
  await writeFile(join(dir, "auth.json"), JSON.stringify({ "https://auth.x.ai::probe": { key: "sentinel-key" } }));
  // The exact hazards the isolation exists to neutralize.
  await writeFile(join(dir, "config.toml"), '[ui]\npermission_mode = "always-approve"\n');
  await mkdir(join(dir, "hooks"), { recursive: true });
  await writeFile(join(dir, "hooks", "operator.json"), JSON.stringify({ hooks: {} }));
  await writeFile(join(dir, "trusted_folders.toml"), "[folders]\n");
  return dir;
}

describe("CF-B25 isolation — a turn inherits the credential and nothing else", () => {
  it("copies only auth.json and writes a config that disables every vendor compat source", async () => {
    const operator = await fakeOperatorHome();
    const isolated = await createIsolatedGrokHome(operator);
    scratch.push(isolated.grokHome, isolated.isolatedHome);
    try {
      expect(isolated.credentialCopied).toBe(true);
      expect(await readFile(join(isolated.grokHome, "auth.json"), "utf8")).toContain("sentinel-key");
      // The operator's always-approve mode, hooks and folder trust stay out.
      const config = await readFile(join(isolated.grokHome, "config.toml"), "utf8");
      expect(config).not.toContain("permission_mode");
      expect(config).toContain("[compat.claude]");
      expect(config).toContain("hooks = false");
      await expect(readFile(join(isolated.grokHome, "hooks", "operator.json"), "utf8")).rejects.toThrow();
      await expect(readFile(join(isolated.grokHome, "trusted_folders.toml"), "utf8")).rejects.toThrow();
      // HOME is redirected too, so ~/.claude/settings.json cannot be found.
      expect(isolated.env["HOME"]).toBe(isolated.isolatedHome);
      expect(isolated.env["GROK_HOME"]).toBe(isolated.grokHome);
      expect(isolated.env["GROK_DISABLE_AUTOUPDATER"]).toBe("1");
      expect(isolated.env["GROK_CLAUDE_HOOKS_ENABLED"]).toBe("0");
      expect(isolated.env["GROK_CLAUDE_RULES_ENABLED"]).toBe("0");
    } finally {
      await isolated.close();
    }
  });

  it("reports an absent credential instead of pretending one was carried", async () => {
    const empty = await mkdtemp(join(tmpdir(), "grok-empty-"));
    scratch.push(empty);
    const isolated = await createIsolatedGrokHome(empty);
    try {
      expect(isolated.credentialCopied).toBe(false);
    } finally {
      await isolated.close();
    }
  });

  it("treats every bypass-shaped permission mode as an isolation failure", () => {
    for (const mode of ["bypassPermissions", "always-approve", "auto", "dontAsk", "ALWAYS-APPROVE"]) {
      expect(isBypassPermissionMode(mode)).toBe(true);
    }
    for (const mode of ["default", "plan", "acceptEdits", undefined]) {
      expect(isBypassPermissionMode(mode)).toBe(false);
    }
  });

  it("never passes an effort or max-turns flag grok agent would reject", () => {
    const args = grokAgentArgs("grok-4.5");
    expect(args).toEqual(["agent", "--model", "grok-4.5", "stdio"]);
    expect(args).not.toContain("--no-auto-update");
    expect(args).not.toContain("--max-turns");
    expect(args).not.toContain("--reasoning-effort");
    expect(args).not.toContain("--always-approve");
  });
});

describe("CF-B25 gate bridge — the hook configuration is what makes the gate real", () => {
  it("writes an always-trusted global hook covering SessionStart and every tool", async () => {
    repo = await makeTempGitRepo();
    const operator = await fakeOperatorHome();
    const escalations: GateEscalation[] = [];
    const hooks: TurnHooks = { gate: () => ({ allow: true }) };
    bridge = await startGrokGateBridge(repo.dir, hooks, escalations, { sourceGrokHome: operator });

    const config = JSON.parse(await readFile(join(bridge.grokHome, "hooks", "cormidia-gate.json"), "utf8")) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>>;
    };
    expect(Object.keys(config.hooks).sort()).toEqual(["PreToolUse", "SessionStart"]);
    // No matcher: an omitted matcher matches every tool, which is the whole
    // point — read-only tools never reach the ACP permission request.
    expect(config.hooks["PreToolUse"]![0]!.matcher).toBeUndefined();
    expect(config.hooks["PreToolUse"]![0]!.hooks[0]!.type).toBe("command");
    expect(bridge.env["CORMIDIA_GROK_GATE_SOCKET"]).toBe(bridge.socketPath);
    expect(bridge.env["GROK_HOME"]).toBe(bridge.grokHome);
    expect(await bridge.awaitHandshake(1)).toBe(false); // nothing has fired yet
  });

  it("classifies pre_tool_use through the gate and denies an unrecognized hook event", () => {
    const seen: string[] = [];
    const escalations: GateEscalation[] = [];
    const core = createGrokGateCore(
      "/workdir",
      {
        gate: (action) => {
          seen.push(action.tool);
          return { allow: true };
        },
      },
      escalations,
    );

    expect(core.handle({ hookEventName: "session_start", sessionId: "s1", permissionMode: "default" })).toEqual({
      passive: true,
    });
    expect(core.observedSessionId()).toBe("s1");
    expect(core.observedPermissionMode()).toBe("default");
    expect(
      core.handle({ hookEventName: "pre_tool_use", toolName: "run_terminal_command", toolInput: { command: "ls" } }),
    ).toEqual({ allow: true });
    expect(seen).toEqual(["bash"]);
    expect(core.gatedToolCount()).toBe(1);

    const unknown = core.handle({ hookEventName: "post_tool_use" }) as { allow: boolean; reason: string };
    expect(unknown.allow).toBe(false);
    expect(unknown.reason).toContain("unexpected hook event");
  });

  it("fails closed on an envelope it cannot classify", () => {
    const core = createGrokGateCore("/workdir", { gate: () => ({ allow: true }) }, []);
    const answer = core.handle({ hookEventName: "pre_tool_use", toolName: "spawn_subagent", toolInput: {} }) as {
      allow: boolean;
      reason: string;
    };
    expect(answer.allow).toBe(false);
    expect(answer.reason).toContain("failed closed");
  });
});

describe("CF-B25 tool normalization — grok names reach the gate as the gate's names", () => {
  it.each([
    ["run_terminal_command", { command: "git push" }, "bash", { command: "git push" }],
    ["read_file", { target_file: "src/a.ts" }, "read", { path: "src/a.ts" }],
    ["create_file", { file_path: "out.txt", contents: "x" }, "write", { path: "out.txt", content: "x" }],
  ])("maps %s onto %s", (grokName, input, expectedTool, expectedInput) => {
    const [action] = normalizeGrokHookActions({ toolName: grokName, toolInput: input }, "/workdir");
    expect(action!.tool).toBe(expectedTool);
    expect(action!.input).toMatchObject(expectedInput as Record<string, unknown>);
  });

  it("keeps an unknown grok tool visible rather than renaming it into something familiar", () => {
    const [action] = normalizeGrokHookActions({ toolName: "video_gen", toolInput: { prompt: "x" } }, "/workdir");
    expect(action!.tool).toBe("video_gen");
    expect(action!.input).toEqual({ prompt: "x" });
  });

  it("refuses to classify the fan-out route B-25 declares unsupported", () => {
    expect(() => normalizeGrokHookActions({ toolName: "spawn_subagent", toolInput: {} }, "/workdir")).toThrow(
      /intra_turn_fanout unsupported/,
    );
  });
});

describe("CF-B25 budget — the cap is enforced on grok's own reported cost", () => {
  it("a reported spend at or above the cap fails the turn with exactly one incident note", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([
      {
        ...script.turn({
          sessionId: "grok-budget",
          outcome: script.success("expensive", { usage: { inputTokens: 900_000, outputTokens: 40_000 }, costUsd: 0 }),
        }),
        // $5.40 in exact ticks.
        costUsdTicks: 54_000_000_000,
      },
    ]);
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({
        workdir: repo.dir,
        role: doubleRole({ runtime: "grok", model: "grok-4.5", effort: "medium", maxTurnBudgetUsd: 5 }),
      }),
      { gate: () => ({ allow: true }) },
    );

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("error_max_budget_usd");
    expect(result.usage.costUsd).toBeCloseTo(5.4, 6);
    expect(result.artifacts.filter((artifact) => artifact.ref.startsWith("budget-overrun/"))).toHaveLength(1);
    // The note states the honest limitation rather than implying a mid-run stop.
    expect(result.artifacts[0]!.summary).toContain("enforced terminally");
  });

  it("a spend under the cap completes untouched", async () => {
    repo = await makeTempGitRepo();
    const dbl = grokDouble([
      {
        ...script.turn({
          sessionId: "grok-budget-ok",
          outcome: script.success("cheap", { usage: { inputTokens: 100, outputTokens: 10 }, costUsd: 0 }),
        }),
        costUsdTicks: 1_000_000,
      },
    ]);
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({
        workdir: repo.dir,
        role: doubleRole({ runtime: "grok", model: "grok-4.5", effort: "medium", maxTurnBudgetUsd: 5 }),
      }),
      { gate: () => ({ allow: true }) },
    );

    expect(result.status).toBe("completed");
    expect(result.errorCode).toBeUndefined();
    expect(result.artifacts).toEqual([]);
  });

  it("an unknown cost never crosses the cap by accident", () => {
    const usage = grokUsage({ inputTokens: 10, outputTokens: 2, costIsPartial: true }, 5);
    expect(usage?.costUsd).toBe(0);
    expect(usage?.quality).toBe("partial");
  });
});

describe("CF-B25 capability profile — declared tiers match what the adapter proves", () => {
  it("declares grok/v1 with fan-out explicitly unsupported", () => {
    const profile = runtimeCapabilityProfile("grok");
    expect(profile.ref).toBe("grok/v1");
    expect(profile.capabilities.intra_turn_fanout).toBe("unsupported");
    expect(profile.capabilities.tool_gate).toBe("adapter");
    expect(profile.capabilities.session_resume).toBe("native");
    expect(profile.capabilities.structured_verdict).toBe("fallback");
    expect(profile.cache.fields).toContain("cacheReadTokens");
  });
});

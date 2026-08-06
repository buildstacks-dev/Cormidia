// #181/#154 — one app-scoped policy resolves provider permission modes,
// per-turn soft caps, episode hard ceilings, and the remaining static-route
// execution bounds before a provider can be constructed.
//
// Detector families and seeded negative controls:
// - permission-mode parser: bypassPermissions / dangerous Codex bypass text
//   must be rejected;
// - monotonic-limit parser: deep < standard and turn > episode must be rejected;
// - applied-policy evidence: a real route/envelope must contain the effective
//   app values, while a second app keeps shipped defaults.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { executePipeline } from "../../../src/loop/pipeline.js";
import { readRouteRecord } from "../../../src/loop/efficiency.js";
import {
  effectiveEpisodeHardCeiling,
  resolveAppRoles,
  shippedAppRuntimePolicy,
} from "../../../src/org/app-execution-policy.js";
import { appExecutionYaml, loadApps, runtimePolicyForApp } from "../../../src/org/apps.js";
import { readEnvelope } from "../../../src/runtime/runlog/envelope.js";
import type { RoleConfig, Runtime, TurnHooks, TurnRequest, TurnResult } from "../../../src/runtime/types.js";
import { makeTempGitRepo, makeTempWorktree, type TempGitRepo } from "../../fixtures/git-repo.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const BASE_ROLE: RoleConfig = {
  name: "builder",
  runtime: "codex",
  model: "scripted",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [],
  outputs: ["pr"],
  maxTurnBudgetUsd: 5,
};

class CompletedRuntime implements Runtime {
  readonly kind = "codex" as const;
  constructed = 0;

  async runTurn(req: TurnRequest, _hooks: TurnHooks): Promise<TurnResult> {
    this.constructed += 1;
    return {
      status: "completed",
      summary: "configured turn complete",
      artifacts: [],
      session: { runtime: "codex", id: "configured-session" },
      usage: {
        tokensIn: 10,
        tokensOut: 5,
        costUsd: Math.min(1, req.role.maxTurnBudgetUsd),
        subagentTurns: 0,
        wallClockMs: 10,
        quality: "complete",
      },
      escalations: [],
    };
  }
}

function assertAppliedPolicyEvidence(input: {
  routeToolCalls: number | null | undefined;
  turnToolCalls: number | null | undefined;
  permissionMode: string | undefined;
}): void {
  if (input.routeToolCalls !== 130 || input.turnToolCalls !== 7 || input.permissionMode !== "never") {
    throw new Error("effective app execution policy is not preserved in durable evidence");
  }
}

describe("CF-REG-181/154 — app execution policy resolution", () => {
  const roots: string[] = [];
  const states: TempStateHome[] = [];
  const repos: TempGitRepo[] = [];

  afterEach(async () => {
    await Promise.all(states.splice(0).map((state) => state.cleanup()));
    await Promise.all(repos.splice(0).map((repo) => repo.cleanup()));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function appsFile(apps: Record<string, unknown>) {
    const root = await mkdtemp(join(tmpdir(), "cormidia-app-policy-"));
    roots.push(root);
    const path = join(root, "apps.yaml");
    await writeFile(
      path,
      stringify({
        org: { name: "fixture", max_concurrent_turns: 2 },
        defaults: { budget_usd_month: 1000 },
        apps,
      }),
      "utf8",
    );
    return { path, loaded: await loadApps(path) };
  }

  it("resolves shipped defaults visibly for an existing app with no execution block", async () => {
    const { loaded } = await appsFile({
      existing: { repo: "owner/existing", status: "live", cadence: {} },
    });
    const policy = runtimePolicyForApp(loaded.apps[0]!);

    expect(policy).toEqual(shippedAppRuntimePolicy());
    expect(policy.permissionModes).toEqual({ codex: "on-request", claude: "auto" });
    expect(policy.limits.perTurn.equivalentCostUsd).toBeNull();
    expect(policy.limits.genericEpisode.maxProviderTurns).toBe(8);
    expect(policy.limits.ticketEpisode.maxProviderTurns).toBe(12);
    expect(policy.limits.routeExecution).toEqual({
      quick: { environmentRetries: 0, toolCalls: 40, claimAttempts: 2, repairAttempts: 1, reviewCycles: 1 },
      standard: { environmentRetries: 1, toolCalls: 100, claimAttempts: 3, repairAttempts: 2, reviewCycles: 2 },
      deep: { environmentRetries: 2, toolCalls: 200, claimAttempts: 3, repairAttempts: 3, reviewCycles: 3 },
    });
    expect(appExecutionYaml(undefined)).toMatchObject({
      permission_modes: { codex: "on-request", claude: "auto" },
      limits: { per_turn: { equivalent_cost_usd: null } },
    });
  });

  it("negative controls reject bypass modes and non-monotonic policy at config load", async () => {
    const bypass = appsFile({
      bad: {
        repo: "owner/bad",
        status: "live",
        cadence: {},
        execution: { permission_modes: { claude: "bypassPermissions" } },
      },
    });
    await expect(bypass).rejects.toThrow(/bypassPermissions is unsupported/);

    const codexBypass = appsFile({
      bad: {
        repo: "owner/bad",
        status: "live",
        cadence: {},
        execution: { permission_modes: { codex: "danger-full-access" } },
      },
    });
    await expect(codexBypass).rejects.toThrow(/bypass modes are unsupported/);

    const turnOverEpisode = appsFile({
      bad: {
        repo: "owner/bad",
        status: "live",
        cadence: {},
        execution: {
          limits: {
            per_turn: { equivalent_cost_usd: 6 },
            ticket_episode: { equivalent_cost_usd: 5 },
          },
        },
      },
    });
    await expect(turnOverEpisode).rejects.toThrow(/non-monotonic.*per_turn.*ticket_episode/s);

    const routeRegression = appsFile({
      bad: {
        repo: "owner/bad",
        status: "live",
        cadence: {},
        execution: {
          limits: {
            route_execution: {
              standard: { tool_calls: 150 },
              deep: { tool_calls: 149 },
            },
          },
        },
      },
    });
    await expect(routeRegression).rejects.toThrow(/deep\.tool_calls.*standard\.tool_calls/);
  });

  it("applies independent turn, episode, and execution bounds to one app and persists what ran", async () => {
    const { loaded } = await appsFile({
      bounded: {
        repo: "owner/bounded",
        status: "live",
        cadence: {},
        execution: {
          permission_modes: { codex: "never", claude: "plan" },
          limits: {
            per_turn: {
              equivalent_cost_usd: 3,
              active_time_ms: 600_000,
              tool_calls: 7,
              model_turns: 4,
            },
            generic_episode: { equivalent_cost_usd: 9, provider_turns: 6 },
            ticket_episode: { equivalent_cost_usd: 12, provider_turns: 10 },
            route_execution: {
              quick: { tool_calls: 50 },
              standard: { tool_calls: 130 },
              deep: { tool_calls: 230 },
            },
          },
        },
      },
      untouched: { repo: "owner/untouched", status: "live", cadence: {} },
      expanded: {
        repo: "owner/expanded",
        status: "live",
        cadence: {},
        execution: { limits: { ticket_episode: { provider_turns: 20 } } },
      },
    });
    const boundedPolicy = runtimePolicyForApp(loaded.apps[0]!);
    const untouchedPolicy = runtimePolicyForApp(loaded.apps[1]!);
    const boundedRole = resolveAppRoles([BASE_ROLE], boundedPolicy)[0]!;
    const untouchedRole = resolveAppRoles([BASE_ROLE], untouchedPolicy)[0]!;

    expect(boundedRole).toMatchObject({
      maxTurnBudgetUsd: 3,
      permissionModes: { codex: "never", claude: "plan" },
      turnExecutionLimits: { activeTimeMs: 600_000, toolCalls: 7, modelTurns: 4 },
    });
    expect(untouchedRole).toMatchObject({
      maxTurnBudgetUsd: 5,
      permissionModes: { codex: "on-request", claude: "auto" },
    });
    expect(
      effectiveEpisodeHardCeiling(boundedPolicy, "ticket", {
        maxProviderTurns: 12,
        maxEquivalentCostUsd: 20,
        maxActiveTimeMs: 10_000_000,
        maxHumanDecisions: 4,
      }),
    ).toMatchObject({
      maxProviderTurns: 10,
      maxEquivalentCostUsd: 12,
      maxActiveTimeMs: 7_200_000,
      maxHumanDecisions: 2,
    });
    expect(
      effectiveEpisodeHardCeiling(runtimePolicyForApp(loaded.apps[2]!), "ticket", {
        maxEquivalentCostUsd: 100,
      }).maxProviderTurns,
    ).toBe(20);

    const state = await makeTempStateHome({ name: "bounded" });
    states.push(state);
    const runtime = new CompletedRuntime();
    const run = await executePipeline({
      pipeline: {
        name: "configured-policy",
        mechanical: false,
        passes: [{ id: "implement", role: "builder", template: "" }],
      },
      selection: { tier: "standard" },
      roles: { builder: boundedRole },
      runtimeFor: () => runtime,
      briefFor: () => "exercise configured policy",
      promptsDir: state.stateHome,
      context: { taste: [], memoryExcerpts: [] },
      workdir: state.stateHome,
      hooks: { gate: () => ({ allow: true }) },
      runlog: { root: state.stateHome, app: "bounded", traceId: "configured" },
      episode: {
        id: "configured-policy-episode",
        route: "standard",
        budgetOverrides: {
          provider_turns: 6,
          equivalent_cost_usd: 9,
          active_time_ms: 3_600_000,
          human_decisions: 2,
        },
      },
      telemetry: { orgDir: state.stateHome },
    });

    expect(runtime.constructed).toBe(1);
    const route = await readRouteRecord(state.stateHome, "configured-policy-episode");
    expect(route.budget).toMatchObject({ provider_turns: 6, equivalent_cost_usd: 9 });
    expect(route.execution_bounds).toEqual({
      environmentRetries: 1,
      toolCalls: 130,
      claimAttempts: 3,
      repairAttempts: 2,
      reviewCycles: 2,
    });
    const envelope = await readEnvelope(state.stateHome, "bounded", run.passes[0]!.runId);
    expect(envelope.effective_bounds).toMatchObject({
      equivalent_cost_usd: 3,
      active_time_ms: 600_000,
      tool_calls: 7,
      model_turns: 4,
      permission_mode: "never",
      configuration_ref: "apps.yaml#apps.bounded.execution",
    });
    expect(() =>
      assertAppliedPolicyEvidence({
        routeToolCalls: 100,
        turnToolCalls: 7,
        permissionMode: "never",
      }),
    ).toThrow(/not preserved/);
    expect(() =>
      assertAppliedPolicyEvidence({
        routeToolCalls: route.execution_bounds?.toolCalls,
        turnToolCalls: envelope.effective_bounds?.tool_calls,
        permissionMode: envelope.effective_bounds?.permission_mode,
      }),
    ).not.toThrow();
  });

  it("bounded linked-worktree matrix edits, stages, and commits under both shipped auto modes", async () => {
    const repo = await makeTempGitRepo({ defaultBranch: "trunk" });
    repos.push(repo);
    const policy = shippedAppRuntimePolicy();

    for (const [runtime, expectedMode] of [
      ["codex", "on-request"],
      ["claude", "auto"],
    ] as const) {
      const worktree = await makeTempWorktree(repo, { branch: `mode-${runtime}` });
      try {
        const role = resolveAppRoles([{ ...BASE_ROLE, runtime }], policy)[0]!;
        expect(role.permissionModes?.[runtime]).toBe(expectedMode);
        const file = `mode-${runtime}.txt`;
        await mkdir(worktree.dir, { recursive: true });
        await writeFile(join(worktree.dir, file), `${runtime}:${expectedMode}\n`, "utf8");
        execFileSync("git", ["-C", worktree.dir, "add", "--", file]);
        execFileSync("git", ["-C", worktree.dir, "commit", "--no-gpg-sign", "-m", `test: ${runtime} auto mode`]);
        expect(execFileSync("git", ["-C", worktree.dir, "status", "--porcelain"], { encoding: "utf8" })).toBe("");
        expect(
          execFileSync("git", ["-C", worktree.dir, "show", "--format=", "--name-only", "HEAD"], { encoding: "utf8" }),
        ).toContain(file);
      } finally {
        await worktree.cleanup();
      }
    }
  });
});

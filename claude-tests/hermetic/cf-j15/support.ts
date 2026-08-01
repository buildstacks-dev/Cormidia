import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppsFile } from "../../../src/org/apps.js";
import type { ObserveGitHubSource } from "../../../src/observe/github-source.js";
import type { GitHubReadResult } from "../../../src/observe/github-source.js";
import { finalizeRun, startRun } from "../../../src/runtime/runlog/envelope.js";
import { recordTurn } from "../../../src/runtime/telemetry.js";
import type { TempStateHome } from "../../fixtures/state-home.js";

export const J15_APP = "evidence-app";
export const J15_NOW = new Date("2026-07-31T18:00:00.000Z");
export const J15_RUN = "20260731-120000-build-implement";

export const J15_APPS: AppsFile = {
  org: { name: "cf-j15-org", maxConcurrentTurns: 2 },
  defaults: { budgetUsdMonth: 100 },
  apps: [{
    name: J15_APP,
    repo: "operon-double/evidence-app",
    status: "live",
    budgetUsdMonth: 100,
    cadence: {},
  }],
};

export function githubResult(
  at: string,
  options: { unavailable?: boolean; issue?: boolean } = {},
): GitHubReadResult {
  const unavailable = options.unavailable === true;
  return {
    apps: [{
      app: J15_APP,
      repo: J15_APPS.apps[0]!.repo,
      issues: options.issue === false || unavailable ? [] : [{
        number: 15,
        title: "Observe evidence truth",
        body: "No dependencies.",
        labels: ["op:ready"],
        state: "OPEN",
      }],
      pull_requests: [],
      observed_at: at,
      ...(unavailable ? { error: "seeded GitHub outage" } : {}),
    }],
    health: {
      id: "github",
      status: unavailable ? "unavailable" : "healthy",
      observed_at: at,
      last_success_at: unavailable ? null : at,
      detail: unavailable ? "seeded GitHub outage" : "fixture GitHub read complete",
    },
  };
}

export function scriptedGithubSource(results: GitHubReadResult[]): ObserveGitHubSource {
  let index = 0;
  return {
    async read() {
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      if (result === undefined) throw new Error("cf-j15 source has no scripted result");
      return structuredClone(result);
    },
  };
}

export async function seedJ15Run(state: TempStateHome): Promise<void> {
  await startRun(state.stateHome, {
    runId: J15_RUN,
    traceId: "trace-cf-j15",
    ticket: "#15",
    app: J15_APP,
    pipeline: "build",
    pass: "implement",
    role: "builder",
    runtime: "claude",
    model: "claude-scripted-model",
    tracePlan: { required_passes: ["implement"], skipped_passes: [] },
  }, new Date("2026-07-31T12:00:00.000Z"));
  await finalizeRun(
    state.stateHome,
    J15_APP,
    J15_RUN,
    { status: "completed", verdictSummary: "fixture complete" },
    new Date("2026-07-31T12:05:00.000Z"),
  );
  await recordTurn(state.stateHome, {
    at: "2026-07-31T12:05:00.000Z",
    role: "builder",
    runtime: "claude",
    model: "claude-scripted-model",
    status: "completed",
    tokensIn: 1200,
    tokensOut: 300,
    costUsd: 1.25,
    usageQuality: "complete",
    subagentTurns: 0,
    wallClockMs: 300_000,
    escalations: 0,
    app: J15_APP,
    runId: J15_RUN,
    providerTurnId: "ptid-cf-j15",
    traceId: "trace-cf-j15",
    pipeline: "build",
    pass: "implement",
  });
  await mkdir(join(state.stateHome, "approvals", "decided"), { recursive: true });
  await writeFile(join(state.stateHome, "approvals", "decided", "appr-j15.json"), `${JSON.stringify({
    id: "appr-j15",
    app: J15_APP,
    role: "sre",
    rule: "publish",
    action: { tool: "Bash", input: { command: "publish" }, description: "publish" },
    raisedAt: "2026-07-31T11:50:00.000Z",
    status: "approved",
    decidedAt: "2026-07-31T11:55:00.000Z",
    reason: "approved only; no execution evidence",
  })}\n`, "utf8");
}

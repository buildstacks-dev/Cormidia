import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runLoopOnce } from "../src/loop/driver.js";
import {
  claimTicket,
  runBuilderPipeline,
  runReviewPipeline,
  type LoopItem,
} from "../src/loop/loop.js";
import { loadPipelines, type PipelinesFile } from "../src/loop/pipelines.js";
import type { Policy } from "../src/loop/policy.js";
import type { GateRunResult } from "../src/loop/qgates.js";
import { FakeRuntime, type ScriptedTurn } from "../src/runtime/testing/fakeRuntime.js";
import type { RoleConfig, Runtime, TurnHooks, TurnRequest, TurnResult } from "../src/runtime/types.js";
import { makeBareWithClone, type BareCloneFixture } from "./fixtures/gitRepo.js";
import { makeOrgHome } from "./fixtures/orgHome.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROMPTS_DIR = join(ROOT, "prompts");

const ISSUE_BODY = [
  "## Goal",
  "Ship a small fixture change.",
  "",
  "## Acceptance criteria",
  "- [x] fixture behavior is covered",
  "",
  "## Scope",
  "- auth/change.ts",
  "",
].join("\n");

const CONTRACT = [
  "## Implementation contract",
  "",
  "**Files:**",
  "- auth/change.ts",
  "",
  "**Approach:**",
  "Add the requested fixture change.",
  "",
  "**Tests:**",
  "AC1 -> loop-driver",
  "",
  "**Risks:**",
  "None.",
  "",
  "**Complexity:**",
  "low",
  "",
].join("\n");

const APPROVE = "Verdict: approve";
const FINDING = "- testing/major test/change.test.ts:1 -- missing coverage -> add the regression\nVerdict: findings";
const DONE = "Verdict: done";

const ROLES: Record<string, RoleConfig> = {
  planner: role("planner"),
  builder: role("builder"),
  reviewer: role("reviewer", { effort: "xhigh" }),
  sre: role("sre"),
  support: role("support"),
  marketing: role("marketing"),
};

function role(name: string, overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    name,
    runtime: "claude",
    model: `${name}-model`,
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: [],
    maxTurnBudgetUsd: 5,
    ...overrides,
  };
}

async function rootPipelines(): Promise<PipelinesFile> {
  return loadPipelines(join(ROOT, "pipelines.yaml"), {
    roleNames: Object.keys(ROLES),
    promptsDir: PROMPTS_DIR,
  });
}

describe("M6 loop engine integration", () => {
  it("building invokes contract then implement with the ticket brief and comments the contract", async () => {
    const h = await claimedHarness("Build Integration", ["op:ready"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(CONTRACT), scripted(DONE)]);
    try {
      const next = await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });

      expect(next.phase).toBe("gates");
      expect(fake.calls.length).toBe(2);
      expect(fake.calls[0]?.req.task).toContain("[ticket]\n#1 Build Integration");
      expect(fake.calls[0]?.req.task).toContain("# Pass: contract");
      expect(fake.calls[0]?.req.verdictSchema?.["title"]).toBe("ContractVerdict");
      expect(fake.calls[1]?.req.task).toContain("[contract]\n## Implementation contract");
      expect(fake.calls[1]?.req.task).toContain("# Pass: implement");
      expect(h.gh.issueComments.get(1)?.[0]).toContain("## Implementation contract");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("tier:quick skips contract and goes straight to implement", async () => {
    const h = await claimedHarness("Quick Build", ["op:ready", "op:tier-quick"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(DONE)]);
    try {
      await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });

      expect(fake.calls.length).toBe(1);
      expect(fake.calls[0]?.req.task).toContain("# Pass: implement");
      expect(fake.calls[0]?.req.task).not.toContain("# Pass: contract");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("fix pass brief carries verbatim gate output", async () => {
    const h = await claimedHarness("Fix Gates", ["op:ready"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(DONE)]);
    try {
      await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
        pipelineName: "fix",
        gateResult: failedGate("EXPECTED_OUTPUT_FROM_GATE"),
      });

      expect(fake.calls[0]?.req.task).toContain("# Pass: fix");
      expect(fake.calls[0]?.req.task).toContain("Gate output (verbatim):");
      expect(fake.calls[0]?.req.task).toContain("EXPECTED_OUTPUT_FROM_GATE");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("review posts a GitHub review and a structured findings comment", async () => {
    const h = await reviewingHarness("Review Finding", { "src/plain.ts": "export const x = 1;\n" });
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(FINDING)]);
    try {
      const next = await runReviewPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });

      expect(next.phase).toBe("building");
      expect(next.findings[0]).toMatchObject({ category: "testing", severity: "major" });
      expect(h.gh.calls.map((call) => call.op)).toContain("createReview");
      expect(h.gh.issueComments.get(1)?.join("\n")).toContain("## Structured review verdict");
      expect((await h.gh.listReviews(h.item.prNumber as number))[0]?.state).toBe("CHANGES_REQUESTED");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("review dimensions select security-deep for auth diffs but not plain diffs", async () => {
    const pipelines = await rootPipelines();
    const plain = await reviewingHarness("Plain Review", { "src/plain.ts": "export const x = 1;\n" });
    const auth = await reviewingHarness("Auth Review", { "auth/login.ts": "export const x = 1;\n" });
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const plainFake = new FakeRuntime([scripted(APPROVE)]);
    const authFake = new FakeRuntime([scripted(APPROVE), scripted(APPROVE)]);
    try {
      await runReviewPipeline(plain.item, {
        ...engineOptions(plain, home.root, plainFake),
        pipelines,
      });
      await runReviewPipeline(auth.item, {
        ...engineOptions(auth, home.root, authFake),
        pipelines,
      });

      expect(plainFake.calls.map((call) => call.req.task)).toHaveLength(1);
      expect(plainFake.calls[0]?.req.task).toContain("# Pass: verify");
      expect(authFake.calls.map((call) => call.req.task)).toHaveLength(2);
      expect(authFake.calls[1]?.req.task).toContain("# Pass: security-deep");
    } finally {
      home.cleanup();
      plain.cleanup();
      auth.cleanup();
    }
  });

  it("high-risk ship-check runs before squash merge", async () => {
    const pair = makeBareWithClone();
    const gh = new FakeGhOps({
      cloneRoot: pair.clone.root,
      issues: [{ number: 1, title: "Loop High Risk", body: ISSUE_BODY, labels: ["op:ready"] }],
    });
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([
      scripted(CONTRACT),
      scripted(DONE),
      scripted(APPROVE),
      scripted(APPROVE),
      scripted(APPROVE),
    ]);
    const runtime = committingRuntime(fake, {
      "# Pass: implement": { "auth/change.ts": "export const changed = true;\n" },
    });
    try {
      const result = await runLoopOnce({
        app: "fixture",
        repo: "fixture/repo",
        gh,
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
        policy: policy(),
        commands: { testCommand: "true", lintCommand: "true" },
        engine: {
          pipelines: await rootPipelines(),
          roles: ROLES,
          runtimeFor: () => runtime,
          promptsDir: PROMPTS_DIR,
          runlogRoot: home.root,
          hooks: allowAllHooks(),
        },
      });

      expect(result.items[0]?.phase).toBe("merged");
      expect(fake.calls.some((call) => call.req.task.includes("# Pass: ship-check"))).toBe(true);
      const ops = gh.calls.map((call) => call.op);
      expect(ops.lastIndexOf("createReview")).toBeLessThan(ops.indexOf("squashMerge"));
    } finally {
      home.cleanup();
      pair.cleanup();
    }
  });
});

async function claimedHarness(
  title: string,
  labels: string[],
): Promise<{ pair: BareCloneFixture; gh: FakeGhOps; item: LoopItem; cleanup(): void }> {
  const pair = makeBareWithClone();
  const gh = new FakeGhOps({
    cloneRoot: pair.clone.root,
    issues: [{ number: 1, title, body: ISSUE_BODY, labels }],
  });
  const item = await claimTicket(await gh.readIssue(1), {
    gh,
    targetRepo: "fixture/repo",
    localRepo: pair.clone.root,
    worktreeRoot: join(pair.root, "worktrees"),
  });
  return { pair, gh, item, cleanup: () => pair.cleanup() };
}

async function reviewingHarness(
  title: string,
  files: Record<string, string>,
): Promise<{ pair: BareCloneFixture; gh: FakeGhOps; item: LoopItem; cleanup(): void }> {
  const h = await claimedHarness(title, ["op:ready"]);
  commit(h.item.worktree as string, "feat: review fixture", files);
  git(h.item.worktree as string, "push", "-u", "origin", h.item.branch as string);
  const pr = await h.gh.createPR({
    head: h.item.branch as string,
    base: "main",
    title,
    body: "Closes #1",
  });
  await h.gh.swapLabel(1, "op:building", "op:in-review");
  return {
    ...h,
    item: { ...h.item, phase: "reviewing", prNumber: pr.number, labels: ["op:in-review"] },
  };
}

function engineOptions(
  h: { gh: FakeGhOps },
  runlogRoot: string,
  runtime: Runtime,
): Omit<Parameters<typeof runBuilderPipeline>[1], "pipelines"> {
  return {
    gh: h.gh,
    roles: ROLES,
    runtimeFor: () => runtime,
    promptsDir: PROMPTS_DIR,
    runlogRoot,
    app: "fixture",
    policy: policy(),
    commands: { testCommand: "true", lintCommand: "true" },
    hooks: allowAllHooks(),
  };
}

function committingRuntime(fake: FakeRuntime, commits: Record<string, Record<string, string>>): Runtime {
  return {
    kind: fake.kind,
    async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
      for (const [needle, files] of Object.entries(commits)) {
        if (req.task.includes(needle)) commit(req.workdir, "feat: runtime fixture", files);
      }
      return fake.runTurn(req, hooks);
    },
  };
}

function policy(): Policy {
  return {
    riskTiers: {
      high: ["auth/**"],
      medium: ["src/**"],
      low: ["*.md"],
    },
    gates: {
      high: ["tests", "lint", "security", "completeness"],
      medium: ["tests", "lint", "completeness"],
      low: ["tests", "completeness"],
    },
    dimensionGlobs: {
      security: ["auth/**"],
      perf: ["perf/**"],
    },
    remediation: { maxAttempts: 3 },
  };
}

function failedGate(output: string): GateRunResult {
  return {
    tier: "medium",
    status: "fail",
    results: [
      {
        gate: "tests",
        status: "fail",
        detail: "tests failed",
        outputTail: output,
        durationMs: 1,
      },
    ],
    remediation: {
      currentAttempt: 0,
      maxAttempts: 3,
      attemptsRemaining: 3,
      canRetry: true,
      exhausted: false,
    },
  };
}

function scripted(summary: string): ScriptedTurn {
  return {
    result: {
      status: "completed",
      summary,
      artifacts: [],
      session: { runtime: "claude", id: `session-${summary.slice(0, 10)}` },
      usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 100 },
      escalations: [],
    },
  };
}

function allowAllHooks(): TurnHooks {
  return { gate: () => ({ allow: true }) };
}

function commit(worktree: string, message: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(worktree, rel);
    execFileSync("mkdir", ["-p", join(path, "..")]);
    writeFileSync(path, content);
  }
  git(worktree, "add", "-A");
  git(worktree, "commit", "-m", message);
  return git(worktree, "rev-parse", "HEAD");
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Operon Test",
      GIT_AUTHOR_EMAIL: "test@operon.invalid",
      GIT_COMMITTER_NAME: "Operon Test",
      GIT_COMMITTER_EMAIL: "test@operon.invalid",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

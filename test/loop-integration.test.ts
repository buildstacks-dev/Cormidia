import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runLoopOnce } from "../src/loop/driver.js";
import {
  claimTicket,
  runBuilderPipeline,
  runReviewPipeline,
  runShipCheckPipeline,
  type LoopItem,
} from "../src/loop/loop.js";
import { loadPipelines, type PipelinesFile } from "../src/loop/pipelines.js";
import type { Policy } from "../src/loop/policy.js";
import type { GateRunResult } from "../src/loop/qgates.js";
import { VerdictParseError } from "../src/loop/verdicts.js";
import { readEnvelope } from "../src/runtime/runlog/envelope.js";
import { readEvents } from "../src/runtime/runlog/events.js";
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
  it("ship-check findings are bounded and route to op:returned at the cycle cap", async () => {
    const pipelines = await rootPipelines();
    // Under the cap: a ship-check bounce goes back to building and counts the cycle.
    const under = await reviewingHarness("Ship Bounce Under", { "auth/change.ts": "export const x = 1;\n" });
    const homeA = makeOrgHome({ runs: { apps: ["fixture"] } });
    // At the cap: the same bounce must terminate in op:returned with findings,
    // not building->shipping forever until the driver phase guard throws and
    // orphans the ticket in op:building.
    const atCap = await reviewingHarness("Ship Bounce Cap", { "auth/change.ts": "export const y = 1;\n" });
    const homeB = makeOrgHome({ runs: { apps: ["fixture"] } });
    try {
      const bounced = await runShipCheckPipeline(
        { ...under.item, phase: "shipping", cycles: 0 },
        { ...engineOptions(under, homeA.root, new FakeRuntime([scripted(FINDING)])), pipelines },
      );
      expect(bounced.phase).toBe("building");
      expect(bounced.cycles).toBe(1);
      expect(bounced.labels).toContain("op:building");

      const returned = await runShipCheckPipeline(
        { ...atCap.item, phase: "shipping", cycles: 3 },
        { ...engineOptions(atCap, homeB.root, new FakeRuntime([scripted(FINDING)])), pipelines },
      );
      expect(returned.phase).toBe("returned");
      expect(returned.labels).toContain("op:returned");
      expect(returned.findings.length).toBeGreaterThan(0);
    } finally {
      homeA.cleanup();
      homeB.cleanup();
      under.cleanup();
      atCap.cleanup();
    }
  });
});

describe("GAP D — verdict reformat retry (docs/loop.md §6, §13 row 11)", () => {
  const MALFORMED = "I'll touch a couple files and add a test or two — looks good.";

  it("a malformed-then-valid verdict recovers via one session-resuming reformat turn", async () => {
    const h = await claimedHarness("Verdict Retry", ["op:ready"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(MALFORMED), scripted(CONTRACT), scripted(DONE)]);
    try {
      const next = await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });

      expect(next.phase).toBe("gates");
      // contract(bad) + reformat(good) + implement = 3 turns.
      expect(fake.calls.length).toBe(3);
      // The reformat turn RESUMED the just-finished contract session.
      expect(fake.calls[1]?.req.session?.id).toBe(`session-${MALFORMED.slice(0, 10)}`);
      expect(fake.calls[1]?.req.task).toContain("could not be parsed");
      expect(h.gh.issueComments.get(1)?.[0]).toContain("## Implementation contract");

      const contractRun = runIdContaining(home.root, "-build-contract");
      const events = await readEvents(home.root, "fixture", contractRun);
      expect(events.some((e) => e.event === "verdict.recorded")).toBe(true);
      // The reformat retry's spend is folded into the pass usage (loop.ts:766):
      // contract turn (10 in / $0.01) + reformat turn (10 in / $0.01) = 20 / $0.02,
      // not the base turn alone.
      const envelope = await readEnvelope(home.root, "fixture", contractRun);
      expect(envelope?.usage?.tokens_in).toBe(20);
      expect(envelope?.usage?.cost_usd).toBeCloseTo(0.02, 5);
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("a malformed-malformed verdict fails loudly with a distinct infra error_code", async () => {
    const h = await claimedHarness("Verdict Fail", ["op:ready"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(MALFORMED), scripted("still not a contract at all")]);
    try {
      await expect(
        runBuilderPipeline(h.item, {
          ...engineOptions(h, home.root, fake),
          pipelines: await rootPipelines(),
        }),
      ).rejects.toThrow(VerdictParseError);

      // Exactly one retry: contract(bad) + reformat(bad); implement never ran.
      expect(fake.calls.length).toBe(2);

      const contractRun = runIdContaining(home.root, "-build-contract");
      const envelope = await readEnvelope(home.root, "fixture", contractRun);
      expect(envelope.status).toBe("failed");
      expect(envelope.error_code).toBe("error_verdict_unparseable");
      const events = await readEvents(home.root, "fixture", contractRun);
      expect(
        events.some((e) => e.event === "pass.failed" && e.error_code === "error_verdict_unparseable"),
      ).toBe(true);
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });
});

describe("GAP F — brief [spec] and [history] population (docs/loop.md §3)", () => {
  it("a Context link to a repo file yields a [spec] section with the file's excerpts", async () => {
    const body = [
      "## Goal",
      "Add the widget.",
      "",
      "## Context",
      "Background lives in [the spec](docs/specs/widget.md).",
      "",
      "## Acceptance criteria",
      "- [x] widget behaves",
      "",
    ].join("\n");
    const h = await claimWithBody("Spec Ticket", body, ["op:ready", "op:tier-quick"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(DONE)]);
    try {
      mkdirSync(join(h.item.worktree as string, "docs/specs"), { recursive: true });
      writeFileSync(
        join(h.item.worktree as string, "docs/specs/widget.md"),
        "# Widget spec\n\nThe widget must foo the bar reliably.\n",
      );

      await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });

      const task = fake.calls[0]?.req.task ?? "";
      expect(task).toContain("[spec]");
      expect(task).toContain("docs/specs/widget.md");
      expect(task).toContain("The widget must foo the bar reliably");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("a second attempt carries a [history] section with the attempt count", async () => {
    const h = await claimedHarness("History Ticket", ["op:ready", "op:tier-quick"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(DONE)]);
    try {
      const retried: LoopItem = { ...h.item, remediationAttempts: 2 };
      await runBuilderPipeline(retried, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
        pipelineName: "fix",
      });

      const task = fake.calls[0]?.req.task ?? "";
      expect(task).toContain("[history]");
      expect(task).toContain("attempt 1 of 3");
      expect(task).toContain("attempt 2 of 3");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });

  it("a missing Context spec file degrades to a note, never throws", async () => {
    const body = [
      "## Goal",
      "Add the gizmo.",
      "",
      "## Context",
      "See [the missing spec](docs/specs/missing.md).",
      "",
      "## Acceptance criteria",
      "- [x] gizmo behaves",
      "",
    ].join("\n");
    const h = await claimWithBody("Missing Spec Ticket", body, ["op:ready", "op:tier-quick"]);
    const home = makeOrgHome({ runs: { apps: ["fixture"] } });
    const fake = new FakeRuntime([scripted(DONE)]);
    try {
      const next = await runBuilderPipeline(h.item, {
        ...engineOptions(h, home.root, fake),
        pipelines: await rootPipelines(),
      });
      expect(next.phase).toBe("gates"); // no throw
      const task = fake.calls[0]?.req.task ?? "";
      expect(task).toContain("[spec]");
      expect(task).toContain("was not found in the worktree");
    } finally {
      home.cleanup();
      h.cleanup();
    }
  });
});

function runIdContaining(runlogRoot: string, needle: string): string {
  const runId = readdirSync(join(runlogRoot, "runs", "fixture")).find((id) => id.includes(needle));
  if (runId === undefined) throw new Error(`no run record matching ${needle}`);
  return runId;
}

async function claimWithBody(
  title: string,
  body: string,
  labels: string[],
): Promise<{ pair: BareCloneFixture; gh: FakeGhOps; item: LoopItem; cleanup(): void }> {
  const pair = makeBareWithClone();
  const gh = new FakeGhOps({
    cloneRoot: pair.clone.root,
    issues: [{ number: 1, title, body, labels }],
  });
  const item = await claimTicket(await gh.readIssue(1), {
    gh,
    targetRepo: "fixture/repo",
    localRepo: pair.clone.root,
    worktreeRoot: join(pair.root, "worktrees"),
  });
  return { pair, gh, item, cleanup: () => pair.cleanup() };
}

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

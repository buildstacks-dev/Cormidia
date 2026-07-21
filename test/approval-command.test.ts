// ISSUE-020: an approved critical op must actually execute.
//
// Run 3 recorded four approvals whose grants no one could spend. The exact
// captured records are seeded verbatim from test/fixtures/approvals/run3/ (a
// copy of ~/.operon/Buildstacks/approvals, which stays read-only evidence), so
// these tests reproduce the real durable shape rather than an idealized one.
//
// Everything here is a local file/state-machine exercise with an injected
// command runner: no provider, no network, no GitHub client, and never a real
// child process.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  executeApprovedCommands,
  ORCHESTRATOR_COMMAND_ACTOR,
  type ApprovedCommandResult,
} from "../src/org/approval-command.js";
import {
  actionHash,
  ApprovalStore,
  type ApprovalItem,
  type ApprovalLogEvent,
} from "../src/org/approvals.js";
import type { AppsFile } from "../src/org/apps.js";
import { composeGate } from "../src/org/gate-compose.js";
import { defaultGate } from "../src/runtime/gate.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const RUN3_DECIDED = JSON.parse(readFileSync(
  new URL("./fixtures/approvals/run3/decided.json", import.meta.url),
  "utf8",
)) as Record<string, ApprovalItem>;
const RUN3_GRANTS = JSON.parse(readFileSync(
  new URL("./fixtures/approvals/run3/grants.json", import.meta.url),
  "utf8",
)) as Record<string, Record<string, unknown>>;
const RUN3_LOG = JSON.parse(readFileSync(
  new URL("./fixtures/approvals/run3/log.json", import.meta.url),
  "utf8",
)) as unknown[];

/** The representative record from the finding: `gh pr create … --fill`, nested
 *  one level inside a quoted `/bin/zsh -lc` argument. */
const PR_CREATE_ID = "20260721T100740Z-95ev";
/** Earliest `decidedAt`, so the first record the executor reaches. */
const FIRST_DECIDED_ID = "20260721T091511Z--ci4";
const APP = "sonnet4-buildstack-dev";
const NOW = new Date("2026-07-21T11:00:00.000Z");

const APPS: AppsFile = {
  org: { name: "Buildstacks", maxConcurrentTurns: 2 },
  defaults: { budgetUsdMonth: 100 },
  apps: [{
    name: APP,
    repo: "buildstacks-dev/buildstacks.dev",
    status: "onboarding",
    budgetUsdMonth: 100,
    cadence: {},
  }],
};

interface Recorder {
  calls: { command: string; cwd: string }[];
  runner: (input: { command: string; cwd: string; env: NodeJS.ProcessEnv }) => Promise<ApprovedCommandResult>;
}

function recorder(result: Partial<ApprovedCommandResult> = {}): Recorder {
  const calls: { command: string; cwd: string }[] = [];
  return {
    calls,
    runner: async ({ command, cwd }) => {
      calls.push({ command, cwd });
      return { exitCode: 0, stdout: "", stderr: "", ...result };
    },
  };
}

/** A checkout the executor will accept as an execution context. */
function makeCheckout(root: string, ...segments: string[]): string {
  const path = join(root, ...segments);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, ".git"), "gitdir: /fixture\n", "utf8");
  return path;
}

/** Seed the captured run-3 approvals verbatim, optionally stamping the sandbox
 *  cwd the fix now records at raise time. */
function seedRun3(options: { workdir?: string } = {}): OrgHomeFixture {
  const decided = Object.fromEntries(
    Object.entries(RUN3_DECIDED).map(([id, item]) => [
      id,
      options.workdir === undefined ? item : { ...item, workdir: options.workdir },
    ]),
  );
  return makeOrgHome({ approvals: { decided, grants: RUN3_GRANTS, log: RUN3_LOG } });
}

function readItem(home: OrgHomeFixture, id: string): ApprovalItem {
  return JSON.parse(readFileSync(home.paths.approvalsDecided(id), "utf8")) as ApprovalItem;
}

describe("captured run-3 records", () => {
  it("carry the exact defect ISSUE-020 reports", () => {
    expect(Object.keys(RUN3_DECIDED)).toHaveLength(4);
    for (const item of Object.values(RUN3_DECIDED)) {
      expect(item.status).toBe("approved");
      expect(item.execution).toMatchObject({
        state: "approved",
        executor: "actor-retry",
        attempts: 0,
        nextAction: "actor_retry",
      });
      expect(item.execution?.actor).toBeUndefined();
    }
  });
});

describe("approved commands execute from the durable record", () => {
  it("runs the exact recorded command once and terminalizes executed", async () => {
    const home = seedRun3();
    const workdir = makeCheckout(home.root, "worktrees", APP, "op-10");
    try {
      const store = new ApprovalStore(home.root);
      // Re-homing happens on the ordinary reconcile every approvals/turn path
      // already performs — no filesystem surgery.
      await store.reconcile(NOW);
      const rehomed = readItem(home, PR_CREATE_ID);
      expect(rehomed.execution).toMatchObject({
        state: "approved",
        executor: "orchestrator-command",
        nextAction: "dispatch",
        attempts: 0,
      });
      // The decision, the action, and its authorization are untouched.
      expect(rehomed.action).toEqual(RUN3_DECIDED[PR_CREATE_ID]!.action);
      expect(rehomed.grantId).toBe(RUN3_DECIDED[PR_CREATE_ID]!.grantId);
      writeFileSync(
        home.paths.approvalsDecided(PR_CREATE_ID),
        `${JSON.stringify({ ...rehomed, workdir }, null, 2)}\n`,
        "utf8",
      );

      const run = recorder();
      const outcomes = await executeApprovedCommands({
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        runner: run.runner,
      });

      const outcome = outcomes.find((entry) => entry.approvalId === PR_CREATE_ID);
      expect(outcome).toMatchObject({ status: "executed", exitCode: 0, app: APP });
      expect(run.calls).toEqual([{
        command: (RUN3_DECIDED[PR_CREATE_ID]!.action.input as { command: string }).command,
        cwd: workdir,
      }]);
      expect(readItem(home, PR_CREATE_ID).execution).toMatchObject({
        state: "executed",
        executor: "orchestrator-command",
        actor: ORCHESTRATOR_COMMAND_ACTOR,
        attempts: 1,
        nextAction: "none",
      });
      // Single-use grant is spent exactly once.
      expect((await store.show(PR_CREATE_ID)).grant).toMatchObject({ uses: 0 });
    } finally {
      home.cleanup();
    }
  });

  it("records the re-homing in the append-only log without touching the action", async () => {
    const home = seedRun3();
    try {
      await new ApprovalStore(home.root).reconcile(NOW);
      const rehomings = (await new ApprovalStore(home.root).readLog())
        .filter((event): event is Extract<ApprovalLogEvent, { type: "executor-rehomed" }> =>
          event.type === "executor-rehomed");
      expect(rehomings).toHaveLength(4);
      expect(rehomings[0]).toMatchObject({
        from: "actor-retry",
        to: "orchestrator-command",
        at: NOW.toISOString(),
      });
    } finally {
      home.cleanup();
    }
  });

  it("is exactly-once: a second dispatch after success runs nothing", async () => {
    const home = seedRun3();
    const workdir = makeCheckout(home.root, "repos", APP);
    try {
      const store = new ApprovalStore(home.root);
      await store.reconcile(NOW);
      const run = recorder();
      const options = {
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        runner: run.runner,
      };
      const first = await executeApprovedCommands(options);
      expect(first.filter((entry) => entry.status === "executed")).toHaveLength(4);
      expect(run.calls).toHaveLength(4);
      expect(run.calls.every((call) => call.cwd === workdir)).toBe(true);

      const second = await executeApprovedCommands(options);
      expect(second).toEqual([]);
      expect(run.calls).toHaveLength(4);
    } finally {
      home.cleanup();
    }
  });

  it("records a non-zero exit as failed with a disposition next step", async () => {
    const home = seedRun3();
    makeCheckout(home.root, "repos", APP);
    try {
      await new ApprovalStore(home.root).reconcile(NOW);
      const outcomes = await executeApprovedCommands({
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        runner: async () => ({ exitCode: 1, stdout: "", stderr: "pull request already exists" }),
      });
      expect(outcomes.every((entry) => entry.status === "failed")).toBe(true);
      expect(readItem(home, PR_CREATE_ID).execution).toMatchObject({
        state: "failed",
        failureCause: "command_failed",
        nextAction: "retry_with_disposition",
        attempts: 1,
      });
      expect(readItem(home, PR_CREATE_ID).execution?.result).toContain("pull request already exists");
    } finally {
      home.cleanup();
    }
  });
});

describe("execution is bound to the approved action", () => {
  it("refuses an action whose recorded command no longer matches its grant", async () => {
    const home = seedRun3();
    makeCheckout(home.root, "repos", APP);
    try {
      await new ApprovalStore(home.root).reconcile(NOW);
      // The adversary edits the durable record after the human decided, to ride
      // an approval for `gh pr create --fill` into a different command.
      const tampered: ApprovalItem = {
        ...readItem(home, PR_CREATE_ID),
        action: {
          tool: "bash",
          input: { command: "/bin/zsh -lc 'gh pr merge 10 --squash --admin'" },
        },
      };
      writeFileSync(
        home.paths.approvalsDecided(PR_CREATE_ID),
        `${JSON.stringify(tampered, null, 2)}\n`,
        "utf8",
      );

      const run = recorder();
      const outcomes = await executeApprovedCommands({
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        runner: run.runner,
      });

      const outcome = outcomes.find((entry) => entry.approvalId === PR_CREATE_ID);
      expect(outcome).toMatchObject({ status: "failed", cause: "grant_unavailable" });
      expect(run.calls.some((call) => call.command.includes("gh pr merge"))).toBe(false);
      expect(readItem(home, PR_CREATE_ID).execution).toMatchObject({
        state: "failed",
        failureCause: "grant_unavailable",
      });
    } finally {
      home.cleanup();
    }
  });

  it("never runs anything once the grant is revoked", async () => {
    const home = seedRun3();
    makeCheckout(home.root, "repos", APP);
    try {
      const store = new ApprovalStore(home.root);
      await store.reconcile(NOW);
      for (const id of Object.keys(RUN3_DECIDED)) {
        store.revokeGrantSync(`grant-${id}`, NOW);
      }
      const run = recorder();
      const outcomes = await executeApprovedCommands({
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        runner: run.runner,
      });
      expect(run.calls).toEqual([]);
      // Revoking an unused grant already terminalizes the record, so the
      // executor has nothing left to claim.
      expect(outcomes).toEqual([]);
      expect(readItem(home, PR_CREATE_ID).execution).toMatchObject({
        state: "failed",
        failureCause: "grant_revoked",
      });
    } finally {
      home.cleanup();
    }
  });

  it("refuses a non-shell action instead of inventing an execution for it", async () => {
    const home = makeOrgHome({ approvals: true });
    try {
      const store = new ApprovalStore(home.root, { idSource: () => "typed-1" });
      await store.raise({
        app: APP,
        role: "sre",
        rule: "external-publishing",
        action: {
          tool: "operon.github.issue.create",
          input: { destination: "github", effect: "create_issue", repo: "x/y", title: "t", body: "b" },
        },
        now: NOW,
      });
      await store.decide("typed-1", { decision: "approved", now: NOW });
      // A typed GitHub delivery belongs to approval-delivery.ts, never here.
      expect((await store.show("typed-1")).item.execution?.executor).toBe("durable-github");
      const run = recorder();
      expect(await executeApprovedCommands({
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        runner: run.runner,
      })).toEqual([]);
      expect(run.calls).toEqual([]);
    } finally {
      home.cleanup();
    }
  });
});

describe("execution context is recorded, never guessed", () => {
  it("refuses when the recorded working directory is gone", async () => {
    const home = seedRun3({ workdir: "/nonexistent/worktrees/pruned" });
    makeCheckout(home.root, "repos", APP);
    try {
      await new ApprovalStore(home.root).reconcile(NOW);
      const run = recorder();
      const outcomes = await executeApprovedCommands({
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        runner: run.runner,
      });
      expect(run.calls).toEqual([]);
      expect(outcomes.every((entry) => entry.cause === "execution_context_unavailable")).toBe(true);
      // A managed clone exists, but substituting it could point a relative path
      // at a different tree — so it is refused, not silently swapped in.
      expect(readItem(home, PR_CREATE_ID).execution).toMatchObject({
        state: "failed",
        failureCause: "execution_context_unavailable",
        nextAction: "retry_with_disposition",
      });
    } finally {
      home.cleanup();
    }
  });

  it("refuses when there is neither a recorded workdir nor a managed clone", async () => {
    const home = seedRun3();
    try {
      await new ApprovalStore(home.root).reconcile(NOW);
      const run = recorder();
      const outcomes = await executeApprovedCommands({
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        runner: run.runner,
      });
      expect(run.calls).toEqual([]);
      expect(outcomes.every((entry) => entry.cause === "execution_context_unavailable")).toBe(true);
    } finally {
      home.cleanup();
    }
  });
});

describe("ambiguity is never blindly retried", () => {
  it("makes an interrupted orchestrator attempt ambiguous and stops", async () => {
    const home = seedRun3();
    makeCheckout(home.root, "repos", APP);
    try {
      await new ApprovalStore(home.root).reconcile(NOW);
      const run = recorder();
      const options = {
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        runner: run.runner,
      };
      // The process dies after the command ran but before acknowledgement.
      await expect(executeApprovedCommands({
        ...options,
        fault: (boundary) => {
          if (boundary === "after_command") throw new Error("dispatch killed");
        },
      })).rejects.toThrow("dispatch killed");
      expect(run.calls).toHaveLength(1);
      // The claim survives the crash, so the strand is visible rather than
      // silently re-runnable. The crash lands on the earliest decided record.
      expect(readItem(home, FIRST_DECIDED_ID).execution).toMatchObject({
        state: "executing",
        actor: ORCHESTRATOR_COMMAND_ACTOR,
        attempts: 1,
      });

      // A dispatch tick that overlaps a live execution must not invent
      // uncertainty about it.
      const overlapping = await executeApprovedCommands(options);
      expect(overlapping.find((entry) => entry.approvalId === FIRST_DECIDED_ID)).toMatchObject({
        status: "skipped",
        summary: expect.stringContaining("may still be in flight"),
      });

      // Past the staleness window the claim is a crashed attempt, and a generic
      // command has no remote marker to reconcile against.
      const later = new Date(NOW.getTime() + 20 * 60_000);
      const recovery = await executeApprovedCommands({ ...options, now: () => later });
      const stranded = recovery.find((entry) => entry.status === "ambiguous");
      expect(stranded?.approvalId).toBe(FIRST_DECIDED_ID);
      expect(stranded?.cause).toBe("ambiguous_command_result");
      expect(stranded?.summary).toContain("operon approvals disposition");
      // The interrupted command was NOT run a second time.
      expect(run.calls.filter((call) => call.command === run.calls[0]!.command)).toHaveLength(1);

      const again = await executeApprovedCommands({ ...options, now: () => later });
      expect(again.find((entry) => entry.approvalId === FIRST_DECIDED_ID)).toMatchObject({
        status: "skipped",
        summary: expect.stringContaining("needs a human disposition, never a retry"),
      });
    } finally {
      home.cleanup();
    }
  });

  it("records a killed-at-deadline command as ambiguous, not failed", async () => {
    const home = seedRun3();
    makeCheckout(home.root, "repos", APP);
    try {
      await new ApprovalStore(home.root).reconcile(NOW);
      const seen: number[] = [];
      const outcomes = await executeApprovedCommands({
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        timeoutMs: 1_234,
        runner: async ({ timeoutMs }) => {
          seen.push(timeoutMs);
          return { exitCode: 137, stdout: "", stderr: "", timedOut: true };
        },
      });
      expect(seen).toEqual([1_234, 1_234, 1_234, 1_234]);
      expect(outcomes.every((entry) => entry.status === "ambiguous")).toBe(true);
      expect(readItem(home, PR_CREATE_ID).execution).toMatchObject({
        state: "ambiguous",
        failureCause: "ambiguous_command_result",
        nextAction: "reconcile",
      });
    } finally {
      home.cleanup();
    }
  });

  it("lets a human disposition re-arm a failed command for the next dispatch", async () => {
    const home = seedRun3();
    makeCheckout(home.root, "repos", APP);
    try {
      const store = new ApprovalStore(home.root);
      await store.reconcile(NOW);
      const failing = recorder({ exitCode: 2, stderr: "transient network blip" });
      await executeApprovedCommands({
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        runner: failing.runner,
      });
      expect(readItem(home, PR_CREATE_ID).execution?.state).toBe("failed");

      await store.dispositionExecution({
        id: PR_CREATE_ID,
        disposition: "retry",
        reason: "network recovered; re-arm the exact approved command",
        actor: "human/operator",
        now: NOW,
      });
      expect(readItem(home, PR_CREATE_ID).execution).toMatchObject({
        state: "approved",
        nextAction: "dispatch",
      });

      const run = recorder();
      const outcomes = await executeApprovedCommands({
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        runner: run.runner,
      });
      expect(outcomes.find((entry) => entry.approvalId === PR_CREATE_ID)?.status).toBe("executed");
      expect(run.calls).toHaveLength(1);
    } finally {
      home.cleanup();
    }
  });
});

describe("a live actor still wins the race", () => {
  it("lets the raising turn consume the grant, and the orchestrator then runs nothing", async () => {
    const home = seedRun3();
    makeCheckout(home.root, "repos", APP);
    try {
      const store = new ApprovalStore(home.root);
      await store.reconcile(NOW);
      const action = {
        tool: "bash",
        input: RUN3_DECIDED[PR_CREATE_ID]!.action.input as Record<string, unknown>,
      };
      const gate = composeGate(defaultGate, store, {
        app: APP,
        role: "builder",
        turnId: "loop-sonnet4-buildstack-dev-1784627678794",
        now: () => NOW,
      });

      // The builder is still alive and re-attempts the approved action itself.
      expect(gate(action)).toEqual({ allow: true });
      expect(readItem(home, PR_CREATE_ID).execution).toMatchObject({
        state: "executing",
        actor: "actor-retry/builder/loop-sonnet4-buildstack-dev-1784627678794",
        attempts: 1,
      });

      const run = recorder();
      const outcomes = await executeApprovedCommands({
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        runner: run.runner,
      });
      expect(outcomes.find((entry) => entry.approvalId === PR_CREATE_ID)?.status).toBe("skipped");
      expect(run.calls.some((call) => call.command.includes("--fill"))).toBe(false);

      // The turn's own settlement still closes the record.
      const settled = await store.settleActorRetryExecutions({
        actor: "actor-retry/builder/loop-sonnet4-buildstack-dev-1784627678794",
        events: [{
          type: "tool_use",
          name: "bash",
          detail: "approved command",
          args: action.input,
          success: true,
        }],
        now: NOW,
      });
      expect(settled.find((item) => item.id === PR_CREATE_ID)?.execution).toMatchObject({
        state: "executed",
        nextAction: "none",
      });
    } finally {
      home.cleanup();
    }
  });

  it("keeps typed deliveries and releases out of the actor's reach", async () => {
    const home = makeOrgHome({ approvals: true });
    try {
      const store = new ApprovalStore(home.root, { idSource: () => "release-1" });
      const action = { tool: "bash", input: { command: "./deploy.sh --prod" } };
      await store.raise({
        app: APP,
        role: "sre",
        rule: "production-deploy",
        action,
        ticketRef: `${APP}#4`,
        now: NOW,
      });
      await store.decide("release-1", { decision: "approved", now: NOW });
      expect((await store.show("release-1")).item.execution?.executor).toBe("release");

      const gate = composeGate(defaultGate, store, {
        app: APP,
        role: "sre",
        turnId: "turn-1",
        ticketRef: `${APP}#4`,
        now: () => NOW,
      });
      const decision = gate(action);
      expect(decision.allow).toBe(false);
      if (!decision.allow) expect(decision.reason).toContain("is owned by release");

      const run = recorder();
      expect(await executeApprovedCommands({
        stateHome: home.root,
        appsFile: APPS,
        now: () => NOW,
        runner: run.runner,
      })).toEqual([]);
      expect(run.calls).toEqual([]);
    } finally {
      home.cleanup();
    }
  });
});

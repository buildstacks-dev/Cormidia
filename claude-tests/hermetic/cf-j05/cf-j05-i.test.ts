// CF-J05-I — process death inside the approval-execution journey
// (contracts/journey-acceptance.md J-05; contracts/B-17-typed-executor.md §3;
// OPERON-INV-003 falsifier (c) "kill between remote effect and
// acknowledgement, observe next tick's behavior"; system-map T-12; risk E-1):
//   leg 1 — SIGKILL between the human decision and the execution continuation:
//           nothing is lost and nothing runs twice — the next dispatch
//           performs the approved op exactly once;
//   leg 2 — SIGKILL between the external effect and its acknowledgement:
//           the next dispatch lands ambiguous-terminal and NEVER re-performs.
//
// L2 with a REAL killed subprocess: fixtures/kill-point.ts runs the product
// modules (composeGate → ApprovalStore.decide → executeApprovedCommands) in a
// child and SIGKILLs it at a named marker; the parent inspects surviving
// durable state at the real product paths and drives the next dispatch
// in-process. The external effect target is a file the scenario's injected
// runner appends to — its line count is the at-most-once oracle.

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeApprovedCommands } from "../../../src/org/approval-command.js";
import { ApprovalStore, approvalLifecycleState } from "../../../src/org/approvals.js";
import type { AppsFile } from "../../../src/org/apps.js";
import { makeTempGitRepo } from "../../fixtures/git-repo.js";
import { runKillPointScenario, type KillPointResult } from "../../fixtures/kill-point.js";
import { makeTestClock } from "../../fixtures/clock.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const APP = "gated-app";
const CRITICAL_COMMAND = "rm -rf /var/data/legacy-exports";

const APPS_FILE: AppsFile = {
  org: { name: "cf-j05-i", maxConcurrentTurns: 1 },
  defaults: { budgetUsdMonth: 100 },
  apps: [{ name: APP, repo: "operon-double/unused", status: "live", budgetUsdMonth: 100, cadence: {} }],
};

/** The child walks gate-block → raise → approve, then (unless killed first)
 *  dispatches with a runner that appends to the effect log and pauses at
 *  `effect-done` — the exact window between effect and acknowledgement. */
function scenarioSource(): string {
  return `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultGate } from ${JSON.stringify(join(REPO_ROOT, "src/runtime/gate.js"))};
import { ApprovalStore } from ${JSON.stringify(join(REPO_ROOT, "src/org/approvals.js"))};
import { composeGate } from ${JSON.stringify(join(REPO_ROOT, "src/org/gate-compose.js"))};
import { executeApprovedCommands } from ${JSON.stringify(join(REPO_ROOT, "src/org/approval-command.js"))};

const scratch = process.env.KP_SCRATCH!;
const stateHome = join(scratch, "state-home");
mkdirSync(stateHome, { recursive: true });
const store = new ApprovalStore(stateHome);
const gate = composeGate(defaultGate, store, {
  app: ${JSON.stringify(APP)},
  role: "builder",
  turnId: "turn-1",
  workdir: process.env.KP_WORKDIR!,
});
const decision = gate({ tool: "bash", input: { command: ${JSON.stringify(CRITICAL_COMMAND)} } });
if (decision.allow !== false) throw new Error("gate unexpectedly allowed the critical op");
const raised = (await store.listPending())[0];
if (raised === undefined) throw new Error("no pending approval was raised");
await store.decide(raised.id, { decision: "approved" });
writeFileSync(join(scratch, "approval-id.txt"), raised.id);
await kp("decided");
await executeApprovedCommands({
  stateHome,
  appsFile: {
    org: { name: "cf-j05-i", maxConcurrentTurns: 1 },
    defaults: { budgetUsdMonth: 100 },
    apps: [{ name: ${JSON.stringify(APP)}, repo: "operon-double/unused", status: "live", budgetUsdMonth: 100, cadence: {} }],
  },
  runner: async () => {
    appendFileSync(join(scratch, "effect.log"), "EFFECT\\n");
    await kp("effect-done");
    return { exitCode: 0, stdout: "purged", stderr: "" };
  },
});
await kp("acknowledged");
`;
}

interface Survivors {
  result: KillPointResult;
  stateHome: string;
  approvalId: string;
  effectLines: () => number;
  store: ApprovalStore;
}

describe("CF-J05-I — kill between decision/continuation and between effect/acknowledgement (L2, real SIGKILL)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function runScenario(killAt: string): Promise<Survivors> {
    const repo = await makeTempGitRepo({ defaultBranch: "trunk" });
    cleanups.push(() => repo.cleanup());
    const result = await runKillPointScenario({
      source: scenarioSource(),
      killAt,
      env: { KP_WORKDIR: repo.dir },
      timeoutMs: 25_000,
    });
    cleanups.push(() => result.cleanup());
    expect(result.timedOut).toBe(false);
    expect(result.killedAt).toBe(killAt);
    // KP_SCRATCH in the child IS result.stateDir — the surviving-state root.
    const scratch = result.stateDir;
    const stateHome = join(scratch, "state-home");
    const approvalId = readFileSync(join(scratch, "approval-id.txt"), "utf8").trim();
    const effectPath = join(scratch, "effect.log");
    return {
      result,
      stateHome,
      approvalId,
      effectLines: () =>
        existsSync(effectPath)
          ? readFileSync(effectPath, "utf8").split("\n").filter((line) => line === "EFFECT").length
          : 0,
      store: new ApprovalStore(stateHome),
    };
  }

  it("leg 1: killed between decision and continuation — the decision survives, and the next dispatch performs exactly once", async () => {
    const s = await runScenario("decided");
    expect(s.result.markers).toEqual(["decided"]);

    // Surviving durable state: approved-but-unexecuted, grant intact, no effect.
    const before = await s.store.show(s.approvalId);
    expect(before.item.execution?.state).toBe("approved");
    expect(before.item.execution?.attempts).toBe(0);
    expect(approvalLifecycleState(before.item)).toBe("approved"); // never rendered executed
    expect(before.grant!.uses).toBe(1);
    expect(before.grant!.consumedAt).toBeUndefined();
    expect(s.effectLines()).toBe(0);

    // The continuation: the next dispatch performs the approved op — once.
    let calls = 0;
    const outcomes = await executeApprovedCommands({
      stateHome: s.stateHome,
      appsFile: APPS_FILE,
      runner: async () => {
        calls += 1;
        return { exitCode: 0, stdout: "purged", stderr: "" };
      },
    });
    expect(calls).toBe(1);
    expect(outcomes[0]).toMatchObject({ approvalId: s.approvalId, status: "executed" });
    const after = await s.store.show(s.approvalId);
    expect(after.item.execution?.state).toBe("executed");
    expect(after.item.execution?.attempts).toBe(1);
    expect(after.grant!.uses).toBe(0);
  }, 30_000);

  it("leg 2 / negative control: killed between effect and acknowledgement — a willing re-dispatch NEVER re-performs; the ambiguity detector FIRES", async () => {
    const s = await runScenario("effect-done");
    expect(s.result.markers).toEqual(["decided", "effect-done"]);

    // Surviving durable state: a visible claimed attempt — grant consumed
    // BEFORE the command started, so the crash strands evidence, never a
    // consumed grant with TRY 0.
    const before = await s.store.show(s.approvalId);
    expect(before.item.execution?.state).toBe("executing");
    expect(before.item.execution?.attempts).toBe(1);
    expect(before.item.execution?.attemptedAt).toBeDefined();
    expect(before.grant!.uses).toBe(0);
    expect(s.effectLines()).toBe(1); // the effect reached the world exactly once

    // Clock anchored to the recorded attempt evidence. The in-flight/crashed
    // split point is a product-internal window; we assert behavior on either
    // side of it, not the constant itself.
    const clock = makeTestClock(before.item.execution!.attemptedAt!);
    const runWith = async () => {
      let calls = 0;
      const outcomes = await executeApprovedCommands({
        stateHome: s.stateHome,
        appsFile: APPS_FILE,
        now: clock.dateFn,
        // SEEDED VIOLATION-TEMPTATION: a runner perfectly willing to run the
        // command again. Any invocation would BE the INV-003 violation.
        runner: async () => {
          calls += 1;
          return { exitCode: 0, stdout: "purged again", stderr: "" };
        },
      });
      return { calls, outcomes };
    };

    // Shortly after the attempt: possibly still in flight — skipped, no
    // invented ambiguity, no re-perform.
    clock.advance(60_000);
    const fresh = await runWith();
    expect(fresh.calls).toBe(0);
    expect(fresh.outcomes[0]).toMatchObject({ status: "skipped" });
    expect(fresh.outcomes[0]!.summary).toContain("may still be in flight");
    expect((await s.store.show(s.approvalId)).item.execution?.state).toBe("executing");

    // Well past the window: the crashed attempt becomes durably ambiguous —
    // and the detector FIRES instead of re-performing.
    clock.advance(16 * 60_000);
    const stale = await runWith();
    expect(stale.calls).toBe(0);
    expect(stale.outcomes[0]).toMatchObject({ status: "ambiguous", cause: "ambiguous_command_result" });
    const ambiguous = await s.store.show(s.approvalId);
    expect(ambiguous.item.execution?.state).toBe("ambiguous");
    expect(ambiguous.item.execution?.nextAction).toBe("reconcile");
    expect(s.effectLines()).toBe(1);

    // Ambiguity is terminal for automation: further dispatches skip.
    const terminal = await runWith();
    expect(terminal.calls).toBe(0);
    expect(terminal.outcomes[0]).toMatchObject({ status: "skipped" });
    expect(terminal.outcomes[0]!.summary).toContain("human disposition, never a retry");
    expect(s.effectLines()).toBe(1);

    // Only an explicit human disposition closes it.
    const closed = await s.store.dispositionExecution({
      id: s.approvalId,
      disposition: "executed",
      reason: "operator confirmed the purge completed on the target",
      actor: "human/operator",
      now: clock.nowDate(),
    });
    expect(closed.execution?.state).toBe("executed");
    expect(s.effectLines()).toBe(1); // the effect was never re-performed
  }, 30_000);
});

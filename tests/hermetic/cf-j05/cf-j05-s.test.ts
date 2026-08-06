// CF-J05-S — gate block → item → approve → typed execution → executed with
// acknowledgement (contracts/journey-acceptance.md J-05; contracts/
// B-17-typed-executor.md §1/§2; CORMIDIA-INV-003/008; system-map T-2/T-12;
// risk E-1).
//
// L2 walk on real product code: the composed gate (composeGate + defaultGate)
// blocks the critical op and persists the exact action for review; the human
// decision mints the fresh single-use grant with the raw-command binding; a
// later dispatch (`executeApprovedCommands`, the typed orchestrator-command
// executor) performs exactly the approved bytes once and acknowledges. The
// only fakes sit at ratified seams: the injected command runner (the external
// effect target) and a real temp git repo as the recorded execution context.

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultGate } from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";
import { executeApprovedCommands, ORCHESTRATOR_COMMAND_ACTOR } from "../../../src/org/approval-command.js";
import {
  ApprovalStore,
  actionHash,
  approvalLifecycleState,
  commandIdentityHash,
  type ApprovalItem,
  type ApprovalLogEvent,
} from "../../../src/org/approvals.js";
import type { AppsFile } from "../../../src/org/apps.js";
import { composeGate } from "../../../src/org/gate-compose.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";

const APP = "gated-app";
const ROLE = "builder";
// Classifies critical under `destructive-local` (absolute-path rm),
// which is ORCHESTRATOR_EXECUTABLE — the typed orchestrator-command slice.
const CRITICAL_COMMAND = "rm -rf /var/data/legacy-exports";
const ACTION: ToolAction = { tool: "bash", input: { command: CRITICAL_COMMAND } };

interface Walk {
  home: TempStateHome;
  repo: TempGitRepo;
  store: ApprovalStore;
  clock: TestClock;
  appsFile: AppsFile;
}

describe("CF-J05-S — gate block → item → approve → typed execution → executed w/ acknowledgement (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeWalk(): Promise<Walk> {
    const home = await makeTempStateHome({ name: "cf-j05-s" });
    cleanups.push(() => home.cleanup());
    const repo = await makeTempGitRepo({ defaultBranch: "trunk" });
    cleanups.push(() => repo.cleanup());
    const clock = makeTestClock("2026-07-31T09:00:00.000Z");
    const appsFile: AppsFile = {
      org: { name: "cf-j05-s", maxConcurrentTurns: 1 },
      defaults: { budgetUsdMonth: 100, objectiveBudgetUsd: 1000 },
      apps: [
        {
          name: APP,
          repo: "cormidia-double/unused",
          status: "live",
          budgetUsdMonth: 100,
          objectiveBudgetUsd: 1000,
          cadence: {},
        },
      ],
    };
    return { home, repo, store: new ApprovalStore(home.stateHome), clock, appsFile };
  }

  it("walks the whole journey: exact op persisted at the block, decision ≠ execution, one acknowledged typed execution", async () => {
    const walk = await makeWalk();
    const gate = composeGate(defaultGate, walk.store, {
      app: APP,
      role: ROLE,
      turnId: "turn-1",
      ticketRef: "#12",
      workdir: walk.repo.dir,
      now: walk.clock.dateFn,
    });

    // 1 — the gate blocks the critical op (the turn ends blocked_on_gate on
    // this denial) and the EXACT op is persisted for review.
    const decision = gate(ACTION);
    if (decision.allow) throw new Error("gate unexpectedly allowed the critical op");
    expect(decision.escalate).toBe(true);
    expect(decision.reason).toContain("destructive-local");

    const pending = await walk.store.listPending();
    expect(pending).toHaveLength(1);
    const raised = pending[0]!;
    expect(raised.rule).toBe("destructive-local");
    expect((raised.action.input as { command: string }).command).toBe(CRITICAL_COMMAND);
    expect(raised.workdir).toBe(walk.repo.dir); // the context it was approved FOR
    expect(raised.classification?.rule).toBe("destructive-local");

    // 2 — approval is never execution (INV-003): the decision mints the
    // typed execution record + fresh single-use grant, nothing runs.
    const decided = await walk.store.decide(raised.id, { decision: "approved", now: walk.clock.nowDate() });
    expect(decided.execution).toMatchObject({
      state: "approved",
      executor: "orchestrator-command",
      attempts: 0,
      nextAction: "dispatch",
      idempotencyKey: `approval:${raised.id}:${actionHash(raised.action)}`,
    });
    expect(approvalLifecycleState(decided)).toBe("approved");
    const { grant } = await walk.store.show(raised.id);
    expect(grant).toMatchObject({ uses: 1, actionHash: actionHash(raised.action) });
    expect(grant!.scope).toBeUndefined();
    // The raw-command execution binding is minted at decision time.
    expect(grant!.commandSha256).toBe(commandIdentityHash(CRITICAL_COMMAND));

    // 3 — a later dispatch performs the typed execution: exact bytes, exact
    // recorded context, exactly once.
    const runnerCalls: Array<{ command: string; cwd: string }> = [];
    const run = () =>
      executeApprovedCommands({
        stateHome: walk.home.stateHome,
        appsFile: walk.appsFile,
        now: walk.clock.dateFn,
        runner: async (input) => {
          runnerCalls.push({ command: input.command, cwd: input.cwd });
          return { exitCode: 0, stdout: "purged", stderr: "" };
        },
      });
    const outcomes = await run();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ approvalId: raised.id, app: APP, status: "executed", exitCode: 0 });
    expect(runnerCalls).toEqual([{ command: CRITICAL_COMMAND, cwd: walk.repo.dir }]);

    // 4 — acknowledgement is a durable fact distinct from the decision (T-12).
    const acked = await walk.store.show(raised.id);
    expect(acked.item.execution).toMatchObject({
      state: "executed",
      attempts: 1,
      actor: ORCHESTRATOR_COMMAND_ACTOR,
      nextAction: "none",
    });
    expect(acked.item.execution?.finishedAt).toBeDefined();
    expect(acked.item.execution?.result).toContain("exit 0");
    expect(acked.grant!.uses).toBe(0);
    expect(acked.grant!.consumedAt).toBeDefined();

    const log = await walk.store.readLog();
    const rows = log.filter((event) => "id" in event && event.id === raised.id).map((event) => event.type);
    expect(rows).toEqual([
      "raised",
      "decided",
      "grant-minted",
      "execution-transition", // approved -> executing
      "grant-consumed",
      "execution-transition", // executing -> executed
    ]);
    const transitions = log.filter(
      (event): event is Extract<ApprovalLogEvent, { type: "execution-transition" }> =>
        event.type === "execution-transition",
    );
    expect(transitions.map((event) => `${event.from}->${event.to}`)).toEqual([
      "approved->executing",
      "executing->executed",
    ]);

    // 5 — at-most-once: a re-dispatch performs nothing further.
    const again = await run();
    expect(again).toEqual([]);
    expect(runnerCalls).toHaveLength(1);
  });

  it("negative control: a post-decision edit of the recorded command — the raw-byte binding detector FIRES and nothing runs", async () => {
    const walk = await makeWalk();
    const gate = composeGate(defaultGate, walk.store, {
      app: APP,
      role: ROLE,
      workdir: walk.repo.dir,
      now: walk.clock.dateFn,
    });
    gate(ACTION);
    const raised = (await walk.store.listPending())[0]!;
    await walk.store.decide(raised.id, { decision: "approved", now: walk.clock.nowDate() });

    // SEEDED VIOLATION (INV-003 falsifier "changed bytes executing under the
    // old approval", via the wrapper-prefix identity fold): an
    // `env INJECTED=pwned bash -c '…'` wrapper keeps the SEMANTIC action
    // identity — and therefore the grant match — but changes the literal bytes
    // the orchestrator would run with its own credentials.
    const decidedPath = join(walk.home.stateHome, "approvals", "decided", `${raised.id}.json`);
    const tampered = JSON.parse(readFileSync(decidedPath, "utf8")) as ApprovalItem;
    (tampered.action.input as { command: string }).command = `env INJECTED=pwned bash -c '${CRITICAL_COMMAND}'`;
    writeFileSync(decidedPath, `${JSON.stringify(tampered, null, 2)}\n`);
    // The fold really is identity-preserving — which is exactly why the
    // separately-stored raw-byte binding must exist and fire.
    expect(actionHash(tampered.action)).toBe(actionHash(raised.action));

    let runnerCalls = 0;
    const outcomes = await executeApprovedCommands({
      stateHome: walk.home.stateHome,
      appsFile: walk.appsFile,
      now: walk.clock.dateFn,
      runner: async () => {
        runnerCalls += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(runnerCalls).toBe(0);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ status: "failed", cause: "command_binding_mismatch" });
    const after = await walk.store.show(raised.id);
    expect(after.item.execution?.state).toBe("failed");
    expect(after.item.execution?.result).toContain("binds a different command");
  });

  it("a pruned recorded workdir refuses execution rather than substituting a different tree", async () => {
    const walk = await makeWalk();
    const gate = composeGate(defaultGate, walk.store, {
      app: APP,
      role: ROLE,
      workdir: walk.repo.dir,
      now: walk.clock.dateFn,
    });
    gate(ACTION);
    const raised = (await walk.store.listPending())[0]!;
    await walk.store.decide(raised.id, { decision: "approved", now: walk.clock.nowDate() });
    await walk.repo.cleanup(); // the approved-for context disappears

    let runnerCalls = 0;
    const outcomes = await executeApprovedCommands({
      stateHome: walk.home.stateHome,
      appsFile: walk.appsFile,
      now: walk.clock.dateFn,
      runner: async () => {
        runnerCalls += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(runnerCalls).toBe(0);
    expect(outcomes[0]).toMatchObject({ status: "failed", cause: "execution_context_unavailable" });
    expect(outcomes[0]!.summary).toContain("no longer a checkout");
  });
});

// CF-J05-A — the queue CLI and the observe read-only view agree on approval
// state, and an approved-but-unexecuted item is NEVER rendered executed on
// any surface (contracts/journey-acceptance.md J-05; CORMIDIA-INV-008 "no
// surface reads approved as executed"; contracts/B-17-typed-executor.md §2;
// risk E-3).
//
// L2 on real product code: `cmdApprovals` (the real CLI module, JSON views,
// stdout captured) and `indexLocalSources` + `projectObserveSnapshot` (the
// real observe read model) over ONE seeded temp state home holding every
// lifecycle state: pending, denied, approved-unexecuted, ambiguous, executed.
// HOME is redirected into the fixture so the CLI's active-org pointer read
// never touches the operator's real ~/.cormidia.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { cmdApprovals } from "../../../src/cli/approvals.js";
import {
  ApprovalStore,
  approvalLifecycleState,
  type ApprovalItem,
} from "../../../src/org/approvals.js";
import { loadApps } from "../../../src/org/apps.js";
import { join } from "node:path";
import { indexLocalSources } from "../../../src/observe/file-index.js";
import { projectObserveSnapshot } from "../../../src/observe/project.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";

const APP = "gated-app";
const ROLE = "builder";

interface SeededIds {
  pending: string;
  denied: string;
  approvedUnexecuted: string;
  ambiguous: string;
  executed: string;
}

interface CliListView {
  pending: ApprovalItem[];
  outstanding: Array<ApprovalItem & { lifecycleState: string }>;
}

interface CliStatusView {
  executions: Array<ApprovalItem & { lifecycleState: string }>;
}

async function seedLifecycleStates(store: ApprovalStore, clock: TestClock): Promise<SeededIds> {
  const raise = async (command: string) =>
    (
      await store.raise({
        app: APP,
        role: ROLE,
        rule: "destructive-or-irreversible",
        action: { tool: "bash", input: { command } },
        now: clock.nowDate(),
      })
    ).id;

  const pending = await raise("rm -rf /var/data/a");

  const denied = await raise("rm -rf /var/data/b");
  await store.decide(denied, { decision: "denied", reason: "out of scope", now: clock.nowDate() });

  const approvedUnexecuted = await raise("rm -rf /var/data/c");
  await store.decide(approvedUnexecuted, { decision: "approved", now: clock.nowDate() });

  // The executing seeds mirror the real executor's ordering exactly:
  // claim (begin) → consume the single-use grant → terminal acknowledgement.
  const ambiguous = await raise("rm -rf /var/data/d");
  const ambiguousDecided = await store.decide(ambiguous, { decision: "approved", now: clock.nowDate() });
  await store.beginExecution(ambiguous, "orchestrator/approval-command", clock.nowDate());
  store.consumeGrantSync(ambiguousDecided.grantId!, clock.nowDate());
  await store.finishExecution({
    id: ambiguous,
    state: "ambiguous",
    actor: "orchestrator/approval-command",
    result: "execution stopped before acknowledgement",
    failureCause: "ambiguous_command_result",
    now: clock.nowDate(),
  });

  const executed = await raise("rm -rf /var/data/e");
  const executedDecided = await store.decide(executed, { decision: "approved", now: clock.nowDate() });
  await store.beginExecution(executed, "orchestrator/approval-command", clock.nowDate());
  store.consumeGrantSync(executedDecided.grantId!, clock.nowDate());
  await store.finishExecution({
    id: executed,
    state: "executed",
    actor: "orchestrator/approval-command",
    result: "exit 0",
    now: clock.nowDate(),
  });

  return { pending, denied, approvedUnexecuted, ambiguous, executed };
}

/** Run the real CLI module with stdout captured and HOME confined to the
 *  fixture (the CLI's pointer read must never touch the real ~/.cormidia). */
async function runApprovalsCli(org: TempOrgHome, args: string[]): Promise<unknown> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...chunks: unknown[]) => {
    lines.push(chunks.map(String).join(" "));
  });
  const savedHome = process.env["HOME"];
  process.env["HOME"] = org.homeDir;
  try {
    const code = await cmdApprovals([
      "--org-home",
      org.orgHome,
      "--state-home",
      org.stateHome,
      ...args,
    ]);
    expect(code).toBe(0);
  } finally {
    spy.mockRestore();
    if (savedHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = savedHome;
  }
  return JSON.parse(lines.join("\n"));
}

describe("CF-J05-A — queue CLI and observe read-only view agree; approved is never rendered executed (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeWalk(): Promise<{ org: TempOrgHome; store: ApprovalStore; clock: TestClock; ids: SeededIds }> {
    const org = await makeTempOrgHome({ name: "cf-j05-a" });
    cleanups.push(() => org.cleanup());
    const clock = makeTestClock("2026-07-31T09:00:00.000Z");
    const store = new ApprovalStore(org.stateHome);
    const ids = await seedLifecycleStates(store, clock);
    return { org, store, clock, ids };
  }

  it("every lifecycle state renders consistently across CLI list/status and the observe projection", async () => {
    const { org, store, clock, ids } = await makeWalk();
    // Sweep guard: the comparison below walks real decided records — prove
    // the walk is non-empty before trusting any agreement (no green by absence).
    await assertNonEmptyWalk(join(org.stateHome, "approvals", "decided"), /\.json$/);

    // --- Surface 1: the queue CLI (real cmdApprovals, JSON views).
    const list = (await runApprovalsCli(org, ["--json"])) as CliListView;
    const status = (await runApprovalsCli(org, ["status", "--json"])) as CliStatusView;

    expect(list.pending.map((item) => item.id)).toEqual([ids.pending]);
    const outstandingById = new Map(list.outstanding.map((item) => [item.id, item]));
    expect(outstandingById.get(ids.approvedUnexecuted)?.lifecycleState).toBe("approved");
    expect(outstandingById.get(ids.ambiguous)?.lifecycleState).toBe("ambiguous");
    expect(outstandingById.has(ids.executed)).toBe(false); // acknowledged work leaves the queue
    expect(outstandingById.has(ids.denied)).toBe(false); // denials never enter the execution queue
    const statusById = new Map(status.executions.map((item) => [item.id, item]));
    expect(statusById.get(ids.executed)?.lifecycleState).toBe("executed");
    expect(statusById.get(ids.approvedUnexecuted)?.lifecycleState).toBe("approved");

    // --- Surface 2: the observe read model (real index + projection).
    const appsFile = await loadApps(join(org.orgHome, "apps.yaml"));
    const local = await indexLocalSources({
      orgName: org.orgName,
      stateHome: org.stateHome,
      appsFile,
      filters: {},
      now: clock.nowDate(),
    });
    const snapshot = projectObserveSnapshot({ ...local, cursor: "cf-j05-a", github: [] });
    const observeById = new Map(snapshot.approvals.map((view) => [view.approval_id, view]));
    expect(snapshot.approvals).toHaveLength(5);
    expect(snapshot.totals.pending_approvals).toBe(1);

    // --- Agreement: both surfaces tell the same story per item, and the
    // authoritative store state backs them.
    const expected: Array<[string, string, string | null, string]> = [
      // [id, observe status, observe execution_state, store lifecycle]
      [ids.pending, "pending", null, "pending"],
      [ids.denied, "denied", null, "denied"],
      [ids.approvedUnexecuted, "granted", "approved", "approved"],
      [ids.ambiguous, "consumed", "ambiguous", "ambiguous"],
      [ids.executed, "consumed", "executed", "executed"],
    ];
    for (const [id, obsStatus, obsExecution, lifecycle] of expected) {
      const view = observeById.get(id);
      expect(view, id).toBeDefined();
      expect(view!.status, id).toBe(obsStatus);
      expect(view!.execution_state, id).toBe(obsExecution);
      const { item } = await store.show(id);
      expect(approvalLifecycleState(item), id).toBe(lifecycle);
    }

    // --- INV-008 anchor: the approved-but-unexecuted item is not rendered
    // executed by ANY surface.
    const approvedView = observeById.get(ids.approvedUnexecuted)!;
    expect(approvedView.execution_state).not.toBe("executed");
    expect(approvedView.status).not.toBe("consumed");
    expect(approvedView.execution_attempts).toBe(0);
    expect(outstandingById.get(ids.approvedUnexecuted)!.lifecycleState).not.toBe("executed");

    // The observe surface flags the ambiguous delivery as needing attention —
    // read-only projection surfaces the stall instead of hiding it.
    expect(
      snapshot.attention.some(
        (entry) => entry.kind === "approval_delivery" && entry.entity_id === `approval:${ids.ambiguous}`,
      ),
    ).toBe(true);
  });

  it("negative control: a torn decided record — both surfaces refuse to render a silently healthy queue (degraded/loud, never green by absence)", async () => {
    const { org, ids } = await makeWalk();
    // SEEDED VIOLATION: the executed item's decided record is torn mid-write.
    const tornPath = join(org.stateHome, "approvals", "decided", `${ids.executed}.json`);
    const whole = readFileSync(tornPath, "utf8");
    writeFileSync(tornPath, whole.slice(0, Math.floor(whole.length / 2)));

    // Observe: the approvals source degrades and NAMES the torn record.
    const appsFile = await loadApps(join(org.orgHome, "apps.yaml"));
    const local = await indexLocalSources({
      orgName: org.orgName,
      stateHome: org.stateHome,
      appsFile,
      filters: {},
      now: new Date("2026-07-31T09:00:00.000Z"),
    });
    const approvalsHealth = local.source_health.find((entry) => entry.id === "approvals");
    expect(approvalsHealth?.status).toBe("degraded");
    expect(approvalsHealth?.detail).toContain(`${ids.executed}.json`);
    const snapshot = projectObserveSnapshot({ ...local, cursor: "cf-j05-a-nc", github: [] });
    expect(snapshot.approvals.map((view) => view.approval_id)).not.toContain(ids.executed);

    // CLI: loud failure, never a quietly shortened queue.
    await expect(runApprovalsCli(org, ["--json"])).rejects.toThrow();
  });
});
